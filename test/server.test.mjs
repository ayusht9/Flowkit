import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createApp, findPandoc } from "../src/server.mjs";
import { defaultWorkflow, toPipeline } from "../src/catalog.mjs";

async function withServer(callback) {
  const app = await createApp();
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    await callback(url);
  } finally {
    await app.close();
  }
}

test("API exposes only the implemented node catalog and a real sample document", async () => {
  await withServer(async (url) => {
    const operations = await (await fetch(`${url}/api/operations`)).json();
    assert.equal(operations.operations.length, 26);
    assert.deepEqual(operations.operations.filter((item) => item.section === "PDF").map((item) => item.type), ["document.toPdf"]);
    const sample = await (await fetch(`${url}/api/sample`)).json();
    assert.match(
      Buffer.from(sample.data, "base64").toString(),
      /FlowKit project brief/,
    );
    assert.equal((await fetch(`${url}/api/missing`)).status, 404);
  });
});

test("API rejects cross-origin calls, unknown operations, malformed JSON, and invalid input bytes", async () => {
  await withServer(async (url) => {
    const request = (body) => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(
      (
        await fetch(`${url}/api/run`, {
          ...request({}),
          headers: {
            "Content-Type": "application/json",
            Origin: "https://example.com",
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${url}/api/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{",
        })
      ).status,
      400,
    );
    assert.equal(
      (await fetch(`${url}/api/run`, { method: "POST", body: "text" })).status,
      415,
    );
    const workflow = defaultWorkflow();
    const pipeline = toPipeline(workflow.nodes, workflow.edges);
    assert.equal(
      (
        await fetch(
          `${url}/api/run`,
          request({ pipeline, input: { name: "a.html", data: "not-base64" } }),
        )
      ).status,
      400,
    );
    pipeline.nodes[1].type = "shell.run";
    const response = await fetch(
      `${url}/api/run`,
      request({ pipeline, input: { name: "a.html", data: "aGVsbG8=" } }),
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Unknown operation/);
  });
});

test("deployment hosts require exact origins and reject spoofed forwarded headers", async () => {
  const app = await createApp({ allowedOrigins: ["https://flowkit.example"] });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  async function get(headers) {
    return new Promise((resolve, reject) => {
      const request = httpRequest({
        hostname: "127.0.0.1", port: app.server.address().port,
        path: "/api/health", headers,
      }, (response) => { response.resume(); resolve(response.statusCode); });
      request.on("error", reject);
      request.end();
    });
  }
  try {
    assert.equal(await get({ Host: "flowkit.example", Origin: "https://flowkit.example" }), 200);
    assert.equal(await get({ Host: "flowkit.example", Origin: "https://evil.example" }), 403);
    assert.equal(await get({ Host: "flowkit.example", Origin: "http://flowkit.example" }), 403);
    assert.equal(await get({ Host: "evil.example", "X-Forwarded-Host": "flowkit.example" }), 403);
    assert.equal(await get({ Host: "localhost" }), 200);
    assert.equal(await get({ Host: "flowkit.example.evil" }), 403);
  } finally { await app.close(); }
});

test("deployment origins reject paths, credentials, and non-HTTP protocols", async () => {
  for (const origin of ["https://flowkit.example/", "https://a:b@flowkit.example", "file:///tmp/a"])
    await assert.rejects(createApp({ allowedOrigins: [origin] }));
});

const pandoc = await findPandoc();
const installed =
  spawnSync(pandoc, ["--version"], { windowsHide: true }).status === 0;
test(
  "API runs the full uploaded-file workflow and streams progress plus Markdown, excluding file bytes",
  { skip: !installed },
  async () => {
    await withServer(async (url) => {
      const workflow = defaultWorkflow();
      const sample = await (await fetch(`${url}/api/sample`)).json();
      const response = await fetch(`${url}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline: toPipeline(workflow.nodes, workflow.edges),
          input: sample,
        }),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /ndjson/);
      const events = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(
        events.filter((event) => event.type === "node.succeeded").length,
        4,
      );
      const result = events.at(-1).result;
      assert.equal(result.status, "succeeded");
      assert.match(result.output.value.text, /# FlowKit project brief/);
      assert.equal(result.nodes[0].output.value.source, "sample.html");
      assert.equal(result.nodes[0].output.value.data, undefined);
    });
  },
);

test("API returns office artifacts as base64 only in the final output", { skip: !installed }, async () => {
  await withServer(async (url) => {
    const sample = await (await fetch(`${url}/api/sample`)).json();
    const response = await fetch(`${url}/api/run`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: sample, pipeline: {
        nodes: [
          { id: "upload", type: "file.upload", options: {} },
          { id: "convert", type: "document.toHtml", options: {} },
          { id: "download", type: "document.preview", options: {} },
        ],
        edges: [{ source: "upload", target: "convert" }, { source: "convert", target: "download" }],
      } }),
    });
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    const result = events.at(-1).result;
    assert.equal(result.status, "succeeded");
    assert.equal(result.output.value.name, "sample.html");
    assert.match(Buffer.from(result.output.value.data, "base64").toString(), /<!DOCTYPE html>/i);
    assert.equal(result.nodes[1].output.value.data, undefined);
  });
});
