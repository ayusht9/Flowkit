import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { createWorkflowRegistry } from '../src/workflow.mjs';
import { inspectFile } from '../src/metadata.mjs';
import { createApp } from '../src/server.mjs';
import { parseWorkflow } from '../src/catalog.mjs';
import { decodeRuntimeInputs, validateAttachment } from '../src/runtime-inputs.mjs';
import { findGhostscript } from '../src/pdf-reducer.mjs';
import { makePdf } from '../examples/fixtures/pdf.mjs';
import { sampleImage } from '../examples/fixtures/image.mjs';
import { sampleAudio } from '../examples/fixtures/media.mjs';
import { makeImagePdf, makeTestCertificate, verifyTestSignature, openssl } from '../examples/fixtures/pdf-security.mjs';

const execute = promisify(execFile);
const qpdf = process.env.QPDF_PATH || 'qpdf';
const native = { skip: spawnSync(qpdf, ['--version'], { windowsHide: true }).status === 0 ? false : 'Install qpdf' };
const signing = { skip: native.skip || (spawnSync(openssl, ['version'], { windowsHide: true }).status === 0 ? false : 'Install OpenSSL for signature test fixtures') };
const reducer = { skip: native.skip || (spawnSync(findGhostscript(), ['--version'], { windowsHide: true }).status === 0 ? false : 'Install Ghostscript') };
const registry = createWorkflowRegistry();
const source = { name: 'source.pdf', data: makePdf() };
const payload = value => ({ type: 'pdf', value });
async function workspace(t) { const directory = await mkdtemp(join(tmpdir(), 'flowkit-security-test-')); t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5 })); return directory; }

test('metadata covers PDFs, images, audio, text, signature mismatches, and missing processors without returning file contents', native, async () => {
  const pdf = await inspectFile(source);
  assert.equal(pdf.details.pageCount, 3); assert.equal(pdf.details.encrypted, false); assert.equal(pdf.data, undefined);
  const image = await inspectFile({ name: 'photo.png', data: sampleImage });
  assert.deepEqual([image.details.width, image.details.height], [120, 60]);
  const audio = await inspectFile({ name: 'tone.wav', data: sampleAudio });
  assert.equal(audio.details.streams[0].codec, 'pcm_s16le'); assert.ok(audio.details.durationSeconds > 0);
  const text = await inspectFile({ name: 'notes.md', data: Buffer.from('# Title\nBody') });
  assert.equal(text.details.lineCount, 2); assert.equal(text.details.characterCount, 12);
  const mismatch = await inspectFile({ name: 'wrong.txt', data: source.data });
  assert.equal(mismatch.kind, 'pdf'); assert.equal(mismatch.status, 'partial');
  const missing = await inspectFile(source, { qpdf: 'flowkit-nonexistent-qpdf' });
  assert.equal(missing.sizeBytes, source.data.length); assert.equal(missing.status, 'partial'); assert.ok(missing.warnings.length);
  await assert.rejects(inspectFile(source, { signal: AbortSignal.abort() }), { name: 'AbortError' });
});

test('AES-256 encryption and password-based decryption round-trip; credentials never become options or results', native, async t => {
  const directory = await workspace(t);
  const password = 'private-test-password-123';
  const context = { secrets: { password } };
  await assert.rejects(registry.execute('pdf.encrypt', payload(source), { password }), /runtime inputs/);
  await assert.rejects(registry.execute('pdf.encrypt', payload(source), {}), /Password/);
  const encrypted = await registry.execute('pdf.encrypt', payload(source), {}, context);
  assert.equal(encrypted.value.encrypted, true);
  assert.equal((await inspectFile(encrypted.value)).details.encrypted, true);
  await assert.rejects(registry.execute('pdf.decrypt', encrypted, {}, { secrets: { password: 'incorrect' } }), /supplied credentials/);
  const decrypted = await registry.execute('pdf.decrypt', encrypted, {}, context);
  assert.equal(decrypted.value.encrypted, false); assert.equal(decrypted.value.pageCount, 3);
  assert.ok(!JSON.stringify(encrypted).includes(password));
  const path = join(directory, 'encrypted.pdf'), secret = join(directory, 'password.txt');
  await writeFile(path, encrypted.value.data); await writeFile(secret, password, { mode: 0o600 });
  const { stdout } = await execute(qpdf, [path, `--password-file=${secret}`, '--json', '--json-key=encrypt'], { windowsHide: true });
  assert.equal(JSON.parse(stdout).encrypt.parameters.bits, 256);
});

