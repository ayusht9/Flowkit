// Captures the README and site screenshots from the real app and landing page.
// Usage: npm run build && npm run screenshots
import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { readFile, copyFile, mkdir, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultWorkflow, imageWorkflow } from "../src/catalog.mjs";
import { makePdf } from "../examples/fixtures/pdf.mjs";
import { findImageMagick } from "../src/image.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs/screenshots");
const port = 4329, base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const wait = async () => { for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); } throw new Error("Server did not start"); };

const browser = await chromium.launch(process.env.CI ? {} : { channel: "chrome" });
try {
  await wait();
  const sample = await readFile(join(root, "examples/fixtures/sample.html"));
  const shoot = async (name, { scheme = "light", setup, clip }) => {
    const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(base);
    await page.locator(".operation-node").first().waitFor();
    await setup?.(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, name), clip });
    await page.close();
    console.log(`docs/screenshots/${name}`);
  };
  const run = (page) => page.getByRole("navigation", { name: "Workflow actions" }).getByRole("button", { name: "Run", exact: true }).click();
  const choose = async (page, id, file) => {
    const chooser = page.waitForEvent("filechooser");
    await page.locator(`.react-flow__node[data-id="${id}"] .card-icon-ring`).click();
    await (await chooser).setFiles(file);
  };
  const importWorkflow = async (page, workflow) => {
    await page.locator('input[type=file][accept=".json"]').setInputFiles({ name: "workflow.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(workflow)) });
    await page.locator(".operation-node").nth(workflow.nodes.length - 1).waitFor();
  };

  const documentRun = async (page) => {
    await choose(page, "upload", { name: "project-brief.html", mimeType: "text/html", buffer: sample });
    await run(page);
    await page.locator(".node-success").nth(2).waitFor({ timeout: 30_000 });
  };
  await shoot("workflow-studio.png", { setup: documentRun });
  await shoot("workflow-studio-dark.png", { scheme: "dark", setup: documentRun });

  await shoot("pdf-workflow.png", { setup: async (page) => {
    await importWorkflow(page, defaultWorkflow());
    await choose(page, "upload", { name: "contract.pdf", mimeType: "application/pdf", buffer: makePdf(Array.from({ length: 6 }, (_, i) => `Contract page ${i + 1}`)) });
    await page.locator('.react-flow__node[data-id="upload"]').getByText("contract.pdf").waitFor();
    await page.waitForTimeout(800);
  } });

  await shoot("image-workflow.png", { setup: async (page) => {
    await importWorkflow(page, imageWorkflow());
    const image = execFileSync(findImageMagick(), ["-size", "1200x800", "gradient:#2a78d6-#eb6834", "PNG:-"], { windowsHide: true });
    await choose(page, "upload-image", { name: "banner.png", mimeType: "image/png", buffer: image });
    await run(page);
    await page.locator(".node-success").nth(2).waitFor({ timeout: 30_000 });
  } });

  // The landing page is deployed from site/ alone, so it gets copies of the app screenshots.
  await mkdir(join(root, "site/assets/screenshots"), { recursive: true });
  for (const name of ["workflow-studio.png", "pdf-workflow.png", "image-workflow.png"]) await copyFile(join(out, name), join(root, "site/assets/screenshots", name));
  await rm(join(out, "workflow-templates.png"), { force: true });

  // Landing page (static site).
  const site = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await site.goto(pathToFileURL(join(root, "site/index.html")).href);
  await site.waitForTimeout(500);
  await site.screenshot({ path: join(out, "landing-page.png") });
  await site.locator("#benchmark").scrollIntoViewIfNeeded();
  await site.locator("#benchmark").screenshot({ path: join(out, "landing-benchmark.png") });
  console.log("docs/screenshots/landing-page.png\ndocs/screenshots/landing-benchmark.png");
} finally {
  await browser.close();
  server.kill();
}
