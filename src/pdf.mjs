import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRecord } from './operations.mjs';
import { selectPdfPages } from './pdf-operations.mjs';

const execute = promisify(execFile);
const MiB = 1024 * 1024;

export function validatePdf(value) {
  assertRecord(value, 'PDF');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 255 || /[/\\\0]/.test(value.name) || !/\.pdf$/i.test(value.name))
    throw new TypeError('Choose a .pdf filename without directory components');
  if (!(value.data instanceof Uint8Array) || !value.data.length || value.data.length > 20 * MiB)
    throw new TypeError('PDF data must contain between 1 byte and 20 MiB');
  if (!Buffer.from(value.data.subarray(0, 5)).equals(Buffer.from('%PDF-')))
    throw new TypeError('PDF data must have a matching PDF signature');
}

function validatePdfInputs(files) {
  if (!Array.isArray(files) || files.length < 2 || files.length > 10)
    throw new TypeError('Merge 2-10 PDF files in the desired page order');
  files.forEach(validatePdf);
  if (files.reduce((total, file) => total + file.data.length, 0) > 20 * MiB)
    throw new TypeError('Merged PDF inputs must total 20 MiB or less');
}

export function createPdfOperation(operation, { executable = process.env.QPDF_PATH || 'qpdf', timeoutMs = 30_000 } = {}) {
  if (!['pdf.extract', 'pdf.rotate', 'pdf.merge'].includes(operation)) throw new TypeError('Unknown PDF operation');
  if (typeof executable !== 'string' || !executable.trim() || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new TypeError('Configure a qpdf executable and positive timeout');
  return {
    inputType: 'pdf', outputType: 'pdf', acceptsMany: operation === 'pdf.merge',
    validateInput: operation === 'pdf.merge' ? validatePdfInputs : validatePdf,
    validateOutput: validatePdf,
    validateOptions(options) {
      const allowed = operation === 'pdf.merge' ? [] : operation === 'pdf.rotate' ? ['pages', 'degrees'] : ['pages'];
      if (Object.keys(options).some(key => !allowed.includes(key))) throw new TypeError('Unsupported PDF settings');
      if (operation !== 'pdf.merge') selectPdfPages(options.pages);
      if (operation === 'pdf.rotate' && options.degrees !== undefined && ![90, 180, 270].includes(options.degrees))
        throw new TypeError('Rotation must be 90, 180, or 270 degrees clockwise');
    },
    async run(input, options, { signal }) {
      signal?.throwIfAborted();
      const directory = await mkdtemp(join(tmpdir(), 'flowkit-pdf-'));
      const settings = { cwd: directory, signal, timeout: timeoutMs, windowsHide: true, maxBuffer: MiB };
      const run = args => execute(executable, args, settings);
      try {
        const files = operation === 'pdf.merge' ? input.value : [input.value];
        const paths = [], counts = [];
        for (const [index, file] of files.entries()) {
          const path = join(directory, `input-${index}.pdf`);
          paths.push(path);
          await writeFile(path, file.data, { signal, mode: 0o600 });
          let encrypted = true;
          try { await run([path, '--is-encrypted']); }
          catch (error) { if (error.code === 2) encrypted = false; else throw error; }
          if (encrypted) throw new Error('Encrypted PDFs are not supported; provide an unencrypted copy');
          const { stdout } = await run([path, '--show-npages']);
          const count = Number(stdout.trim());
          if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('PDFs must contain 1-1000 pages');
          counts.push(count);
        }
        const outputPath = join(directory, 'output.pdf');
        let expectedPages;
        if (operation === 'pdf.merge') {
          expectedPages = counts.reduce((sum, count) => sum + count, 0);
          if (expectedPages > 1000) throw new Error('Merged PDFs may contain at most 1000 pages');
          await run(['--empty', '--pages', ...paths.flatMap(path => [path, '1-z']), '--', outputPath]);
        } else {
          const selected = selectPdfPages(options.pages, counts[0]).join(',');
          if (operation === 'pdf.extract') {
            expectedPages = selected.split(',').length;
            await run([paths[0], '--pages', '.', selected, '--', outputPath]);
          } else {
            expectedPages = counts[0];
            await run([paths[0], `--rotate=+${options.degrees ?? 90}:${selected}`, outputPath]);
          }
        }
        const size = (await stat(outputPath)).size;
        if (!size || size > 8 * MiB) throw new Error('PDF output exceeded the 8 MiB limit; extract fewer pages or merge fewer files');
        await run([outputPath, '--check']);
        const { stdout } = await run([outputPath, '--show-npages']);
        if (Number(stdout.trim()) !== expectedPages) throw new Error('PDF output has an unexpected page count');
        const data = await readFile(outputPath, { signal });
        const stem = files[0].name.replace(/\.pdf$/i, '').slice(0, 170);
        return { type: 'pdf', value: { name: operation === 'pdf.merge' ? 'merged.pdf' : `${stem}-${operation.split('.')[1]}.pdf`,
          data, mimeType: 'application/pdf', pageCount: expectedPages } };
      } catch (error) {
        if (signal?.aborted) throw error;
        if (error.code === 'ENOENT') throw new Error('qpdf was not found. Install qpdf or set QPDF_PATH to its executable.', { cause: error });
        if (error.killed) throw new Error(`PDF processing exceeded its ${timeoutMs} ms execution limit`, { cause: error });
        if (error.code) throw new Error('PDF processing failed; check that the PDF is valid, unencrypted, and supported by qpdf', { cause: error });
        throw error;
      } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    },
  };
}
