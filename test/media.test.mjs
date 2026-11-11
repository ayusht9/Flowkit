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
import { mediaOperations } from '../src/media-operations.mjs';

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

test('media capabilities reject arbitrary flags and invalid effect settings before execution', () => {
  for (const operation of mediaOperations) assert.throws(() => registry.validateOptions(operation.type, { ...operation.defaults, filter: 'movie=https://example.com' }), TypeError);
  for (const [type, options] of [
    ['audio.volume', { gainDb: 13 }], ['audio.volume', { gainDb: '0' }], ['audio.volume', { gainDb: NaN }],
    ['audio.fade', { fadeInSeconds: -1 }], ['audio.fade', { fadeOutSeconds: 31 }], ['audio.normalize', { targetLufs: -8 }],
    ['video.convert', { quality: '-f' }], ['video.resize', {}], ['video.resize', { width: 1 }], ['video.resize', { height: 1921 }],
    ['video.rotate', { degrees: 45 }], ['video.flip', { direction: 'hflip;movie=evil' }], ['video.mute', { format: 'webm' }],
  ]) assert.throws(() => registry.validateOptions(type, options), TypeError);
});

async function nativeOutput(value, args) {
  const directory = await mkdtemp(join(tmpdir(), 'flowkit-native-check-'));
  try {
    const path = join(directory, value.name);
    await writeFile(path, value.data);
    return await promisify(execFile)(ffmpeg, ['-hide_banner', '-i', path, ...args], { windowsHide: true, maxBuffer: 2 * 1024 * 1024, encoding: 'buffer' });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function samples(value) {
  const { stdout } = await nativeOutput(value, ['-loglevel', 'error', '-f', 'f32le', '-ac', '1', '-ar', '8000', 'pipe:1']);
  return Array.from({ length: stdout.length / 4 }, (_, i) => stdout.readFloatLE(i * 4));
}
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);

test('volume and fade effects alter decoded audio samples as requested', native, async () => {
  const original = await samples((await registry.execute('audio.convert', audioInput, { format: 'wav' })).value);
  const quieter = await samples((await registry.execute('audio.volume', audioInput, { format: 'wav', gainDb: -6 })).value);
  assert.ok(Math.abs(rms(quieter) / rms(original) - Math.pow(10, -6 / 20)) < 0.02);
  const faded = await samples((await registry.execute('audio.fade', audioInput, { format: 'wav', fadeInSeconds: 0.25, fadeOutSeconds: 0.25 })).value);
  assert.ok(rms(faded.slice(0, 400)) < rms(original.slice(0, 400)) * 0.3);
  assert.ok(rms(faded.slice(-400)) < rms(original.slice(-400)) * 0.3);
  assert.ok(rms(faded.slice(6000, 10000)) > rms(original.slice(6000, 10000)) * 0.95);
  await assert.rejects(registry.execute('audio.fade', audioInput, { fadeInSeconds: 2, fadeOutSeconds: 1 }), /Fade durations must fit/);
});

test('loudness normalization reaches the requested target on a steady test signal', native, async () => {
  const output = await registry.execute('audio.normalize', audioInput, { targetLufs: -16, format: 'wav' });
  const { stderr } = await nativeOutput(output.value, ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']);
  const stats = JSON.parse(stderr.toString().match(/\{\s*"input_i"[\s\S]*?\}/)[0]);
  assert.ok(Math.abs(Number(stats.input_i) + 16) < 1, JSON.stringify(stats));
});

test('video resize, conversion and mute produce verified dimensions, codecs and tracks', native, async () => {
  const input = { type: 'video', value: { name: 'clip.mp4', data: await makeVideo({ ffmpeg }) } };
  const resized = await registry.execute('video.resize', input, { width: 64, height: 64 });
  assert.deepEqual([resized.value.width, resized.value.height], [64, 36]);
  const resizedInfo = await inspect(resized.value);
  assert.deepEqual(resizedInfo.streams.filter(stream => stream.codec_type === 'video').map(stream => [stream.width, stream.height]), [[64, 36]]);
  const unchanged = await registry.execute('video.resize', input, { width: 1920 });
  assert.deepEqual([unchanged.value.width, unchanged.value.height], [128, 72]);
  for (const quality of ['compact', 'balanced', 'high']) {
    const converted = await registry.execute('video.convert', input, { quality });
    const info = await inspect(converted.value);
    assert.ok(info.streams.some(stream => stream.codec_name === 'h264'));
    assert.ok(info.streams.some(stream => stream.codec_name === 'aac'));
    assert.equal(converted.value.frameRate, 12);
  }
  const muted = await registry.execute('video.mute', input, {});
  assert.ok((await inspect(muted.value)).streams.every(stream => stream.codec_type === 'video'));
  await assert.rejects(registry.execute('video.extractAudio', muted, {}), /no audio track/);
  const silent = { type: 'video', value: { name: 'silent.mp4', data: await makeVideo({ ffmpeg, audio: false }) } };
  assert.equal((await registry.execute('video.convert', silent, {})).type, 'video');
});

test('video rotations and mirrors move decoded pixels in the expected directions', native, async () => {
  const input = { type: 'video', value: { name: 'pattern.mp4', data: await makeVideo({ ffmpeg, pattern: true }) } };
  const frame = async value => (await nativeOutput(value, ['-loglevel', 'error', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])).stdout;
  const original = await frame(input.value);
  for (const [type, options, dimensions, coordinate] of [
    ['video.rotate', { degrees: 90 }, [72, 128], (x, y) => [y, 71 - x]],
    ['video.rotate', { degrees: 180 }, [128, 72], (x, y) => [127 - x, 71 - y]],
    ['video.rotate', { degrees: 270 }, [72, 128], (x, y) => [127 - y, x]],
    ['video.flip', { direction: 'horizontal' }, [128, 72], (x, y) => [127 - x, y]],
    ['video.flip', { direction: 'vertical' }, [128, 72], (x, y) => [x, 71 - y]],
    ['video.flip', { direction: 'both' }, [128, 72], (x, y) => [127 - x, 71 - y]],
  ]) {
    const output = await registry.execute(type, input, options);
    assert.deepEqual([output.value.width, output.value.height], dimensions);
    const pixels = await frame(output.value);
    let error = 0;
    for (let y = 0; y < dimensions[1]; y++) for (let x = 0; x < dimensions[0]; x++) {
      const [sx, sy] = coordinate(x, y);
      for (let channel = 0; channel < 3; channel++) error += Math.abs(pixels[(y * dimensions[0] + x) * 3 + channel] - original[(sy * 128 + sx) * 3 + channel]);
    }
    assert.ok(error / pixels.length < 15, `${type}: mean pixel difference ${error / pixels.length}`);
  }
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
