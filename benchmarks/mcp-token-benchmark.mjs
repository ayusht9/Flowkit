// Estimates model-context tokens for FlowKit MCP versus an agent writing and running its own script.
// Usage: node benchmarks/mcp-token-benchmark.mjs [--json]
import { createFlowkitMcpServer, toolsets } from "../src/mcp.mjs";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

const encoder = new TextEncoder();
const tokens = (text) => Math.ceil(encoder.encode(typeof text === "string" ? text : JSON.stringify(text)).length / 4);

// Each baseline is what the model must emit and read without FlowKit: a compact but safe script
// (no shell, timeout, no overwrite, bounded output) plus the tool-call wrapper and its stdout.
// Retries after a failed first attempt are excluded, so the baseline is a lower bound.
const tasks = [
  {
    toolset: "document",
    request: "Convert report.docx to Markdown and return a short preview.",
    call: { name: "flowkit_document_to_markdown", arguments: { inputPath: "report.docx" } },
    result: { path: ".flowkit-artifacts/run-a1B2c3/report.md", name: "report.md", type: "markdown", sizeBytes: 18342, mimeType: "text/markdown", preview: "x".repeat(1000), previewTruncated: true },
    script: `import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
const run = promisify(execFile);
const root = process.cwd();
const input = resolve(root, "report.docx");
const rel = relative(root, input);
if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Input must stay inside the workspace");
const info = await stat(input);
if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error("Input must be a file under 20 MiB");
const work = await mkdtemp(join(tmpdir(), "convert-"));
try {
  const output = join(work, "report.md");
  await run("pandoc", ["--from=docx", "--to=gfm", "--sandbox", "--output", output, input], { timeout: 60000, windowsHide: true, maxBuffer: 1024 * 1024 });
  const text = await readFile(output, "utf8");
  const target = join(root, "report.converted.md");
  await writeFile(target, text, { flag: "wx" });
  console.log(JSON.stringify({ path: relative(root, target), sizeBytes: Buffer.byteLength(text), preview: text.slice(0, 1000), previewTruncated: text.length > 1000 }));
} finally {
  await rm(work, { recursive: true, force: true });
}`,
  },
  {
    toolset: "image",
    request: "Resize photo.jpg to fit within 800 by 800 pixels.",
    call: { name: "flowkit_image_resize", arguments: { inputPath: "photo.jpg", width: 800, height: 800 } },
    result: { path: ".flowkit-artifacts/run-d4E5f6/photo.png", name: "photo.png", type: "image", sizeBytes: 412877, mimeType: "image/png", width: 800, height: 600 },
    script: `import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
const run = promisify(execFile);
const root = process.cwd();
const input = resolve(root, "photo.jpg");
const rel = relative(root, input);
if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Input must stay inside the workspace");
const info = await stat(input);
if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error("Input must be a file under 20 MiB");
const magick = process.platform === "win32" ? "magick" : "convert";
const opts = { timeout: 60000, windowsHide: true, maxBuffer: 1024 * 1024 };
const { stdout: dims } = await run(magick, ["identify", "-format", "%w %h", input + "[0]"], opts);
const [w, h] = dims.trim().split(" ").map(Number);
if (!w || !h || w * h > 16e6) throw new Error("Image exceeds 16 megapixels");
const target = resolve(root, "photo.resized.png");
await stat(target).then(() => { throw new Error("Output already exists"); }, () => {});
await run(magick, ["-limit", "memory", "256MiB", "-limit", "disk", "1GiB", input + "[0]", "-auto-orient", "-resize", "800x800", "-strip", "PNG:" + target], opts);
const { stdout } = await run(magick, ["identify", "-format", "%w %h", target], opts);
const [width, height] = stdout.trim().split(" ").map(Number);
console.log(JSON.stringify({ path: relative(root, target), width, height, sizeBytes: (await stat(target)).size }));`,
  },
  {
    toolset: "video",
    request: "Trim clip.mp4 from 12 seconds for 20 seconds.",
    call: { name: "flowkit_video_trim", arguments: { inputPath: "clip.mp4", startSeconds: 12, durationSeconds: 20 } },
    result: { path: ".flowkit-artifacts/run-g7H8i9/clip.mp4", name: "clip.mp4", type: "video", sizeBytes: 3911204, mimeType: "video/mp4", width: 1280, height: 720, durationSeconds: 20, frameRate: 30 },
    script: `import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
const run = promisify(execFile);
const root = process.cwd();
const input = resolve(root, "clip.mp4");
const rel = relative(root, input);
if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Input must stay inside the workspace");
const info = await stat(input);
if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error("Input must be a file under 20 MiB");
const opts = { timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 };
const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate:format=duration", "-of", "json", input], opts);
const probe = JSON.parse(stdout);
const stream = probe.streams?.[0];
if (!stream) throw new Error("No video stream");
const [num, den] = stream.avg_frame_rate.split("/").map(Number);
const duration = Number(probe.format.duration);
if (duration > 300 || stream.width * stream.height > 1920 * 1080 || num / den > 60) throw new Error("Video exceeds limits");
if (12 >= duration) throw new Error("Start is past the end of the clip");
const target = resolve(root, "clip.trimmed.mp4");
await run("ffmpeg", ["-n", "-v", "error", "-ss", "12", "-t", "20", "-i", input, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-movflags", "+faststart", target], opts);
const { stdout: out } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", target], opts);
console.log(JSON.stringify({ path: relative(root, target), durationSeconds: Number(out), sizeBytes: (await stat(target)).size }));`,
  },
];

