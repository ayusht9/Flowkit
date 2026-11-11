import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { OperationRegistry } from '../src/operations.mjs';
import { createDocumentConversion, createDocumentToMarkdown } from '../src/document.mjs';
import { runPipeline } from '../src/pipeline.mjs';
import { documentConversions } from '../src/document-formats.mjs';
import { inflateRawSync } from 'node:zlib';

const execute = promisify(execFile);
const executable = process.env.PANDOC_PATH || 'pandoc';
const pandocSettings = { executable };
const probe = spawnSync(executable, ['--version'], { windowsHide: true });
const installed = probe.status === 0;
const native = { skip: installed ? false : 'Install Pandoc or set PANDOC_PATH to run native integration tests' };
const pdfNative = { skip: installed && spawnSync('pdfroff', ['--version'], { windowsHide: true }).status === 0
  ? false : 'Install Pandoc, Groff, and Ghostscript to run PDF integration tests' };
const registry = new OperationRegistry().register('document.toMarkdown', createDocumentToMarkdown({ executable }));
const payload = (name, text) => ({ type: 'document', value: { name, data: Buffer.from(text) } });

const addedFormats = documentConversions.filter(item => ['text', 'rtf', 'latex', 'rst', 'asciidoc', 'pptx'].includes(item.target));

