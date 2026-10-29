import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { assertRecord } from './operations.mjs';

const execute = promisify(execFile);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const defaultImageExecutable = process.platform === 'win32' ? 'magick' : 'convert';

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
export function createImageResize({ executable = process.env.IMAGEMAGICK_PATH || defaultImageExecutable, timeoutMs = 30_000 } = {}) {
  if (typeof executable !== 'string' || !executable.trim()) throw new TypeError('Expected an ImageMagick executable');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('Timeout must be a positive integer');
  return {
    inputType: 'image', outputType: 'image',
    validateInput: validateImage,
    validateOutput: validateImage,
    validateOptions(options) {
      if (Object.keys(options).some(key => !['width', 'height'].includes(key)))
        throw new TypeError('Resize accepts only width and height');
      if (options.width === undefined && options.height === undefined)
        throw new TypeError('Set a resize width or height');
      for (const key of ['width', 'height']) {
        if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key] < 1 || options[key] > 4096))
          throw new TypeError('Resize dimensions must be integers between 1 and 4096 pixels');
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
        const limits = ['-limit', 'memory', '128MiB', '-limit', 'map', '256MiB', '-limit', 'disk', '0',
          '-limit', 'thread', '1', '-limit', 'time', '30', '-limit', 'width', '8192', '-limit', 'height', '8192'];
        const settings = { cwd: directory, signal, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer', windowsHide: true };
        // Force the decoder and select a single frame; uploaded filenames never become arguments.
        const source = `${format}:${path}[0]`;
        const metadata = await execute(executable, [...limits, '-ping', source, '-format', '%w %h', 'info:'], settings);
        const [width, height] = metadata.stdout.toString().trim().split(/\s+/).map(Number);
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 16_000_000)
          throw new Error('Images must contain at most 16 million pixels');
        signal?.throwIfAborted();
        const { stdout } = await execute(executable, [...limits, source, '-auto-orient', '-resize',
          `${options.width ?? ''}x${options.height ?? ''}`, '-strip', 'PNG:-'], settings);
        if (!stdout.subarray(0, 8).equals(pngSignature) || stdout.length < 24) throw new Error('Invalid image output');
        return { type: 'image', value: { name: `${name.replace(/\.[^.]+$/, '')}-resized.png`, source: name,
          data: stdout, mimeType: 'image/png', width: stdout.readUInt32BE(16), height: stdout.readUInt32BE(20) } };
      } catch (error) {
        if (signal?.aborted) throw error;
        if (error.code === 'ENOENT') throw new Error('ImageMagick was not found. Install it or set IMAGEMAGICK_PATH to magick (v7) or convert (v6).', { cause: error });
        if (error.killed) throw new Error(`ImageMagick exceeded its ${timeoutMs} ms execution limit`, { cause: error });
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('Image output exceeded the 8 MiB limit', { cause: error });
        throw new Error('Image resize failed; check image content and the 16 million pixel limit', { cause: error });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
