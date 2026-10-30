import { test, expect } from "@playwright/test";

test("connected navbar has actions and the requested popup", async ({ page }) => {
  await page.goto("/");
  const actions = page.getByRole("navigation", { name: "Workflow actions" });
  await expect(actions.getByRole("switch")).toBeVisible();
  await expect(actions.getByRole("button", { name: "Add node", exact: true })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Export", exact: true })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Run", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear all", exact: true })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Add node", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "About", exact: true })).toHaveCount(0);
  await expect(actions.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
  await page.locator('.react-flow__node[data-id="upload"] .card-body').click();
  await expect(page.getByLabel("Node editor", { exact: true }).getByRole("button", { name: /upload|sample/i })).toHaveCount(0);
  await expect(page.getByText("No file uploaded", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close node editor" }).click();
  await page.getByRole("button", { name: "Open workflow menu" }).click();
  const menu = page.getByRole("dialog", { name: "Workflow menu" });
  await expect(menu.locator(":scope > button")).toHaveText(["New", "Save", "Save as new"]);
  await page.screenshot({ path: "test-results/navbar-menu.png", fullPage: true });
  await page.keyboard.press("Escape");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of ["Add node", "Export", "Run"])
      await expect(actions.getByRole("button", { name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: "test-results/navbar-mobile.png", fullPage: true });
});

test("Save restores workflow JSON, Save as new keeps the original, and Import starts a new identity", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type=file][accept*=".png"]').setInputFiles({
    name: "private.html", mimeType: "text/html", buffer: Buffer.from("PRIVATE_FILE_BYTES"),
  });
  await page.getByRole("button", { name: "Open workflow menu" }).click();
  await page.getByLabel("Workflow name", { exact: true }).fill("Original");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem("flowkit.workspace")));
  expect(original.workflows).toHaveLength(1);
  expect(JSON.stringify(original)).not.toContain("private.html");
  expect(JSON.stringify(original)).not.toContain("PRIVATE_FILE_BYTES");
  await page.reload();
  await page.getByRole("button", { name: "Open workflow menu" }).click();
  await page.getByRole("button", { name: "Save as new", exact: true }).click();
  await page.getByLabel("New workflow name", { exact: true }).fill("Copy");
  await page.getByRole("button", { name: "Save copy", exact: true }).click();
  const copied = await page.evaluate(() => JSON.parse(localStorage.getItem("flowkit.workspace")));
  expect(copied.workflows).toHaveLength(2);
  expect(copied.activeId).not.toBe(original.activeId);
  await page.getByRole("button", { name: "Open workflow menu" }).click();
  await page.getByLabel("Workflow name", { exact: true }).fill("Updated copy");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const updated = await page.evaluate(() => JSON.parse(localStorage.getItem("flowkit.workspace")));
  expect(updated.workflows.map((entry) => entry.workflow.name)).toEqual(["Original", "Updated copy"]);
  await page.getByRole("button", { name: "Open workflow menu" }).click();
  await page.getByLabel("Saved workflows", { exact: true }).selectOption(original.activeId);
  const imported = { ...original.workflows[0].workflow, name: "Imported" };
  await page.locator('input[type=file][accept=".json"]').setInputFiles({ name: "import.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await page.getByRole("button", { name: "Open workflow menu" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("flowkit.workspace")).workflows.length)).toBe(3);
});

test("unavailable browser storage reports a save failure without losing the workflow", async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error("Storage unavailable"); }; });
  await page.goto("/");
  await page.getByRole("button", { name: "Open workflow menu" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not save in this browser");
  await expect(page.locator(".operation-node")).toHaveCount(3);
});

test("node action buttons (details and delete) appear on hover around the node area", async ({ page }) => {
  await page.goto("/");
  const node = page.locator('.react-flow__node[data-id="upload"]');
  const cardBody = node.locator(".card-body");
  const actions = node.locator(".node-actions");
  await expect(actions).toHaveCSS("opacity", "0");

  // Wait for initial canvas layout to settle then hover
  await page.waitForTimeout(400);
  await cardBody.hover();
  await expect(actions).toHaveCSS("opacity", "1");
  await expect(actions.getByTitle("Node details")).toBeVisible();
  await expect(actions.getByTitle("Delete node")).toBeVisible();
});