function zipText(data, name) {
  const bytes = Buffer.from(data);
  let offset = bytes.indexOf(Buffer.from('504b0102', 'hex'));
  while (offset >= 0 && bytes.readUInt32LE(offset) === 0x02014b50) {
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    if (bytes.subarray(offset + 46, offset + 46 + nameLength).toString() === name) {
      const local = bytes.readUInt32LE(offset + 42);
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const compressed = bytes.subarray(start, start + bytes.readUInt32LE(offset + 20));
      const method = bytes.readUInt16LE(offset + 10);
      assert.ok([0, 8].includes(method));
      return (method === 8 ? inflateRawSync(compressed) : compressed).toString('utf8');
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Missing ZIP entry: ${name}`);
}

for (const format of addedFormats) {
  test(`exports real ${format.target} content and verifies its document structure`, native, async () => {
    const before = new Set(await readdir(tmpdir()));
    const conversion = new OperationRegistry().register('export', createDocumentConversion(format.target, pandocSettings));
    const source = payload('REPORT.MD', '# Quarterly report\n\n## First slide\n\nRevenue increased. Café report.');
    const result = await conversion.execute('export', source);
    assert.equal(result.value.name, `REPORT${format.extension}`);
    assert.equal(result.value.mimeType, format.mimeType);
    if (format.target === 'pptx') assert.equal(Buffer.from(result.value.data).subarray(0, 4).toString('hex'), '504b0304');
    if (format.target === 'rtf') assert.match(Buffer.from(result.value.data).toString(), /^\{\\rtf/);
    if (format.target === 'latex') assert.match(Buffer.from(result.value.data).toString(), /\\documentclass/);
    if (format.target === 'pptx') {
      assert.match(zipText(result.value.data, 'ppt/presentation.xml'), /<p:sldIdLst>/);
      assert.match(zipText(result.value.data, 'ppt/slides/slide1.xml'), /Quarterly report/);
      assert.match(zipText(result.value.data, 'ppt/slides/slide2.xml'), /Revenue increased/);
    } else {
      const text = format.target === 'asciidoc' ? Buffer.from(result.value.data).toString('utf8') : (await registry.execute('document.toMarkdown', result)).value.text;
      for (const expected of ['Quarterly report', 'First slide', 'Revenue increased', 'Café report']) assert.ok(text.includes(expected), text);
    }
    await assert.rejects(conversion.execute('export', source, { filter: 'untrusted.lua' }), /does not accept options/);
    await assert.rejects(conversion.execute('export', source, {}, { signal: AbortSignal.abort() }), { name: 'AbortError' });
    assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith('flowkit-pandoc-') && !before.has(name)), []);
  });
}

test('new document readers retain ZIP validation and block local includes', native, async () => {
  await assert.rejects(registry.execute('document.toMarkdown', payload('slides.pptx', 'not ZIP')), /export-only/);
  await assert.rejects(registry.execute('document.toMarkdown', payload('source.adoc', '= Title')), /export-only/);
  const directory = await mkdtemp(join(tmpdir(), 'flowkit-reader-test-'));
  try {
    const secret = join(directory, 'secret.txt').replaceAll('\\', '/');
    await writeFile(secret, 'FLOWKIT_PRIVATE_CANARY');
    for (const [name, text] of [
      ['hostile.tex', `\\input{${secret}}`],
      ['hostile.rst', `.. include:: ${secret}\n`],
    ]) {
      let result;
      try { result = await registry.execute('document.toMarkdown', payload(name, text)); }
      catch (error) { assert.match(error.message, /Pandoc conversion failed/); continue; }
      assert.doesNotMatch(result.value.text, /FLOWKIT_PRIVATE_CANARY/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('explicit PANDOC_PATH points to a working Pandoc installation', { skip: !process.env.PANDOC_PATH }, () => {
  assert.equal(installed, true, probe.error?.message || probe.stderr?.toString());
});

test('rejects unsupported formats, unsafe filenames, invalid bytes, and arbitrary options', async () => {
  for (const input of [
    payload('a.pdf', 'pdf'), payload('../a.html', 'html'), payload('a\\b.html', 'html'),
    payload('a\0.html', 'html'), payload('a.html', ''), payload('a.docx', 'not a ZIP'),
    payload('a.epub', 'not a ZIP'),
    { type: 'document', value: { name: 'a.html', data: 'not bytes' } },
    { type: 'document', value: { name: 'a.html', data: Buffer.alloc(20 * 1024 * 1024 + 1) } },
  ]) {
    await assert.rejects(registry.execute('document.toMarkdown', input), TypeError);
  }
  await assert.rejects(registry.execute('document.toMarkdown', payload('a.html', '<p>Hello</p>'), {
    executable: 'untrusted',
  }), /does not accept options/);
  assert.throws(() => createDocumentToMarkdown({ timeoutMs: 0 }), /Timeout/);
  assert.throws(() => createDocumentConversion('pages'), /Unsupported/);
});

test('office and PDF converters reject invalid input before starting Pandoc', async () => {
  for (const target of ['html', 'docx', 'odt', 'epub', 'pdf']) {
    const conversion = new OperationRegistry().register(target, createDocumentConversion(target, pandocSettings));
    await assert.rejects(conversion.execute(target, payload('report.pdf', '%PDF')), /Supported documents/);
    await assert.rejects(conversion.execute(target, payload('report.odt', 'not a ZIP')), /ZIP file signature/);
  }
});

for (const target of ['html', 'docx', 'odt', 'epub']) {
  test(`creates a real ${target.toUpperCase()} office artifact`, native, async () => {
    const conversion = new OperationRegistry().register(target, createDocumentConversion(target, pandocSettings));
    const result = await conversion.execute(target, payload('report.md', '# Quarterly report\n\nRevenue increased.'));
    assert.equal(result.type, 'document');
    assert.match(result.value.name, new RegExp(`\\.${target === 'html' ? 'html' : target}$`));
    assert.ok(result.value.data.byteLength > 0);
  });
}

test('creates a real PDF artifact with pdfroff', pdfNative, async () => {
  const conversion = new OperationRegistry().register('pdf', createDocumentConversion('pdf', pandocSettings));
  const result = await conversion.execute('pdf', payload('report.md', '# Quarterly report\n\nRevenue increased.'));
  assert.equal(result.value.name, 'report.pdf');
  assert.equal(Buffer.from(result.value.data.subarray(0, 5)).toString(), '%PDF-');
});

test('missing Pandoc produces an actionable error and cleans temporary files', async () => {
  const before = await readdir(tmpdir());
  const missing = new OperationRegistry().register('convert', createDocumentToMarkdown({
    executable: join(tmpdir(), 'flowkit-missing-executable', 'pandoc'),
  }));
  await assert.rejects(missing.execute('convert', payload('a.html', '<p>Hello</p>')), /Pandoc was not found/);
  const leftovers = (await readdir(tmpdir())).filter(name => name.startsWith('flowkit-pandoc-') && !before.includes(name));
  assert.deepEqual(leftovers, []);
});

test('HTML conversion preserves headings, lists, tables, and source filename', native, async () => {
  const data = await readFile(new URL('../examples/fixtures/sample.html', import.meta.url));
  const before = await readdir(tmpdir());
  const result = await registry.execute('document.toMarkdown', { type: 'document', value: { name: 'sample.html', data } });
  assert.equal(result.type, 'markdown');
  assert.equal(result.value.source, 'sample.html');
  assert.match(result.value.text, /# FlowKit project brief/);
  assert.match(result.value.text, /## Supported tools/);
  assert.match(result.value.text, /[-*]\s+Pandoc for documents/);
  assert.match(result.value.text, /\|.*Feature.*\|.*Status.*\|/);
  const leftovers = (await readdir(tmpdir())).filter(name => name.startsWith('flowkit-pandoc-') && !before.includes(name));
  assert.deepEqual(leftovers, []);
});

test('Pandoc sandbox blocks local file inclusion through HTML iframes', native, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowkit-test-'));
  try {
    const secret = join(directory, 'secret.html');
    await writeFile(secret, '<p>FLOWKIT_PRIVATE_CANARY</p>');
    const result = await registry.execute('document.toMarkdown', payload('hostile.html', `<iframe src="${secret}"></iframe>`));
    assert.doesNotMatch(result.value.text, /FLOWKIT_PRIVATE_CANARY/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const format of ['docx', 'epub']) {
  test(`converts real ${format.toUpperCase()} bytes to Markdown through the pipeline`, native, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flowkit-test-'));
    try {
      const source = join(directory, 'input.md');
      const document = join(directory, `source.${format}`);
      await writeFile(source, '# Quarterly report\n\nRevenue increased by **18%**.\n');
      // Trusted test fixtures need Pandoc's system templates on distro builds.
      await execute(executable, ['--from', 'commonmark', '--to', format, '--output', document, source]);
      const result = await runPipeline({
        nodes: [{ id: 'convert', type: 'document.toMarkdown' }], edges: [],
      }, registry, { input: { type: 'document', value: { name: `report.${format}`, data: await readFile(document) } } });
      assert.equal(result.status, 'succeeded', result.error?.message);
      assert.match(result.output.value.text, /# Quarterly report/);
      assert.match(result.output.value.text, /18%/);
      assert.equal(result.output.value.source, `report.${format}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('filenames containing shell metacharacters remain ordinary metadata', native, async () => {
  const name = 'notes & echo injected.html';
  const result = await registry.execute('document.toMarkdown', payload(name, '<h1>Hello</h1>'));
  assert.equal(result.value.source, name);
  assert.match(result.value.text, /# Hello/);
});

test('corrupt documents fail the node without continuing the pipeline', native, async () => {
  const before = await readdir(tmpdir());
  const result = await runPipeline({
    nodes: [{ id: 'convert', type: 'document.toMarkdown' }], edges: [],
  }, registry, { input: payload('corrupt.docx', 'PK\x03\x04not-a-real-archive') });
  assert.equal(result.status, 'failed');
  assert.match(result.error.message, /conversion failed/);
  const leftovers = (await readdir(tmpdir())).filter(name => name.startsWith('flowkit-pandoc-') && !before.includes(name));
  assert.deepEqual(leftovers, []);
});

test('aborted conversions reject and enforce execution deadlines', native, async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(registry.execute('document.toMarkdown', payload('a.html', '<p>Hello</p>'), {}, {
    signal: controller.signal,
  }), { name: 'AbortError' });
  const deadline = new OperationRegistry().register('convert', createDocumentToMarkdown({ executable, timeoutMs: 1 }));
  await assert.rejects(deadline.execute('convert', payload('a.html', '<p>Hello</p>')), /execution limit/);
});
