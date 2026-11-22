// Full FlowKit benchmark: token cost, workflows, retries, tool-list cost, session break-even,
// output kept out of context, real execution time for every tool, and safety-boundary checks.
//
// Usage: node benchmarks/run.mjs [--runs 3] [--tokens-only]
// Writes benchmarks/results/latest.json, docs/BENCHMARKS.md, docs/benchmarks/*.svg and site/benchmark-data.js.
import { parseArgs } from "node:util";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { runTokenBenchmark, tokens } from "./lib/tokens.mjs";
import { runLatencyBenchmark } from "./lib/latency.mjs";
import { horizontalBars, lineChart } from "./lib/charts.mjs";
import { diagnoseMcp } from "../src/doctor.mjs";
import packageInfo from "../package.json" with { type: "json" };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { runs: { type: "string", default: "3" }, "tokens-only": { type: "boolean" } } });
const runs = Math.max(1, Math.min(20, Number.parseInt(values.runs, 10) || 3));
const resultsPath = join(root, "benchmarks/results/latest.json");

const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
const ms = (n) => (n == null ? "—" : `${n < 100 ? n.toFixed(1) : Math.round(n).toLocaleString("en-US")} ms`);
const kib = (n) => (n == null ? "—" : n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 ** 2).toFixed(1)} MiB`);
const short = (name) => name.replace(/^flowkit_/, "");

console.error("FlowKit benchmark: measuring token cost…");
const tokenResults = await runTokenBenchmark();

let latency;
if (values["tokens-only"]) {
  latency = JSON.parse(await readFile(resultsPath, "utf8").catch(() => "{}")).latency;
  if (!latency) console.error("No previous execution results found; run without --tokens-only to measure tools.");
} else {
  console.error(`Running all tools over MCP stdio (${runs} run${runs > 1 ? "s" : ""} each)…`);
  latency = await runLatencyBenchmark({ runs, onProgress: (name) => console.error(`  ${short(name)}`) });
}

const doctor = await diagnoseMcp(root);
const cpu = os.cpus()[0]?.model?.trim() || "unknown CPU";
const environment = {
  date: new Date().toISOString().slice(0, 10), flowkitVersion: packageInfo.version, node: process.version,
  os: `${os.type()} ${os.release()} (${os.arch()})`, cpu: `${cpu}, ${os.cpus().length} threads`, memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
  // Keep just the version number, e.g. "ffmpeg version 9.0.2-full_build-..." → "9.0.2-full_build-www.gyan.dev".
  engines: Object.fromEntries(Object.entries(doctor.tools).map(([name, tool]) => [name, tool.available ? (tool.version.match(/\d+\.\d+[\w.-]*/)?.[0] ?? tool.version) : "not installed"])),
};

// Text outputs: what reading the full artifact would cost versus FlowKit's bounded result.
const textTools = ["flowkit_document_to_markdown", "flowkit_document_to_html", "flowkit_document_to_text", "flowkit_document_to_rst",
  "flowkit_document_to_asciidoc", "flowkit_document_to_latex"];
const context = latency ? latency.rows.filter((row) => textTools.includes(row.name) && row.ok).map((row) => ({
  tool: row.name, label: short(row.name), fullTokens: Math.ceil(row.outputBytes / 4), returnedTokens: Math.ceil(row.resultBytes / 4),
})) : [];
const binaryRows = latency ? latency.rows.filter((row) => row.ok && row.outputBytes && !textTools.includes(row.name) && row.name !== "flowkit_clean_markdown") : [];
const binaryBytes = binaryRows.reduce((sum, row) => sum + row.outputBytes, 0);

const t = tokenResults;
const passed = latency?.rows.filter((r) => r.status === "pass").length ?? 0;
const skipped = latency?.rows.filter((r) => r.status === "skipped").length ?? 0;
const failed = latency?.rows.filter((r) => r.status === "fail").length ?? 0;
const summary = {
  averageReductionPercent: t.averages.reductionPercent, averageSavedTokens: t.averages.savedTokens,
  workflowReduction: [Math.min(...t.chains.map((c) => c.reductionPercent)), Math.max(...t.chains.map((c) => c.reductionPercent))],
  allToolsFixedTokens: t.fixedCost.all.fixedTokens, oneToolsetFixedTokens: t.averages.oneToolsetFixedTokens,
  breakEvenAll: t.fixedCost.all.breakEvenTasks, breakEvenOneToolset: [Math.min(...Object.values(t.fixedCost).filter((f) => f.name !== "all").map((f) => f.breakEvenTasks)), Math.max(...Object.values(t.fixedCost).filter((f) => f.name !== "all").map((f) => f.breakEvenTasks))],
  session30: t.sessions.find((s) => s.tasks === 30),
  toolsRun: latency?.rows.length ?? 0, toolsPassed: passed, toolsSkipped: skipped, toolsFailed: failed,
  medianToolMs: latency ? [...latency.rows.filter((r) => r.ok).map((r) => r.medianMs)].sort((a, b) => a - b)[Math.floor(latency.rows.filter((r) => r.ok).length / 2)] : null,
  boundariesBlocked: latency ? `${latency.boundaries.filter((b) => b.blocked).length}/${latency.boundaries.length}` : null,
  contextReductionPercent: context.length ? Number((100 * (1 - context.reduce((s, r) => s + r.returnedTokens, 0) / context.reduce((s, r) => s + r.fullTokens, 0))).toFixed(1)) : null,
  binaryBytesKeptOut: binaryBytes,
};
const results = { generatedBy: "node benchmarks/run.mjs", environment, summary, tokens: tokenResults, context, latency };
await mkdir(dirname(resultsPath), { recursive: true });
await writeFile(resultsPath, JSON.stringify(results, null, 2) + "\n");

// ── Charts ──
const chartDir = join(root, "docs/benchmarks");
await mkdir(chartDir, { recursive: true });
const charts = {
  "tokens-per-task.svg": horizontalBars({ title: "Tokens per task: own script vs FlowKit MCP",
    subtitle: `Request + script/tool call + result, estimated as bytes ÷ 4. Average ${t.averages.reductionPercent}% fewer tokens with FlowKit.`,
    rows: t.singles.map((s) => ({ label: s.label, own: s.ownTokens, mcp: s.mcpTokens })),
    series: [["Own script", "--s1", "own"], ["FlowKit MCP", "--s2", "mcp"]] }),
  "workflows.svg": horizontalBars({ title: "Multi-step workflows",
    subtitle: "Baseline writes one combined script; FlowKit makes one call per step and chains returned paths.",
    rows: t.chains.map((c) => ({ label: `${c.label.split(":")[0]} (${c.steps} steps)`, own: c.ownTokens, mcp: c.mcpTokens })),
    series: [["Own script", "--s1", "own"], ["FlowKit MCP", "--s2", "mcp"]] }),
  "retries.svg": horizontalBars({ title: "When the first attempt fails",
    subtitle: "Average tokens per task, including one failed attempt and its error output.",
    rows: [{ label: "First try succeeds", own: t.averages.ownTokens, mcp: t.averages.mcpTokens }, { label: "One retry", own: t.averages.ownRetryTokens, mcp: t.averages.mcpRetryTokens }],
    series: [["Own script", "--s1", "own"], ["FlowKit MCP", "--s2", "mcp"]] }),
  "fixed-cost.svg": horizontalBars({ title: "One-time cost of the tool list, per session",
    subtitle: "Tool definitions + server instructions sent to the model when the server connects.",
    rows: Object.values(t.fixedCost).map((f) => ({ label: `--tools ${f.name} (${f.tools} tools)`, v: f.fixedTokens })),
    series: [["Tokens", "--s2", "v"]] }),
  "session-totals.svg": lineChart({ title: "Total tokens across a session",
    subtitle: `Own scripts vs FlowKit with all ${t.fixedCost.all.tools} tools or one tool group. Break-even: ${t.fixedCost.all.breakEvenTasks} tasks (all) · ${summary.breakEvenOneToolset.join("–")} tasks (one group).`,
    rows: t.sessions.filter((s) => ![2, 3].includes(s.tasks)), xKey: "tasks", xLabel: "Tasks in the session",
    series: [["Own scripts", "--s1", "ownScripts"], ["MCP, all tools", "--s2", "mcpAllTools"], ["MCP, one group", "--s3", "mcpOneToolset"]] }),
};
if (context.length) charts["context.svg"] = horizontalBars({ title: "Text output kept out of the model's context",
  subtitle: `Tokens to read the whole converted document vs FlowKit's bounded result (${summary.contextReductionPercent}% less).`,
  rows: context.map((c) => ({ label: c.label, full: c.fullTokens, ret: c.returnedTokens })),
  series: [["Read full output", "--s1", "full"], ["FlowKit result", "--s2", "ret"]] });
