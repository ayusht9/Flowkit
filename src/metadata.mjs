import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { validateImage, findImageMagick } from './image.mjs';
import { validateMedia } from './media.mjs';
import { validatePdf } from './pdf.mjs';
import { runPdfWorker } from './pdf-worker-client.mjs';

const execute = promisify(execFile);
const mimeTypes = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', odt: 'application/vnd.oasis.opendocument.text', epub: 'application/epub+zip',
  html: 'text/html', htm: 'text/html', txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', rtf: 'application/rtf', tex: 'application/x-tex', rst: 'text/x-rst' };
const bounded = value => typeof value === 'string' ? value.slice(0, 200) : undefined;
const finite = value => Number.isFinite(Number(value)) ? Number(value) : undefined;

export async function inspectFile(file, { signal, qpdf = process.env.QPDF_PATH || 'qpdf', imageExecutable = findImageMagick(),
  ffprobe = process.env.FFPROBE_PATH || 'ffprobe', timeoutMs = 10_000 } = {}) {
  if (!file || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 255 || /[/\\\0]/.test(file.name) ||
      !(file.data instanceof Uint8Array) || !file.data.length || file.data.length > 20 * 1024 * 1024)
    throw new TypeError('Metadata requires a filename and 1 byte to 20 MiB of file data');
  signal?.throwIfAborted();
  const data = Buffer.from(file.data);
  const extension = extname(file.name).slice(1).toLowerCase();
  let detectedExtension = extension;
  if (data.subarray(0, 5).toString() === '%PDF-') detectedExtension = 'pdf';
  else if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) detectedExtension = 'png';
  else if (data[0] === 255 && data[1] === 216 && data[2] === 255) detectedExtension = 'jpg';
  else if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE') detectedExtension = 'wav';
  const kind = detectedExtension === 'pdf' ? 'pdf' : ['png', 'jpg', 'jpeg'].includes(detectedExtension) ? 'image'
    : ['wav', 'mp3', 'm4a'].includes(detectedExtension) ? 'audio' : ['mp4', 'mov', 'webm', 'mkv'].includes(detectedExtension) ? 'video' : 'document';
  const report = { name: file.name, sizeBytes: data.length, extension, detectedExtension, kind,
    mimeType: mimeTypes[detectedExtension] || 'application/octet-stream', status: 'complete', details: {}, warnings: [] };
  if (extension !== detectedExtension && !(['jpg', 'jpeg'].includes(extension) && detectedExtension === 'jpg'))
    report.warnings.push('File contents do not match the filename extension');
  const directory = await mkdtemp(join(tmpdir(), 'flowkit-metadata-'));
  const path = join(directory, `input.${/^[a-z0-9]{1,10}$/.test(detectedExtension) ? detectedExtension : 'bin'}`);
  const settings = { cwd: directory, signal, timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true };
  try {
    await writeFile(path, data, { signal, mode: 0o600 });
    if (kind === 'pdf') {
      validatePdf({ name: 'input.pdf', data });
      let encrypted = true;
      try { await execute(qpdf, [path, '--is-encrypted'], settings); }
      catch (error) { if (error.code === 2) encrypted = false; else throw error; }
      report.details.encrypted = encrypted;
      if (encrypted) {
        report.details.pageCount = null;
        report.warnings.push('Page count and document properties are unavailable while the PDF is encrypted');
      } else {
        const count = Number((await execute(qpdf, [path, '--show-npages'], settings)).stdout.trim());
        if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('PDF page limit');
        report.details.pageCount = count;
        Object.assign(report.details, await runPdfWorker({ action: 'metadata', inputPath: path }, { signal, timeoutMs }));
      }
    } else if (kind === 'image') {
      validateImage({ name: `input.${detectedExtension}`, data });
      const format = detectedExtension === 'png' ? 'png' : 'jpeg';
      const { stdout } = await execute(imageExecutable, ['-limit', 'memory', '128MiB', '-limit', 'map', '128MiB', '-limit', 'disk', '256MiB',
        '-limit', 'thread', '1', '-limit', 'time', '10', '-ping', `${format}:${path}[0]`, '-format', '%w %h %z %[colorspace] %[orientation]', 'info:'],
      { ...settings, env: { ...process.env, MAGICK_TEMPORARY_PATH: directory } });
      const [width, height, depth, colorspace, orientation] = stdout.trim().split(/\s+/);
      if (![width, height].every(value => Number.isSafeInteger(Number(value)) && Number(value) > 0)) throw new Error('Invalid dimensions');
      const swapped = ['LeftTop', 'RightTop', 'RightBottom', 'LeftBottom'].includes(orientation);
      report.details = { width: Number(swapped ? height : width), height: Number(swapped ? width : height),
        storedWidth: Number(width), storedHeight: Number(height), bitDepth: finite(depth), colorspace: bounded(colorspace), orientation: bounded(orientation) };
      if (Number(width) * Number(height) > 16_000_000) report.warnings.push('Image exceeds the 16 million pixel processing limit');
    } else if (kind === 'audio' || kind === 'video') {
      validateMedia({ name: `input.${detectedExtension}`, data }, kind);
      const demuxer = { wav: 'wav', mp3: 'mp3', m4a: 'mov', mp4: 'mov', mov: 'mov', webm: 'matroska', mkv: 'matroska' }[detectedExtension];
      const { stdout } = await execute(ffprobe, ['-v', 'error', '-max_alloc', '67108864', '-protocol_whitelist', 'file,pipe', '-f', demuxer,
        ...(demuxer === 'mov' ? ['-enable_drefs', '0'] : []), '-show_entries', 'format=duration,format_name,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate,channels,sample_rate,bit_rate', '-of', 'json', path], settings);
      const info = JSON.parse(stdout);
      report.details = { durationSeconds: finite(info.format?.duration), container: bounded(info.format?.format_name), bitRate: finite(info.format?.bit_rate),
        streams: (info.streams || []).slice(0, 16).map(stream => ({ type: bounded(stream.codec_type), codec: bounded(stream.codec_name),
          width: finite(stream.width), height: finite(stream.height), channels: finite(stream.channels), sampleRate: finite(stream.sample_rate), frameRate: bounded(stream.r_frame_rate) })) };
      if (report.details.durationSeconds > 300) report.warnings.push('Media exceeds the five-minute processing limit');
    } else if (['txt', 'md', 'markdown', 'html', 'htm', 'tex', 'rst', 'rtf'].includes(extension)) {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
      let lineCount = 1;
      for (let index = 0; index < text.length; index++) {
        if (text[index] === '\r') { lineCount++; if (text[index + 1] === '\n') index++; }
        else if (text[index] === '\n') lineCount++;
      }
      report.details = { encoding: 'UTF-8', characterCount: text.length, lineCount };
    } else if (['docx', 'odt', 'epub'].includes(extension)) {
      if (!data.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) throw new Error('Document signature mismatch');
      report.details = { container: 'ZIP', format: extension.toUpperCase() };
    }
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error;
    report.status = 'partial';
    report.warnings.push(error.code === 'ENOENT'
      ? 'A required metadata processor is missing; run flowkit-mcp --doctor'
      : 'Detailed metadata is unavailable for this file or exceeded the inspection limits');
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  if (report.warnings.length) report.status = 'partial';
  return report;
}
