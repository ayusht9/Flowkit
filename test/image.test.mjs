import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImageResize, createImageOperation, defaultImageExecutable } from '../src/image.mjs';
import { imageOperations } from '../src/image-operations.mjs';
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

test('all image operations reject unknown flags, invalid ranges and malformed input', async () => {
  const workflows = createWorkflowRegistry({ imageExecutable: executable });
  for (const operation of imageOperations) {
    await assert.rejects(workflows.execute(operation.type, input(), { ...operation.defaults, executable: 'evil' }), TypeError);
    await assert.rejects(workflows.execute(operation.type, input('bad.svg'), operation.defaults), TypeError);
    await assert.rejects(workflows.execute(operation.type, input(), operation.defaults, { signal: AbortSignal.abort() }), { name: 'AbortError' });
  }
  for (const [type, options] of [
    ['image.crop', {}], ['image.crop', { width: 1, height: 1, x: -1 }], ['image.crop', { width: 1.5, height: 1 }],
    ['image.rotate', { degrees: 45 }], ['image.rotate', { degrees: '90' }], ['image.flip', { direction: '-write evil.png' }],
    ['image.blur', { sigma: 0 }], ['image.blur', { sigma: Infinity }], ['image.sharpen', { sigma: 5.1 }],
    ['image.convert', { format: 'svg' }], ['image.convert', { quality: 101 }], ['image.grayscale', { colorspace: 'RGB' }],
  ]) await assert.rejects(workflows.execute(type, input(), options), TypeError);
  assert.throws(() => createImageOperation('image.unknown'), /Unknown image/);
});

const rgba = value => execFileSync(executable, ['-depth', '8', '-', 'RGBA:-'], { input: value, windowsHide: true });
const pixel = (bytes, width, x, y) => [...bytes.subarray((y * width + x) * 4, (y * width + x + 1) * 4)];

test('native crop, rotation and mirrors move the expected pixels', native, async () => {
  await checkCleanup(async () => {
    const workflows = createWorkflowRegistry({ imageExecutable: executable });
    const original = rgba(sampleImage);
    const cropped = await workflows.execute('image.crop', input(), { width: 40, height: 20, x: 10, y: 5 });
    assert.deepEqual([cropped.value.width, cropped.value.height], [40, 20]);
    assert.deepEqual(pixel(rgba(cropped.value.data), 40, 0, 0), pixel(original, 120, 10, 5));
    for (const [degrees, dimensions, target] of [[90, [60, 120], [59, 0]], [180, [120, 60], [119, 59]], [270, [60, 120], [0, 119]]]) {
      const rotated = await workflows.execute('image.rotate', input(), { degrees });
      assert.deepEqual([rotated.value.width, rotated.value.height], dimensions);
      assert.deepEqual(pixel(rgba(rotated.value.data), dimensions[0], ...target), pixel(original, 120, 0, 0));
    }
    for (const [direction, source] of [['horizontal', [119, 0]], ['vertical', [0, 59]], ['both', [119, 59]]]) {
      const flipped = await workflows.execute('image.flip', input(), { direction });
      assert.deepEqual(pixel(rgba(flipped.value.data), 120, 0, 0), pixel(original, 120, ...source));
    }
    await assert.rejects(workflows.execute('image.crop', input(), { width: 120, height: 60, x: 1 }), /Crop rectangle must fit/);
  });
});

test('native grayscale, blur and sharpen change pixels while preserving dimensions', native, async () => {
  const workflows = createWorkflowRegistry({ imageExecutable: executable });
  const original = rgba(sampleImage);
  for (const type of ['image.grayscale', 'image.blur', 'image.sharpen']) {
    const output = await workflows.execute(type, input(), type === 'image.grayscale' ? {} : { sigma: 2 });
    assert.deepEqual([output.value.width, output.value.height], [120, 60]);
    const pixels = rgba(output.value.data);
    assert.notDeepEqual(pixels, original);
    if (type === 'image.grayscale') for (let i = 0; i < pixels.length; i += 4)
      assert.ok(pixels[i] === pixels[i + 1] && pixels[i + 1] === pixels[i + 2]);
  }
});

