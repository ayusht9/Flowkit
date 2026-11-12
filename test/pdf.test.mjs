import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { createWorkflowRegistry } from '../src/workflow.mjs';
import { createApp } from '../src/server.mjs';
import { createPdfOperation, validatePdf } from '../src/pdf.mjs';
import { selectPdfPages } from '../src/pdf-operations.mjs';
import { adaptNodes } from '../src/node-builder.mjs';
import { parseWorkflow, toPipeline } from '../src/catalog.mjs';
import { makePdf } from '../examples/fixtures/pdf.mjs';

const execute = promisify(execFile);
const qpdf = process.env.QPDF_PATH || 'qpdf';
const native = { skip: spawnSync(qpdf, ['--version'], { windowsHide: true }).status === 0 ? false : 'Install qpdf or set QPDF_PATH' };
const registry = createWorkflowRegistry({ qpdf });
const source = { name: 'source.pdf', data: makePdf() };
const payload = value => ({ type: 'pdf', value });

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'flowkit-pdf-test-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5 }));
  return directory;
}

async function inspect(data, directory) {
  const path = join(directory, 'inspect.pdf');
  await writeFile(path, data);
  const { stdout } = await execute(qpdf, [path, '--json', '--json-key=pages', '--json-key=qpdf'], { windowsHide: true });
  const pdf = JSON.parse(stdout);
  return Promise.all(pdf.pages.map(async page => ({
    box: pdf.qpdf[1][`obj:${page.object}`].value['/MediaBox'],
    rotation: pdf.qpdf[1][`obj:${page.object}`].value['/Rotate'] || 0,
    text: (await execute(qpdf, [path, `--show-object=${page.contents[0].split(' ')[0]}`, '--filtered-stream-data'], { windowsHide: true })).stdout,
  })));
}

test('PDF inputs and page selections reject malformed files, flags, and excessive ranges', async () => {
  for (const name of ['../x.pdf', 'x.txt', 'x\0.pdf']) assert.throws(() => validatePdf({ ...source, name }));
  for (const data of [Buffer.from('not a pdf'), Buffer.alloc(0), Buffer.alloc(21 * 1024 * 1024)]) assert.throws(() => validatePdf({ ...source, data }));
  for (const pages of ['', '0', '1-0', '3-1', '1, 2', '@secret', '--pages', '1-z', '1-1001', '999999999', null])
    assert.throws(() => selectPdfPages(pages));
  assert.deepEqual(selectPdfPages('3,1-2', 3), [3, 1, 2]);
  assert.throws(() => selectPdfPages('4', 3), /within/);
  await assert.rejects(registry.execute('pdf.rotate', payload(source), { degrees: 45 }));
  await assert.rejects(registry.execute('pdf.extract', payload(source), { command: 'untrusted' }));
  for (const operation of ['pdf.reverse', 'pdf.optimize', 'pdf.inspect'])
    await assert.rejects(registry.execute(operation, payload(source), { pages: '1' }), /Unsupported/);
  await assert.rejects(registry.execute('pdf.remove', payload(source), {}), /Choose pages/);
  await assert.rejects(registry.execute('pdf.merge', payload([source]), {}), /2-10/);
  await assert.rejects(registry.execute('pdf.merge', payload(Array(11).fill(source)), {}), /2-10/);
  const large = { name: 'large.pdf', data: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(11 * 1024 * 1024)]) };
  await assert.rejects(registry.execute('pdf.merge', payload([large, large]), {}), /total 20 MiB/);
});

test('qpdf extracts and reorders actual pages, merges in input order, and rotates relative to existing rotation', native, async t => {
  const directory = await workspace(t);
  const original = Buffer.from(source.data);
  const extracted = await registry.execute('pdf.extract', payload(source), { pages: '3,1' });
  assert.equal(extracted.value.pageCount, 2);
  const pages = await inspect(extracted.value.data, directory);
  assert.deepEqual(pages.map(page => page.box[2]), [320, 300]);
  assert.match(pages[0].text, /Third page/);
  const rotated = await registry.execute('pdf.rotate', payload(extracted.value), { pages: '2', degrees: 90 });
  const again = await registry.execute('pdf.rotate', payload(rotated.value), { pages: '2', degrees: 180 });
  assert.deepEqual((await inspect(again.value.data, directory)).map(page => page.rotation), [0, 270]);
  const merged = await registry.execute('pdf.merge', payload([again.value, source]), {});
  assert.equal(merged.value.pageCount, 5);
  assert.deepEqual((await inspect(merged.value.data, directory)).map(page => page.box[2]), [320, 300, 300, 310, 320]);
  assert.deepEqual(source.data, original);
  await assert.rejects(registry.execute('pdf.extract', payload(source), { pages: '4' }), /within/);
});

