import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { assertRecord } from './operations.mjs';
import { imageOperations } from './image-operations.mjs';

const execute = promisify(execFile);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const defaultImageExecutable = process.platform === 'win32' ? 'magick' : 'convert';

export function findImageMagick() {
  if (process.env.IMAGEMAGICK_PATH) return process.env.IMAGEMAGICK_PATH;
  for (const candidate of [
    resolve('.tools/imagemagick/magick.exe'),
    resolve('../.tools/imagemagick/magick.exe'),
  ]) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {}
  }
  return defaultImageExecutable;
}

export function validateImage(value) {
  assertRecord(value, 'Image');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 255 || /[/\\\0]/.test(value.name))
    throw new TypeError('Image name must be a filename without directory components');
  if (!(value.data instanceof Uint8Array) || !value.data.byteLength || value.data.byteLength > 20 * 1024 * 1024)
    throw new TypeError('Image data must contain between 1 byte and 20 MiB');
  const bytes = Buffer.from(value.data);
  const extension = extname(value.name).toLowerCase();
  const png = extension === '.png' && bytes.subarray(0, 8).equals(pngSignature);
  const jpeg = ['.jpg', '.jpeg'].includes(extension) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg) throw new TypeError('Choose a PNG or JPEG with a matching file signature');
}

/** Executable and limits are trusted server settings, never workflow options. */
export function createImageResize({ executable = findImageMagick(), timeoutMs = 30_000 } = {}) {
  return createImageOperation('image.resize', { executable, timeoutMs });
}

