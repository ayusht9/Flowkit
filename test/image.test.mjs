import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImageResize, defaultImageExecutable } from '../src/image.mjs';
import { OperationRegistry } from '../src/operations.mjs';
import { createWorkflowRegistry } from '../src/workflow.mjs';
import { imageWorkflow, defaultWorkflow, toPipeline, parseWorkflow, canConnect } from '../src/catalog.mjs';
import { createApp } from '../src/server.mjs';
import { runPipeline } from '../src/pipeline.mjs';
import { sampleImage } from '../examples/fixtures/image.mjs';

const executable = process.env.IMAGEMAGICK_PATH || defaultImageExecutable;
const installed = spawnSync(executable, ['-version'], { windowsHide: true }).status === 0;
const native = { skip: installed ? false : 'Install ImageMagick or set IMAGEMAGICK_PATH for native tests' };
const input = (name = 'sample.png', data = sampleImage) => ({ type: 'image', value: { name, data } });
const registry = new OperationRegistry().register('resize', createImageResize({ executable }));
async function checkCleanup(callback) {
  const before = new Set(await readdir(tmpdir()));
  await callback();
  assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith('flowkit-image-') && !before.has(name)), []);
}

test('explicit IMAGEMAGICK_PATH must work', { skip: !process.env.IMAGEMAGICK_PATH }, () => assert.equal(installed, true));

test('rejects unsafe filenames, signatures, oversized files, dimensions, and native flags', async () => {
  for (const payload of [input('../bad.png'), input('a\\bad.png'), input('bad\0.png'), input('bad.svg'),
    input('bad.png', Buffer.from('invalid')), input('bad.jpg'), input('a.png', Buffer.alloc(20 * 1024 * 1024 + 1)),
    input('a.png', 'not bytes')])
    await assert.rejects(registry.execute('resize', payload, { width: 40 }), TypeError);
  for (const options of [{}, { width: 0 }, { width: 4097 }, { width: 1.5 }, { height: -1 }, { width: '40' }, { width: NaN }, { width: 40, executable: 'evil' }])
    await assert.rejects(registry.execute('resize', input(), options), TypeError);
  assert.throws(() => createImageResize({ timeoutMs: 0 }), /Timeout/);
});

test('image workflow survives export/import and rejects document connections and upload targets', () => {
  const workflow = imageWorkflow();
  assert.deepEqual(toPipeline(parseWorkflow(workflow).nodes, workflow.edges), toPipeline(workflow.nodes, workflow.edges));
  const nodes = [...workflow.nodes, ...defaultWorkflow().nodes];
  assert.equal(canConnect({ source: 'upload', target: 'resize' }, nodes, []), false);
  assert.equal(canConnect({ source: 'resize', target: 'upload-image' }, nodes, []), false);
  assert.equal(canConnect({ source: 'preview-image', target: 'resize' }, nodes, []), false);
});

test('missing ImageMagick is actionable and removes temporary input', async () => {
  const missing = new OperationRegistry().register('resize', createImageResize({ executable: join(tmpdir(), 'flowkit-missing', 'magick') }));
  await checkCleanup(() => assert.rejects(missing.execute('resize', input(), { width: 40 }), /ImageMagick was not found/));
});

test('real PNG resize preserves aspect ratio for bounding boxes and either dimension', native, async () => {
  await checkCleanup(async () => {
    for (const [options, expected] of [[{ width: 40, height: 40 }, [40, 20]], [{ width: 60 }, [60, 30]], [{ height: 10 }, [20, 10]]]) {
      const output = await registry.execute('resize', input('photo & echo hello.png'), options);
      assert.deepEqual([output.value.width, output.value.height], expected);
      assert.equal(output.value.name, 'photo & echo hello-resized.png');
      assert.equal(output.value.mimeType, 'image/png');
      const dimensions = execFileSync(executable, ['PNG:-', '-format', '%w %h', 'info:'], { input: output.value.data, windowsHide: true }).toString();
      assert.equal(dimensions, expected.join(' '));
    }
  });
});

test('real JPEG resizes through the linear executor', native, async () => {
  const data = execFileSync(executable, ['PNG:-', 'JPEG:-'], { input: sampleImage, windowsHide: true });
  const workflow = imageWorkflow();
  workflow.nodes[1].data.options = { width: 40, height: 40 };
  const result = await runPipeline(toPipeline(workflow.nodes, workflow.edges), createWorkflowRegistry({ imageExecutable: executable }), { input: input('photo.jpeg', data) });
  assert.equal(result.status, 'succeeded', result.error?.message);
  assert.equal(result.nodes.length, 3);
  assert.deepEqual([result.output.value.width, result.output.value.height], [40, 20]);
});

test('corrupt and excessive pixel inputs fail and remove temporary files', native, async () => {
  await checkCleanup(async () => {
    await assert.rejects(registry.execute('resize', input('bad.png', sampleImage.subarray(0, 24)), { width: 40 }), /resize failed/);
    const large = execFileSync(executable, ['-size', '5000x4000', 'xc:red', 'PNG:-'], { windowsHide: true });
    await assert.rejects(registry.execute('resize', input('large.png', large), { width: 40 }), /16 million pixel/);
  });
});

test('pre-abort, in-flight cancellation, and execution deadlines clean up', native, async () => {
  await checkCleanup(async () => {
    const aborted = AbortSignal.abort();
    await assert.rejects(registry.execute('resize', input(), { width: 40 }, { signal: aborted }), { name: 'AbortError' });
    const deadline = new OperationRegistry().register('resize', createImageResize({ executable, timeoutMs: 1 }));
    await assert.rejects(deadline.execute('resize', input(), { width: 40 }), /execution limit/);
    const controller = new AbortController();
    const task = registry.execute('resize', input(), { width: 4096 }, { signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 10);
    try { await assert.rejects(task, { name: 'AbortError' }); } finally { clearTimeout(timer); }
  });
});

test('API streams the resized PNG once and metadata for intermediate images', native, async () => {
  const app = await createApp({ imageExecutable: executable });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  try {
    const workflow = imageWorkflow();
    workflow.nodes[1].data.options = { width: 40, height: 40 };
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipeline: toPipeline(workflow.nodes, workflow.edges), input: { name: 'sample.png', data: sampleImage.toString('base64') } }),
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split('\n').map(JSON.parse);
    const result = events.at(-1).result;
    assert.equal(result.status, 'succeeded', result.error?.message);
    assert.equal(events.filter(event => event.type === 'node.succeeded').length, 3);
    assert.equal(result.output.value.width, 40);
    assert.equal(Buffer.from(result.output.value.data, 'base64').readUInt32BE(20), 20);
    assert.ok(result.nodes.every(node => node.output.value.data === undefined));
    assert.equal(result.nodes[0].output.value.size, sampleImage.length);
  } finally { await app.close(); }
});