test('PDF failures, encrypted files, missing qpdf, timeout and cancellation clean their temporary files', native, async t => {
  const directory = await workspace(t);
  const before = new Set(await readdir(tmpdir()));
  await assert.rejects(registry.execute('pdf.extract', payload({ name: 'broken.pdf', data: Buffer.from('%PDF-broken') }), {}), /PDF processing failed/);
  await assert.rejects(createPdfOperation('pdf.extract', { executable: join(directory, 'missing-qpdf') }).run(payload(source), {}, {}), /QPDF_PATH/);
  await writeFile(join(directory, 'source.pdf'), source.data);
  await execute(qpdf, [join(directory, 'source.pdf'), '--encrypt', 'test-user', 'test-owner', '256', '--', join(directory, 'locked.pdf')], { windowsHide: true });
  const locked = { name: 'locked.pdf', data: await readFile(join(directory, 'locked.pdf')) };
  await assert.rejects(registry.execute('pdf.extract', payload(locked), {}), /Encrypted PDFs/);
  for (const operation of ['pdf.remove', 'pdf.reverse', 'pdf.optimize'])
    await assert.rejects(registry.execute(operation, payload(locked), operation === 'pdf.remove' ? { pages: '1' } : {}), /Encrypted PDFs/);
  const inspected = await registry.execute('pdf.inspect', payload(locked), {});
  assert.equal(inspected.value.encrypted, true);
  assert.equal(inspected.value.pageCount, null);
  assert.match(inspected.value.pageCountUnavailableReason, /encrypted PDFs/);
  assert.deepEqual(inspected.value.data, locked.data);
  await assert.rejects(createPdfOperation('pdf.extract', { executable: qpdf, timeoutMs: 1 }).run(payload(source), {}, {}), /execution limit/);
  const controller = new AbortController();
  const task = registry.execute('pdf.extract', payload(source), {}, { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 5);
  try { await assert.rejects(task, { name: 'AbortError' }); } finally { clearTimeout(timer); }
  assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith('flowkit-pdf-') && !before.has(name)), []);
});

test('PDF removal and reversal preserve remaining page content and reject empty results', native, async t => {
  const directory = await workspace(t);
  const removed = await registry.execute('pdf.remove', payload(source), { pages: '2' });
  assert.equal(removed.value.pageCount, 2);
  const pages = await inspect(removed.value.data, directory);
  assert.match(pages[0].text, /First page/);
  assert.match(pages[1].text, /Third page/);
  const reversed = await registry.execute('pdf.reverse', payload(removed.value), {});
  assert.deepEqual((await inspect(reversed.value.data, directory)).map(page => page.box[2]), [320, 300]);
  await assert.rejects(registry.execute('pdf.remove', payload(source), { pages: 'all' }), /empty PDF/);
  await assert.rejects(registry.execute('pdf.remove', payload(source), { pages: '1-3' }), /empty PDF/);
  await assert.rejects(registry.execute('pdf.remove', payload(source), { pages: '4' }), /within/);
  const one = { name: 'one.pdf', data: makePdf(['Only page']) };
  await assert.rejects(registry.execute('pdf.remove', payload(one), { pages: '1' }), /empty PDF/);
  const singleReverse = await registry.execute('pdf.reverse', payload(one), {});
  assert.equal(singleReverse.value.pageCount, 1);
  assert.deepEqual(source.data, makePdf());
});

test('PDF optimization retains decoded contents and reports actual size changes; inspection preserves bytes', native, async t => {
  const directory = await workspace(t);
  const compressible = { name: 'repeated.pdf', data: makePdf(['Repeated content. '.repeat(10000)]) };
  const optimized = await registry.execute('pdf.optimize', payload(compressible), {});
  assert.equal(optimized.value.pageCount, 1);
  assert.equal(optimized.value.originalSizeBytes, compressible.data.length);
  assert.equal(optimized.value.sizeChangeBytes, optimized.value.data.length - compressible.data.length);
  assert.ok(optimized.value.data.length < compressible.data.length);
  const before = await inspect(compressible.data, directory);
  assert.deepEqual(await inspect(optimized.value.data, directory), before);
  const inspected = await registry.execute('pdf.inspect', payload(source), {});
  assert.equal(inspected.value.pageCount, 3);
  assert.equal(inspected.value.encrypted, false);
  assert.deepEqual(inspected.value.data, source.data);
});

