import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const execute = promisify(execFile);
export function findGhostscript() {
  if (process.env.GHOSTSCRIPT_PATH) return process.env.GHOSTSCRIPT_PATH;
  const portable = fileURLToPath(new URL('../.tools/ghostscript/bin/gswin64c.exe', import.meta.url));
  return existsSync(portable) ? portable : process.platform === 'win32' ? 'gswin64c' : 'gs';
}

export async function reducePdf(inputPath, outputPath, { directory, originalSizeBytes, options, qpdf, ghostscript = findGhostscript(), settings }) {
  const factor = options.factor ?? 2;
  const targetBytes = Math.floor(originalSizeBytes / factor);
  let best = { path: inputPath, size: originalSizeBytes, qualityUsed: 100, resolutionDpi: null, method: 'original' };
  const lossless = join(directory, 'lossless.pdf');
  await execute(qpdf, [inputPath, '--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9', lossless], settings);
  const losslessSize = (await stat(lossless)).size;
  if (losslessSize < best.size) best = { path: lossless, size: losslessSize, qualityUsed: 100, resolutionDpi: null, method: 'lossless' };
  const auto = options.autoQuality !== false;
  if (best.size > targetBytes) {
    const qualities = auto ? [90, 80, 65, 50, 35] : [options.quality ?? 80];
    for (const [index, quality] of qualities.entries()) {
      settings.signal?.throwIfAborted();
      const dpi = Math.max(50, Math.round(300 / Math.sqrt(factor) * (auto ? Math.max(0.4, 1 - index * 0.15) : 1)));
      const candidate = join(directory, `reduced-${index}.pdf`);
      const args = ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-dPDFSTOPONERROR', '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5',
        '-dAutoRotatePages=/None', '-dNumRenderingThreads=1', '-dDetectDuplicateImages=true', '-dCompressFonts=true', '-dPassThroughJPEGImages=false',
        ...['Color', 'Gray'].flatMap(type => [`-dDownsample${type}Images=true`, `-d${type}ImageDownsampleType=/Bicubic`, `-d${type}ImageResolution=${dpi}`,
          `-d${type}ImageDownsampleThreshold=1.0`, `-dAutoFilter${type}Images=false`, `-d${type}ImageFilter=/DCTEncode`]),
        `-sOutputFile=${candidate}`, '-c',
        `<< /ColorImageDict << /QFactor ${((100 - quality) / 100).toFixed(2)} >> /GrayImageDict << /QFactor ${((100 - quality) / 100).toFixed(2)} >> >> setdistillerparams`,
        '-f', inputPath];
      await execute(ghostscript, args, { ...settings, env: { ...process.env, GS_OPTIONS: '' } });
      const size = (await stat(candidate)).size;
      if (size > 0 && size < best.size) best = { path: candidate, size, qualityUsed: quality, resolutionDpi: dpi, method: 'image-recompression' };
      if (best.size <= targetBytes) break;
    }
  }
  await copyFile(best.path, outputPath);
  return { originalSizeBytes, sizeChangeBytes: best.size - originalSizeBytes, requestedFactor: factor,
    achievedFactor: originalSizeBytes / best.size, targetMet: best.size <= targetBytes, autoQuality: auto,
    qualityUsed: best.qualityUsed, resolutionDpi: best.resolutionDpi, compressionMethod: best.method };
}
