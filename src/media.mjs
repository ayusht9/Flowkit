import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { assertRecord } from "./operations.mjs";

const execute = promisify(execFile);
const maxBytes = 20 * 1024 * 1024;
const maxOutput = 8 * 1024 * 1024;
const formats = { ".wav": "wav", ".mp3": "mp3", ".m4a": "mov", ".mp4": "mov", ".mov": "mov", ".webm": "matroska", ".mkv": "matroska" };

export function validateMedia(value, kind) {
  assertRecord(value, "Media");
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 255 || /[/\\\0]/.test(value.name))
    throw new TypeError("Media name must be a filename without directory components");
  if (!(value.data instanceof Uint8Array) || !value.data.byteLength || value.data.byteLength > maxBytes)
    throw new TypeError("Media must contain between 1 byte and 20 MiB");
  const extension = extname(value.name).toLowerCase();
  const allowed = kind === "audio" ? [".wav", ".mp3", ".m4a"] : [".mp4", ".mov", ".webm", ".mkv"];
  const data = Buffer.from(value.data);
  const signature = extension === ".wav" ? data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WAVE" :
    extension === ".mp3" ? data.toString("ascii", 0, 3) === "ID3" || (data[0] === 255 && (data[1] & 224) === 224) :
    [".webm", ".mkv"].includes(extension) ? data.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) : data.toString("ascii", 4, 8) === "ftyp";
  if (!allowed.includes(extension) || !signature)
    throw new TypeError(kind === "audio" ? "Choose WAV, MP3, or M4A audio with a matching signature" : "Choose MP4, MOV, WebM, or MKV video with a matching signature");
}

export function createMediaOperation(operation, { ffmpeg = process.env.FFMPEG_PATH || "ffmpeg", ffprobe = process.env.FFPROBE_PATH || "ffprobe", timeoutMs = 30_000 } = {}) {
  const inputType = operation.startsWith("audio.") ? "audio" : "video";
  const outputType = operation === "video.extractAudio" ? "audio" : inputType;
  const trim = operation.endsWith(".trim");
  if (!["audio.convert", "audio.trim", "video.trim", "video.extractAudio"].includes(operation)) throw new TypeError("Unknown media operation");
  if (![ffmpeg, ffprobe].every((value) => typeof value === "string" && value.trim()) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new TypeError("Configure valid FFmpeg/FFprobe executables and a positive timeout");
  return {
    inputType, outputType,
    validateInput: (value) => validateMedia(value, inputType),
    validateOutput: (value) => validateMedia(value, outputType),
    validateOptions(options) {
      const keys = [...(outputType === "audio" ? ["format"] : []), ...(trim ? ["startSeconds", "durationSeconds"] : [])];
      if (Object.keys(options).some((key) => !keys.includes(key))) throw new TypeError("Unsupported media settings");
      if (outputType === "audio" && options.format !== undefined && !["mp3", "wav"].includes(options.format)) throw new TypeError("Audio output must be MP3 or WAV");
      if (trim && (!Number.isFinite(options.startSeconds) || options.startSeconds < 0 || options.startSeconds > 300 ||
        !Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0 || options.durationSeconds > 300))
        throw new TypeError("Set a start of 0–300 seconds and a duration greater than 0 and at most 300 seconds");
    },
    async run(input, options, { signal }) {
      signal?.throwIfAborted();
      const directory = await mkdtemp(join(tmpdir(), "flowkit-media-"));
      try {
        const extension = extname(input.value.name).toLowerCase();
        const path = join(directory, `input${extension}`);
        await writeFile(path, input.value.data, { signal, mode: 0o600 });
        // Force a supported local demuxer; network protocols and MOV external references are disabled.
        const sourceArgs = ["-protocol_whitelist", "file,pipe", "-f", formats[extension], ...(formats[extension] === "mov" ? ["-enable_drefs", "0"] : [])];
        const settings = { cwd: directory, signal, timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true };
        const probe = await execute(ffprobe, ["-v", "error", "-max_alloc", "67108864", ...sourceArgs,
          "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate", "-of", "json", path], settings);
        const info = JSON.parse(probe.stdout);
        const duration = Number(info.format?.duration);
        const video = info.streams?.find((stream) => stream.codec_type === "video");
        const audio = info.streams?.some((stream) => stream.codec_type === "audio");
        if (!Number.isFinite(duration) || duration <= 0 || duration > 300) throw new Error("Media must be at most 5 minutes long");
        if ((inputType === "audio" && (!audio || video)) || (inputType === "video" && !video)) throw new Error("Media streams do not match the uploaded file type");
        if (outputType === "audio" && !audio) throw new Error("This file has no audio track");
        if (video) {
          const [numerator, denominator] = (video.r_frame_rate || "0/1").split("/").map(Number);
          if (!Number.isSafeInteger(video.width) || !Number.isSafeInteger(video.height) || video.width < 1 || video.height < 1 ||
            video.width * video.height > 1920 * 1080 || !Number.isFinite(numerator / denominator) || numerator / denominator > 60)
            throw new Error("Video is limited to 1920 × 1080 pixels and 60 fps");
        }
        if (trim && options.startSeconds >= duration) throw new Error("Trim start must be before the end of the file");
        const format = outputType === "audio" ? options.format || "mp3" : "mp4";
        const outputPath = join(directory, `output.${format}`);
        const encoding = outputType === "audio"
          ? ["-map", "0:a:0", "-vn", "-ac", "2", "-ar", "44100", "-c:a", format === "wav" ? "pcm_s16le" : "libmp3lame", ...(format === "mp3" ? ["-b:a", "128k"] : [])]
          : ["-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"];
        await execute(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-max_alloc", "67108864", "-filter_threads", "1", "-threads", "1",
          ...sourceArgs, "-i", path, ...(trim ? ["-ss", String(options.startSeconds), "-t", String(options.durationSeconds)] : []),
          ...encoding, "-threads", "1", "-map_metadata", "-1", "-map_chapters", "-1", "-fs", String(maxOutput + 1), outputPath], settings);
        const size = (await stat(outputPath)).size;
        if (!size || size >= maxOutput) throw new Error("Media output exceeded the 8 MiB limit; use a shorter trim");
        const data = await readFile(outputPath, { signal });
        const stem = input.value.name.replace(/\.[^.]+$/, "").slice(0, 200);
        return { type: outputType, value: { name: `${stem}-processed.${format}`, source: input.value.name, data,
          mimeType: outputType === "video" ? "video/mp4" : format === "wav" ? "audio/wav" : "audio/mpeg",
          durationSeconds: trim ? Math.min(options.durationSeconds, duration - options.startSeconds) : duration } };
      } catch (error) {
        if (signal?.aborted) throw error;
        if (error.code === "ENOENT") throw new Error("FFmpeg/FFprobe not found. Install FFmpeg or set FFMPEG_PATH and FFPROBE_PATH.", { cause: error });
        if (error.killed) throw new Error(`Media processing exceeded its ${timeoutMs} ms execution limit`, { cause: error });
        if (error.code || error instanceof SyntaxError) throw new Error("Media processing failed; check the file content and format", { cause: error });
        throw error;
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
  };
}
