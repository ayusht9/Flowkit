import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRecord } from './operations.mjs';
import { selectPdfPages, pdfOperations } from './pdf-operations.mjs';
import { validatePassword, validateAttachment } from './runtime-inputs.mjs';
import { runPdfWorker } from './pdf-worker-client.mjs';
import { reducePdf, findGhostscript } from './pdf-reducer.mjs';

const execute = promisify(execFile);
const MiB = 1024 * 1024;
export function validatePdf(value) {
  assertRecord(value, 'PDF');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 255 || /[/\\\0]/.test(value.name) || !/\.pdf$/i.test(value.name))
    throw new TypeError('Choose a .pdf filename without directory components');
  if (!(value.data instanceof Uint8Array) || !value.data.length || value.data.length > 20 * MiB)
    throw new TypeError('PDF data must contain between 1 byte and 20 MiB');
  if (!Buffer.from(value.data.subarray(0, 5)).equals(Buffer.from('%PDF-'))) throw new TypeError('PDF data must have a matching PDF signature');
}
function validatePdfInputs(files) {
  if (!Array.isArray(files) || files.length < 2 || files.length > 10) throw new TypeError('Merge 2-10 PDF files in the desired page order');
  files.forEach(validatePdf);
  if (files.reduce((total, file) => total + file.data.length, 0) > 20 * MiB) throw new TypeError('Merged PDF inputs must total 20 MiB or less');
}

