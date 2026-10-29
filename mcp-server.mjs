import { parseArgs } from "node:util";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createFlowkitMcpServer } from "./src/mcp.mjs";

try {
  const { values } = parseArgs({ options: { workspace: { type: "string" }, help: { type: "boolean", short: "h" } } });
  if (values.help) {
    console.error("Usage: node mcp-server.mjs --workspace <directory>\nExpose FlowKit tools over MCP stdio. Native tools must be installed on this machine.");
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
