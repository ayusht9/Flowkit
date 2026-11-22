// Runs every FlowKit MCP tool over real stdio against generated files and records timing and payload sizes.
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, copyFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { findPandoc } from "../../src/server.mjs";
import { findImageMagick } from "../../src/image.mjs";
import { sampleImage } from "../../examples/fixtures/image.mjs";
import { makeWav } from "../../examples/fixtures/media.mjs";
import { makePdf } from "../../examples/fixtures/pdf.mjs";
import { makeImagePdf, makeTestCertificate } from "../../examples/fixtures/pdf-security.mjs";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const encoder = new TextEncoder();
const bytes = (value) => encoder.encode(typeof value === "string" ? value : JSON.stringify(value)).length;

export function engineOf(name) {
  if (["flowkit_list_files", "flowkit_read_text", "flowkit_clean_markdown"].includes(name)) return "Node.js";
  if (name === "flowkit_file_metadata") return "Mixed";
  if (name === "flowkit_pdf_reduce") return "qpdf + Ghostscript";
  if (name === "flowkit_pdf_sign") return "pdf-lib";
  if (name.startsWith("flowkit_pdf_")) return "qpdf";
  if (name.startsWith("flowkit_image_")) return "ImageMagick";
  if (name.startsWith("flowkit_audio_") || name.startsWith("flowkit_video_")) return "FFmpeg";
  return "Pandoc";
}
export const groupOf = (name) => ["document", "pdf", "image", "audio", "video"].find((g) => name.startsWith(`flowkit_${g}_`)) ||
  (["flowkit_clean_markdown", "flowkit_merge_documents"].includes(name) ? "document" : "core");

function reportHtml() {
  const sections = Array.from({ length: 36 }, (_, i) => `<h2>Section ${i + 1}: Regional results</h2>
<p>Revenue in region ${i + 1} grew steadily through the quarter, driven by renewals and new accounts. Operating costs stayed flat while support response times improved.</p>
<table><tr><th>Metric</th><th>Q1</th><th>Q2</th></tr><tr><td>Revenue</td><td>${100 + i}</td><td>${112 + i}</td></tr><tr><td>Accounts</td><td>${40 + i}</td><td>${47 + i}</td></tr></table>
<ul><li>Renewal rate above target</li><li>Two new partnerships</li><li>Hiring on plan</li></ul>`).join("\n");
  return `<!doctype html><html><head><title>Quarterly report</title></head><body><h1>Quarterly report</h1>${sections}</body></html>`;
}

