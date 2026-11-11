import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { assertRecord } from "./operations.mjs";
import { mediaOperations } from './media-operations.mjs';
import { getMediaOutputMiB, MiB } from './limits.mjs';

const execute = promisify(execFile);
const maxBytes = 20 * 1024 * 1024;
const formats = { ".wav": "wav", ".mp3": "mp3", ".m4a": "mov", ".mp4": "mov", ".mov": "mov", ".webm": "matroska", ".mkv": "matroska" };

export function validateMedia(value, kind, { maxBytes: byteLimit = maxBytes } = {}) {
  assertRecord(value, "Media");
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 255 || /[/\\\0]/.test(value.name))
    throw new TypeError("Media name must be a filename without directory components");
  if (!(value.data instanceof Uint8Array) || !value.data.byteLength || value.data.byteLength > byteLimit)
    throw new TypeError(`Media must contain between 1 byte and ${byteLimit / MiB} MiB`);
  const extension = extname(value.name).toLowerCase();
  const allowed = kind === "audio" ? [".wav", ".mp3", ".m4a"] : [".mp4", ".mov", ".webm", ".mkv"];
  const data = Buffer.from(value.data);
  const signature = extension === ".wav" ? data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WAVE" :
    extension === ".mp3" ? data.toString("ascii", 0, 3) === "ID3" || (data[0] === 255 && (data[1] & 224) === 224) :
    [".webm", ".mkv"].includes(extension) ? data.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) : data.toString("ascii", 4, 8) === "ftyp";
  if (!allowed.includes(extension) || !signature)
    throw new TypeError(kind === "audio" ? "Choose WAV, MP3, or M4A audio with a matching signature" : "Choose MP4, MOV, WebM, or MKV video with a matching signature");
}

