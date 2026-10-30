import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultWorkflow,
  canConnect,
  parseWorkflow,
  toPipeline,
} from "../src/catalog.mjs";
import { createWorkflowRegistry } from "../src/workflow.mjs";
import { validatePipeline } from "../src/pipeline.mjs";

test("the default visual workflow matches the executable operation contracts", () => {
  const workflow = defaultWorkflow();
  const pipeline = toPipeline(workflow.nodes, workflow.edges);
  assert.deepEqual(
    validatePipeline(pipeline, createWorkflowRegistry()).map(
      (node) => node.type,
    ),
    ["file.upload", "document.toMarkdown", "artifact.preview"],
  );
  const imported = parseWorkflow(workflow);
  assert.deepEqual(toPipeline(imported.nodes, imported.edges), pipeline);
  assert.deepEqual(imported.nodes, workflow.nodes);
});

test("visual connections reject incompatible types, branches, and cycles", () => {
  const { nodes } = defaultWorkflow();
  assert.equal(
    canConnect({ source: "upload", target: "convert" }, nodes, []),
    true,
  );
  assert.equal(
    canConnect({ source: "upload", target: "preview" }, nodes, []),
    false,
  );
  assert.equal(
    canConnect({ source: "convert", target: "convert" }, nodes, []),
    false,
  );
  assert.equal(
    canConnect({ source: "preview", target: "upload" }, nodes, []),
    false,
  );
  assert.equal(
    canConnect({ source: "convert", target: "clean" }, nodes, [
      { source: "clean", target: "convert" },
    ]),
    false,
  );
  assert.equal(
    canConnect({ source: "convert", target: "preview" }, nodes, [
      { source: "convert", target: "clean" },
    ]),
    false,
  );
});

test("import rejects unsupported operations and malformed graph data", () => {
  for (const change of [
    (workflow) => {
      workflow.nodes[0].data.operation = "shell.run";
    },
    (workflow) => {
      workflow.nodes[0].position.x = Infinity;
    },
    (workflow) => {
      workflow.nodes[0].data.options = [];
    },
    (workflow) => {
      workflow.nodes[1].id = workflow.nodes[0].id;
    },
    (workflow) => {
      workflow.edges[0].target = "unknown";
    },
  ]) {
    const workflow = defaultWorkflow();
    change(workflow);
    assert.throws(() => parseWorkflow(workflow));
  }
});

test("cleanup normalizes line endings and optional blank lines while retaining source metadata", async () => {
  const registry = createWorkflowRegistry();
  const input = {
    type: "markdown",
    value: { text: "# Title\r\n\r\n\r\nText\r\n", source: "report.docx" },
  };
  const output = await registry.execute("context.clean", input, {
    collapseBlankLines: true,
  });
  assert.deepEqual(output.value, {
    text: "# Title\n\nText\n",
    source: "report.docx",
  });
  assert.equal(
    (
      await registry.execute("context.clean", input, {
        collapseBlankLines: false,
      })
    ).value.text,
    "# Title\n\n\nText\n",
  );
  await assert.rejects(
    registry.execute("context.clean", input, { collapseBlankLines: "yes" }),
  );
});

test("cleanup preserves fenced code spacing, indented code, and Markdown hard breaks", async () => {
  const registry = createWorkflowRegistry();
  for (const text of [
    "```text\nfirst\n\n\nlast\n```\n",
    "    indented code\n",
    "first  \nsecond\n",
  ]) {
    const result = await registry.execute("context.clean", {
      type: "markdown",
      value: { text, source: "notes.md" },
    });
    assert.equal(result.value.text, text);
  }
});
