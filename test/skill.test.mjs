import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { createFlowkitMcpServer } from "../src/mcp.mjs";
import { buildToolsReference } from "../scripts/pack-skill.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const skillDir = join(root, "skill/flowkit");
const read = (path) => readFile(join(skillDir, path), "utf8").then((text) => text.replace(/\r\n/g, "\n"));

async function liveTools() {
  const server = await createFlowkitMcpServer({ workspace: root, registry: { get() { throw new Error("not executed"); } } });
  const client = new Client({ name: "skill-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try { return (await client.listTools()).tools; } finally { await client.close(); await server.close(); }
}

test("skill has valid Agent Skills frontmatter", async () => {
  const skill = await read("SKILL.md");
  const match = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "SKILL.md starts with YAML frontmatter");
  const name = match[1].match(/^name: (.+)$/m)?.[1];
  const description = match[1].match(/^description: (.+)$/m)?.[1];
  assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(name.length <= 64);
  assert.ok(description && description.length >= 100 && description.length <= 1024, `description length ${description?.length}`);
  assert.ok(skill.split("\n").length < 500, "SKILL.md stays under 500 lines");
  for (const link of skill.matchAll(/\]\((references\/[^)]+)\)/g)) await read(link[1]);
});

test("skill references match the live tools and their arguments", async () => {
  const tools = await liveTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const files = ["SKILL.md", ...(await readdir(join(skillDir, "references"))).map((f) => `references/${f}`)];
  const text = (await Promise.all(files.map(read))).join("\n");
  for (const tool of tools) assert.ok(text.includes(tool.name), `skill mentions ${tool.name}`);
  for (const [name] of text.matchAll(/flowkit_[a-z_]+[a-z](?![a-z_<])/g)) assert.ok(byName.has(name), `${name} exists on the server`);
  // Every example call in the recipes uses real argument names.
  const recipes = await read("references/recipes.md");
  const calls = [...recipes.matchAll(/(flowkit_[a-z_]+)\(\{([^}]*)\}\)/g)];
  assert.ok(calls.length >= 20);
  for (const [, name, args] of calls) {
    const properties = Object.keys(byName.get(name).inputSchema.properties);
    for (const [, key] of args.matchAll(/(\w+):/g)) assert.ok(properties.includes(key), `${name} accepts ${key}`);
  }
});

test("skill tool reference is generated from the current MCP.md", async () => {
  assert.equal(await read("references/tools.md"), await buildToolsReference());
});
