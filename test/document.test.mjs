import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { OperationRegistry } from '../src/operations.mjs';
import { createDocumentToMarkdown } from '../src/document.mjs';
import { runPipeline } from '../src/pipeline.mjs';

const execute = promisify(execFile);
const executable = process.env.PANDOC_PATH || 'pandoc';
const probe = spawnSync(executable, ['--version'], { windowsHide: true });
const installed = probe.status === 0;
const native = { skip: installed ? false : 'Install Pandoc or set PANDOC_PATH to run native integration tests' };
const registry = new OperationRegistry().register('document.toMarkdown', createDocumentToMarkdown({ executable }));
const payload = (name, text) => ({ type: 'document', value: { name, data: Buffer.from(text) } });

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
