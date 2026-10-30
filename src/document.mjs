import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { assertRecord } from './operations.mjs';

const execute = promisify(execFile);
const formats = new Map([['.docx', 'docx'], ['.odt', 'odt'], ['.html', 'html'], ['.htm', 'html'], ['.epub', 'epub'], ['.md', 'commonmark']]);
const archiveFormats = new Set(['.docx', '.odt', '.epub']);
const maxInputBytes = 20 * 1024 * 1024;
const maxOutputBytes = 20 * 1024 * 1024;
const targets = Object.freeze({
  html: { format: 'html5', extension: '.html', mimeType: 'text/html', arguments: ['--standalone'] },
  docx: { format: 'docx', extension: '.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  odt: { format: 'odt', extension: '.odt', mimeType: 'application/vnd.oasis.opendocument.text' },
  epub: { format: 'epub3', extension: '.epub', mimeType: 'application/epub+zip' },
  pdf: { format: 'pdf', extension: '.pdf', mimeType: 'application/pdf', arguments: ['--pdf-engine=pdfroff'] },
});

function validateDocument(value) {
  assertRecord(value, 'Document');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 255 || /[/\\\0]/.test(value.name)) {
    throw new TypeError('Document name must be a filename without directory components');
  }
  const extension = extname(value.name).toLowerCase();
  if (!formats.has(extension)) throw new TypeError('Supported documents: DOCX, ODT, HTML, EPUB, and Markdown');
  if (!(value.data instanceof Uint8Array) || value.data.byteLength === 0 || value.data.byteLength > maxInputBytes) {
    throw new TypeError('Document data must contain between 1 byte and 20 MiB');
  }
  if (archiveFormats.has(extension) && !Buffer.from(value.data.subarray(0, 4)).equals(Buffer.from([0x50, 0x4b, 3, 4]))) {
    throw new TypeError('DOCX, ODT, and EPUB documents must have a ZIP file signature');
  }
}

function settings(executable, timeoutMs) {
  if (typeof executable !== 'string' || !executable.trim()) throw new TypeError('Expected a Pandoc executable');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('Timeout must be a positive integer');
}

function conversionError(error, signal, timeoutMs) {
  if (signal?.aborted) throw error;
  if (error.code === 'ENOENT') throw new Error('Pandoc was not found. Install Pandoc or set PANDOC_PATH to its executable.', { cause: error });
  if (error.killed) throw new Error(`Pandoc exceeded its ${timeoutMs} ms execution limit`, { cause: error });
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('Pandoc output exceeded the 8 MiB limit', { cause: error });
  throw new Error('Pandoc conversion failed; check the document format, content, and required PDF engine', { cause: error });
}

/** Executable and timeout are trusted server settings, never node options. */
export function createDocumentToMarkdown({ executable = 'pandoc', timeoutMs = 30_000 } = {}) {
  settings(executable, timeoutMs);
  return {
    inputType: 'document',
    outputType: 'markdown',
    validateInput: validateDocument,
    validateOutput(value) {
      if (typeof value?.text !== 'string' || typeof value.source !== 'string') {
        throw new TypeError('Expected Markdown text and source filename');
      }
    },
    async run(input, options, { signal }) {
      signal?.throwIfAborted();
      const directory = await mkdtemp(join(tmpdir(), 'flowkit-pandoc-'));
      try {
        const { name, data } = input.value;
        const extension = extname(name).toLowerCase();
        const path = join(directory, `input${extension}`);
        await writeFile(path, data, { signal, mode: 0o600 });
        const { stdout } = await execute(executable, [
          '--sandbox', '--from', formats.get(extension), '--to', 'gfm', '--wrap=none',
          path, '+RTS', '-M512M', '-RTS',
        ], {
          cwd: directory, signal, timeout: timeoutMs,
          maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', windowsHide: true,
        });
        return { type: 'markdown', value: { text: stdout, source: name } };
      } catch (error) {
        conversionError(error, signal, timeoutMs);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

export function createDocumentConversion(target, { executable = 'pandoc', timeoutMs = 30_000 } = {}) {
  settings(executable, timeoutMs);
  const output = targets[target];
  if (!output) throw new TypeError('Unsupported Pandoc output format');
  return {
    inputType: 'document', outputType: 'document', validateInput: validateDocument,
    validateOutput(value) {
      assertRecord(value, 'Document');
      if (typeof value.name !== 'string' || extname(value.name).toLowerCase() !== output.extension ||
          !(value.data instanceof Uint8Array) || !value.data.byteLength || value.data.byteLength > maxOutputBytes ||
          value.mimeType !== output.mimeType) throw new TypeError(`Expected ${target.toUpperCase()} output`);
    },
    async run(input, options, { signal }) {
      signal?.throwIfAborted();
      const directory = await mkdtemp(join(tmpdir(), 'flowkit-pandoc-'));
      try {
        const sourceExtension = extname(input.value.name).toLowerCase();
        const source = join(directory, `input${sourceExtension}`);
        const name = `${basename(input.value.name, sourceExtension)}${output.extension}`;
        const destination = join(directory, `output${output.extension}`);
        await writeFile(source, input.value.data, { signal, mode: 0o600 });
        await execute(executable, ['--sandbox', '--from', formats.get(sourceExtension), '--to', output.format, ...(output.arguments || []), '--output', destination, source, '+RTS', '-M512M', '-RTS'], {
          cwd: directory, signal, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
        });
        const data = await readFile(destination);
        if (!data.byteLength || data.byteLength > maxOutputBytes) throw new Error('Pandoc output must contain between 1 byte and 20 MiB');
        return { type: 'document', value: { name, data, mimeType: output.mimeType } };
      } catch (error) {
        conversionError(error, signal, timeoutMs);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