test('Size Reducer uses factor and Auto/manual quality, reports truthful results, and never increases size', reducer, async () => {
  const imagePdf = { name: 'images.pdf', data: await makeImagePdf() };
  const auto = await registry.execute('pdf.reduce', payload(imagePdf), { factor: 2, autoQuality: true });
  assert.ok(auto.value.data.length < imagePdf.data.length / 2);
  assert.equal(auto.value.targetMet, true); assert.equal(auto.value.autoQuality, true);
  assert.equal(auto.value.requestedFactor, 2); assert.ok(auto.value.qualityUsed > 0);
  const manual = await registry.execute('pdf.reduce', payload(imagePdf), { factor: 4, autoQuality: false, quality: 40 });
  assert.equal(manual.value.autoQuality, false); assert.ok(manual.value.data.length <= imagePdf.data.length);
  assert.equal(manual.value.achievedFactor, imagePdf.data.length / manual.value.data.length);
  const small = await registry.execute('pdf.reduce', payload(source), { factor: 10 });
  assert.equal(small.value.targetMet, small.value.data.length <= source.data.length / 10);
  assert.ok(small.value.data.length <= source.data.length);
  for (const options of [{ factor: 0 }, { factor: 11 }, { quality: 0 }, { autoQuality: 'yes' }]) await assert.rejects(registry.execute('pdf.reduce', payload(source), options));
});

test('visible signing embeds an image only on the chosen page and rejects invalid placement', native, async t => {
  const directory = await workspace(t);
  const context = { attachment: { name: 'signature.png', data: sampleImage } };
  const signed = await registry.execute('pdf.sign', payload(source), { mode: 'image', page: 2 }, context);
  assert.equal(signed.value.signatureType, 'visible-image'); assert.equal(signed.value.pageCount, 3);
  const path = join(directory, 'visible.pdf'); await writeFile(path, signed.value.data);
  const { stdout } = await execute(qpdf, [path, '--json', '--json-key=pages'], { windowsHide: true });
  assert.deepEqual(JSON.parse(stdout).pages.map(page => page.images.length), [0, 1, 0]);
  await assert.rejects(registry.execute('pdf.sign', payload(source), { mode: 'image', x: 500 }, context), /signing or inspection failed/);
  await assert.rejects(registry.execute('pdf.sign', payload(source), { mode: 'image', page: 4 }, context), /outside/);
  const oversized = Buffer.from(sampleImage); oversized.writeUInt32BE(100000, 16); oversized.writeUInt32BE(100000, 20);
  assert.throws(() => validateAttachment({ name: 'huge.png', data: oversized }, 'image'), /16 million pixels/);
});

test('certificate signing creates a cryptographically valid detached signature and rejects bad credentials and re-signing', signing, async t => {
  const directory = await workspace(t);
  const certificate = await makeTestCertificate(directory);
  const context = { attachment: certificate.file, secrets: { certificatePassword: certificate.password } };
  const signed = await registry.execute('pdf.sign', payload(source), { mode: 'certificate', name: 'FlowKit Test' }, context);
  assert.equal(signed.value.signatureType, 'certificate');
  await verifyTestSignature(Buffer.from(signed.value.data), directory);
  await assert.rejects(registry.execute('pdf.sign', payload(source), { mode: 'certificate' }, { attachment: certificate.file, secrets: { certificatePassword: 'wrong-certificate-password' } }), /signing or inspection failed/);
  await assert.rejects(registry.execute('pdf.sign', signed, { mode: 'certificate' }, context), /already has a digital signature/);
});

