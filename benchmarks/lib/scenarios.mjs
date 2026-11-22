// Benchmark scenarios: what an agent sends and reads to finish a file task with and without FlowKit.
//
// Baseline ("own script"): the agent writes a compact but safe Node.js script (workspace-bounded
// paths, size check, no shell, timeout, no overwrite), sends it through a shell tool, and reads
// its stdout. Every script repeats the same safety preamble because the model must re-emit it.
// MCP: the agent sends one tool call per step and reads FlowKit's JSON result.
// Results mirror the fields FlowKit actually returns for the operation.

export const preamble = `import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
const run = promisify(execFile);
const root = process.cwd();
const opts = { timeout: 120000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 };
async function input(name) {
  const path = resolve(root, name);
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Input must stay inside the workspace");
  const info = await stat(path);
  if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error("Input must be a file under 20 MiB");
  return path;
}
async function output(name) {
  const path = resolve(root, name);
  if (await stat(path).then(() => true, () => false)) throw new Error("Refusing to overwrite " + name);
  return path;
}
const report = async (path, extra = {}) => console.log(JSON.stringify({ path: relative(root, path), sizeBytes: (await stat(path)).size, ...extra }));
`;

const artifact = (name, extra) => ({ path: `.flowkit-artifacts/run-x7Kp2Q/${name}`, name, ...extra });
const preview = "# Quarterly report\n\n" + "Revenue grew in every region; details follow in the tables below. ".repeat(15);

