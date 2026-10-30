#!/usr/bin/env node
import { parseArgs } from "node:util";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createFlowkitMcpServer } from "./src/mcp.mjs";
import { diagnoseMcp } from "./src/doctor.mjs";

try {
  const { values } = parseArgs({ options: { workspace: { type: "string" }, doctor: { type: "boolean" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" } } });
  if (values.help) {
    console.error("Usage: flowkit-mcp --workspace <directory>\n       flowkit-mcp --doctor [--workspace <directory>] [--json]\nExpose FlowKit tools over MCP stdio or verify the installation.");
  } else if (values.doctor) {
    const report = await diagnoseMcp(values.workspace);
    console.log(values.json ? JSON.stringify(report, null, 2) : [
      `FlowKit MCP ${report.version}: installed`, `Workspace: ${report.workspace}`,
      ...Object.entries(report.tools).map(([name, tool]) => `${name}: ${tool.available ? "ready" : "missing"}`),
      `Processing tools: ${report.processingReady ? "ready" : "incomplete"}`,
    ].join("\n"));
    if (!report.processingReady) process.exitCode = 1;
  } else {
    const shutdown = new AbortController();
    // Validate configuration before the first protocol request arrives.
    const server = await createFlowkitMcpServer({ workspace: values.workspace, signal: shutdown.signal });
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