test('4K color JPEG blur and sharpen can spill pixel caches and clean up', native, async () => {
  await checkCleanup(async () => {
    const data = execFileSync(executable, ['-size', '3840x2160', 'gradient:red-blue', 'JPEG:-'], { windowsHide: true });
    const workflows = createWorkflowRegistry({ imageExecutable: executable });
    for (const type of ['image.blur', 'image.sharpen']) {
      const output = await workflows.execute(type, input('4k.jpg', data), { sigma: 1 });
      assert.deepEqual([output.value.width, output.value.height], [3840, 2160]);
      assert.deepEqual([output.value.data.readUInt32BE(16), output.value.data.readUInt32BE(20)], [3840, 2160]);
    }
  });
});

test('JPEG conversion flattens transparency to white and chains through PNG operations', native, async () => {
  await checkCleanup(async () => {
    const workflows = createWorkflowRegistry({ imageExecutable: executable });
    const transparent = execFileSync(executable, ['-size', '2x1', 'xc:none', 'PNG:-'], { windowsHide: true });
    const jpeg = await workflows.execute('image.convert', input('transparent.png', transparent), { format: 'jpeg', quality: 90 });
    assert.equal(jpeg.value.mimeType, 'image/jpeg');
    assert.equal(jpeg.value.name, 'transparent-converted.jpg');
    assert.ok([...rgba(jpeg.value.data)].every(value => value >= 250));
    const png = await workflows.execute('image.convert', jpeg, { format: 'png' });
    assert.equal(png.value.mimeType, 'image/png');
    assert.deepEqual([png.value.data.readUInt32BE(16), png.value.data.readUInt32BE(20)], [2, 1]);
    const steps = [
      { type: 'image.crop', options: { width: 40, height: 20 } },
      { type: 'image.rotate', options: { degrees: 90 } },
      { type: 'image.grayscale', options: {} },
      { type: 'image.convert', options: { format: 'jpeg' } },
    ];
    const nodes = steps.map((step, i) => ({ id: String(i), ...step }));
    const result = await runPipeline({ nodes, edges: nodes.slice(1).map((node, i) => ({ source: String(i), target: node.id })) }, workflows, { input: input() });
    assert.equal(result.status, 'succeeded', result.error?.message);
    assert.deepEqual([result.output.value.width, result.output.value.height], [20, 40]);
    assert.equal(result.output.value.mimeType, 'image/jpeg');
    assert.equal(rgba(result.output.value.data).length, 20 * 40 * 4);
  });
});

test('crop bounds use EXIF-oriented JPEG dimensions', native, async () => {
  const jpeg = execFileSync(executable, ['PNG:-', 'JPEG:-'], { input: sampleImage, windowsHide: true });
  // Minimal EXIF TIFF profile: orientation 6 means rotate 90 degrees clockwise.
  const profile = Buffer.from('45786966000049492a0008000000010012010300010000000600000000000000', 'hex');
  const marker = Buffer.alloc(4);
  marker.writeUInt16BE(0xffe1, 0); marker.writeUInt16BE(profile.length + 2, 2);
  const oriented = Buffer.concat([jpeg.subarray(0, 2), marker, profile, jpeg.subarray(2)]);
  const workflows = createWorkflowRegistry({ imageExecutable: executable });
  const output = await workflows.execute('image.crop', input('oriented.jpg', oriented), { width: 50, height: 100 });
  assert.deepEqual([output.value.width, output.value.height], [50, 100]);
  await assert.rejects(workflows.execute('image.crop', input('oriented.jpg', oriented), { width: 100, height: 50 }), /Crop rectangle must fit/);
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