async function makeFixtures(directory) {
  const pandoc = await findPandoc();
  const magick = findImageMagick();
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const opts = { cwd: directory, windowsHide: true, timeout: 60_000 };
  await writeFile(join(directory, "report.html"), reportHtml());
  await run(pandoc, ["report.html", "-o", "report.docx"], opts);
  await copyFile(join(directory, "report.docx"), join(directory, "appendix.docx"));
  await writeFile(join(directory, "notes.md"), "# Meeting notes\r\n\r\n\r\n\r\n- Ship the PDF tools\r\n- Publish benchmarks\r\n\r\n\r\n```js\nconst  spaced = true;\n```\n".repeat(20));
  try { await run(magick, ["-size", "1600x1000", "gradient:#2a78d6-#eb6834", "photo.png"], opts); }
  catch { await writeFile(join(directory, "photo.png"), sampleImage); }
  await writeFile(join(directory, "signature.png"), sampleImage);
  await writeFile(join(directory, "tone.wav"), makeWav(20));
  await run(ffmpeg, ["-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
    "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "clip.mp4"], opts);
  await writeFile(join(directory, "contract.pdf"), makePdf(Array.from({ length: 8 }, (_, i) => `Contract page ${i + 1}`)));
  await writeFile(join(directory, "cover.pdf"), makePdf(["Cover", "Summary"]));
  await writeFile(join(directory, "scan.pdf"), await makeImagePdf());
  await writeFile(join(directory, "password.txt"), "benchmark-only-password\n", { mode: 0o600 });
  let certificate = false;
  try { await makeTestCertificate(directory); certificate = true; } catch { /* OpenSSL unavailable: certificate signing is reported as skipped */ }
  return { certificate };
}

// Arguments for every tool; `prepare` runs once (untimed) before measuring.
function plan({ certificate }) {
  const doc = (format) => [`flowkit_document_to_${format}`, { inputPath: "report.docx" }];
  return [
    ["flowkit_list_files", { directory: "." }],
    ["flowkit_read_text", { inputPath: "notes.md", limit: 2000 }],
    ["flowkit_file_metadata", { inputPath: "contract.pdf" }],
    ["flowkit_document_to_markdown", { inputPath: "report.docx" }],
    ...["html", "docx", "odt", "epub", "pdf", "text", "rtf", "latex", "rst", "asciidoc", "pptx"].map((format) =>
      format === "docx" ? [`flowkit_document_to_docx`, { inputPath: "report.html" }] : doc(format)),
    ["flowkit_clean_markdown", { inputPath: "notes.md" }],
    ["flowkit_merge_documents", { inputPaths: ["report.docx", "appendix.docx"] }],
    ["flowkit_image_resize", { inputPath: "photo.png", width: 800, height: 800 }],
    ["flowkit_image_crop", { inputPath: "photo.png", width: 600, height: 400, x: 100, y: 100 }],
    ["flowkit_image_rotate", { inputPath: "photo.png", degrees: 90 }],
    ["flowkit_image_flip", { inputPath: "photo.png", direction: "horizontal" }],
    ["flowkit_image_grayscale", { inputPath: "photo.png" }],
    ["flowkit_image_blur", { inputPath: "photo.png", sigma: 2 }],
    ["flowkit_image_sharpen", { inputPath: "photo.png", sigma: 1 }],
    ["flowkit_image_convert", { inputPath: "photo.png", format: "jpeg", quality: 85 }],
    ["flowkit_audio_convert", { inputPath: "tone.wav", format: "mp3" }],
    ["flowkit_audio_trim", { inputPath: "tone.wav", startSeconds: 2, durationSeconds: 10 }],
    ["flowkit_audio_volume", { inputPath: "tone.wav", gainDb: -6 }],
    ["flowkit_audio_fade", { inputPath: "tone.wav", fadeInSeconds: 1, fadeOutSeconds: 1 }],
    ["flowkit_audio_normalize", { inputPath: "tone.wav", targetLufs: -16 }],
    ["flowkit_video_trim", { inputPath: "clip.mp4", startSeconds: 1, durationSeconds: 3 }],
    ["flowkit_video_extract_audio", { inputPath: "clip.mp4", format: "mp3" }],
    ["flowkit_video_convert", { inputPath: "clip.mp4", quality: "balanced" }],
    ["flowkit_video_resize", { inputPath: "clip.mp4", width: 320, height: 180 }],
    ["flowkit_video_rotate", { inputPath: "clip.mp4", degrees: 90 }],
    ["flowkit_video_flip", { inputPath: "clip.mp4", direction: "horizontal" }],
    ["flowkit_video_mute", { inputPath: "clip.mp4" }],
    ["flowkit_pdf_merge", { inputPaths: ["cover.pdf", "contract.pdf"] }],
    ["flowkit_pdf_extract", { inputPath: "contract.pdf", pages: "2-4,7" }],
    ["flowkit_pdf_rotate", { inputPath: "contract.pdf", pages: "1-3", degrees: 90 }],
    ["flowkit_pdf_remove", { inputPath: "contract.pdf", pages: "2" }],
    ["flowkit_pdf_reverse", { inputPath: "contract.pdf" }],
    ["flowkit_pdf_reduce", { inputPath: "scan.pdf", factor: 2 }],
    ["flowkit_pdf_encrypt", { inputPath: "contract.pdf", passwordFilePath: "password.txt" }],
    ["flowkit_pdf_decrypt", { passwordFilePath: "password.txt" }, { prepare: ["flowkit_pdf_encrypt", { inputPath: "contract.pdf", passwordFilePath: "password.txt" }] }],
    ["flowkit_pdf_sign", { inputPath: "contract.pdf", signatureImagePath: "signature.png", page: 1 }],
    ...(certificate ? [["flowkit_pdf_sign", { inputPath: "contract.pdf", mode: "certificate", certificatePath: "test-cert.p12", certificatePasswordFilePath: "certificate-password.txt" }, { label: "flowkit_pdf_sign (certificate)" }]] : []),
  ];
}

const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]; };
const round = (value) => Number(value.toFixed(1));