if (latency) charts["latency.svg"] = horizontalBars({ title: `Execution time for all ${latency.rows.length} tool runs`,
  subtitle: `Median of ${latency.runs} call(s) over MCP stdio with real native engines, including process start-up of each engine.`,
  rows: [...latency.rows].filter((r) => r.ok).sort((a, b) => a.medianMs - b.medianMs).map((r) => ({ label: short(r.tool), v: r.medianMs })),
  series: [["Median", "--s1", "v"]], unit: "ms" });
// The landing page is deployed from site/ alone, so it gets its own copy of the charts.
const siteChartDir = join(root, "site/assets/benchmarks");
await mkdir(siteChartDir, { recursive: true });
for (const [file, content] of Object.entries(charts)) {
  await writeFile(join(chartDir, file), content);
  await writeFile(join(siteChartDir, file), content);
}

// ── Markdown report ──
const table = (headers, rows) => [`| ${headers.join(" | ")} |`, `| ${headers.map((h, i) => (i ? "---:" : "---")).join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const img = (file, alt) => `![${alt}](benchmarks/${file})`;
const md = `# FlowKit benchmarks

> Generated by \`npm run benchmark\` on ${environment.date} with flowkit-mcp ${environment.flowkitVersion}. Re-run it to reproduce these numbers on your machine; raw data is in [\`benchmarks/results/latest.json\`](../benchmarks/results/latest.json).

## Summary

| Question | Answer |
| --- | --- |
| How many tokens does one FlowKit call save? | **${summary.averageSavedTokens} tokens per task on average (${summary.averageReductionPercent}% fewer)** across ${t.singles.length} common tasks |
| Multi-step workflows? | **${summary.workflowReduction[0]}–${summary.workflowReduction[1]}% fewer tokens**, even when the baseline writes one combined script |
| What does loading the tools cost? | **${fmt(summary.allToolsFixedTokens)} tokens once** for all ${t.fixedCost.all.tools} tools, about **${fmt(summary.oneToolsetFixedTokens)}** for one tool group (\`--tools\`) |
| When does it pay off? | After **${summary.breakEvenAll} tasks** with all tools, **${summary.breakEvenOneToolset.join("–")} tasks** with one group |
| A 30-task session? | ${fmt(summary.session30.ownScripts)} tokens with own scripts → **${fmt(summary.session30.mcpAllTools)}** (all tools) or **${fmt(summary.session30.mcpOneToolset)}** (one group) |
| Large outputs? | Converted text is returned as a bounded preview: **${summary.contextReductionPercent ?? "—"}% fewer tokens** than reading the file; **${kib(summary.binaryBytesKeptOut)}** of binary output never enters the context |
| Do all tools work? | **${summary.toolsPassed} of ${summary.toolsRun} tool runs passed**${summary.toolsSkipped ? `, ${summary.toolsSkipped} skipped (optional engine missing)` : ""}${summary.toolsFailed ? `, **${summary.toolsFailed} failed**` : ""}; median ${ms(summary.medianToolMs)} per call |
| Are unsafe inputs rejected? | **${summary.boundariesBlocked} boundary checks blocked** (path escapes, absolute paths, bad options, unknown arguments, missing files, wrong types) |

Token counts are estimated as UTF-8 bytes ÷ 4. They are a transparent approximation, not provider billing data; use your model host's usage fields for exact billed tokens.

## Run it yourself

\`\`\`sh
npm run benchmark                 # everything; writes this report, charts, JSON, and site data
npm run benchmark -- --runs 5     # more timing samples per tool
npm run benchmark -- --tokens-only  # token scenarios only (no native tools needed)
npm run benchmark:mcp             # quick token summary in the terminal
\`\`\`

## Test machine

| | |
| --- | --- |
| OS | ${environment.os} |
| CPU | ${environment.cpu} |
| Memory | ${environment.memoryGiB} GiB |
| Node.js | ${environment.node} |
${Object.entries(environment.engines).map(([name, version]) => `| ${name} | ${String(version).slice(0, 80)} |`).join("\n")}

## 1. Tokens per task

Each task compares what the agent sends and reads:

- **Own script:** the request, a compact but safe Node.js script sent through a shell tool, and the script's output. Scripts validate workspace paths and file sizes, avoid the shell, set timeouts, and refuse to overwrite files — the same guarantees FlowKit provides. They are ${Math.min(...t.singles.map((s) => s.scriptLines))}–${Math.max(...t.singles.map((s) => s.scriptLines))} lines long.
- **FlowKit MCP:** the request, one tool call, and FlowKit's JSON result.

${img("tokens-per-task.svg", "Tokens per task: own script vs FlowKit MCP")}

${table(["Task", "Tool", "Own script", "FlowKit MCP", "Saved", "Reduction"], t.singles.map((s) => [s.label, `\`${short(s.tool)}\``, fmt(s.ownTokens), fmt(s.mcpTokens), fmt(s.savedTokens), `${s.reductionPercent}%`]))}
| **Average** | | **${fmt(t.averages.ownTokens)}** | **${fmt(t.averages.mcpTokens)}** | **${fmt(t.averages.savedTokens)}** | **${t.averages.reductionPercent}%** |

