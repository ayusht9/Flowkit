// Quick token summary in the terminal (no native tools needed).
// Usage: node benchmarks/mcp-token-benchmark.mjs [--json]
// For the full benchmark with execution timing, charts, and the report: npm run benchmark
import { runTokenBenchmark } from "./lib/tokens.mjs";

const report = await runTokenBenchmark();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("FlowKit MCP token benchmark (estimate: bytes / 4)\n");
  console.table(report.singles.map((s) => ({ task: s.label, "own script": s.ownTokens, "FlowKit MCP": s.mcpTokens, "saved %": s.reductionPercent })));
  console.table(report.chains.map((c) => ({ workflow: c.label, steps: c.steps, "own script": c.ownTokens, "FlowKit MCP": c.mcpTokens, "saved %": c.reductionPercent })));
  console.log(`Average saved per task: ~${report.averages.savedTokens} tokens (${report.averages.reductionPercent}%)\n\nOne-time tool list cost per session:`);
  console.table(Object.fromEntries(Object.values(report.fixedCost).map((f) => [`--tools ${f.name}`, { tools: f.tools, "fixed tokens": f.fixedTokens, "break-even tasks": f.breakEvenTasks }])));
  console.log("Session totals:");
  console.table(report.sessions.map((s) => ({ tasks: s.tasks, "own scripts": s.ownScripts, "MCP (all tools)": s.mcpAllTools, "MCP (one group)": s.mcpOneToolset })));
  console.log(Object.values(report.methodology).join("\n"));
}
