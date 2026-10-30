import { createFlowkitMcpServer } from "../src/mcp.mjs";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

const encoder = new TextEncoder();
const estimatedTokens = (text) => Math.ceil(encoder.encode(text).length / 4);
const tasks = [
  { request: "Convert report.docx to Markdown and return a short preview.", call: { name: "flowkit_document_to_markdown", arguments: { inputPath: "report.docx" } },
    generated: `Write and run a Node.js script that securely creates a temporary directory, invokes Pandoc with fixed arguments and a timeout, reads report.docx, converts it to GitHub Markdown, limits returned content to 1000 characters, saves the full output without overwriting the source, cleans up temporary files, and returns the output path and metadata.` },
  { request: "Resize photo.jpg to fit within 800 by 800 pixels.", call: { name: "flowkit_image_resize", arguments: { inputPath: "photo.jpg", width: 800, height: 800 } },
    generated: `Write and run a Node.js script that validates photo.jpg, invokes ImageMagick without a shell, applies safe resource limits, auto-orients it, resizes it within 800x800 while preserving aspect ratio, writes a new PNG without overwriting the source, and returns only its path and dimensions.` },
  { request: "Trim clip.mp4 from 12 seconds for 20 seconds.", call: { name: "flowkit_video_trim", arguments: { inputPath: "clip.mp4", startSeconds: 12, durationSeconds: 20 } },
    generated: `Write and run a Node.js script that validates clip.mp4 with ffprobe, enforces duration, resolution, frame-rate and size limits, invokes FFmpeg without a shell to trim from 12 seconds for 20 seconds into H.264 MP4, applies a timeout, preserves the source, and returns the artifact path and duration without returning media bytes.` },
];

const server = await createFlowkitMcpServer({ workspace: process.cwd(), registry: { get() { throw new Error("not executed"); } } });
const client = new Client({ name: "flowkit-benchmark", version: "1.0.0" });
const transports = InMemoryTransport.createLinkedPair();
await server.connect(transports[1]);
await client.connect(transports[0]);
const schema = JSON.stringify(await client.listTools());
await client.close(); await server.close();

const rows = tasks.map((task) => {
  const mcp = JSON.stringify(task.call);
  const baseline = `${task.request}\n${task.generated}`;
  return { task: task.call.name, baselineBytes: encoder.encode(baseline).length, mcpCallBytes: encoder.encode(mcp).length,
    baselineEstimatedTokens: estimatedTokens(baseline), mcpCallEstimatedTokens: estimatedTokens(mcp) };
});
const totals = rows.reduce((sum, row) => ({ baselineEstimatedTokens: sum.baselineEstimatedTokens + row.baselineEstimatedTokens,
  mcpCallEstimatedTokens: sum.mcpCallEstimatedTokens + row.mcpCallEstimatedTokens }), { baselineEstimatedTokens: 0, mcpCallEstimatedTokens: 0 });
const schemaEstimatedTokens = estimatedTokens(schema);
const repeatedTasks = 10;
const baselineAtTen = totals.baselineEstimatedTokens * repeatedTasks;
const mcpAtTen = schemaEstimatedTokens + totals.mcpCallEstimatedTokens * repeatedTasks;
const marginalReductionPercent = Number(((1 - totals.mcpCallEstimatedTokens / totals.baselineEstimatedTokens) * 100).toFixed(1));
const breakEvenRounds = Math.ceil(schemaEstimatedTokens / (totals.baselineEstimatedTokens - totals.mcpCallEstimatedTokens));
console.log(JSON.stringify({
  methodology: "UTF-8 bytes / 4 token estimate; compare fixed MCP calls with explicit generated-script instructions. This is not provider billing data.",
  schemaBytes: encoder.encode(schema).length, schemaEstimatedTokens, rows,
  marginalReductionPercent, breakEvenRounds, repeatedTasks,
  repeatedTotals: { baselineEstimatedTokens: baselineAtTen, mcpEstimatedTokens: mcpAtTen,
    estimatedReductionPercent: Number(((1 - mcpAtTen / baselineAtTen) * 100).toFixed(1)) },
}, null, 2));