export function createPdfOperation(operation, { executable = process.env.QPDF_PATH || 'qpdf', ghostscript = findGhostscript(), timeoutMs = 30_000 } = {}) {
  const definition = pdfOperations.find(item => item.type === operation);
  if (!definition && operation !== 'pdf.merge') throw new TypeError('Unknown PDF operation');
  if (typeof executable !== 'string' || !executable.trim() || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('Configure a qpdf executable and positive timeout');
  return {
    inputType: 'pdf', outputType: 'pdf', acceptsMany: operation === 'pdf.merge',
    validateInput: operation === 'pdf.merge' ? validatePdfInputs : validatePdf, validateOutput: validatePdf,
    validateOptions(options) {
      const allowed = definition?.hasPages ? (operation === 'pdf.rotate' ? ['pages', 'degrees'] : ['pages'])
        : operation === 'pdf.reduce' ? ['factor', 'autoQuality', 'quality']
        : operation === 'pdf.sign' ? ['mode', 'page', 'x', 'y', 'width', 'height', 'name', 'reason'] : [];
      if (Object.keys(options).some(key => !allowed.includes(key))) throw new TypeError('Unsupported PDF settings; credentials belong in runtime inputs');
      if (operation === 'pdf.remove' && options.pages === undefined) throw new TypeError('Choose pages to remove');
      if (definition?.hasPages) selectPdfPages(options.pages);
      if (operation === 'pdf.rotate' && options.degrees !== undefined && ![90, 180, 270].includes(options.degrees)) throw new TypeError('Rotation must be 90, 180, or 270 degrees clockwise');
      if (operation === 'pdf.reduce') {
        if (options.factor !== undefined && (typeof options.factor !== 'number' || !Number.isFinite(options.factor) || options.factor < 1 || options.factor > 10)) throw new TypeError('Compression factor must be between 1 and 10');
        if (options.autoQuality !== undefined && typeof options.autoQuality !== 'boolean') throw new TypeError('Auto quality must be a boolean');
        if (options.quality !== undefined && (!Number.isSafeInteger(options.quality) || options.quality < 20 || options.quality > 95)) throw new TypeError('Quality must be an integer from 20 to 95');
      }
      if (operation === 'pdf.sign') {
        if (options.mode !== undefined && !['image', 'certificate'].includes(options.mode)) throw new TypeError('Choose image or certificate signing');
        for (const [key, min, max] of [['page', 1, 1000], ['x', 0, 14400], ['y', 0, 14400], ['width', 1, 2000], ['height', 1, 2000]])
          if (options[key] !== undefined && (!Number.isFinite(options[key]) || options[key] < min || options[key] > max || (key === 'page' && !Number.isSafeInteger(options[key])))) throw new TypeError(`Invalid signature ${key}`);
        for (const key of ['name', 'reason']) if (options[key] !== undefined && (typeof options[key] !== 'string' || options[key].length > 200)) throw new TypeError(`Signature ${key} must be at most 200 characters`);
      }
    },
    async run(input, options, { signal, secrets = {}, attachment }) {
      signal?.throwIfAborted();
      if (['pdf.encrypt', 'pdf.decrypt'].includes(operation)) validatePassword(secrets.password);
      if (operation === 'pdf.encrypt') validatePassword(secrets.ownerPassword, 'Owner password', { optional: true });
      if (operation === 'pdf.sign') {
        validateAttachment(attachment, options.mode === 'certificate' ? 'certificate' : 'image');
        validatePassword(secrets.certificatePassword, 'Certificate password', { optional: true });
      }
      const directory = await mkdtemp(join(tmpdir(), 'flowkit-pdf-'));
      const deadline = AbortSignal.timeout(timeoutMs);
      const settings = { cwd: directory, signal: signal ? AbortSignal.any([signal, deadline]) : deadline, timeout: timeoutMs, windowsHide: true, maxBuffer: MiB };
      const run = args => execute(executable, args, settings);
      let passwordArgs = [];
      try {
        if (['pdf.encrypt', 'pdf.decrypt'].includes(operation)) {
          const passwordPath = join(directory, 'password.txt');
          await writeFile(passwordPath, secrets.password, { mode: 0o600 });
          passwordArgs = [`--password-file=${passwordPath}`];
        }
        const files = operation === 'pdf.merge' ? input.value : [input.value];
        const paths = [], counts = [];
        for (const [index, file] of files.entries()) {
          const path = join(directory, `input-${index}.pdf`); paths.push(path);
          await writeFile(path, file.data, { signal: settings.signal, mode: 0o600 });
          let encrypted = true;
          try { await run([path, '--is-encrypted']); } catch (error) { if (error.code === 2) encrypted = false; else throw error; }
          if (encrypted && operation !== 'pdf.decrypt') throw new Error('Encrypted PDFs require the Decrypt PDF tool and a supplied password first');
          const { stdout } = await run([path, ...(operation === 'pdf.decrypt' ? passwordArgs : []), '--show-npages']);
          const count = Number(stdout.trim());
          if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('PDFs must contain 1-1000 pages');
          counts.push(count);
        }
        const outputPath = join(directory, 'output.pdf');
        let expectedPages = counts[0], extra = {};
        if (operation === 'pdf.merge') {
          expectedPages = counts.reduce((sum, count) => sum + count, 0);
          if (expectedPages > 1000) throw new Error('Merged PDFs may contain at most 1000 pages');
          await run(['--empty', '--pages', ...paths.flatMap(path => [path, '1-z']), '--', outputPath]);
        } else if (operation === 'pdf.encrypt') {
          const jobPath = join(directory, 'encrypt-job.json');
          await writeFile(jobPath, JSON.stringify({ inputFile: paths[0], outputFile: outputPath,
            encrypt: { userPassword: secrets.password, ownerPassword: secrets.ownerPassword || randomBytes(32).toString('hex'), '256bit': {} } }), { mode: 0o600 });
          await run([`--job-json-file=${jobPath}`]);
        } else if (operation === 'pdf.decrypt') await run([paths[0], ...passwordArgs, '--decrypt', outputPath]);
        else if (operation === 'pdf.sign') {
          if ((options.page ?? 1) > counts[0]) throw new Error('Signature page is outside the PDF');
          const attachmentPath = join(directory, options.mode === 'certificate' ? 'certificate.p12' : /\.png$/i.test(attachment.name) ? 'signature.png' : 'signature.jpg');
          await writeFile(attachmentPath, attachment.data, { mode: 0o600 });
          await runPdfWorker({ action: 'sign', inputPath: paths[0], outputPath, attachmentPath, options, passphrase: secrets.certificatePassword || '' }, { signal: settings.signal, timeoutMs });
          extra = { signatureType: options.mode === 'certificate' ? 'certificate' : 'visible-image' };
        } else if (operation === 'pdf.reduce') {
          extra = await reducePdf(paths[0], outputPath, { directory, originalSizeBytes: files[0].data.length, options, qpdf: executable, ghostscript, settings });
        } else if (operation === 'pdf.reverse') await run([paths[0], '--pages', '.', Array.from({ length: counts[0] }, (_, index) => counts[0] - index).join(','), '--', outputPath]);
        else {
          const selected = selectPdfPages(options.pages, counts[0]).join(',');
          if (operation === 'pdf.extract' || operation === 'pdf.remove') {
            const excluded = new Set(selected.split(',').map(Number));
            const pages = operation === 'pdf.extract' ? selected : Array.from({ length: counts[0] }, (_, index) => index + 1).filter(page => !excluded.has(page)).join(',');
            if (!pages) throw new Error('Removing these pages would leave an empty PDF; keep at least one page');
            expectedPages = pages.split(',').length;
            await run([paths[0], '--pages', '.', pages, '--', outputPath]);
          } else await run([paths[0], `--rotate=+${options.degrees ?? 90}:${selected}`, outputPath]);
        }
        const size = (await stat(outputPath)).size;
        if (!size || size > 8 * MiB) throw new Error('PDF output exceeded the 8 MiB limit; use a higher compression factor or fewer pages');
        const checkArgs = operation === 'pdf.encrypt' ? passwordArgs : [];
        await run([outputPath, ...checkArgs, '--check']);
        if (Number((await run([outputPath, ...checkArgs, '--show-npages'])).stdout.trim()) !== expectedPages) throw new Error('PDF output has an unexpected page count');
        const data = await readFile(outputPath, { signal: settings.signal });
        const stem = files[0].name.replace(/\.pdf$/i, '').slice(0, 170);
        return { type: 'pdf', value: { name: operation === 'pdf.merge' ? 'merged.pdf' : `${stem}-${operation.split('.')[1]}.pdf`, data,
          mimeType: 'application/pdf', pageCount: expectedPages, encrypted: operation === 'pdf.encrypt', ...extra } };
      } catch (error) {
        if (signal?.aborted) throw error;
        if (deadline.aborted || error.killed) throw new Error(`PDF processing exceeded its ${timeoutMs} ms execution limit`);
        if (error.code === 'ENOENT') throw new Error('A PDF processor was not found. Install qpdf and Ghostscript or configure QPDF_PATH/GHOSTSCRIPT_PATH.');
        if (error.code) throw new Error('PDF processing failed; check the PDF and supplied credentials');
        throw error;
      } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    },
  };
}
