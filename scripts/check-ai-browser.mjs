import { createServer } from 'node:http';
import { createApp } from '../src/server.mjs';
import { chromium } from '@playwright/test';
const provider = createServer((request, response) => {
  request.resume();
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ name: 'Resize photo', nodes: [
    { type: 'image.upload', options: {} }, { type: 'image.resize', options: { width: 640 } }, { type: 'image.preview', options: {} },
  ] }) } }] }));
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
process.env.OPENAI_API_KEY = 'local-test-only';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1`;
const app = await createApp();
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  await page.getByRole('textbox', { name: 'Describe a pipeline in natural language' }).fill('Resize my photo to 640 pixels');
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByText('Pipeline created. Review the nodes, upload your input, then press Run.', { exact: true }).waitFor();
  if (await page.locator('.react-flow__node').count() !== 3) throw Error('Expected three generated nodes');
  console.log('Browser -> AI endpoint -> mock provider -> three image workflow nodes: PASS');
} finally {
  await browser?.close();
  await app.close();
  await new Promise(resolve => provider.close(resolve));
}
