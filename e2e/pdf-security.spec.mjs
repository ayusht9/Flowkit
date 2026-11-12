import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultWorkflow } from '../src/catalog.mjs';
import { makePdf } from '../examples/fixtures/pdf.mjs';
import { sampleImage } from '../examples/fixtures/image.mjs';
import { sampleAudio } from '../examples/fixtures/media.mjs';
import { makeImagePdf, makeTestCertificate, verifyTestSignature } from '../examples/fixtures/pdf-security.mjs';

async function open(page) {
  await page.goto('/');
  await page.locator('input[type=file][accept=".json"]').setInputFiles({ name: 'security.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(defaultWorkflow())) });
}
async function upload(page, name, data) {
  const pending = page.waitForEvent('filechooser');
  await page.locator('.react-flow__node[data-id="upload"] .card-icon-ring').click();
  await (await pending).setFiles({ name, mimeType: 'application/octet-stream', buffer: data });
  await expect(page.locator('.react-flow__node[data-id="upload"]')).toContainText(name);
}
async function select(page, operation) { await page.locator('.react-flow__node[data-id="convert"]').getByLabel('Operation', { exact: true }).selectOption(operation); }
async function run(page) { await page.getByRole('navigation', { name: 'Workflow actions' }).getByRole('button', { name: 'Run', exact: true }).click(); await expect(page.locator('.node-success')).toHaveCount(3); }
async function download(page) {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const result = await pending; const chunks = []; for await (const chunk of await result.createReadStream()) chunks.push(chunk); return Buffer.concat(chunks);
}
async function assertSavedWithout(page, forbidden) {
  await page.getByRole('button', { name: 'Open workflow menu' }).click(); await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await page.evaluate(() => localStorage.getItem('flowkit.workspace'));
  for (const value of forbidden) expect(saved).not.toContain(value);
}

test('automatic Upload metadata covers image, audio, text and PDF without running a pipeline', async ({ page }) => {
  await open(page);
  for (const [name, data, expected] of [['photo.png', sampleImage, 'image/png'], ['tone.wav', sampleAudio, 'audio/wav'], ['notes.md', Buffer.from('# Title\nBody'), 'text/markdown'], ['source.pdf', makePdf(), 'application/pdf']]) {
    await upload(page, name, data);
    const node = page.locator('.react-flow__node[data-id="upload"]'); await node.hover(); await node.getByRole('button', { name: /^Configure / }).click();
    const metadata = page.getByRole('region', { name: 'File metadata' });
    await expect(metadata.getByText(expected, { exact: true })).toBeVisible(); await expect(metadata).toHaveAttribute('aria-busy', 'false');
  }
  await expect(page.locator('.node-success')).toHaveCount(0);
});

test('Size Reducer supports compression factor and Auto/manual quality and reports actual savings', async ({ page }) => {
  await open(page); const source = await makeImagePdf(); await upload(page, 'large.pdf', source); await select(page, 'pdf.reduce');
  await page.getByLabel('Compression factor', { exact: true }).fill('2'); await expect(page.getByLabel('Auto quality', { exact: true })).toBeChecked();
  await run(page); expect((await download(page)).length).toBeLessThan(source.length / 2);
  await expect(page.getByText(/Target reached/)).toBeVisible();
  const process = page.locator('.react-flow__node[data-id="convert"]'); await process.hover(); await process.getByRole('button', { name: 'Configure PDF Size Reducer', exact: true }).click();
  await page.getByLabel('Auto quality', { exact: true }).uncheck(); await page.getByRole('slider', { name: 'Image quality', exact: true }).fill('40');
  await run(page); expect((await download(page)).length).toBeLessThan(source.length);
});

test('encrypt and both signing methods work while credentials and attachments stay out of saved workflows', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await upload(page, 'source.pdf', makePdf()); await select(page, 'pdf.encrypt');
  const password = 'UI-private-password-456'; await page.getByLabel('Opening password', { exact: true }).fill(password);
  await assertSavedWithout(page, [password, 'runtimeInputs']);
  await run(page); await expect(page.getByText('Encryption: encrypted', { exact: true })).toBeVisible(); expect((await download(page)).length).toBeGreaterThan(100);
  await select(page, 'pdf.sign'); await page.getByLabel('Signature image', { exact: true }).setInputFiles({ name: 'private-signature.png', mimeType: 'image/png', buffer: sampleImage });
  await assertSavedWithout(page, ['private-signature.png', sampleImage.toString('base64')]);
  await run(page); await expect(page.getByText('Visible signature image', { exact: true })).toBeVisible();
  const process = page.locator('.react-flow__node[data-id="convert"]'); await process.hover(); await process.getByRole('button', { name: 'Configure Sign PDF', exact: true }).click();
  await page.getByLabel('Signing method', { exact: true }).selectOption('certificate');
  const directory = await mkdtemp(join(tmpdir(), 'flowkit-browser-cert-'));
  try {
    const certificate = await makeTestCertificate(directory);
    await page.getByLabel('Signing certificate', { exact: true }).setInputFiles({ name: certificate.file.name, mimeType: 'application/x-pkcs12', buffer: certificate.file.data });
    await page.getByLabel('Certificate password', { exact: true }).fill(certificate.password);
    await assertSavedWithout(page, [certificate.password, certificate.file.data.toString('base64'), certificate.file.name]);
    await run(page); await expect(page.getByText('Certificate digital signature', { exact: true })).toBeVisible(); await verifyTestSignature(await download(page), directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
  expect(errors).toEqual([]);
});