export const tasks = [
  {
    id: "doc-markdown", toolset: "document", label: "DOCX → Markdown (with preview)",
    request: "Convert report.docx to Markdown and show me the beginning.",
    calls: [{ name: "flowkit_document_to_markdown", arguments: { inputPath: "report.docx" } }],
    results: [artifact("report.md", { type: "markdown", sizeBytes: 21480, mimeType: "text/markdown", preview: preview.slice(0, 1000), previewTruncated: true })],
    body: `const source = await input("report.docx");
const target = await output("report.md");
await run("pandoc", ["--sandbox", "--from=docx", "--to=gfm", "--output", target, source], opts);
const text = await readFile(target, "utf8");
await report(target, { preview: text.slice(0, 1000), previewTruncated: text.length > 1000 });`,
    stdout: { path: "report.md", sizeBytes: 21480, preview: preview.slice(0, 1000), previewTruncated: true },
  },
  {
    id: "doc-pdf", toolset: "document", label: "Markdown → PDF",
    request: "Turn notes.md into a PDF.",
    calls: [{ name: "flowkit_document_to_pdf", arguments: { inputPath: "notes.md" } }],
    results: [artifact("notes.pdf", { type: "document", sizeBytes: 48211, mimeType: "application/pdf" })],
    body: `const source = await input("notes.md");
const target = await output("notes.pdf");
await run("pandoc", ["--sandbox", "--from=markdown", "--pdf-engine=pdfroff", "--output", target, source], opts);
await report(target);`,
    stdout: { path: "notes.pdf", sizeBytes: 48211 },
  },
  {
    id: "pdf-merge", toolset: "pdf", label: "Merge 3 PDFs",
    request: "Merge intro.pdf, body.pdf and appendix.pdf in that order.",
    calls: [{ name: "flowkit_pdf_merge", arguments: { inputPaths: ["intro.pdf", "body.pdf", "appendix.pdf"] } }],
    results: [artifact("merged.pdf", { type: "pdf", sizeBytes: 182304, mimeType: "application/pdf", pageCount: 14 })],
    body: `const sources = await Promise.all(["intro.pdf", "body.pdf", "appendix.pdf"].map(input));
for (const file of sources) { const { stdout } = await run("qpdf", ["--is-encrypted", file], opts).catch(e => e); if (stdout === "") throw new Error("Encrypted PDF: " + file); }
const target = await output("merged.pdf");
await run("qpdf", ["--empty", "--pages", ...sources, "--", target], opts);
const { stdout } = await run("qpdf", ["--show-npages", target], opts);
await report(target, { pageCount: Number(stdout) });`,
    stdout: { path: "merged.pdf", sizeBytes: 182304, pageCount: 14 },
  },
  {
    id: "pdf-extract", toolset: "pdf", label: "Extract PDF pages 2-4,7",
    request: "Pull pages 2 to 4 and page 7 out of contract.pdf.",
    calls: [{ name: "flowkit_pdf_extract", arguments: { inputPath: "contract.pdf", pages: "2-4,7" } }],
    results: [artifact("contract.pdf", { type: "pdf", sizeBytes: 64290, mimeType: "application/pdf", pageCount: 4 })],
    body: `const source = await input("contract.pdf");
const pages = "2-4,7";
if (!/^\\d+(-\\d+)?(,\\d+(-\\d+)?)*$/.test(pages)) throw new Error("Invalid page selection");
const target = await output("contract-pages.pdf");
await run("qpdf", ["--empty", "--pages", source, pages, "--", target], opts);
const { stdout } = await run("qpdf", ["--show-npages", target], opts);
await report(target, { pageCount: Number(stdout) });`,
    stdout: { path: "contract-pages.pdf", sizeBytes: 64290, pageCount: 4 },
  },
  {
    id: "pdf-reduce", toolset: "pdf", label: "Halve a scanned PDF's size",
    request: "Make scan.pdf about half its size.",
    calls: [{ name: "flowkit_pdf_reduce", arguments: { inputPath: "scan.pdf", factor: 2 } }],
    results: [artifact("scan.pdf", { type: "pdf", sizeBytes: 1802113, mimeType: "application/pdf", pageCount: 12, originalSizeBytes: 4120558, sizeChangeBytes: -2318445, requestedFactor: 2, achievedFactor: 2.29, targetMet: true, autoQuality: true, qualityUsed: 75, resolutionDpi: 150, compressionMethod: "image-recompression" })],
    body: `import { rm } from "node:fs/promises";
const source = await input("scan.pdf");
const original = (await stat(source)).size;
const candidates = [];
const lossless = await output("scan.lossless.pdf");
await run("qpdf", ["--object-streams=generate", "--compress-streams=y", "--recompress-flate", source, lossless], opts);
candidates.push({ path: lossless, method: "lossless" });
for (const [preset, dpi] of [["/ebook", 150], ["/screen", 96]]) {
  const target = await output(\`scan.\${dpi}.pdf\`);
  await run("gs", ["-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite", \`-dPDFSETTINGS=\${preset}\`, \`-dColorImageResolution=\${dpi}\`, \`-sOutputFile=\${target}\`, source], opts);
  candidates.push({ path: target, method: "image-recompression", dpi });
}
for (const c of candidates) c.size = (await stat(c.path)).size;
const best = candidates.filter(c => c.size < original).sort((a, b) => Math.abs(original / a.size - 2) - Math.abs(original / b.size - 2))[0];
for (const c of candidates) if (c !== best) await rm(c.path);
await report(best.path, { originalSizeBytes: original, achievedFactor: +(original / best.size).toFixed(2), method: best.method, dpi: best.dpi });`,
    stdout: { path: "scan.150.pdf", sizeBytes: 1802113, originalSizeBytes: 4120558, achievedFactor: 2.29, method: "image-recompression", dpi: 150 },
  },
  {
    id: "pdf-encrypt", toolset: "pdf", label: "Encrypt a PDF (AES-256)",
    request: "Password-protect invoice.pdf using the password in secret.txt.",
    calls: [{ name: "flowkit_pdf_encrypt", arguments: { inputPath: "invoice.pdf", passwordFilePath: "secret.txt" } }],
    results: [artifact("invoice.pdf", { type: "pdf", sizeBytes: 90233, mimeType: "application/pdf", pageCount: 2, encrypted: true })],
    body: `const source = await input("invoice.pdf");
const password = (await readFile(await input("secret.txt"), "utf8")).replace(/\\r?\\n$/, "");
if (!password || password.length > 1024) throw new Error("Invalid password file");
const target = await output("invoice.encrypted.pdf");
await run("qpdf", ["--encrypt", "--user-password=" + password, "--owner-password=" + password, "--bits=256", "--", source, target], opts);
await report(target, { encrypted: true });`,
    stdout: { path: "invoice.encrypted.pdf", sizeBytes: 90233, encrypted: true },
  },
  {
    id: "image-resize", toolset: "image", label: "Resize image to fit 800×800",
    request: "Resize photo.jpg to fit within 800 by 800 pixels.",
    calls: [{ name: "flowkit_image_resize", arguments: { inputPath: "photo.jpg", width: 800, height: 800 } }],
    results: [artifact("photo.png", { type: "image", sizeBytes: 412877, mimeType: "image/png", width: 800, height: 600 })],
    body: `const source = await input("photo.jpg");
const magick = process.platform === "win32" ? "magick" : "convert";
const { stdout: dims } = await run(magick, ["identify", "-format", "%w %h", source + "[0]"], opts);
const [w, h] = dims.trim().split(" ").map(Number);
if (!w || !h || w * h > 16e6) throw new Error("Image exceeds 16 megapixels");
const target = await output("photo.resized.png");
await run(magick, ["-limit", "memory", "256MiB", source + "[0]", "-auto-orient", "-resize", "800x800", "-strip", "PNG:" + target], opts);
const { stdout } = await run(magick, ["identify", "-format", "%w %h", target], opts);
const [width, height] = stdout.trim().split(" ").map(Number);
await report(target, { width, height });`,
    stdout: { path: "photo.resized.png", sizeBytes: 412877, width: 800, height: 600 },
  },
  {
    id: "image-convert", toolset: "image", label: "PNG → JPEG at quality 85",
    request: "Convert diagram.png to a JPEG at quality 85.",
    calls: [{ name: "flowkit_image_convert", arguments: { inputPath: "diagram.png", format: "jpeg", quality: 85 } }],
    results: [artifact("diagram.jpg", { type: "image", sizeBytes: 98112, mimeType: "image/jpeg", width: 1600, height: 900 })],
    body: `const source = await input("diagram.png");
const magick = process.platform === "win32" ? "magick" : "convert";
const target = await output("diagram.jpg");
await run(magick, ["-limit", "memory", "256MiB", source + "[0]", "-auto-orient", "-background", "white", "-flatten", "-quality", "85", "-strip", "JPEG:" + target], opts);
const { stdout } = await run(magick, ["identify", "-format", "%w %h", target], opts);
const [width, height] = stdout.trim().split(" ").map(Number);
await report(target, { width, height });`,
    stdout: { path: "diagram.jpg", sizeBytes: 98112, width: 1600, height: 900 },
  },
  {
    id: "audio-trim", toolset: "audio", label: "Trim audio 0:30 for 45 s",
    request: "Cut interview.wav from 30 seconds for 45 seconds, as MP3.",
    calls: [{ name: "flowkit_audio_trim", arguments: { inputPath: "interview.wav", startSeconds: 30, durationSeconds: 45 } }],
    results: [artifact("interview.mp3", { type: "audio", sizeBytes: 721344, mimeType: "audio/mpeg", durationSeconds: 45 })],
    body: `const source = await input("interview.wav");
const { stdout: probe } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", source], opts);
const duration = Number(probe);
if (!(duration > 0) || duration > 300) throw new Error("Audio must be at most 5 minutes");
if (30 >= duration) throw new Error("Start is past the end");
const target = await output("interview.trimmed.mp3");
await run("ffmpeg", ["-nostdin", "-n", "-v", "error", "-ss", "30", "-t", "45", "-i", source, "-vn", "-c:a", "libmp3lame", "-b:a", "128k", target], opts);
const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", target], opts);
await report(target, { durationSeconds: Number(stdout) });`,
    stdout: { path: "interview.trimmed.mp3", sizeBytes: 721344, durationSeconds: 45 },
  },
  {
    id: "audio-normalize", toolset: "audio", label: "Normalize loudness to −16 LUFS",
    request: "Normalize podcast.mp3 to -16 LUFS.",
    calls: [{ name: "flowkit_audio_normalize", arguments: { inputPath: "podcast.mp3", targetLufs: -16 } }],
    results: [artifact("podcast.mp3", { type: "audio", sizeBytes: 2811904, mimeType: "audio/mpeg", durationSeconds: 175.7 })],
    body: `const source = await input("podcast.mp3");
const { stdout: probe } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", source], opts);
if (!(Number(probe) > 0) || Number(probe) > 300) throw new Error("Audio must be at most 5 minutes");
const pass1 = await run("ffmpeg", ["-nostdin", "-hide_banner", "-i", source, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], opts);
const stats = JSON.parse(pass1.stderr.slice(pass1.stderr.lastIndexOf("{")));
const filter = \`loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=\${stats.input_i}:measured_TP=\${stats.input_tp}:measured_LRA=\${stats.input_lra}:measured_thresh=\${stats.input_thresh}:offset=\${stats.target_offset}:linear=true\`;
const target = await output("podcast.normalized.mp3");
await run("ffmpeg", ["-nostdin", "-n", "-v", "error", "-i", source, "-af", filter, "-c:a", "libmp3lame", "-b:a", "128k", target], opts);
await report(target);`,
    stdout: { path: "podcast.normalized.mp3", sizeBytes: 2811904 },
  },
  {
    id: "video-trim", toolset: "video", label: "Trim video 0:12 for 20 s",
    request: "Trim clip.mp4 from 12 seconds for 20 seconds.",
    calls: [{ name: "flowkit_video_trim", arguments: { inputPath: "clip.mp4", startSeconds: 12, durationSeconds: 20 } }],
    results: [artifact("clip.mp4", { type: "video", sizeBytes: 3911204, mimeType: "video/mp4", width: 1280, height: 720, durationSeconds: 20, frameRate: 30 })],
    body: `const source = await input("clip.mp4");
const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate:format=duration", "-of", "json", source], opts);
const probe = JSON.parse(stdout), stream = probe.streams?.[0];
if (!stream) throw new Error("No video stream");
const [num, den] = stream.avg_frame_rate.split("/").map(Number);
const duration = Number(probe.format.duration);
if (duration > 300 || stream.width * stream.height > 1920 * 1080 || num / den > 60) throw new Error("Video exceeds limits");
const target = await output("clip.trimmed.mp4");
await run("ffmpeg", ["-nostdin", "-n", "-v", "error", "-ss", "12", "-t", "20", "-i", source, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-movflags", "+faststart", target], opts);
await report(target, { width: stream.width, height: stream.height, durationSeconds: 20 });`,
    stdout: { path: "clip.trimmed.mp4", sizeBytes: 3911204, width: 1280, height: 720, durationSeconds: 20 },
  },
  {
    id: "video-audio", toolset: "video", label: "Extract a video's soundtrack",
    request: "Extract the audio from talk.mp4 as MP3.",
    calls: [{ name: "flowkit_video_extract_audio", arguments: { inputPath: "talk.mp4" } }],
    results: [artifact("talk.mp3", { type: "audio", sizeBytes: 2390112, mimeType: "audio/mpeg", durationSeconds: 149.4 })],
    body: `const source = await input("talk.mp4");
const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type:format=duration", "-of", "json", source], opts);
const probe = JSON.parse(stdout);
if (!probe.streams?.length) throw new Error("No audio stream");
if (Number(probe.format.duration) > 300) throw new Error("Video must be at most 5 minutes");
const target = await output("talk.mp3");
await run("ffmpeg", ["-nostdin", "-n", "-v", "error", "-i", source, "-vn", "-c:a", "libmp3lame", "-b:a", "128k", target], opts);
await report(target, { durationSeconds: Number(probe.format.duration) });`,
    stdout: { path: "talk.mp3", sizeBytes: 2390112, durationSeconds: 149.4 },
  },
  {
    id: "metadata", toolset: "core", label: "Inspect a PDF's metadata",
    request: "How many pages does contract.pdf have, and is it encrypted?",
    calls: [{ name: "flowkit_file_metadata", arguments: { inputPath: "contract.pdf" } }],
    results: [{ path: "contract.pdf", name: "contract.pdf", sizeBytes: 241880, extension: "pdf", detectedExtension: "pdf", kind: "pdf", mimeType: "application/pdf", details: { pageCount: 9, encrypted: false, pdfVersion: "1.7", title: "Service agreement", pageSize: { width: 612, height: 792 } }, warnings: [] }],
    body: `const source = await input("contract.pdf");
const pages = Number((await run("qpdf", ["--show-npages", source], opts)).stdout);
const encrypted = await run("qpdf", ["--is-encrypted", source], opts).then(() => true, () => false);
const { stdout } = await run("qpdf", ["--json", "--json-key=pages", "--json-key=encrypt", source], opts);
const json = JSON.parse(stdout);
await report(source, { pageCount: pages, encrypted, pdfVersion: json.version ?? null, pageSize: json.pages?.[0]?.mediabox ?? null });`,
    stdout: { path: "contract.pdf", sizeBytes: 241880, pageCount: 9, encrypted: false, pdfVersion: "1.7", pageSize: [0, 0, 612, 792] },
  },
];

