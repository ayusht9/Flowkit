import { test, expect } from "@playwright/test";

test("node categories support keyboard collapse, category search, and future-tool empty states", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add node", exact: true }).click();
  const library = page.getByLabel("Node library", { exact: true });
  const image = library.getByLabel("Image nodes", { exact: true });
  const text = library.getByLabel("Text nodes", { exact: true });
  await expect(library.locator("summary > span")).toHaveText(["Image", "Text", "Audio", "Video"]);
  await expect(image.locator(".palette-node")).toHaveCount(3);
  await expect(text.locator(".palette-node")).toHaveCount(4);
  await image.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(image.getByTitle("Drag or click to add Resize image")).toBeHidden();
  const search = page.getByRole("textbox", { name: "Find a node" });
  await search.fill("image");
  await expect(library.locator(".picker-category")).toHaveCount(1);
  await expect(image.getByTitle("Drag or click to add Resize image")).toBeVisible();
  await search.fill("text");
  await expect(text.locator(".palette-node")).toHaveCount(4);
  await search.fill("audio");
  await expect(library.getByText("Audio tools are coming soon.", { exact: true })).toBeVisible();
  await expect(library.locator(".palette-node")).toHaveCount(0);
  await search.fill("nothing-matches-this");
  await expect(library.getByText("No compatible nodes match your search.")).toBeVisible();
  await search.clear();
  await image.locator("summary").click();
  await text.locator("summary").click();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const category of ["Image", "Text", "Audio", "Video"])
    await expect(library.getByLabel(`${category} nodes`, { exact: true }).locator("summary")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/node-categories-mobile.png", fullPage: true });
});
