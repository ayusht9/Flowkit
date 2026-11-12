import { spawnSync } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { findPandoc } from "./server.mjs";
import { findImageMagick } from "./image.mjs";
import { imageOperations } from './image-operations.mjs';
import { documentConversions } from './document-formats.mjs';
import { mediaOperations } from './media-operations.mjs';
import packageInfo from '../package.json' with { type: 'json' };
import { nativeToolRecommendations } from './setup.mjs';

function check(command, argument = "--version") {
  const run = spawnSync(command, [argument], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  const text = `${run.stdout || ""}\n${run.stderr || ""}`.trim().split(/\r?\n/)[0];
  return { command, available: run.status === 0, version: run.status === 0 ? text : undefined };
}

export async function diagnoseMcp(workspace) {
  const root = await realpath(resolve(workspace || process.cwd()));
  if (!(await stat(root)).isDirectory()) throw new TypeError("Workspace must be a directory");
  const pandoc = await findPandoc();
  const tools = {
    pandoc: check(pandoc),
    imagemagick: check(findImageMagick()),
    ffmpeg: check(process.env.FFMPEG_PATH || "ffmpeg", "-version"),
    ffprobe: check(process.env.FFPROBE_PATH || "ffprobe", "-version"),
    qpdf: check(process.env.QPDF_PATH || 'qpdf'),
  };
  for (const [name, tool] of Object.entries(tools)) {
    tool.recommendation = nativeToolRecommendations[name];
  }
  return {
    installed: true,
    package: "flowkit-mcp",
    version: packageInfo.version,
    node: process.version,
    workspace: root,
    mcpTools: 8 + mediaOperations.length + imageOperations.length + documentConversions.length,
    processingReady: Object.values(tools).every((tool) => tool.available),
    tools,
  };
}
