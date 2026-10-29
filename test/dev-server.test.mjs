import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';

test('development mode serves the editor and transforms JSX', async () => {
  const app = await createApp({ dev: true });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /@vite\/client/);
    const module = await fetch(`${url}/web/main.jsx`);
    assert.equal(module.status, 200);
    assert.match(await module.text(), /createRoot/);
  } finally {
    await app.close();
  }
});
