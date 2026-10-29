import { test, expect } from "@playwright/test";
import { defaultWorkflow } from "../src/catalog.mjs";

test("sample document runs through the visual workflow and downloads real Markdown", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Workflow name" }),
  ).toHaveValue("Document to context");
  await expect(page.locator(".operation-node")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Try with a sample document" })
    .click();
  await expect(page.getByRole("button", { name: /sample.html/ })).toBeVisible();
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await expect(
    page.getByText("Workflow completed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Markdown output", { exact: true }),
  ).toContainText("# FlowKit project brief");
  await expect(page.locator(".node-success")).toHaveCount(4);
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download Markdown", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("sample.md");
  const stream = await download.createReadStream();
  let contents = "";
  for await (const chunk of stream) contents += chunk;
  expect(contents).toContain("# FlowKit project brief");
  await page.screenshot({
    path: "test-results/workflow-complete.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("supports node dragging, adding, deleting, and safe workflow import/export", async ({
  page,
}) => {
  await page.goto("/");
  const node = page.locator('.react-flow__node[data-id="convert"]');
  const before = await node.boundingBox();
  await page.mouse.move(before.x + 90, before.y + 15);
  await page.mouse.down();
  await page.mouse.move(before.x + 140, before.y + 45, { steps: 10 });
  await page.mouse.up();
  const after = await node.boundingBox();
  expect(after.x).toBeGreaterThan(before.x + 20);
  await page.getByTitle("Drag or click to add Clean Markdown").click();
  await expect(page.locator(".operation-node")).toHaveCount(5);
  await page.getByRole("button", { name: "Delete selected node" }).click();
  await expect(page.locator(".operation-node")).toHaveCount(4);
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workflow" }).click();
  const exported = await promise;
  const stream = await exported.createReadStream();
  let json = "";
  for await (const chunk of stream) json += chunk;
  expect(JSON.parse(json).nodes).toHaveLength(4);
  expect(json).not.toContain("base64");
  const imported = { ...defaultWorkflow(), name: "Imported workflow" };
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: "workflow.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect(
    page.getByRole("textbox", { name: "Workflow name" }),
  ).toHaveValue("Imported workflow");
});

test("shows missing-input and disconnected-workflow errors", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Upload a document");
  await page
    .getByRole("button", { name: "Try with a sample document" })
    .click();
  await expect(page.getByRole("button", { name: /sample.html/ })).toBeVisible();
  await page.getByRole("button", { name: "Delete selected node" }).click();
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    /connected|existing nodes/,
  );
});

test("mobile layout remains usable without horizontal page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Run workflow", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/workflow-mobile.png",
    fullPage: true,
  });
});

test("can build connections on the canvas and configure them from the inspector", async ({
  page,
}) => {
  await page.goto("/");
  const workflow = defaultWorkflow();
  workflow.edges = [];
  await page
    .locator('input[type=file][accept=".json"]')
    .setInputFiles({
      name: "workflow.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(workflow)),
    });
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  for (const [source, target] of [
    ["upload", "convert"],
    ["convert", "clean"],
    ["clean", "preview"],
  ]) {
    await page
      .locator(`.react-flow__handle.source[data-nodeid="${source}"]`)
      .click();
    await page
      .locator(`.react-flow__handle.target[data-nodeid="${target}"]`)
      .click();
  }
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  await page.locator('.react-flow__node[data-id="convert"]').click();
  await expect(page.getByLabel("Next node")).toHaveValue("clean");
  await page.getByLabel("Next node").selectOption("");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await page.getByLabel("Next node").selectOption("clean");
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
});

test("uploads a real file and supports keyboard guide and search interactions", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick guide" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(".flow-canvas").click({ position: { x: 15, y: 15 } });
  await page.keyboard.press("/");
  await expect(
    page.getByRole("textbox", { name: "Find a node" }),
  ).toBeFocused();
  await page.getByRole("textbox", { name: "Find a node" }).fill("Clean");
  await expect(page.locator(".palette-node")).toHaveCount(1);
  await page
    .locator('input[type=file][accept=".docx,.html,.htm,.epub,.md"]')
    .setInputFiles({
      name: "uploaded.html",
      mimeType: "text/html",
      buffer: Buffer.from("<h1>Actual upload</h1><p>Document content.</p>"),
    });
  await expect(
    page.getByRole("button", { name: /uploaded.html/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await expect(
    page.getByLabel("Markdown output", { exact: true }),
  ).toContainText("# Actual upload");
});