async function listing(tools) {
  const server = await createFlowkitMcpServer({ workspace: process.cwd(), tools, registry: { get() { throw new Error("not executed"); } } });
  const client = new Client({ name: "flowkit-benchmark", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide); await client.connect(clientSide);
  const list = await client.listTools();
  const instructions = client.getInstructions() || "";
  await client.close(); await server.close();
  return { tools: list.tools.length, schemaTokens: tokens(list), instructionTokens: tokens(instructions), fixedTokens: tokens(list) + tokens(instructions) };
}

const fixed = { all: await listing(undefined) };
for (const group of toolsets) fixed[group] = await listing(group);

const rows = tasks.map((task) => {
  // Baseline: the model writes the script into a shell/exec tool call, then reads its stdout.
  const baseline = tokens(task.request) + tokens({ command: "node --input-type=module -e <script>", script: task.script }) + tokens(task.result);
  const mcp = tokens(task.request) + tokens(task.call) + tokens(task.result);
  return { task: task.call.name, toolset: task.toolset, baselineTokens: baseline, mcpTokens: mcp, savedPerCall: baseline - mcp,
    reductionPercent: Number(((1 - mcp / baseline) * 100).toFixed(1)) };
});

const perRound = rows.reduce((sum, row) => ({ baseline: sum.baseline + row.baselineTokens, mcp: sum.mcp + row.mcpTokens }), { baseline: 0, mcp: 0 });
const savedPerTask = (perRound.baseline - perRound.mcp) / rows.length;
const scenarios = Object.fromEntries(Object.entries(fixed).map(([name, value]) => [name, {
  ...value, breakEvenTasks: Math.ceil(value.fixedTokens / savedPerTask),
}]));
const totals = [1, 3, 10, 30].map((count) => {
  const baseline = Math.round(perRound.baseline / rows.length * count);
  const variable = Math.round(perRound.mcp / rows.length * count);
  return { tasks: count, baselineTokens: baseline,
    mcpAllToolsTokens: fixed.all.fixedTokens + variable,
    mcpOneToolsetTokens: Math.round(Object.values(fixed).filter((_, i) => i).reduce((s, v) => s + v.fixedTokens, 0) / toolsets.length) + variable };
});

const report = {
  methodology: "Estimated as UTF-8 bytes / 4; not provider billing data. Baseline = request + a compact safe script sent through a shell tool + its stdout, assuming success on the first try. MCP = request + tool call + tool result, plus the once-per-session tool list and server instructions. Clients that load tool schemas on demand pay much less of the fixed cost.",
  rows, averageSavedPerTask: Math.round(savedPerTask), fixedCost: scenarios, totals,
};

if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`FlowKit MCP token benchmark (estimate: bytes / 4)\n`);
  console.table(rows.map(({ task, baselineTokens, mcpTokens, reductionPercent }) => ({ task, "script baseline": baselineTokens, "MCP call": mcpTokens, "saved %": reductionPercent })));
  console.log(`Average saved per task: ~${Math.round(savedPerTask)} tokens\n\nOne-time cost of the tool list (per session):`);
  console.table(Object.fromEntries(Object.entries(scenarios).map(([name, s]) => [`--tools ${name}`, { tools: s.tools, "fixed tokens": s.fixedTokens, "break-even tasks": s.breakEvenTasks }])));
  console.log("Session totals:");
  console.table(totals.map(t => ({ tasks: t.tasks, "own scripts": t.baselineTokens, "MCP (all tools)": t.mcpAllToolsTokens, "MCP (one toolset)": t.mcpOneToolsetTokens })));
  console.log(report.methodology);
}
