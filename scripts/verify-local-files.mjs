import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createApp } from '../src/server.mjs';
import { imageWorkflow, toPipeline } from '../src/catalog.mjs';
import { defaultImageExecutable } from '../src/image.mjs';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/verify-local-files.mjs <test_files directory>');
const executable = process.env.IMAGEMAGICK_PATH || defaultImageExecutable;
const files = (await readdir(join(directory, 'Images'), { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name));
const app = await createApp();
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
let resized = 0;
let rejected = 0;
try {
  for (const file of files) {
    const supported = /\.(png|jpe?g)$/i.test(file);
    const data = await readFile(file);
    const workflow = imageWorkflow();
    workflow.nodes[1].data.options = { width: 320, height: 240 };
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipeline: toPipeline(workflow.nodes, workflow.edges), input: { name: file.split(/[\\/]/).at(-1), data: data.toString('base64') } }),
    });
    if (!supported) {
      assert.equal(response.status, 400, file);
      assert.match((await response.json()).error, /PNG or JPEG/);
      rejected++;
      console.log(`REJECTED (unsupported): ${relative(directory, file)}`);
      continue;
    }
    assert.equal(response.status, 200, file);
    const result = (await response.text()).trim().split('\n').map(line => JSON.parse(line)).at(-1).result;
    assert.equal(result.status, 'succeeded', `${file}: ${result.error?.message}`);
    const output = Buffer.from(result.output.value.data, 'base64');
    const dimensions = execFileSync(executable, ['PNG:-', '-format', '%w %h', 'info:'], { input: output, windowsHide: true }).toString().split(' ').map(Number);
    const original = execFileSync(executable, [file, '-auto-orient', '-format', '%w %h', 'info:'], { windowsHide: true }).toString().split(' ').map(Number);
    const scale = Math.min(320 / original[0], 240 / original[1]);
    assert.deepEqual(dimensions, original.map(value => Math.max(1, Math.round(value * scale))), file);
    assert.deepEqual(dimensions, [result.output.value.width, result.output.value.height]);
    assert.ok(result.nodes.every(node => !node.output?.value?.data));
    resized++;
    console.log(`PASSED: ${relative(directory, file)} — ${original.join('x')} → ${dimensions.join('x')}`);
  }
  assert.ok(resized > 0, 'No PNG/JPEG fixtures found');
  console.log(`Local file verification passed: ${resized} resized, ${rejected} unsupported formats rejected.`);
} finally { await app.close(); }
