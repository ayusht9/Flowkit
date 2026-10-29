import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createMediaOperation, validateMedia } from "../src/media.mjs";
import { createWorkflowRegistry } from "../src/workflow.mjs";
import { mediaWorkflow, toPipeline } from "../src/catalog.mjs";
import { adaptNodes } from "../src/node-builder.mjs";
import { createApp } from "../src/server.mjs";
import { sampleAudio, makeWav, makeVideo } from "../examples/fixtures/media.mjs";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
const installed = [ffmpeg, ffprobe].every((tool) => spawnSync(tool, ["-version"], { windowsHide: true }).status === 0);
const native = { skip: installed ? false : "Install FFmpeg and FFprobe to run media tests" };
const registry = createWorkflowRegistry({ ffmpeg, ffprobe });
const audioInput = { type: "audio", value: { name: "tone.wav", data: sampleAudio } };
async function inspect(value) {
  const directory = await mkdtemp(join(tmpdir(), "flowkit-media-check-"));
  try {
    const path = join(directory, value.name);
    await writeFile(path, value.data);
    const { stdout } = await promisify(execFile)(ffprobe, ["-v", "error", "-show_format", "-show_streams", "-of", "json", path], { windowsHide: true });
    return JSON.parse(stdout);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("configured FFmpeg and FFprobe must work", { skip: !process.env.FFMPEG_PATH && !process.env.FFPROBE_PATH }, () => assert.equal(installed, true));
test("media validates signatures, filenames, sizes, trim values, output formats, and rejects native flags", async () => {
  for (const value of [{ name: "../tone.wav", data: sampleAudio }, { name: "tone.mp3", data: sampleAudio }, { name: "bad.wav", data: Buffer.from("not media") }, { name: "a.wav", data: Buffer.alloc(20 * 1024 * 1024 + 1) }])
    assert.throws(() => validateMedia(value, "audio"));
  for (const options of [{ format: "flac" }, { executable: "evil" }, { format: "mp3", flags: "-i https://evil" }])
    await assert.rejects(registry.execute("audio.convert", audioInput, options), TypeError);
  for (const options of [{}, { startSeconds: -1, durationSeconds: 1 }, { startSeconds: 0, durationSeconds: 0 }, { startSeconds: "0", durationSeconds: 1 }, { startSeconds: 0, durationSeconds: 301 }])
    await assert.rejects(registry.execute("audio.trim", audioInput, options), TypeError);
});
test("audio converts to real MP3 and trims to a duration-verified WAV", native, async () => {
  const mp3 = await registry.execute("audio.convert", audioInput, { format: "mp3" });
  assert.equal(mp3.type, "audio"); assert.equal(mp3.value.mimeType, "audio/mpeg");
  const info = await inspect(mp3.value);
  assert.ok(info.streams.some((stream) => stream.codec_name === "mp3"));
  const wav = await registry.execute("audio.trim", audioInput, { startSeconds: 0.3, durationSeconds: 0.5, format: "wav" });
  const trimmed = await inspect(wav.value);
  assert.ok(Math.abs(Number(trimmed.format.duration) - 0.5) < 0.05);
});
test("video trims to a playable H.264 MP4 and extracts a real audio track", native, async () => {
  const input = { type: "video", value: { name: "clip.mp4", data: await makeVideo({ ffmpeg }) } };
  const clip = await registry.execute("video.trim", input, { startSeconds: 0.5, durationSeconds: 0.5 });
  const info = await inspect(clip.value);
  assert.equal(clip.type, "video"); assert.ok(info.streams.some((stream) => stream.codec_name === "h264"));
  assert.ok(Math.abs(Number(info.format.duration) - 0.5) < 0.15);
  const audio = await registry.execute("video.extractAudio", input, { format: "wav" });
  assert.equal(audio.type, "audio"); assert.ok((await inspect(audio.value)).streams.every((stream) => stream.codec_type === "audio"));
  const workflow = mediaWorkflow("video");
  workflow.nodes[1].data.operation = "video.extractAudio";
  const adapted = adaptNodes(workflow.nodes, workflow.edges);
  assert.equal(adapted.at(-1).data.operation, "audio.preview");
  const silent = { type: "video", value: { name: "silent.mp4", data: await makeVideo({ ffmpeg, audio: false }) } };
  await assert.rejects(registry.execute("video.extractAudio", silent, {}), /no audio track/);
});
test("media failures, duration limits, missing tools, timeout and cancellation clean temporary files", native, async () => {
  const before = new Set(await readdir(tmpdir()));
  const missing = createMediaOperation("audio.convert", { ffprobe: join(tmpdir(), "flowkit-no-ffprobe") });
  await assert.rejects(missing.run(audioInput, {}, {}), /not found/);
  await assert.rejects(registry.execute("audio.convert", { type: "audio", value: { name: "long.wav", data: makeWav(301) } }, {}), /5 minutes/);
  await assert.rejects(registry.execute("audio.trim", audioInput, { startSeconds: 4, durationSeconds: 1 }), /before the end/);
  const deadline = createMediaOperation("audio.convert", { ffmpeg, ffprobe, timeoutMs: 1 });
  await assert.rejects(deadline.run(audioInput, {}, {}), /execution limit/);
  const controller = new AbortController();
  const task = registry.execute("audio.convert", audioInput, {}, { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 5);
  try { await assert.rejects(task, { name: "AbortError" }); } finally { clearTimeout(timer); }
  assert.deepEqual((await readdir(tmpdir())).filter((name) => name.startsWith("flowkit-media-") && !before.has(name)), []);
});
test("audio API returns one base64 artifact and metadata-only intermediate nodes", native, async () => {
  const app = await createApp({ ffmpeg, ffprobe });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const workflow = mediaWorkflow("audio");
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/run`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipeline: toPipeline(workflow.nodes, workflow.edges), input: { name: "tone.wav", data: sampleAudio.toString("base64") } }),
    });
    const result = (await response.text()).trim().split("\n").map(JSON.parse).at(-1).result;
    assert.equal(result.status, "succeeded", result.error?.message);
    assert.equal(result.output.type, "audio");
    assert.ok(result.nodes.every((node) => !node.output.value.data));
    validateMedia({ name: result.output.value.name, data: Buffer.from(result.output.value.data, "base64") }, "audio");
  } finally { await app.close(); }
});
