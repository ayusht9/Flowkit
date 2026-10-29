import { test, expect } from "@playwright/test";
import { sampleAudio, makeVideo } from "../examples/fixtures/media.mjs";

async function create(page, type, name, mimeType, buffer) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open workflow menu" }).click();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("Workflow template").selectOption(type);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.locator('input[type=file][accept*=".png"]').setInputFiles({ name, mimeType, buffer });
  return page.locator('.react-flow__node[data-id="media-process"]');
}

async function run(page, type) {
  await page.getByRole("navigation", { name: "Workflow actions" }).getByRole("button", { name: "Process", exact: true }).click();
  const preview = page.getByLabel(type + " preview", { exact: true });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(media => media.readyState)).toBeGreaterThan(0);
  await expect(page.locator(".node-success")).toHaveCount(3);
  return preview;
}

async function download(page, name) {
  const pending = page.waitForEvent("download");
  await page.getByRole("navigation", { name: "Workflow actions" }).getByRole("button", { name: "Export", exact: true }).click();
  const result = await pending;
  expect(result.suggestedFilename()).toBe(name);
  const chunks = [];
  for await (const chunk of await result.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test("audio upload, trim, playback and WAV download", async ({ page }) => {
  const process = await create(page, "audio", "tone.wav", "audio/wav", sampleAudio);
  await expect(process.getByLabel("File type", { exact: true })).toHaveValue("Audio");
  await process.getByLabel("Operation", { exact: true }).selectOption("audio.trim");
  await process.locator(".card-body").click();
  await page.getByLabel("Start (seconds)").fill("0.25");
  await page.getByLabel("Duration (seconds)").fill("0.5");
  await page.getByLabel("Audio output format").selectOption("wav");
  const preview = await run(page, "Audio");
  expect(await preview.evaluate(media => media.duration)).toBeCloseTo(0.5, 1);
  expect((await download(page, "tone-processed.wav")).toString("ascii", 0, 4)).toBe("RIFF");
});

test("video trim, playback, MP4 download and audio extraction", async ({ page }) => {
  const process = await create(page, "video", "clip.mp4", "video/mp4", await makeVideo());
  await expect(process.getByLabel("File type", { exact: true })).toHaveValue("Video");
  await process.locator(".card-body").click();
  await page.getByLabel("Start (seconds)").fill("0.25");
  await page.getByLabel("Duration (seconds)").fill("0.5");
  const preview = await run(page, "Video");
  expect(await preview.evaluate(media => [media.videoWidth, media.videoHeight])).toEqual([128, 72]);
  expect(await preview.evaluate(media => media.duration)).toBeCloseTo(0.5, 1);
  expect((await download(page, "clip-processed.mp4")).toString("ascii", 4, 8)).toBe("ftyp");
  await process.getByLabel("Operation", { exact: true }).selectOption("video.extractAudio");
  await expect(process.getByLabel("File type", { exact: true })).toHaveValue("Video");
  await run(page, "Audio");
  expect((await download(page, "clip-processed.mp3")).length).toBeGreaterThan(100);
});
