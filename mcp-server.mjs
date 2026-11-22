#!/usr/bin/env node
import { parseArgs } from "node:util";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createFlowkitMcpServer } from "./src/mcp.mjs";
import { diagnoseMcp } from "./src/doctor.mjs";
import { setupGuidance } from './src/setup.mjs';

try {
  const { values } = parseArgs({ options: { workspace: { type: "string" }, tools: { type: "string" }, doctor: { type: "boolean" }, setup: { type: "boolean" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" } } });
  if (values.help) {
    console.error("Usage: flowkit-mcp --workspace <directory> [--tools all|document,pdf,image,audio,video]\n       flowkit-mcp --doctor [--workspace <directory>] [--json]\n       flowkit-mcp --setup\nExpose FlowKit tools over MCP stdio or verify the installation.\n--tools (or FLOWKIT_TOOLS) limits the advertised tool groups to save model context;\nfile listing, text reading and metadata are always included.");
  } else if (values.setup) {
    console.log(setupGuidance());
  } else if (values.doctor) {
    const report = await diagnoseMcp(values.workspace);
    console.log(values.json ? JSON.stringify(report, null, 2) : [
      `FlowKit MCP ${report.version}: installed`, `Workspace: ${report.workspace}`,
      ...Object.entries(report.tools).map(([name, tool]) => `${name}: ${tool.available ? `ready - ${tool.version}` : "missing"}`),
      `Processing tools: ${report.processingReady ? "ready" : "incomplete"}`,
      '', setupGuidance(),
    ].join("\n"));
    if (!report.processingReady) process.exitCode = 1;
  } else {
    const shutdown = new AbortController();
    // Validate configuration before the first protocol request arrives.
    const server = await createFlowkitMcpServer({ workspace: values.workspace, tools: values.tools ?? process.env.FLOWKIT_TOOLS, signal: shutdown.signal });
    const handle = serveStdio(() => server, {
      transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 64 * 1024 }),
      onerror: (error) => console.error("FlowKit MCP:", error.message),
    });
    const close = () => { shutdown.abort(); void handle.close(); };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  }
} catch (error) {
  console.error("FlowKit MCP:", error.message);
  process.exitCode = 1;
}
