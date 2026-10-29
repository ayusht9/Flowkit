import { test, expect } from '@playwright/test';
import { sampleImage } from '../examples/fixtures/image.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const fixture = process.env.FLOWKIT_TEST_FILES
  ? await readFile(join(process.env.FLOWKIT_TEST_FILES, 'Images', 'PNG', 'sample.png')) : sampleImage;
const fixtureName = process.env.FLOWKIT_TEST_FILES ? 'sample.png' : 'gradient.png';
const scale = Math.min(40 / fixture.readUInt32BE(16), 40 / fixture.readUInt32BE(20));
const expectedDimensions = [fixture.readUInt32BE(16), fixture.readUInt32BE(20)].map(value => Math.max(1, Math.round(value * scale)));

test('upload, configure, resize, preview, and download a real PNG', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open workflow menu' }).click();
  await page.getByRole('button', { name: 'Use image resize template' }).click();
  await expect(page.locator('.operation-node')).toHaveCount(3);
  await page.locator('input[type=file][accept=".png,.jpg,.jpeg"]').setInputFiles({ name: fixtureName, mimeType: 'image/png', buffer: fixture });
  await page.locator('.react-flow__node[data-id="resize"] .node-tile').click();
  await page.getByLabel('Maximum width (px)').fill('40');
  await page.getByLabel('Maximum height (px)').fill('40');
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  await expect(page.getByText(`${expectedDimensions.join(' × ')} pixels`, { exact: true })).toBeVisible();
  const preview = page.getByAltText('Resized image', { exact: true });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(image => [image.naturalWidth, image.naturalHeight])).toEqual(expectedDimensions);
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
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
  await page.getByRole('button', { name: 'Use image resize template' }).click();
  await page.locator('input[type=file][accept=".png,.jpg,.jpeg"]').setInputFiles({ name: 'gradient.png', mimeType: 'image/png', buffer: sampleImage });
  await page.locator('.react-flow__node[data-id="resize"] .node-tile').click();
  await page.getByLabel('Maximum width (px)').fill('0');
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('between 1 and 4096');
  await expect(page.locator('.node-success')).toHaveCount(0);
});