export function createImageOperation(operation, { executable = findImageMagick(), timeoutMs = 30_000 } = {}) {
  const definition = imageOperations.find(item => item.type === operation);
  if (!definition) throw new TypeError('Unknown image operation');
  if (typeof executable !== 'string' || !executable.trim()) throw new TypeError('Expected an ImageMagick executable');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('Timeout must be a positive integer');
  return {
    inputType: 'image', outputType: 'image',
    validateInput: validateImage,
    validateOutput: validateImage,
    validateOptions(options) {
      if (Object.keys(options).some(key => !definition.fields.some(field => field.key === key)))
        throw new TypeError(`${definition.title} accepts only its documented options`);
      if (operation === 'image.resize' && options.width === undefined && options.height === undefined)
        throw new TypeError('Set a resize width or height');
      for (const field of definition.fields) {
        const value = options[field.key];
        if (value === undefined && !field.required) continue;
        if (field.choices ? !field.choices.includes(value) :
          typeof value !== 'number' || !Number.isFinite(value) || (field.step === 1 && !Number.isSafeInteger(value)) || value < field.min || value > field.max)
          throw new TypeError(`${field.label}: ${field.choices ? `choose ${field.choices.join(', ')}` : `use ${field.step === 1 ? 'an integer' : 'a number'} between ${field.min} and ${field.max}`}`);
      }
    },
    async run(input, options, { signal }) {
      signal?.throwIfAborted();
      const directory = await mkdtemp(join(tmpdir(), 'flowkit-image-'));
      try {
        const { name, data } = input.value;
        const format = extname(name).toLowerCase() === '.png' ? 'png' : 'jpeg';
        const path = join(directory, `input.${format}`);
        await writeFile(path, data, { signal, mode: 0o600 });
        // Blur/sharpen need several pixel caches, even when the uploaded JPEG is tiny.
        // Keep heap usage bounded and spill into this operation's private directory.
        const limits = ['-limit', 'memory', '128MiB', '-limit', 'map', '256MiB', '-limit', 'disk', '1GiB',
          '-limit', 'thread', '1', '-limit', 'time', '30', '-limit', 'width', '8192', '-limit', 'height', '8192'];
        const settings = { cwd: directory, signal, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer', windowsHide: true,
          env: { ...process.env, MAGICK_TEMPORARY_PATH: directory } };
        // Force the decoder and select a single frame; uploaded filenames never become arguments.
        const source = `${format}:${path}[0]`;
        const metadata = await execute(executable, [...limits, '-ping', source, '-format', '%w %h %[orientation]', 'info:'], settings);
        const [rawWidth, rawHeight, orientation] = metadata.stdout.toString().trim().split(/\s+/);
        let width = Number(rawWidth), height = Number(rawHeight);
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 16_000_000)
          throw new RangeError('Images must contain at most 16 million pixels');
        if (['LeftTop', 'RightTop', 'RightBottom', 'LeftBottom'].includes(orientation)) [width, height] = [height, width];
        signal?.throwIfAborted();
        let args;
        switch (operation) {
          case 'image.resize': args = ['-resize', `${options.width ?? ''}x${options.height ?? ''}`]; break;
          case 'image.crop': {
            const { x = 0, y = 0 } = options;
            if (x + options.width > width || y + options.height > height)
              throw new RangeError('Crop rectangle must fit inside the oriented image');
            args = ['+repage', '-crop', `${options.width}x${options.height}+${x}+${y}`, '+repage']; break;
          }
          case 'image.rotate': args = ['-rotate', String(options.degrees ?? 90), '+repage']; break;
          case 'image.flip': args = (options.direction ?? 'horizontal') === 'horizontal' ? ['-flop'] : options.direction === 'both' ? ['-flip', '-flop'] : ['-flip']; break;
          case 'image.grayscale': args = ['-colorspace', 'Gray']; break;
          case 'image.blur': args = ['-blur', `0x${options.sigma ?? 1}`]; break;
          case 'image.sharpen': args = ['-sharpen', `0x${options.sigma ?? 1}`]; break;
          case 'image.convert': args = []; break;
        }
        const jpeg = operation === 'image.convert' && options.format === 'jpeg';
        const encoding = jpeg ? ['-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-quality', String(options.quality ?? 85), 'JPEG:-'] : ['PNG:-'];
        const { stdout: output } = await execute(executable, [...limits, source, '-auto-orient', ...args, '-strip', ...encoding], settings);
        if (jpeg ? output[0] !== 255 || output[1] !== 216 || output[2] !== 255 :
          !output.subarray(0, 8).equals(pngSignature) || output.length < 24) throw new Error('Invalid image output');
        const outputWidth = jpeg ? width : output.readUInt32BE(16), outputHeight = jpeg ? height : output.readUInt32BE(20);
        if (!outputWidth || !outputHeight || outputWidth * outputHeight > 16_000_000) throw new Error('Invalid output dimensions');
        return { type: 'image', value: { name: `${name.replace(/\.[^.]+$/, '').slice(0, 200)}-${definition.suffix}.${jpeg ? 'jpg' : 'png'}`, source: name,
          data: output, mimeType: jpeg ? 'image/jpeg' : 'image/png', width: outputWidth, height: outputHeight } };
      } catch (error) {
        if (signal?.aborted) throw error;
        if (error.code === 'ENOENT') throw new Error('ImageMagick was not found. Install it or set IMAGEMAGICK_PATH to magick (v7) or convert (v6).', { cause: error });
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('Image output exceeded the 8 MiB limit', { cause: error });
        if (error.killed || /time limit exceeded/i.test(error.stderr?.toString() || ''))
          throw new Error(`ImageMagick exceeded its ${timeoutMs} ms execution limit; try a smaller image or lower effect strength`, { cause: error });
        if (/cache resources exhausted|memory allocation failed|unable to extend cache|disk allocation failed|width or height exceeds limit/i.test(error.stderr?.toString() || ''))
          throw new Error('ImageMagick reached its memory or temporary-cache limit; resize the image first or lower the effect strength', { cause: error });
        if (error instanceof RangeError) throw error;
        throw new Error(`Image ${operation.slice(6)} failed; check image content and the 16 million pixel limit`, { cause: error });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
