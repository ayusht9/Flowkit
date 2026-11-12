import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makePdf } from '../examples/fixtures/pdf.mjs';
import { defaultWorkflow } from '../src/catalog.mjs';

const execute = promisify(execFile);
const node = (id, operation, x, y, options = {}) => ({ id, type: 'operation', position: { x, y }, data: { operation, options } });

async function importWorkflow(page, workflow) {
  await page.goto('/');
  await page.locator('input[type=file][accept=".json"]').setInputFiles({ name: 'pdf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(workflow)) });
  await expect(page.locator('.operation-node')).toHaveCount(workflow.nodes.length);
}

async function upload(page, id, name, buffer = makePdf()) {
  const pending = page.waitForEvent('filechooser');
  await page.locator(`.react-flow__node[data-id="${id}"] .card-icon-ring`).click();
  await (await pending).setFiles({ name, mimeType: 'application/pdf', buffer });
  await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toContainText(name);
}

async function downloadAndInspect(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const result = await pending;
  const chunks = [];
  for await (const chunk of await result.createReadStream()) chunks.push(chunk);
  const directory = await mkdtemp(join(tmpdir(), 'flowkit-browser-pdf-'));
  try {
    const path = join(directory, 'result.pdf');
    await writeFile(path, Buffer.concat(chunks));
    const { stdout } = await execute(process.env.QPDF_PATH || 'qpdf', [path, '--json', '--json-key=pages', '--json-key=qpdf'], { windowsHide: true });
    const pdf = JSON.parse(stdout);
    return pdf.pages.map(page => pdf.qpdf[1][`obj:${page.object}`].value);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('PDF upload infers PDF processing, reports invalid pages, extracts and rotates downloaded pages', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await importWorkflow(page, defaultWorkflow());
  await upload(page, 'upload', 'source.pdf');
  const process = page.locator('.react-flow__node[data-id="convert"]');
  await expect(process.getByLabel('File type', { exact: true })).toHaveValue('PDF');
  await expect(process.getByLabel('Operation', { exact: true })).toHaveValue('pdf.extract');
  await process.hover();
  await process.getByRole('button', { name: 'Configure Extract PDF pages', exact: true }).click();
  await page.getByRole('textbox', { name: 'Pages', exact: true }).fill('0');
  await expect(page.getByRole('textbox', { name: 'Pages', exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('textbox', { name: 'Pages', exact: true }).fill('3,1');
  await page.getByRole('navigation', { name: 'Workflow actions' }).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.node-success')).toHaveCount(3);
  expect((await downloadAndInspect(page)).map(page => page['/MediaBox'][2])).toEqual([320, 300]);
  await process.getByLabel('Operation', { exact: true }).selectOption('pdf.rotate');
  await process.hover();
  await process.getByRole('button', { name: 'Configure Rotate PDF pages', exact: true }).click();
  await page.getByRole('textbox', { name: 'Pages', exact: true }).fill('2');
  await page.getByLabel('Clockwise rotation', { exact: true }).selectOption('270');
  await page.getByRole('navigation', { name: 'Workflow actions' }).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.node-success')).toHaveCount(3);
  expect((await downloadAndInspect(page)).map(page => page['/Rotate'] || 0)).toEqual([0, 270, 0]);
  expect(errors).toEqual([]);
});

test('PDF merge shows incoming file order and downloads all pages from multiple uploads', async ({ page }) => {
  await importWorkflow(page, { name: 'Merge PDFs', nodes: [node('a', 'pdf.upload', 80, 100), node('b', 'pdf.upload', 80, 430), node('m', 'pdf.merge', 400, 240), node('d', 'pdf.preview', 720, 240)],
    edges: [{ source: 'b', target: 'm' }, { source: 'a', target: 'm' }, { source: 'm', target: 'd' }] });
  await upload(page, 'a', 'first.pdf');
  await upload(page, 'b', 'second.pdf', makePdf(['Last page']));
  const merge = page.locator('.react-flow__node[data-id="m"]');
  await merge.hover();
  await merge.getByRole('button', { name: 'Configure Merge PDFs', exact: true }).click();
  await expect(page.getByLabel('Node editor').locator('ol li')).toHaveText(['second.pdf', 'first.pdf']);
  await page.getByRole('navigation', { name: 'Workflow actions' }).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.node-success')).toHaveCount(4);
  expect((await downloadAndInspect(page)).map(page => page['/MediaBox'][2])).toEqual([300, 300, 310, 320]);
});
