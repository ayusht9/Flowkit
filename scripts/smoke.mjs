import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { defaultWorkflow, toPipeline } from "../src/catalog.mjs";

const url = new URL(process.argv[2] || "http://127.0.0.1:3000");
assert.ok(["http:", "https:"].includes(url.protocol));
const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
  : {};
async function request(path, options = {}) {
  return fetch(new URL(path, url), {
    ...options, headers: { ...headers, ...options.headers },
    signal: AbortSignal.timeout(60_000),
  });
}
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await request("/api/health");
    ready = response.ok && (await response.json()).status === "ok";
    if (ready) break;
  } catch { /* Allow a starting container to become ready. */ }
  await setTimeout(2000);
}
assert.ok(ready, "Deployment health check failed");
const page = await request("/");
assert.equal(page.status, 200);
assert.match(await page.text(), /<div id="root"><\/div>/);
const sampleResponse = await request("/api/sample");
assert.equal(sampleResponse.status, 200);
const sample = await sampleResponse.json();
const { nodes, edges } = defaultWorkflow();
const run = await request("/api/run", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: url.origin },
  body: JSON.stringify({ pipeline: toPipeline(nodes, edges), input: sample }),
});
assert.equal(run.status, 200);
const events = (await run.text()).trim().split("\n").map((line) => JSON.parse(line));
assert.equal(events.at(-1).result?.status, "succeeded");
assert.match(events.at(-1).result.output.value.text, /# FlowKit project brief/);
console.log("Smoke test passed: frontend, API, Pandoc conversion, streamed Markdown.");
