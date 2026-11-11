import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { mkdtemp, writeFile, readFile, rm, symlink, open } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createFlowkitMcpServer } from "../src/mcp.mjs";
import { OperationRegistry } from "../src/operations.mjs";
import { findPandoc } from "../src/server.mjs";
import { sampleImage } from "../examples/fixtures/image.mjs";
import { sampleAudio, makeWav, makeVideo } from "../examples/fixtures/media.mjs";

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
const pandoc = await findPandoc();
const magick = process.env.IMAGEMAGICK_PATH || (process.platform === "win32" ? "magick" : "convert");
const native = [ffmpeg, ffprobe, pandoc, magick].every((command, i) => spawnSync(command, [i < 2 ? "-version" : "--version"], { windowsHide: true }).status === 0);

async function session(t, registry, { mediaOutputMiB = 8 } = {}) {
  const workspace = await mkdtemp(join(tmpdir(), "flowkit-mcp-test-"));
  const client = new Client({ name: "flowkit-test", version: "1.0.0" });
  let server;
  const transport = registry ? InMemoryTransport.createLinkedPair() : new StdioClientTransport({
    command: process.execPath, args: [join(project, "mcp-server.mjs"), "--workspace", workspace], cwd: project,
    env: { ...getDefaultEnvironment(),
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("MAGICK_"))),
      PANDOC_PATH: pandoc, IMAGEMAGICK_PATH: magick, FFMPEG_PATH: ffmpeg, FFPROBE_PATH: ffprobe,
      FLOWKIT_MEDIA_MAX_OUTPUT_MIB: String(mediaOutputMiB) },
    stderr: "pipe",
  });
  t.after(async () => { await client.close(); await server?.close(); await rm(workspace, { recursive: true, force: true }); });
  if (registry) {
    server = await createFlowkitMcpServer({ workspace, registry, mediaOutputMiB });
    await server.connect(transport[1]);
    await client.connect(transport[0]);
  } else await client.connect(transport);
  return { workspace, client, call: (name, args) => client.callTool({ name: `flowkit_${name}`, arguments: args }) };
}

test('MCP chains configured media artifacts larger than the upload limit', { skip: native ? false : 'Install all native processing tools' }, async t => {
  const { workspace, client, call } = await session(t, undefined, { mediaOutputMiB: 64 });
  await writeFile(join(workspace, 'long.wav'), makeWav(125));
  const tools = (await client.listTools()).tools;
  assert.match(tools.find(tool => tool.name === 'flowkit_audio_convert').description, /64 MiB/);
  const converted = await call('audio_convert', { inputPath: 'long.wav', format: 'wav' });
  assert.ok(!converted.isError, JSON.stringify(converted));
  assert.ok(converted.structuredContent.sizeBytes > 20 * 1024 * 1024);
  const processed = await call('audio_volume', { inputPath: converted.structuredContent.path, gainDb: -6, format: 'wav' });
  assert.ok(!processed.isError, JSON.stringify(processed));
  assert.ok(processed.structuredContent.sizeBytes > 20 * 1024 * 1024);
  const large = await open(join(workspace, 'oversized.wav'), 'w');
  await large.truncate(21 * 1024 * 1024); await large.close();
  const rejected = await call('audio_convert', { inputPath: 'oversized.wav', format: 'mp3' });
  assert.equal(rejected.isError, true);
  assert.match(rejected.content[0].text, /20 MiB/);
});

test("MCP stdio discovers tools, chains artifacts and returns bounded text without overwriting sources", async (t) => {
  const { workspace, client, call } = await session(t);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 36);
  for (const name of ['audio_volume', 'audio_fade', 'audio_normalize', 'video_convert', 'video_resize', 'video_rotate', 'video_flip', 'video_mute'])
    assert.ok(tools.some(tool => tool.name === `flowkit_${name}`));
  for (const name of ['text', 'rtf', 'latex', 'rst', 'asciidoc', 'pptx'])
    assert.ok(tools.some(tool => tool.name === `flowkit_document_to_${name}`));
  for (const name of ['crop', 'rotate', 'flip', 'grayscale', 'blur', 'sharpen', 'convert'])
    assert.ok(tools.some(tool => tool.name === `flowkit_image_${name}`));
  assert.ok(tools.some((tool) => tool.name === "flowkit_merge_documents"));
  assert.ok(tools.some((tool) => tool.name === "flowkit_document_to_pdf"));
  assert.ok(tools.some((tool) => tool.name === "flowkit_video_extract_audio"));
  assert.ok(tools.every((tool) => !tool.name.includes("pipeline")));
  const source = "# Document\r\n\r\n\r\n" + "Content ".repeat(2000);
  await writeFile(join(workspace, "input.md"), source);
  const response = await call("clean_markdown", { inputPath: "input.md" });
  assert.ok(!response.isError, JSON.stringify(response));
  const output = response.structuredContent;
  assert.match(output.path, /^\.flowkit-artifacts\/run-[^/]+\/input.md$/);
  assert.equal(output.preview.length, 1000);
  assert.equal(output.previewTruncated, true);
  assert.ok(JSON.stringify(response).length < 3000);
  assert.equal(await readFile(join(workspace, "input.md"), "utf8"), source);
  const excerpt = await call("read_text", { inputPath: output.path, offset: 2, limit: 8 });
  assert.equal(excerpt.structuredContent.text, "Document");
  assert.equal(excerpt.structuredContent.nextOffset, 10);
  const second = await call("clean_markdown", { inputPath: output.path });
  assert.ok(!second.isError);
  assert.notEqual(second.structuredContent.path, output.path);
  const list = await call("list_files", {});
  assert.deepEqual(list.structuredContent.entries, [{ name: "input.md", type: "file" }]);
});

