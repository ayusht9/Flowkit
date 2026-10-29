import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
    assert.equal(operations.operations.length, 4);
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