DOCX → Markdown saves the least because both sides return a 1,000-character preview, which dominates the payload.

## 2. Multi-step workflows

The baseline gets the benefit of the doubt: one combined script for the whole workflow. FlowKit makes one call per step and passes each returned path to the next call.

${img("workflows.svg", "Multi-step workflows")}

${table(["Workflow", "Steps", "Own script", "FlowKit MCP", "Saved", "Reduction"], t.chains.map((c) => [c.label, c.steps, fmt(c.ownTokens), fmt(c.mcpTokens), fmt(c.savedTokens), `${c.reductionPercent}%`]))}

## 3. When the first attempt fails

A failed script costs the broken script, its stack trace, and a corrected script. A rejected FlowKit call costs a short validation error and a corrected call.

${img("retries.svg", "Tokens with one retry")}

${table(["Scenario", "Own script", "FlowKit MCP"], [["First try succeeds", fmt(t.averages.ownTokens), fmt(t.averages.mcpTokens)], ["One failed attempt, then success", fmt(t.averages.ownRetryTokens), fmt(t.averages.mcpRetryTokens)]])}

## 4. One-time cost of the tool list

MCP clients send tool definitions to the model when the server connects. This is FlowKit's overhead. Use \`--tools\` (or \`FLOWKIT_TOOLS\`) to load only the groups you need; file listing, text reading, and metadata are always included.