test('API metadata and runtime credentials work without leaking secrets into workflow events', native, async t => {
  const app = await createApp(); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const file = { name: source.name, data: source.data.toString('base64') };
  const post = (path, body) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const metadata = await (await post('/api/metadata', { file })).json(); assert.equal(metadata.metadata.details.pageCount, 3);
  const pipeline = { nodes: [{ id: 'u', type: 'pdf.upload' }, { id: 'e', type: 'pdf.encrypt' }, { id: 'd', type: 'pdf.preview' }], edges: [{ source: 'u', target: 'e' }, { source: 'e', target: 'd' }] };
  const password = 'private-API-test-password';
  const body = await (await post('/api/run', { pipeline, input: file, runtimeInputs: { e: { secrets: { password } } } })).text();
  assert.ok(!body.includes(password)); const result = JSON.parse(body.trim().split('\n').at(-1)).result;
  assert.equal(result.status, 'succeeded'); assert.equal(result.output.value.encrypted, true);
  assert.throws(() => decodeRuntimeInputs({ unknown: { secrets: { password } } }, pipeline.nodes), /existing nodes/);
  assert.throws(() => decodeRuntimeInputs({ e: { secrets: { password: 'x\ny' } } }, pipeline.nodes), /line breaks/);
});

test('legacy Optimize and Inspect workflow nodes migrate without introducing lossy compression', () => {
  const node = (id, operation) => ({ id, position: { x: 0, y: 0 }, data: { operation, options: {} } });
  const restored = parseWorkflow({ name: 'Legacy PDF', nodes: [node('u', 'pdf.upload'), node('o', 'pdf.optimize'), node('i', 'pdf.inspect'), node('d', 'pdf.preview')],
    edges: [{ source: 'u', target: 'o' }, { source: 'o', target: 'i' }, { source: 'i', target: 'd' }] });
  assert.equal(restored.nodes[1].data.operation, 'pdf.reduce');
  assert.equal(restored.nodes[1].data.options.factor, 1);
  assert.equal(restored.nodes[2].data.operation, 'pdf.pipe');
  assert.equal(restored.nodes[2].data.kind, 'pipe');
});

test('MCP reads credentials and signature attachments from workspace paths and exposes shared metadata', native, async t => {
  const directory = await workspace(t); await writeFile(join(directory, 'source.pdf'), source.data);
  await writeFile(join(directory, 'password.txt'), 'MCP-secret-test-password', { mode: 0o600 }); await writeFile(join(directory, 'signature.png'), sampleImage);
  const client = new Client({ name: 'security-test', version: '1' }); t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('mcp-server.mjs'), '--workspace', directory], env: getDefaultEnvironment(), stderr: 'pipe' }));
  const call = async (name, args) => { const result = await client.callTool({ name, arguments: args }); assert.ok(!result.isError, JSON.stringify(result)); assert.ok(!JSON.stringify(result).includes('MCP-secret-test-password')); return result.structuredContent; };
  const encrypted = await call('flowkit_pdf_encrypt', { inputPath: 'source.pdf', passwordFilePath: 'password.txt' });
  const metadata = await call('flowkit_file_metadata', { inputPath: encrypted.path }); assert.equal(metadata.details.encrypted, true);
  const decrypted = await call('flowkit_pdf_decrypt', { inputPath: encrypted.path, passwordFilePath: 'password.txt' }); assert.equal(decrypted.encrypted, false);
  const signed = await call('flowkit_pdf_sign', { inputPath: decrypted.path, signatureImagePath: 'signature.png' }); assert.equal(signed.signatureType, 'visible-image');
  const invalid = await client.callTool({ name: 'flowkit_pdf_encrypt', arguments: { inputPath: 'source.pdf', passwordFilePath: '../password.txt' } }); assert.equal(invalid.isError, true);
  assert.deepEqual(await readFile(join(directory, 'source.pdf')), source.data);
});
