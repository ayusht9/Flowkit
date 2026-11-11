import { test, expect } from '@playwright/test';
import { defaultWorkflow } from '../src/catalog.mjs';
import { documentConversions } from '../src/document-formats.mjs';

async function openDocumentWorkflow(page) {
  await page.goto('/');
  await page.locator('input[type=file][accept=".json"]').setInputFiles({ name: 'document.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(defaultWorkflow())) });
}

async function upload(page, name, text) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('.react-flow__node[data-id="upload"] .card-icon-ring').click();
  await (await chooserPromise).setFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(text) });
  await expect(page.locator('.react-flow__node[data-id="upload"]')).toContainText(name);
}

test('six Pandoc exports can be selected, processed and downloaded in the editor', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openDocumentWorkflow(page);
  await upload(page, 'report.md', '# Quarterly report\n\n## First slide\n\nRevenue increased.');
  const process = page.locator('.react-flow__node[data-id="convert"]');
  for (const conversion of documentConversions.filter(item => ['text', 'rtf', 'latex', 'rst', 'asciidoc', 'pptx'].includes(item.target))) {
    const selector = process.getByRole('combobox', { name: 'Operation', exact: true });
    await selector.click();
    await page.keyboard.press('Escape');
    await selector.selectOption(conversion.type);
    await expect(process.getByRole('heading')).toHaveText(conversion.title);
    await page.getByRole('navigation', { name: 'Workflow actions' }).getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.locator('.node-success')).toHaveCount(3);
    await expect(page.getByText(`report${conversion.extension}`, { exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download document', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`report${conversion.extension}`);
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (conversion.target === 'pptx') expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
    else expect(bytes.toString('utf8')).toContain('Revenue increased');
  }
  expect(errors).toEqual([]);
});

test('new source extensions upload and convert to readable Markdown', async ({ page }) => {
  await openDocumentWorkflow(page);
  for (const [name, text] of [
    ['source.rst', 'Heading\n=======\n\nReader content.'],
    ['source.tex', '\\section{Heading}\nReader content.'],
    ['source.rtf', '{\\rtf1\\ansi Reader content.}'],
    ['source.txt', 'Reader content.'],
    ['source.markdown', '# Heading\n\nReader content.'],
  ]) {
    await upload(page, name, text);
    await page.getByRole('navigation', { name: 'Workflow actions' }).getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.locator('.node-success')).toHaveCount(3);
    await expect(page.getByLabel('Markdown output', { exact: true })).toContainText('Reader content.');
  }
});