test("MCP rejects path escapes, symlinks outside the workspace, invalid options, and oversized input", async (t) => {
  const { workspace, call } = await session(t);
  const outside = await mkdtemp(join(tmpdir(), "flowkit-mcp-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "secret.md"), "outside secret");
  await symlink(outside, join(workspace, "escape"), process.platform === "win32" ? "junction" : "dir");
  for (const inputPath of ["../secret.md", join(outside, "secret.md"), "escape/secret.md", "file.txt:secret", "https://example.com/a.md"])
    assert.equal((await call("clean_markdown", { inputPath })).isError, true, inputPath);
  assert.equal((await call("audio_convert", { inputPath: "a.wav", command: "evil" })).isError, true);
  assert.equal((await call("audio_trim", { inputPath: "a.wav", startSeconds: -1, durationSeconds: 0 })).isError, true);
  assert.equal((await call("read_text", { inputPath: "a.md", limit: 12001 })).isError, true);
  assert.equal((await call("image_resize", { inputPath: "a.png" })).isError, true);
  assert.equal((await call("image_rotate", { inputPath: "a.png", degrees: 45 })).isError, true);
  assert.equal((await call("image_crop", { inputPath: "a.png", width: 1, height: 1, flags: "-write" })).isError, true);
  const large = await open(join(workspace, "large.md"), "w");
  await large.truncate(20 * 1024 * 1024 + 1); await large.close();
  assert.match((await call("clean_markdown", { inputPath: "large.md" })).content[0].text, /20 MiB/);
  assert.equal((await call("list_files", { directory: "escape" })).isError, true);
  await symlink(outside, join(workspace, ".flowkit-artifacts"), process.platform === "win32" ? "junction" : "dir");
  await writeFile(join(workspace, "a.md"), "safe");
  assert.equal((await call("clean_markdown", { inputPath: "a.md" })).isError, true);
  assert.equal(await readFile(join(outside, "secret.md"), "utf8"), "outside secret");
});

test("MCP uses real Pandoc, ImageMagick and FFmpeg for every native processing tool", { skip: native ? false : "Install all native processing tools" }, async (t) => {
  const { workspace, call } = await session(t);
  await writeFile(join(workspace, "report.html"), "<h1>MCP document</h1>");
  await writeFile(join(workspace, "photo.png"), sampleImage);
  await writeFile(join(workspace, "tone.wav"), sampleAudio);
  await writeFile(join(workspace, "clip.mp4"), await makeVideo({ ffmpeg }));
  for (const [tool, args, expectedType] of [
    ["document_to_markdown", { inputPath: "report.html" }, "markdown"],
    ...['text', 'rtf', 'latex', 'rst', 'asciidoc', 'pptx'].map(format => [`document_to_${format}`, { inputPath: 'report.html' }, 'document']),
    ["image_resize", { inputPath: "photo.png", width: 40, height: 40 }, "image"],
    ["image_crop", { inputPath: "photo.png", width: 40, height: 20, x: 10, y: 5 }, "image"],
    ["image_rotate", { inputPath: "photo.png", degrees: 90 }, "image"],
    ["image_flip", { inputPath: "photo.png", direction: "horizontal" }, "image"],
    ["image_grayscale", { inputPath: "photo.png" }, "image"],
    ["image_blur", { inputPath: "photo.png", sigma: 1 }, "image"],
    ["image_sharpen", { inputPath: "photo.png", sigma: 1 }, "image"],
    ["image_convert", { inputPath: "photo.png", format: "jpeg", quality: 85 }, "image"],
    ["audio_convert", { inputPath: "tone.wav", format: "mp3" }, "audio"],
    ["audio_trim", { inputPath: "tone.wav", startSeconds: 0.25, durationSeconds: 0.5, format: "wav" }, "audio"],
    ["video_trim", { inputPath: "clip.mp4", startSeconds: 0.25, durationSeconds: 0.5 }, "video"],
    ["video_extract_audio", { inputPath: "clip.mp4", format: "wav" }, "audio"],
    ['audio_volume', { inputPath: 'tone.wav', gainDb: -6, format: 'wav' }, 'audio'],
    ['audio_fade', { inputPath: 'tone.wav', fadeInSeconds: 0.25, fadeOutSeconds: 0.25, format: 'wav' }, 'audio'],
    ['audio_normalize', { inputPath: 'tone.wav', targetLufs: -16, format: 'wav' }, 'audio'],
    ['video_convert', { inputPath: 'clip.mp4', quality: 'balanced' }, 'video'],
    ['video_resize', { inputPath: 'clip.mp4', width: 64, height: 64 }, 'video'],
    ['video_rotate', { inputPath: 'clip.mp4', degrees: 90 }, 'video'],
    ['video_flip', { inputPath: 'clip.mp4', direction: 'horizontal' }, 'video'],
    ['video_mute', { inputPath: 'clip.mp4' }, 'video'],
  ]) {
    const response = await call(tool, args);
    assert.ok(!response.isError, `${tool}: ${JSON.stringify(response)}`);
    const output = response.structuredContent;
    assert.equal(output.type, expectedType);
    assert.ok(output.sizeBytes > 0);
    assert.equal(output.data, undefined);
    const bytes = await readFile(join(workspace, output.path));
    assert.equal(bytes.length, output.sizeBytes);
    if (tool === "image_resize") assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [40, 20]);
    if (tool === "image_crop") assert.deepEqual([output.width, output.height], [40, 20]);
    if (tool === "image_rotate") assert.deepEqual([output.width, output.height], [60, 120]);
    if (tool === "image_convert") {
      assert.equal(output.mimeType, "image/jpeg");
      assert.match(output.path, /\.jpg$/);
      assert.equal(bytes[0], 255);
      const chained = await call("image_crop", { inputPath: output.path, width: 20, height: 10 });
      assert.ok(!chained.isError, JSON.stringify(chained));
      assert.deepEqual([chained.structuredContent.width, chained.structuredContent.height], [20, 10]);
      assert.deepEqual(await readFile(join(workspace, "photo.png")), sampleImage);
    }
    if (tool === "document_to_markdown") assert.match(bytes.toString(), /# MCP document/);
    if (['document_to_text', 'document_to_rtf', 'document_to_latex', 'document_to_rst'].includes(tool)) {
      const converted = await call('document_to_markdown', { inputPath: output.path });
      assert.ok(!converted.isError, JSON.stringify(converted));
      assert.match(converted.structuredContent.preview, /MCP document/);
      if (tool === 'document_to_text') {
        const excerpt = await call('read_text', { inputPath: output.path, limit: 3 });
        assert.equal(excerpt.structuredContent.text.length, 3);
        assert.equal(output.mimeType, 'text/plain');
      }
    }
    if (tool === "video_trim") {
      const extracted = await call("video_extract_audio", { inputPath: output.path });
      assert.equal(extracted.structuredContent.type, "audio");
    }
    if (tool === 'video_resize') {
      assert.deepEqual([output.width, output.height], [64, 36]);
      assert.equal(output.frameRate, 12);
      const rotated = await call('video_rotate', { inputPath: output.path, degrees: 90 });
      assert.ok(!rotated.isError, JSON.stringify(rotated));
      assert.deepEqual([rotated.structuredContent.width, rotated.structuredContent.height], [36, 64]);
    }
    if (tool === 'video_mute') assert.equal((await call('video_extract_audio', { inputPath: output.path })).isError, true);
  }
});

test("MCP forwards cancellation to the executor and rejects overlapping operations", async (t) => {
  const started = Promise.withResolvers();
  const cancelled = Promise.withResolvers();
  const registry = new OperationRegistry().register("image.resize", { inputType: "image", outputType: "image",
    run: async (_input, _options, { signal }) => {
      started.resolve();
      await new Promise((_resolve, reject) => signal.addEventListener("abort", () => { cancelled.resolve(); reject(signal.reason); }, { once: true }));
    },
  });
  const { workspace, client, call } = await session(t, registry);
  await writeFile(join(workspace, "image.png"), sampleImage);
  const controller = new AbortController();
  const request = client.callTool({ name: "flowkit_image_resize", arguments: { inputPath: "image.png" } }, { signal: controller.signal });
  const rejected = assert.rejects(request);
  await started.promise;
  assert.match((await call("list_files", {})).content[0].text, /busy/);
  controller.abort();
  await rejected;
  await cancelled.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(!(await call("list_files", {})).isError);
});

test("MCP CLI requires an explicit workspace and keeps diagnostics off stdout", () => {
  const response = spawnSync(process.execPath, [join(project, "mcp-server.mjs")], { encoding: "utf8", windowsHide: true });
  assert.equal(response.status, 1);
  assert.equal(response.stdout, "");
  assert.match(response.stderr, /--workspace/);
});

test("MCP doctor proves the installed CLI can inspect its workspace and dependencies", () => {
  const response = spawnSync(process.execPath, [join(project, "mcp-server.mjs"), "--doctor", "--workspace", project, "--json"], { encoding: "utf8", windowsHide: true });
  const report = JSON.parse(response.stdout);
  assert.equal(report.installed, true);
  assert.equal(report.mcpTools, 36);
  assert.equal(report.workspace, project);
  assert.deepEqual(Object.keys(report.tools), ["pandoc", "imagemagick", "ffmpeg", "ffprobe"]);
  assert.equal(response.stderr, "");
});