test('PDF workflows preserve merge inputs and options through visual import and adaptation', () => {
  const node = (id, operation) => ({ id, type: 'operation', position: { x: 0, y: 0 }, data: { operation, options: {} } });
  const workflow = { name: 'Merge PDFs', nodes: [node('a', 'pdf.upload'), node('b', 'pdf.upload'), node('merge', 'pdf.merge'), node('download', 'pdf.preview')],
    edges: [{ source: 'b', target: 'merge' }, { source: 'a', target: 'merge' }, { source: 'merge', target: 'download' }] };
  const restored = parseWorkflow(workflow);
  const adapted = adaptNodes(restored.nodes, restored.edges);
  assert.deepEqual(adapted.map(node => node.data.operation), ['pdf.upload', 'pdf.upload', 'pdf.merge', 'pdf.preview']);
  assert.equal(toPipeline(adapted, restored.edges).edges[0].source, 'b');
});

test('native PDF processing enforces page-count and output-size limits', native, async () => {
  const excessive = { name: 'many.pdf', data: makePdf(Array(1001).fill('Page')) };
  await assert.rejects(registry.execute('pdf.extract', payload(excessive), {}), /1-1000 pages/);
  const half = { name: 'half.pdf', data: makePdf(Array(501).fill('Page')) };
  await assert.rejects(registry.execute('pdf.merge', payload([half, half]), {}), /at most 1000 pages/);
  const oversized = { name: 'large.pdf', data: makePdf([randomBytes(9 * 1024 * 1024).toString('base64')]) };
  assert.ok(oversized.data.length < 20 * 1024 * 1024);
  await assert.rejects(registry.execute('pdf.extract', payload(oversized), {}), /8 MiB limit/);
});

test('PDF browser API merges multiple uploads and returns binary data only in the final artifact', native, async t => {
  const app = await createApp({ qpdf });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipeline: {
      nodes: [{ id: 'a', type: 'pdf.upload' }, { id: 'b', type: 'pdf.upload' }, { id: 'm', type: 'pdf.merge' }, { id: 'd', type: 'pdf.preview' }],
      edges: [{ source: 'a', target: 'm' }, { source: 'b', target: 'm' }, { source: 'm', target: 'd' }],
    }, inputs: { a: { name: 'a.pdf', data: source.data.toString('base64') }, b: { name: 'b.pdf', data: makePdf(['Extra page']).toString('base64') } } }),
  });
  const { result } = (await response.text()).trim().split('\n').map(JSON.parse).at(-1);
  assert.equal(result.status, 'succeeded', result.error?.message);
  assert.equal(result.output.value.pageCount, 4);
  assert.equal(Buffer.from(result.output.value.data, 'base64').subarray(0, 5).toString(), '%PDF-');
  assert.ok(result.nodes.every(node => !node.output?.value?.data));
});

test('MCP discovers PDF tools and chains extract, rotation, and merge artifact paths', native, async t => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'source.pdf'), source.data);
  const client = new Client({ name: 'pdf-tests', version: '1' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('mcp-server.mjs'), '--workspace', directory],
    env: { ...getDefaultEnvironment(), QPDF_PATH: qpdf }, stderr: 'pipe' }));
  const tools = (await client.listTools()).tools;
  for (const action of ['merge', 'extract', 'rotate', 'remove', 'reverse', 'optimize', 'inspect']) assert.ok(tools.some(tool => tool.name === `flowkit_pdf_${action}`));
  assert.equal(tools.find(tool => tool.name === 'flowkit_pdf_inspect').annotations.readOnlyHint, true);
  const call = async (action, args) => {
    const response = await client.callTool({ name: `flowkit_pdf_${action}`, arguments: args });
    assert.ok(!response.isError, JSON.stringify(response));
    assert.equal(response.structuredContent.data, undefined);
    return response.structuredContent;
  };
  const extracted = await call('extract', { inputPath: 'source.pdf', pages: '2-3' });
  assert.equal(extracted.pageCount, 2);
  const rotated = await call('rotate', { inputPath: extracted.path, degrees: 270 });
  const merged = await call('merge', { inputPaths: [rotated.path, 'source.pdf'] });
  assert.equal(merged.pageCount, 5);
  const removed = await call('remove', { inputPath: merged.path, pages: '2' });
  assert.equal(removed.pageCount, 4);
  const reversed = await call('reverse', { inputPath: removed.path });
  const optimized = await call('optimize', { inputPath: reversed.path });
  assert.equal(optimized.pageCount, 4);
  assert.equal(typeof optimized.sizeChangeBytes, 'number');
  const beforeInspection = await readdir(directory);
  const inspected = await call('inspect', { inputPath: optimized.path });
  assert.equal(inspected.path, optimized.path);
  assert.equal(inspected.pageCount, 4);
  assert.equal(inspected.encrypted, false);
  assert.deepEqual(await readdir(directory), beforeInspection);
  assert.equal((await readFile(join(directory, merged.path))).length, merged.sizeBytes);
  assert.deepEqual(await readFile(join(directory, 'source.pdf')), source.data);
  const invalid = await client.callTool({ name: 'flowkit_pdf_extract', arguments: { inputPath: '../source.pdf' } });
  assert.equal(invalid.isError, true);
});