// Multi-step workflows. The baseline gets the benefit of the doubt: one combined script per workflow.
export const chains = [
  {
    id: "chain-contract", label: "Contract packet: merge → drop page → shrink → encrypt", toolset: "pdf",
    request: "Merge cover.pdf and terms.pdf, drop page 2, shrink it to half size, and protect it with secret.txt.",
    steps: ["pdf-merge", "pdf-extract", "pdf-reduce", "pdf-encrypt"],
    calls: [
      { name: "flowkit_pdf_merge", arguments: { inputPaths: ["cover.pdf", "terms.pdf"] } },
      { name: "flowkit_pdf_remove", arguments: { inputPath: ".flowkit-artifacts/run-x7Kp2Q/merged.pdf", pages: "2" } },
      { name: "flowkit_pdf_reduce", arguments: { inputPath: ".flowkit-artifacts/run-a91LmT/merged.pdf", factor: 2 } },
      { name: "flowkit_pdf_encrypt", arguments: { inputPath: ".flowkit-artifacts/run-Qe0vZ3/merged.pdf", passwordFilePath: "secret.txt" } },
    ],
  },
  {
    id: "chain-podcast", label: "Podcast clip: extract audio → trim → normalize", toolset: "video+audio",
    request: "Take the audio from talk.mp4, keep 1:00–2:30, and normalize it to -16 LUFS.",
    steps: ["video-audio", "audio-trim", "audio-normalize"],
    calls: [
      { name: "flowkit_video_extract_audio", arguments: { inputPath: "talk.mp4" } },
      { name: "flowkit_audio_trim", arguments: { inputPath: ".flowkit-artifacts/run-x7Kp2Q/talk.mp3", startSeconds: 60, durationSeconds: 90 } },
      { name: "flowkit_audio_normalize", arguments: { inputPath: ".flowkit-artifacts/run-a91LmT/talk.mp3", targetLufs: -16 } },
    ],
  },
  {
    id: "chain-thumbnail", label: "Thumbnail: resize → JPEG", toolset: "image",
    request: "Make a JPEG thumbnail of photo.jpg that fits in 800×800.",
    steps: ["image-resize", "image-convert"],
    calls: [
      { name: "flowkit_image_resize", arguments: { inputPath: "photo.jpg", width: 800, height: 800 } },
      { name: "flowkit_image_convert", arguments: { inputPath: ".flowkit-artifacts/run-x7Kp2Q/photo.png", format: "jpeg", quality: 85 } },
    ],
  },
];

// A realistic tool error the agent must read before correcting itself.
export const scriptError = `node:internal/process/promises:394
    triggerUncaughtException(err, true /* fromPromise */);
    ^
Error: Command failed: ffmpeg -nostdin -n -v error -ss 30 -t 45 -i interview.wav -vn -c:a libmp3lame -b:a 128k interview.trimmed.mp3
[mp3 @ 0000021f8c0e1a40] Invalid audio stream. Exactly one MP3 audio stream is required.
Could not write header (incorrect codec parameters ?): Invalid argument
Error opening output files: Invalid argument
    at genericNodeError (node:internal/errors:983:15)
    at wrapError (node:internal/errors:1418:21)
    at ChildProcess.exithandler (node:child_process:417:12) {
  code: 1, killed: false, signal: null }`;
export const mcpError = "MCP error -32602: Input validation error: Invalid arguments for tool flowkit_audio_trim: durationSeconds must be greater than 0";
