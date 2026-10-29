import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { assertRecord } from './operations.mjs';

const execute = promisify(execFile);
const formats = new Map([['.docx', 'docx'], ['.html', 'html'], ['.htm', 'html'], ['.epub', 'epub'], ['.md', 'commonmark']]);
const maxInputBytes = 20 * 1024 * 1024;

/** Executable and timeout are trusted server settings, never node options. */
export function createDocumentToMarkdown({ executable = 'pandoc', timeoutMs = 30_000 } = {}) {
  if (typeof executable !== 'string' || !executable.trim()) throw new TypeError('Expected a Pandoc executable');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('Timeout must be a positive integer');
  return {
    inputType: 'document',
    outputType: 'markdown',
    validateInput(value) {
      assertRecord(value, 'Document');
      if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 255 || /[/\\\0]/.test(value.name)) {
        throw new TypeError('Document name must be a filename without directory components');
      }
      const extension = extname(value.name).toLowerCase();
      if (!formats.has(extension)) throw new TypeError('Supported documents: DOCX, HTML, EPUB, and Markdown');
      if (!(value.data instanceof Uint8Array) || value.data.byteLength === 0 || value.data.byteLength > maxInputBytes) {
        throw new TypeError('Document data must contain between 1 byte and 20 MiB');
      }
      if (['.docx', '.epub'].includes(extension) && !Buffer.from(value.data.subarray(0, 4)).equals(Buffer.from([0x50, 0x4b, 3, 4]))) {
        throw new TypeError('DOCX and EPUB documents must have a ZIP file signature');
      }
    },
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
        if (signal?.aborted) throw error;
        if (error.code === 'ENOENT') {
          throw new Error('Pandoc was not found. Install Pandoc or set PANDOC_PATH to its executable.', { cause: error });
        }
        if (error.killed) throw new Error(`Pandoc exceeded its ${timeoutMs} ms execution limit`, { cause: error });
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          throw new Error('Pandoc output exceeded the 8 MiB limit', { cause: error });
        }
        throw new Error('Pandoc conversion failed; check the document format and content', { cause: error });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
