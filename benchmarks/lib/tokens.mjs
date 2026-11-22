import { createFlowkitMcpServer, toolsets } from "../../src/mcp.mjs";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { preamble, tasks, chains, scriptError, mcpError } from "./scenarios.mjs";

const encoder = new TextEncoder();
export const tokens = (value) => Math.ceil(encoder.encode(typeof value === "string" ? value : JSON.stringify(value)).length / 4);
const round = (value, digits = 1) => Number(value.toFixed(digits));
// How an agent hands a script to a shell tool, e.g. Bash({ command: "node --input-type=module -e '...'" }).
const shellCall = (script) => ({ command: `node --input-type=module -e '${script}'`, description: "Run the processing script" });

async function listing(tools) {
  const server = await createFlowkitMcpServer({ workspace: process.cwd(), tools, registry: { get() { throw new Error("not executed"); } } });
  const client = new Client({ name: "flowkit-benchmark", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide); await client.connect(clientSide);
  const list = await client.listTools();
  const instructions = client.getInstructions() || "";
  await client.close(); await server.close();
  return { list, instructions };
}

export async function runTokenBenchmark({ retryRate = 0.25 } = {}) {
  const all = await listing(undefined);
  const fixedCost = { all: { tools: all.list.tools.length, schemaTokens: tokens(all.list), instructionTokens: tokens(all.instructions) } };
  for (const group of toolsets) {
    const { list, instructions } = await listing(group);
    fixedCost[group] = { tools: list.tools.length, schemaTokens: tokens(list), instructionTokens: tokens(instructions) };
  }
  for (const value of Object.values(fixedCost)) value.fixedTokens = value.schemaTokens + value.instructionTokens;
  const perTool = all.list.tools.map((tool) => ({ name: tool.name, tokens: tokens(tool) })).sort((a, b) => b.tokens - a.tokens);

  const byId = Object.fromEntries(tasks.map((task) => [task.id, task]));
  const singles = tasks.map((task) => {
    const script = preamble + task.body;
    const scriptTokens = tokens(shellCall(script));
    const own = tokens(task.request) + scriptTokens + tokens(task.stdout);
    const mcp = tokens(task.request) + tokens(task.calls) + tokens(task.results);
    // One failed first attempt: the broken script, its error output, then the corrected script.
    const ownRetry = own + scriptTokens + tokens(scriptError);
    const mcpRetry = mcp + tokens(task.calls[0]) + tokens(mcpError);
    return { id: task.id, label: task.label, toolset: task.toolset, tool: task.calls[0].name,
      scriptLines: script.split("\n").length, ownTokens: own, mcpTokens: mcp, savedTokens: own - mcp,
      reductionPercent: round((1 - mcp / own) * 100), ownRetryTokens: ownRetry, mcpRetryTokens: mcpRetry };
  });

  const chainRows = chains.map((chain) => {
    const steps = chain.steps.map((id) => byId[id]);
    const script = preamble + steps.map((step) => step.body.replace(/^import .*\n/gm, "")).join("\n");
    const own = tokens(chain.request) + tokens(shellCall(script)) + tokens(steps.at(-1).stdout);
    const mcp = tokens(chain.request) + chain.calls.reduce((sum, call, i) => sum + tokens(call) + tokens(steps[i].results), 0);
    return { id: chain.id, label: chain.label, toolset: chain.toolset, steps: chain.calls.length,
      ownTokens: own, mcpTokens: mcp, savedTokens: own - mcp, reductionPercent: round((1 - mcp / own) * 100) };
  });

  const mean = (list, key) => list.reduce((sum, row) => sum + row[key], 0) / list.length;
  const perTask = { own: mean(singles, "ownTokens"), mcp: mean(singles, "mcpTokens"),
    ownRetry: mean(singles, "ownRetryTokens"), mcpRetry: mean(singles, "mcpRetryTokens") };
  const expected = { own: perTask.own + retryRate * (perTask.ownRetry - perTask.own), mcp: perTask.mcp + retryRate * (perTask.mcpRetry - perTask.mcp) };
  const groupFixed = toolsets.reduce((sum, group) => sum + fixedCost[group].fixedTokens, 0) / toolsets.length;
  const breakEven = (fixed, saved) => Math.ceil(fixed / saved);
  for (const [name, value] of Object.entries(fixedCost)) {
    value.breakEvenTasks = breakEven(value.fixedTokens, perTask.own - perTask.mcp);
    value.breakEvenTasksWithRetries = breakEven(value.fixedTokens, expected.own - expected.mcp);
    value.name = name;
  }

  const sessionSizes = [1, 2, 3, 5, 10, 15, 20, 30, 50];
  const sessions = sessionSizes.map((count) => ({
    tasks: count,
    ownScripts: Math.round(perTask.own * count),
    ownScriptsWithRetries: Math.round(expected.own * count),
    mcpAllTools: Math.round(fixedCost.all.fixedTokens + perTask.mcp * count),
    mcpOneToolset: Math.round(groupFixed + perTask.mcp * count),
  }));

  return {
    methodology: {
      tokenEstimate: "UTF-8 bytes / 4 (a transparent approximation, not provider billing data)",
      baseline: "Request + a compact, safe Node.js script sent through a shell tool + its stdout. Scripts validate workspace paths and sizes, avoid the shell, set timeouts, and refuse to overwrite.",
      mcp: "Request + FlowKit tool call(s) + FlowKit's JSON result(s), plus the once-per-session tool list and server instructions.",
      chains: "Baseline writes one combined script for the whole workflow; MCP makes one call per step.",
      retries: `A retry adds a failed first attempt: the broken script and its error output (baseline) or the rejected call and its validation error (MCP). Session totals with retries assume ${Math.round(retryRate * 100)}% of tasks need one.`,
      deferredSchemas: "Clients that load tool schemas on demand pay little of the fixed cost; the all-tools figures are the worst case.",
    },
    retryRate,
    fixedCost, perTool, singles, chains: chainRows,
    averages: { ownTokens: Math.round(perTask.own), mcpTokens: Math.round(perTask.mcp), savedTokens: Math.round(perTask.own - perTask.mcp),
      reductionPercent: round((1 - perTask.mcp / perTask.own) * 100), ownRetryTokens: Math.round(perTask.ownRetry), mcpRetryTokens: Math.round(perTask.mcpRetry),
      oneToolsetFixedTokens: Math.round(groupFixed) },
    sessions,
  };
}
