import { test, expect } from '@playwright/test';
import { sampleImage } from '../examples/fixtures/image.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { imageWorkflow } from '../src/catalog.mjs';

const fixture = process.env.FLOWKIT_TEST_FILES
  ? await readFile(join(process.env.FLOWKIT_TEST_FILES, 'Images', 'PNG', 'sample.png')) : sampleImage;
const fixtureName = process.env.FLOWKIT_TEST_FILES ? 'sample.png' : 'gradient.png';
const scale = Math.min(40 / fixture.readUInt32BE(16), 40 / fixture.readUInt32BE(20));
const expectedDimensions = [fixture.readUInt32BE(16), fixture.readUInt32BE(20)].map(value => Math.max(1, Math.round(value * scale)));

async function uploadImage(page, name, buffer) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('.react-flow__node[data-id="upload-image"] .card-icon-ring').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name, mimeType: 'image/png', buffer });
  await expect(page.locator('.react-flow__node[data-id="upload-image"]')).toContainText(name);
}

test('crop, rotate and JPEG conversion run through editable visual nodes and download', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const base = imageWorkflow();
  const steps = [
    { id: 'crop', operation: 'image.crop', options: { width: 40, height: 20, x: 10, y: 5 } },
    { id: 'rotate', operation: 'image.rotate', options: { degrees: 90 } },
    { id: 'convert', operation: 'image.convert', options: { format: 'png', quality: 85 } },
  ];
  const nodes = [base.nodes[0], ...steps.map((step, i) => ({ id: step.id, type: 'operation', position: { x: 340 + i * 300, y: 240 }, data: { kind: 'process', operation: step.operation, options: step.options } })),
    { ...base.nodes[2], position: { x: 1240, y: 240 } }];
  const workflow = { name: 'Image transformations', nodes, edges: nodes.slice(1).map((node, i) => ({ id: `e${i}`, source: nodes[i].id, target: node.id })) };
  await page.locator('input[type=file][accept=".json"]').setInputFiles({ name: 'image.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(workflow)) });
  await uploadImage(page, 'gradient.png', sampleImage);
  await page.locator('.react-flow__node[data-id="crop"] .card-body').click();
  await expect(page.getByLabel('Crop width (px)')).toHaveValue('40');
  await page.getByLabel('Left offset (px)').fill('5');
  await page.locator('.react-flow__node[data-id="rotate"] .card-body').click();
  await page.getByLabel('Clockwise rotation').selectOption('270');
  await page.locator('.react-flow__node[data-id="convert"] .card-body').click();
  await page.getByLabel('Image output format').selectOption('jpeg');
  await expect(page.locator('.react-flow__node[data-id="convert"] .card-subtitle')).toContainText('JPEG');
  await page.getByLabel('JPEG quality').fill('75');
  await page.getByRole('navigation', { name: 'Workflow actions' }).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.node-success')).toHaveCount(5);
  const preview = page.getByAltText('Processed image', { exact: true });
  await expect.poll(() => preview.evaluate(image => [image.naturalWidth, image.naturalHeight])).toEqual([20, 40]);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('gradient-cropped-rotated-converted.jpg');
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  expect([...Buffer.concat(chunks).subarray(0, 3)]).toEqual([255, 216, 255]);
  await page.screenshot({ path: 'test-results/image-tools-complete.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('upload, configure, resize, preview, and download a real PNG', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open workflow menu' }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Workflow template').selectOption('image');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('.operation-node')).toHaveCount(3);
  await uploadImage(page, fixtureName, fixture);
  await page.locator('.react-flow__node[data-id="resize"] .card-body').click();
  await page.getByLabel('Maximum width (px)').fill('40');
  await page.getByLabel('Maximum height (px)').fill('40');
  await page.getByRole('navigation', { name: 'Workflow actions' }).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByText(`${expectedDimensions.join(' × ')} pixels`, { exact: true })).toBeVisible();
  const preview = page.getByAltText('Processed image', { exact: true });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(image => [image.naturalWidth, image.naturalHeight])).toEqual(expectedDimensions);
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await promise;
  expect(download.suggestedFilename()).toBe(fixtureName.replace('.png', '-resized.png'));
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual(expectedDimensions);
  await page.screenshot({ path: 'test-results/image-resize-complete.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('invalid resize settings produce a visible error before execution', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open workflow menu' }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Workflow template').selectOption('image');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await uploadImage(page, 'gradient.png', sampleImage);
  await page.locator('.react-flow__node[data-id="resize"] .card-body').click();
  await page.getByLabel('Maximum width (px)').fill('0');
  await page.getByRole('navigation', { name: 'Workflow actions' }).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('between 1 and 4096');
  await expect(page.locator('.node-success')).toHaveCount(0);
});