export function createMediaOperation(operation, { ffmpeg = process.env.FFMPEG_PATH || "ffmpeg", ffprobe = process.env.FFPROBE_PATH || "ffprobe", timeoutMs = 30_000, maxOutputMiB = getMediaOutputMiB() } = {}) {
  maxOutputMiB = getMediaOutputMiB(maxOutputMiB);
  const maxOutput = maxOutputMiB * MiB;
  const maxPayloadBytes = Math.max(maxBytes, maxOutput);
  const definition = mediaOperations.find(item => item.type === operation);
  if (!definition) throw new TypeError("Unknown media operation");
  const { inputType, outputType } = definition;
  const trim = operation.endsWith(".trim");
  if (![ffmpeg, ffprobe].every((value) => typeof value === "string" && value.trim()) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new TypeError("Configure valid FFmpeg/FFprobe executables and a positive timeout");
  return {
    inputType, outputType,
    validateInput: (value) => validateMedia(value, inputType, { maxBytes: maxPayloadBytes }),
    validateOutput: (value) => validateMedia(value, outputType, { maxBytes: maxOutput }),
    validateOptions(options) {
      if (Object.keys(options).some(key => !definition.fields.some(field => field.key === key))) throw new TypeError("Unsupported media settings");
      for (const field of definition.fields) {
        const value = options[field.key];
        if (value === undefined && !field.required) continue;
        if (field.choices ? !field.choices.includes(value) : typeof value !== 'number' || !Number.isFinite(value) ||
          (field.step === 1 && !Number.isSafeInteger(value)) || value < field.min || value > field.max || (field.exclusiveMin && value === field.min))
          throw new TypeError(`${field.label}: ${field.choices ? `choose ${field.choices.join(', ')}` : `use ${field.step === 1 ? 'an integer' : 'a number'} ${field.exclusiveMin ? 'greater than' : 'between'} ${field.min} and ${field.max}`}`);
      }
      if (operation === 'video.resize' && options.width === undefined && options.height === undefined) throw new TypeError('Set a video resize width or height');
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
        const audioFilters = [], videoFilters = [];
        if (operation === 'audio.volume') audioFilters.push(`volume=${options.gainDb ?? 0}dB`);
        if (operation === 'audio.fade') {
          const fadeIn = options.fadeInSeconds ?? 0.25, fadeOut = options.fadeOutSeconds ?? 0.25;
          if (fadeIn + fadeOut > duration) throw new Error('Fade durations must fit within the audio duration');
          if (fadeIn) audioFilters.push(`afade=t=in:st=0:d=${fadeIn}`);
          if (fadeOut) audioFilters.push(`afade=t=out:st=${duration - fadeOut}:d=${fadeOut}`);
        }
        if (operation === 'audio.normalize') audioFilters.push('aformat=channel_layouts=stereo:sample_rates=44100', `loudnorm=I=${options.targetLufs ?? -16}:TP=-1.5:LRA=11`);
        if (operation === 'video.resize') videoFilters.push(`scale=w=min(iw\\,${options.width ?? 1920}):h=min(ih\\,${options.height ?? 1920}):force_original_aspect_ratio=decrease:force_divisible_by=2`);
        if (operation === 'video.rotate') videoFilters.push((options.degrees ?? 90) === 90 ? 'transpose=clock' : options.degrees === 180 ? 'hflip,vflip' : 'transpose=cclock');
        if (operation === 'video.flip') videoFilters.push((options.direction ?? 'horizontal') === 'horizontal' ? 'hflip' : options.direction === 'both' ? 'hflip,vflip' : 'vflip');
        videoFilters.push('pad=ceil(iw/2)*2:ceil(ih/2)*2');
        const format = outputType === "audio" ? options.format || "mp3" : "mp4";
        const outputPath = join(directory, `output.${format}`);
        const encoding = outputType === "audio"
          ? ["-map", "0:a:0", "-vn", ...(audioFilters.length ? ['-af', audioFilters.join(',')] : []), "-ac", "2", "-ar", "44100", "-c:a", format === "wav" ? "pcm_s16le" : "libmp3lame", ...(format === "mp3" ? ["-b:a", "128k"] : [])]
          : ["-map", "0:v:0", ...(operation === 'video.mute' ? ['-an'] : ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '128k']), "-c:v", "libx264", "-preset", "ultrafast", "-crf",
            String(operation === 'video.convert' ? ({ compact: 28, balanced: 23, high: 18 }[options.quality ?? 'balanced']) : 28), "-vf", videoFilters.join(','), "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
        await execute(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-max_alloc", "67108864", "-filter_threads", "1", "-threads", "1",
          ...sourceArgs, "-i", path, ...(trim ? ["-ss", String(options.startSeconds), "-t", String(options.durationSeconds)] : []),
          ...encoding, "-threads", "1", "-map_metadata", "-1", "-map_chapters", "-1", "-fs", String(maxOutput + 1), outputPath], settings);
        const size = (await stat(outputPath)).size;
        if (!size || size >= maxOutput) throw new Error(`Media output exceeded the ${maxOutputMiB} MiB limit; ${format === 'wav' ? 'choose MP3 or shorten the audio' : outputType === 'video' ? 'resize the video, use compact conversion quality, or trim it' : 'shorten the audio'}`);
        const data = await readFile(outputPath, { signal });
        const outputProbe = await execute(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'json', outputPath], settings);
        const outputInfo = JSON.parse(outputProbe.stdout);
        const outputDuration = Number(outputInfo.format?.duration);
        const outputVideo = outputInfo.streams?.find(stream => stream.codec_type === 'video');
        if (!Number.isFinite(outputDuration) || outputDuration <= 0 || (outputType === 'video' && !outputVideo) ||
          (outputType === 'audio' && !outputInfo.streams?.some(stream => stream.codec_type === 'audio'))) throw new Error('FFmpeg produced an invalid media file');
        if (operation === 'video.mute' && outputInfo.streams?.some(stream => stream.codec_type === 'audio')) throw new Error('FFmpeg did not remove the audio track');
        const [rateNum, rateDen] = (outputVideo?.r_frame_rate || '0/1').split('/').map(Number);
        if (outputVideo && (!Number.isSafeInteger(outputVideo.width) || !Number.isSafeInteger(outputVideo.height) || outputVideo.width < 1 || outputVideo.height < 1 ||
          outputVideo.width * outputVideo.height > 1920 * 1080 || !Number.isFinite(rateNum / rateDen) || rateNum / rateDen <= 0 || rateNum / rateDen > 60))
          throw new Error('Processed video exceeds the 1080p pixel-area or 60 fps limit; resize to smaller bounds');
        const stem = input.value.name.replace(/\.[^.]+$/, "").slice(0, 200);
        return { type: outputType, value: { name: `${stem}-processed.${format}`, source: input.value.name, data,
          mimeType: outputType === "video" ? "video/mp4" : format === "wav" ? "audio/wav" : "audio/mpeg",
          durationSeconds: outputDuration,
          ...(outputVideo ? { width: outputVideo.width, height: outputVideo.height, frameRate: rateNum / rateDen } : {}) } };
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
