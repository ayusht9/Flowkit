import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export function makeWav(seconds = 2) {
  const rate = 8000;
  const samples = Math.round(seconds * rate);
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) bytes.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / rate) * 12000), 44 + index * 2);
  return bytes;
}
export const sampleAudio = makeWav();

// Trusted synthetic fixture generation, never used for uploaded files.
export async function makeVideo({ ffmpeg = process.env.FFMPEG_PATH || "ffmpeg", audio = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "flowkit-video-fixture-"));
  try {
    const path = join(directory, "sample.mp4");
    await promisify(execFile)(ffmpeg, ["-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=128x72:r=12",
      ...(audio ? ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100"] : []), "-t", "2", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p",
      ...(audio ? ["-c:a", "aac"] : []), "-movflags", "+faststart", path], { windowsHide: true, timeout: 20_000 });
    return await readFile(path);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