export async function runLatencyBenchmark({ runs = 3, onProgress = () => {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "flowkit-benchmark-"));
  const client = new Client({ name: "flowkit-benchmark", version: "1.0.0" });
  try {
    const fixtures = await makeFixtures(directory);
    const started = performance.now();
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, "mcp-server.mjs"), "--workspace", directory], cwd: root,
      env: { ...getDefaultEnvironment(), ...process.env }, stderr: "ignore" }));
    const { tools } = await client.listTools();
    const startupMs = round(performance.now() - started);
    const listStart = performance.now(); await client.listTools(); const listToolsMs = round(performance.now() - listStart);

    const rows = [];
    for (const [name, args, extra = {}] of plan(fixtures)) {
      const label = extra.label || name;
      onProgress(label);
      let callArgs = args;
      if (extra.prepare) {
        const prepared = await client.callTool({ name: extra.prepare[0], arguments: extra.prepare[1] });
        callArgs = { inputPath: prepared.structuredContent?.path, ...args };
      }
      const durations = []; let last; let error;
      for (let i = 0; i < runs; i++) {
        const start = performance.now();
        last = await client.callTool({ name, arguments: callArgs });
        durations.push(performance.now() - start);
        if (last.isError) { error = last.content?.[0]?.text || "Tool returned an error"; break; }
      }
      const result = last.structuredContent;
      // PDF export needs pdfroff (GNU groff); report a missing optional engine as skipped, not failed.
      const skipped = error && name === "flowkit_document_to_pdf" && spawnSync("pdfroff", ["--version"], { windowsHide: true }).status !== 0;
      rows.push({ tool: label, name, group: groupOf(name), engine: engineOf(name), ok: !error, status: error ? (skipped ? "skipped" : "fail") : "pass",
        error: skipped ? "pdfroff (GNU groff) is not installed on the benchmark machine" : error?.slice(0, 200),
        runs: durations.length, medianMs: round(percentile(durations, 0.5)), minMs: round(Math.min(...durations)), maxMs: round(Math.max(...durations)),
        outputBytes: result?.sizeBytes ?? null, resultBytes: bytes(last.content?.[0]?.text ?? ""),
        summary: result ? summarize(name, result) : null });
    }

    // Safety boundaries: each must be rejected without touching files outside the workspace.
    const boundaries = [];
    for (const [label, name, args, expect] of [
      ["Path escape (../)", "flowkit_read_text", { inputPath: "../outside.md" }, /workspace/i],
      ["Absolute path", "flowkit_file_metadata", { inputPath: resolve(root, "package.json") }, /relative/i],
      ["Out-of-range option", "flowkit_image_resize", { inputPath: "photo.png", width: -50 }, /width|validation|invalid/i],
      ["Unknown argument", "flowkit_pdf_reverse", { inputPath: "contract.pdf", shell: "rm -rf /" }, /unrecognized|invalid|validation/i],
      ["Missing file", "flowkit_document_to_markdown", { inputPath: "missing.docx" }, /missing|inaccessible/i],
      ["Wrong file type", "flowkit_read_text", { inputPath: "photo.png" }, /markdown|txt/i],
    ]) {
      const start = performance.now();
      let response;
      try { response = await client.callTool({ name, arguments: args }); } catch (e) { response = { isError: true, content: [{ text: e.message }] }; }
      const text = response.content?.[0]?.text || "";
      boundaries.push({ check: label, tool: name, blocked: !!response.isError && expect.test(text), message: text.slice(0, 160), ms: round(performance.now() - start) });
    }
    return { runs, toolCount: tools.length, startupMs, listToolsMs, rows, boundaries };
  } finally {
    await client.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}

function summarize(name, r) {
  const size = r.sizeBytes ? `${(r.sizeBytes / 1024).toFixed(1)} KiB` : "";
  if (name === "flowkit_list_files") return `${r.entries?.length ?? 0} entries`;
  if (name === "flowkit_read_text") return `${r.text?.length ?? 0} of ${r.totalCharacters} characters`;
  if (name === "flowkit_file_metadata") return `${r.kind || r.detectedExtension}, ${r.details?.pageCount ?? "?"} pages`;
  const bits = [r.type, size, r.width && `${r.width}×${r.height}`, r.durationSeconds && `${Number(r.durationSeconds).toFixed(1)} s`,
    r.pageCount && `${r.pageCount} pages`, r.achievedFactor && `${Number(r.achievedFactor).toFixed(2)}× smaller`,
    ["flowkit_pdf_encrypt", "flowkit_pdf_decrypt"].includes(name) && (r.encrypted ? "encrypted" : "decrypted"), r.signatureType && `${r.signatureType} signature`];
  return bits.filter(Boolean).join(", ");
}
