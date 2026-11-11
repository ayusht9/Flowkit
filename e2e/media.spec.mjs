import { test, expect } from "@playwright/test";
import { sampleAudio, makeVideo } from "../examples/fixtures/media.mjs";

async function create(page, type, name, mimeType, buffer) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open workflow menu" }).click();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("Workflow template").selectOption(type);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('.react-flow__node[data-id="media-upload"] .card-icon-ring').click();
  await (await chooserPromise).setFiles({ name, mimeType, buffer });
  await expect(page.locator('.react-flow__node[data-id="media-upload"]')).toContainText(name);
  return page.locator('.react-flow__node[data-id="media-process"]');
}

async function run(page, type) {
  await page.getByRole("navigation", { name: "Workflow actions" }).getByRole("button", { name: "Run", exact: true }).click();
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

test('audio volume, fades and normalization expose controls and produce playable files', async ({ page }) => {
  const process = await create(page, 'audio', 'tone.wav', 'audio/wav', sampleAudio);
  for (const [type, fields] of [
    ['audio.volume', [['Volume gain (dB)', '-6']]],
    ['audio.fade', [['Fade in (seconds)', '0.25'], ['Fade out (seconds)', '0.25']]],
    ['audio.normalize', [['Target loudness (LUFS)', '-16']]],
  ]) {
    const selector = process.getByRole('combobox', { name: 'Operation', exact: true });
    await selector.click(); await page.keyboard.press('Escape');
    await selector.selectOption(type);
    for (const [label, value] of fields) await page.getByRole('spinbutton', { name: label, exact: true }).fill(value);
    await page.getByRole('combobox', { name: 'Audio output format', exact: true }).selectOption('wav');
    const preview = await run(page, 'Audio');
    expect(await preview.evaluate(media => media.duration)).toBeCloseTo(2, 1);
    expect((await download(page, 'tone-processed.wav')).toString('ascii', 0, 4)).toBe('RIFF');
  }
});

test('video conversion, resize, rotation, mirror and mute support selection, playback and download', async ({ page }) => {
  const process = await create(page, 'video', 'clip.mp4', 'video/mp4', await makeVideo({ pattern: true }));
  for (const [type, configure, dimensions] of [
    ['video.convert', async () => page.getByRole('combobox', { name: 'Video quality', exact: true }).selectOption('compact'), [128, 72]],
    ['video.resize', async () => { await page.getByLabel('Maximum width (px)').fill('64'); await page.getByLabel('Maximum height (px)').fill('64'); }, [64, 36]],
    ['video.rotate', async () => page.getByRole('combobox', { name: 'Clockwise rotation', exact: true }).selectOption('90'), [72, 128]],
    ['video.flip', async () => page.getByRole('combobox', { name: 'Flip direction', exact: true }).selectOption('vertical'), [128, 72]],
    ['video.mute', async () => {}, [128, 72]],
  ]) {
    const selector = process.getByRole('combobox', { name: 'Operation', exact: true });
    await selector.click(); await page.keyboard.press('Escape');
    await selector.selectOption(type);
    await configure();
    const preview = await run(page, 'Video');
    expect(await preview.evaluate(media => [media.videoWidth, media.videoHeight])).toEqual(dimensions);
    expect((await download(page, 'clip-processed.mp4')).toString('ascii', 4, 8)).toBe('ftyp');
  }
});
