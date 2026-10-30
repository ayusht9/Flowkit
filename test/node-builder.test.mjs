import test from "node:test";
import assert from "node:assert/strict";
import { adaptNodes, connectNodes, processOptions, nodeItem } from "../src/node-builder.mjs";
import { defaultWorkflow, parseWorkflow, toPipeline } from "../src/catalog.mjs";
import { createWorkflowRegistry } from "../src/workflow.mjs";
import { runPipeline } from "../src/pipeline.mjs";

const node = (id, operation, kind) => ({ id, position: { x: 0, y: 0 }, data: { operation, kind, options: {} } });

test("a connected upload adapts a previously unconfigured Process and its downstream nodes", () => {
  const nodes = [node("u", "image.upload", "upload"), node("p", "", "process"), node("pipe", "document.pipe", "pipe"), node("d", "artifact.preview", "download")];
  const edges = [{ source: "p", target: "pipe" }, { source: "pipe", target: "d" }];
  const next = connectNodes({ source: "u", target: "p" }, nodes, edges, "photo.jpg");
  assert.ok(next);
  assert.deepEqual(next.nodes.map((item) => item.data.operation), ["image.upload", "image.resize", "image.pipe", "image.preview"]);
  assert.deepEqual(next.nodes[1].data.options, { width: 800, height: 800 });
  assert.equal(nodes[1].data.operation, "");
  const text = adaptNodes(next.nodes, next.edges, "report.docx");
  assert.deepEqual(text.map((item) => item.data.operation), ["file.upload", "document.toMarkdown", "markdown.pipe", "artifact.preview"]);
});

test("operation options follow upstream payload types and survive metadata export/import", () => {
  const workflow = defaultWorkflow();
  const nodes = adaptNodes(workflow.nodes, workflow.edges);
  assert.deepEqual(processOptions("Text", "document").map((item) => item.type), [
    "document.toMarkdown", "document.toHtml", "document.toDocx", "document.toOdt", "document.toEpub", "document.toPdf",
  ]);
  assert.deepEqual(processOptions("Text", "document").map((item) => item.section), ["Text", "Office", "Office", "Office", "Office", "PDF"]);
  assert.deepEqual(processOptions("Text", "markdown").map((item) => item.type), ["context.clean"]);
  const restored = parseWorkflow({ ...workflow, nodes });
  assert.deepEqual(restored.nodes.map((item) => item.data), nodes.map((item) => item.data));
  assert.deepEqual(toPipeline(restored.nodes, restored.edges), toPipeline(workflow.nodes, workflow.edges));
});

test("office and PDF conversions adapt the final node to a document download", () => {
  const workflow = defaultWorkflow();
  const nodes = workflow.nodes
    .filter((item) => item.id !== "clean")
    .map((item) => item.id === "convert" ? { ...item, data: { operation: "document.toPdf", options: {} } } : item);
  const edges = [{ source: "upload", target: "convert" }, { source: "convert", target: "preview" }];
  assert.deepEqual(adaptNodes(nodes, edges).map((item) => item.data.operation), ["file.upload", "document.toPdf", "document.preview"]);
});

test("Audio and Video select executable operations", () => {
  for (const fileType of ["Audio", "Video"]) {
    const [pending] = adaptNodes([{ ...node("p", "", "process"), data: { kind: "process", operation: "", fileType } }], []);
    assert.equal(pending.data.operation, fileType === "Audio" ? "audio.convert" : "video.trim");
    assert.equal(nodeItem(pending).type, pending.data.operation);
    assert.equal(toPipeline([pending], []).nodes[0].type, pending.data.operation);
    assert.equal(parseWorkflow({ name: "Draft", nodes: [pending], edges: [] }).nodes[0].data.fileType, fileType);
  }
});

test("adaptive connections still reject cycles, branches, upload targets, and terminal outputs", () => {
  const workflow = defaultWorkflow();
  for (const connection of [{ source: "preview", target: "convert" }, { source: "clean", target: "upload" }, { source: "convert", target: "convert" }, { source: "upload", target: "preview" }])
    assert.equal(connectNodes(connection, workflow.nodes, workflow.edges), null);
});

test("typed Pipe operations preserve image, document, and Markdown payloads", async () => {
  const registry = createWorkflowRegistry();
  const values = {
    document: { name: "a.html", data: Buffer.from("<h1>Hello</h1>") },
    image: { name: "a.png", data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) },
    markdown: { text: "# Hello", source: "a.html" },
  };
  for (const type of Object.keys(values)) {
    const input = { type, value: values[type] };
    const result = await runPipeline({ nodes: [{ id: "pipe", type: `${type}.pipe` }], edges: [] }, registry, { input });
    assert.equal(result.status, "succeeded");
    assert.equal(result.output, input);
  }
});