${img("fixed-cost.svg", "Tool list cost per tool group")}

${table(["Option", "Tools", "Tool definitions", "Instructions", "Total", "Break-even", `Break-even with ${Math.round(t.retryRate * 100)}% retries`], Object.values(t.fixedCost).map((f) => [`\`--tools ${f.name}\``, f.tools, fmt(f.schemaTokens), fmt(f.instructionTokens), `**${fmt(f.fixedTokens)}**`, `${f.breakEvenTasks} tasks`, `${f.breakEvenTasksWithRetries} tasks`]))}

Largest tool definitions:

${table(["Tool", "Tokens"], t.perTool.slice(0, 8).map((p) => [`\`${p.name}\``, fmt(p.tokens)]))}

Clients that load tool schemas on demand (deferred tool loading) pay only for the tools they use, so these totals are the worst case.

## 5. Total tokens across a session

${img("session-totals.svg", "Total tokens across a session")}

${table(["Tasks", "Own scripts", `Own scripts (${Math.round(t.retryRate * 100)}% retries)`, "MCP, all tools", "MCP, one group"], t.sessions.map((s) => [s.tasks, fmt(s.ownScripts), fmt(s.ownScriptsWithRetries), fmt(s.mcpAllTools), fmt(s.mcpOneToolset)]))}

For a one-off task, writing a script is cheaper. FlowKit wins once a session has a handful of file tasks, and the gap widens with every task after that.

## 6. Output kept out of the context
${context.length ? `
FlowKit writes artifacts to disk and returns metadata. Text conversions return at most a 1,000-character preview; the agent reads more with \`flowkit_read_text\` only when it needs to. Measured on a ${kib(latency.rows.find((r) => r.name === "flowkit_document_to_markdown")?.outputBytes)} Markdown conversion of a 36-section report:

${img("context.svg", "Text output kept out of context")}

${table(["Tool", "Output size", "Tokens to read the output", "FlowKit result tokens"], context.map((c) => [`\`${c.label}\``, kib(latency.rows.find((r) => r.name === c.tool).outputBytes), fmt(c.fullTokens), fmt(c.returnedTokens)]))}

