import { test, expect } from "@playwright/test";
import { sampleImage } from "../examples/fixtures/image.mjs";

test("connecting an image Upload automatically changes a Text Process to Image", async ({ page }) => {
  await page.goto("/");
  const workflow = { name: "Infer on connection", nodes: [
    { id: "input", position: { x: 80, y: 220 }, data: { kind: "upload", operation: "image.upload", fileType: "Image" } },
    { id: "operation", position: { x: 400, y: 220 }, data: { kind: "process", operation: "document.toMarkdown", fileType: "Text" } },
  ], edges: [] };
  await page.locator('input[type=file][accept=".json"]').setInputFiles({ name: "infer.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(workflow)) });
  const process = page.locator('.react-flow__node[data-id="operation"]');
  await expect(process.getByLabel("File type", { exact: true })).toHaveValue("Text");
  await page.locator('.react-flow__handle.source[data-nodeid="input"]').click();
  await page.locator('.react-flow__handle.target[data-nodeid="operation"]').click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(process.getByLabel("File type", { exact: true })).toHaveValue("Image");
  await expect(process.getByLabel("File type", { exact: true })).toBeDisabled();
  await expect(process.getByLabel("Operation", { exact: true })).toHaveValue("image.resize");
});

test("Add Node offers four stages and Process configures file type above operation", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Add node", exact: true }).click();
  const library = page.getByLabel("Node library", { exact: true });
  await expect(library.locator(".palette-node strong")).toHaveText(["Upload", "Process", "Pipe", "Download"]);
  await expect(library.getByRole("button", { name: "Upload", exact: true })).toBeDisabled();
  await library.getByRole("button", { name: "Process", exact: true }).click();
  const config = page.getByLabel("Configure Process");
  await expect(config.getByLabel("File type", { exact: true })).toHaveValue("Text");
  await config.getByLabel("File type", { exact: true }).selectOption("Audio");
  await expect(config.getByLabel("Operation", { exact: true })).toHaveValue("audio.convert");
  await expect(config.getByRole("button", { name: "Add Process", exact: true })).toBeEnabled();
  await config.getByLabel("File type", { exact: true }).selectOption("Image");
  await expect(config.getByLabel("Operation", { exact: true })).toHaveValue("image.resize");
  await config.getByRole("button", { name: "Add Process", exact: true }).click();
  const process = page.locator(".react-flow__node.selected");
  await expect(process.getByLabel("File type", { exact: true })).toHaveValue("Image");
  await process.getByLabel("File type", { exact: true }).selectOption("Video");
  await expect(process.getByLabel("Operation", { exact: true })).toHaveValue("video.trim");
  await expect(page.locator(".operation-node")).toHaveCount(5);
  expect(errors).toEqual([]);
});

test("Upload infers Process type and a Pipe/Download chain executes after changing input type", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open workflow menu" }).click();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("button", { name: "Add first step" }).click();
  await page.getByLabel("Node library", { exact: true }).getByRole("button", { name: "Upload", exact: true }).click();
  await page.getByRole("button", { name: "Add after Upload document" }).click();
  const config = page.getByLabel("Configure Process");
  await expect(config.getByLabel("File type", { exact: true })).toHaveValue("Text");
  await expect(config.getByLabel("File type", { exact: true })).toBeDisabled();
  await config.getByRole("button", { name: "Add Process", exact: true }).click();
  await page.getByRole("button", { name: "Add after Convert to Markdown" }).click();
  await page.getByLabel("Node library", { exact: true }).getByRole("button", { name: "Pipe", exact: true }).click();
  await page.getByRole("button", { name: "Add after Pipe", exact: true }).click();
  await page.getByLabel("Node library", { exact: true }).getByRole("button", { name: "Download", exact: true }).click();
  const upload = page.locator('input[type=file][accept*=".png"]');
  await upload.setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: sampleImage });
  const process = page.locator(".react-flow__node").filter({ has: page.locator(".card-selectors") });
  await expect(process.getByLabel("File type", { exact: true })).toHaveValue("Image");
  await expect(process.getByLabel("Operation", { exact: true })).toHaveValue("image.resize");
  await expect(process.getByLabel("File type", { exact: true })).toBeDisabled();
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  await process.locator(".card-body").click();
  await page.getByLabel("Maximum width (px)").fill("40");
  await page.getByLabel("Maximum height (px)").fill("40");
  await page.getByRole("navigation", { name: "Workflow actions" }).getByRole("button", { name: "Process", exact: true }).click();
  await expect(page.getByAltText("Resized image", { exact: true })).toBeVisible();
  await expect(page.getByText("40 × 20 pixels", { exact: true })).toBeVisible();
  await expect(page.locator(".node-success")).toHaveCount(4);
  await page.screenshot({ path: "test-results/four-stage-image-pipeline.png", fullPage: true });
  const download = page.waitForEvent("download");
  await page.getByRole("navigation", { name: "Workflow actions" }).getByRole("button", { name: "Export", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("photo-resized.png");
  await upload.setInputFiles({ name: "report.html", mimeType: "text/html", buffer: Buffer.from("<h1>Switched to text</h1>") });
  await expect(process.getByLabel("File type", { exact: true })).toHaveValue("Text");
  await expect(process.getByLabel("Operation", { exact: true })).toHaveValue("document.toMarkdown");
  await page.getByRole("navigation", { name: "Workflow actions" }).getByRole("button", { name: "Process", exact: true }).click();
  await expect(page.getByLabel("Markdown output", { exact: true })).toContainText("# Switched to text");
});
