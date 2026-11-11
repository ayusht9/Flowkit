import { test, expect } from '@playwright/test';
import { imageWorkflow } from '../src/catalog.mjs';
import { imageOperations } from '../src/image-operations.mjs';

test('changing an image node operation updates its selection and settings', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('input[type=file][accept=".json"]').setInputFiles({ name: 'image.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imageWorkflow())) });
  const node = page.locator('.react-flow__node[data-id="resize"]');
  await node.locator('.card-body').click();
  const selector = node.getByRole('combobox', { name: 'Operation', exact: true });
  await selector.click();
  await page.keyboard.press('Escape');
  await selector.focus();
  await selector.press('ArrowDown');
  await selector.press('Enter');
  await expect(selector).toHaveValue('image.crop');
  for (const operation of imageOperations) {
    await selector.click();
    await page.keyboard.press('Escape');
    await node.getByLabel('Operation', { exact: true }).selectOption(operation.type);
    await expect(node.getByLabel('Operation', { exact: true })).toHaveValue(operation.type);
    await expect(node.getByRole('heading')).toHaveText(operation.title);
    for (const field of operation.fields.filter(field => field.key !== 'quality'))
      await expect(page.getByRole('complementary', { name: 'Node editor' }).getByRole(field.choices ? 'combobox' : 'spinbutton', { name: field.label, exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});