Binary outputs (images, audio, video, PDF, Office files) are never base64-encoded into results: ${kib(binaryBytes)} of artifacts in this run were returned as paths and metadata only.` : "\nRun without `--tokens-only` to measure output sizes."}

## 7. Execution time for every tool
${latency ? `
Every tool was called over MCP stdio against generated files (a 36-section DOCX report, a 1600×1000 PNG, a 20 s WAV, a 6 s 640×360 MP4, an 8-page PDF, and an image-heavy PDF). Times include starting the native engine for each call. Server start-up and connection took ${ms(latency.startupMs)}; listing tools took ${ms(latency.listToolsMs)}.

${img("latency.svg", "Execution time per tool")}

${table(["Tool", "Group", "Engine", "Status", "Median", "Min", "Max", "Output", "Result sent to model"], latency.rows.map((r) => [`\`${short(r.tool)}\``, r.group, r.engine, r.status === "pass" ? "✅ pass" : r.status === "skipped" ? "⏭️ skipped" : "❌ fail", ms(r.medianMs), ms(r.minMs), ms(r.maxMs), r.summary || r.error || "—", kib(r.resultBytes)]))}
${skipped ? `\nSkipped runs need an optional engine that isn't installed on the test machine (see the Output column). They are not counted as failures.` : ""}

## 8. Safety boundary checks

${table(["Check", "Tool", "Blocked", "Server response"], latency.boundaries.map((b) => [b.check, `\`${short(b.tool)}\``, b.blocked ? "✅ yes" : "❌ no", b.message.replace(/\|/g, "\\|")]))}` : "\nRun without `--tokens-only` to measure execution time."}

## Methodology and limitations

${Object.values(t.methodology).map((line) => `- ${line}`).join("\n")}
- Scenario scripts and results are in [\`benchmarks/lib/scenarios.mjs\`](../benchmarks/lib/scenarios.mjs). Tool definitions are read from the live server, so they always match the current code.
- Execution times depend on hardware and engine versions; compare runs on the same machine.
- The baseline assumes the model writes a correct, safe script. Real agents often skip safety checks (shorter but riskier) or need several attempts (longer).
`;
await writeFile(join(root, "docs/BENCHMARKS.md"), md);

// ── Site data ──
const site = { generated: environment.date, environment, summary,
  singles: t.singles.map(({ label, toolset, ownTokens, mcpTokens, reductionPercent }) => ({ label, toolset, ownTokens, mcpTokens, reductionPercent })),
  chains: t.chains, fixedCost: Object.values(t.fixedCost), sessions: t.sessions, averages: t.averages, context,
  latency: latency ? { runs: latency.runs, startupMs: latency.startupMs, rows: latency.rows.map(({ tool, group, engine, status, medianMs, summary: s, error }) => ({ tool, group, engine, status, medianMs, summary: s || error })), boundaries: latency.boundaries } : null };
await writeFile(join(root, "site/benchmark-data.js"), `// Generated by npm run benchmark — do not edit by hand.\nwindow.FLOWKIT_BENCHMARK = ${JSON.stringify(site)};\n`);

console.log(`\nAverage: ${summary.averageSavedTokens} tokens saved per task (${summary.averageReductionPercent}%). Workflows: ${summary.workflowReduction.join("–")}% fewer.`);
console.log(`Tool list: ${fmt(summary.allToolsFixedTokens)} tokens (all) / ~${fmt(summary.oneToolsetFixedTokens)} (one group). Break-even: ${summary.breakEvenAll} / ${summary.breakEvenOneToolset.join("–")} tasks.`);
if (latency) console.log(`Tools: ${passed} passed, ${skipped} skipped, ${failed} failed of ${latency.rows.length}. Boundaries blocked: ${summary.boundariesBlocked}.`);
console.log("Wrote docs/BENCHMARKS.md, docs/benchmarks/*.svg, site/assets/benchmarks/*.svg, benchmarks/results/latest.json, site/benchmark-data.js");
if (failed) process.exitCode = 1;
