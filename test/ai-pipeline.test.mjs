import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/server.mjs';

test('AI endpoint creates validated pipelines and rejects incompatible plans', async () => {
  const previous = Object.fromEntries(['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL'].map(key => [key, process.env[key]]));
  let plan = { name: 'Resize photo', nodes: [
    { type: 'image.upload', options: {} },
    { type: 'image.resize', options: { width: 640 } },
    { type: 'image.preview', options: {} },
  ] };
  let requests = 0;
  const provider = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(JSON.parse(raw).messages.at(-1).content, 'Resize my photo to 640 pixels');
    requests++;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  process.env.OPENAI_API_KEY = 'local-test-only';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1`;
  process.env.OPENAI_MODEL = 'local-test';
  const app = await createApp();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const submit = text => fetch(`${base}/api/ai/pipeline`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  try {
    assert.equal((await (await fetch(`${base}/api/health`)).json()).features.aiPipeline, true);
    const good = await submit('Resize my photo to 640 pixels');
    assert.equal(good.status, 200);
    const result = await good.json();
    assert.equal(result.workflow.nodes[1].options.width, 640);
    assert.equal(result.workflow.edges.length, 2);
    assert.equal((await submit('')).status, 400);
    assert.equal(requests, 1);
    plan.nodes[1] = { type: 'audio.convert', options: { format: 'mp3' } };
    assert.equal((await submit('Resize my photo to 640 pixels')).status, 502);
    delete process.env.OPENAI_API_KEY;
    const savedAiKey = process.env.AI_API_KEY;
    delete process.env.AI_API_KEY;
    try { assert.equal((await submit('Resize my photo to 640 pixels')).status, 503); }
    finally { if (savedAiKey !== undefined) process.env.AI_API_KEY = savedAiKey; }
  } finally {
    await app.close();
    await new Promise(resolve => provider.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
