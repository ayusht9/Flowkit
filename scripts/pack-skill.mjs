// Builds the FlowKit agent skill: regenerates references/tools.md from MCP.md and writes
// dist/flowkit-skill-<version>.zip with SKILL.md at the archive root (Agensi and Agent Skills format).
// Usage: npm run skill:pack [-- --check]   (--check fails if references/tools.md is out of date)
import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import { join, resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, crc32 } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = join(root, "skill/flowkit");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

export async function buildToolsReference() {
  const mcp = (await readFile(join(root, "MCP.md"), "utf8")).replace(/\r\n/g, "\n");
  const start = mcp.indexOf("## Tools\n");
  const end = mcp.indexOf("\n## Example agent flow");
  if (start < 0 || end < 0) throw new Error("MCP.md is missing the Tools section");
  const body = mcp.slice(start + "## Tools\n".length, end).trim()
    // Repository-relative links don't resolve inside the skill; point them at GitHub.
    .replace(/\]\((?!https?:|#)([^)]+)\)/g, "](https://github.com/ayusht9/Flowkit/blob/main/$1)");
  return `# FlowKit tool reference\n\n<!-- Generated from MCP.md by npm run skill:pack. Edit MCP.md, not this file. -->\n\nAll tool names start with \`flowkit_\`. Paths are relative to the workspace.\n\n${body}\n`;
}

// Minimal ZIP writer (deflate), enough for a small text-only skill archive.
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  const time = 0, date = ((2026 - 1980) << 9) | (1 << 5) | 1; // fixed timestamp for reproducible archives
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8"), compressed = deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(0o100644 * 0x10000, 38); central.writeUInt32LE(offset, 42); // external attrs: -rw-r--r--
    locals.push(local, nameBytes, compressed); centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

async function files(directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await files(path)); else out.push(path);
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reference = await buildToolsReference();
  const referencePath = join(skillDir, "references/tools.md");
  const current = await readFile(referencePath, "utf8").catch(() => "");
  if (process.argv.includes("--check")) {
    if (current.replace(/\r\n/g, "\n") !== reference) { console.error("skill/flowkit/references/tools.md is out of date. Run: npm run skill:pack"); process.exit(1); }
    console.log("Skill tool reference is up to date.");
    process.exit(0);
  }
  await writeFile(referencePath, reference);

  // Keep the skill's version in step with the package.
  const skillPath = join(skillDir, "SKILL.md");
  const skill = (await readFile(skillPath, "utf8")).replace(/version: "[^"]*"/, `version: "${version}"`);
  await writeFile(skillPath, skill);

  const entries = [];
  for (const path of (await files(skillDir)).sort()) {
    entries.push({ name: relative(skillDir, path).split(sep).join("/"), data: Buffer.from((await readFile(path, "utf8")).replace(/\r\n/g, "\n")) });
  }
  entries.push({ name: "LICENSE", data: Buffer.from((await readFile(join(root, "LICENSE"), "utf8")).replace(/\r\n/g, "\n")) });
  await mkdir(join(root, "dist"), { recursive: true });
  const target = join(root, `dist/flowkit-skill-${version}.zip`);
  await writeFile(target, zip(entries));
  console.log(`Wrote ${relative(root, target)} (${((await stat(target)).size / 1024).toFixed(1)} KiB):`);
  for (const entry of entries) console.log(`  ${entry.name}`);
}
