// ── 1. Installation Methods ──
const installMethods = {
  global: {
    label: "Global npm install",
    command: `# Install the FlowKit MCP CLI globally from GitHub\nnpm install --global https://github.com/ayusht9/Flowkit.git\n\n# Run with your workspace directory\nflowkit-mcp --workspace /path/to/files`,
    note: "Installs flowkit-mcp binary into your global PATH",
  },
  npx: {
    label: "npx on-demand execution",
    command: `# Run FlowKit MCP directly on demand without global install\nnpx -y https://github.com/ayusht9/Flowkit.git flowkit-mcp --workspace /path/to/files`,
    note: "Runs with Node.js 22.12+ and NPX cache",
  },
  source: {
    label: "Clone and run from source",
    command: `# 1. Clone the repository\ngit clone https://github.com/ayusht9/Flowkit.git\ncd Flowkit\n\n# 2. Install dependencies & launch stdio server\nnpm install\nnode mcp-server.mjs --workspace /path/to/files`,
    note: "Ideal for local development, custom tools, and testing",
  },
};

const installCode = document.querySelector("#install-command");
const installLabel = document.querySelector("#install-label");
const installNote = document.querySelector("#install-note");
const copyInstallBtn = document.querySelector("#copy-install");
let activeInstall = "global";

function showInstall(name) {
  activeInstall = name;
  const item = installMethods[name];
  if (!item) return;
  installCode.textContent = item.command;
  installLabel.textContent = item.label;
  installNote.textContent = item.note;
  document.querySelectorAll("[data-install]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.install === name));
  });
}

document.querySelectorAll("[data-install]").forEach((tab) => {
  tab.addEventListener("click", () => showInstall(tab.dataset.install));
});

copyInstallBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(installMethods[activeInstall].command);
    copyInstallBtn.textContent = "Copied";
    copyInstallBtn.classList.add("copied");
    setTimeout(() => {
      copyInstallBtn.textContent = "Copy";
      copyInstallBtn.classList.remove("copied");
    }, 1800);
  } catch {
    copyInstallBtn.textContent = "Select command";
  }
});
showInstall("global");

// ── 2. Testing & Diagnostics ──
const testMethods = {
  doctor: {
    label: "Diagnostic Health Check Doctor",
    command: `# Run the built-in diagnostic doctor\nflowkit-mcp --doctor --workspace /path/to/files\n\n# Diagnostic Report:\nFlowKit MCP 0.1.0: installed\nWorkspace: /path/to/files (read/write verified)\npandoc: ready (DOCX, HTML, EPUB -> Markdown)\nimagemagick: ready (PNG, JPEG resize)\nffmpeg: ready (audio/video processing)\nffprobe: ready (media metadata inspection)\n15 MCP tools registered\nProcessing tools: ready`,
    note: "Checks Node runtime, workspace directory, and all 4 native processors",
    canSimulate: true,
  },
  inspector: {
    label: "MCP Inspector (Official Web GUI)",
    command: `# Launch the official Model Context Protocol Inspector\nnpx @modelcontextprotocol/inspector flowkit-mcp --workspace /path/to/files\n\n# Interactive GUI starts at http://localhost:5173\n# - Inspect 15 live tool schemas & input constraints\n# - Execute manual tool requests with custom JSON arguments\n# - Review structured output envelopes & latency`,
    note: "Official interactive web inspector for debugging MCP servers",
    canSimulate: false,
  },
  suite: {
    label: "Full Automated Test Suite",
    command: `# Run all 71 unit and MCP transport tests\nnpm test\n\n# Test verification highlights:\n# ✔ MCP stdio discovers tools, chains artifacts and returns bounded text\n# ✔ MCP rejects path escapes, symlinks outside workspace, invalid options\n# ✔ MCP forwards cancellation to executor and rejects overlapping operations\n# ✔ MCP doctor CLI verifies dependencies\n# 71 passed`,
    note: "Validates sanitization, path security, and stdout isolation",
    canSimulate: false,
  },
  sample: {
    label: "Sample Tool Call & Response",
    command: `// Agent invokes tool via MCP stdio:\ncallTool("flowkit_document_to_markdown", {\n  "inputPath": "project_report.docx"\n})\n\n// FlowKit MCP returns structured artifact preview:\n{\n  "path": ".flowkit-artifacts/run-a9c2b/project_report.md",\n  "preview": "# FlowKit Project Report\\n\\nExecutive summary...",\n  "previewTruncated": false,\n  "size": 1840,\n  "format": "markdown"\n}`,
    note: "Agents receive bounded text previews and safe relative artifact paths",
    canSimulate: false,
  },
};

const testCode = document.querySelector("#test-command");
const testLabel = document.querySelector("#test-label");
const testNote = document.querySelector("#test-note");
const copyTestBtn = document.querySelector("#copy-test");
const runDoctorBtn = document.querySelector("#run-doctor-btn");
let activeTest = "doctor";

function showTest(name) {
  activeTest = name;
  const item = testMethods[name];
  if (!item) return;
  testCode.textContent = item.command;
  testLabel.textContent = item.label;
  testNote.textContent = item.note;
  runDoctorBtn.style.display = item.canSimulate ? "inline-block" : "none";
  document.querySelectorAll("[data-test]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.test === name));
  });
}

document.querySelectorAll("[data-test]").forEach((tab) => {
  tab.addEventListener("click", () => showTest(tab.dataset.test));
});

copyTestBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(testMethods[activeTest].command);
    copyTestBtn.textContent = "Copied";
    copyTestBtn.classList.add("copied");
    setTimeout(() => {
      copyTestBtn.textContent = "Copy";
      copyTestBtn.classList.remove("copied");
    }, 1800);
  } catch {
    copyTestBtn.textContent = "Select command";
  }
});

// Interactive Doctor Simulation
let simulationTimer = null;
runDoctorBtn.addEventListener("click", () => {
  if (simulationTimer) clearInterval(simulationTimer);
  runDoctorBtn.textContent = "Running...";
  runDoctorBtn.disabled = true;

  const lines = [
    "$ flowkit-mcp --doctor --workspace /path/to/files",
    "→ Verifying Node.js runtime... v22.14.0 (OK)",
    "→ Checking workspace directory permissions... Read/Write (OK)",
    "→ Discovering native processing engines:",
    "  ✓ pandoc 3.9 (Markdown, DOCX, HTML, EPUB -> ready)",
    "  ✓ imagemagick 7.1 (PNG, JPEG resize -> ready)",
    "  ✓ ffmpeg 8.1 (Audio & Video trim/convert -> ready)",
    "  ✓ ffprobe 8.1 (Media metadata analyzer -> ready)",
    "→ Inspecting MCP Schema Registry:",
    "  ✓ 15/15 typed tools registered and validated",
    "==================================================",
    "FlowKit MCP 0.1.0: INSTALLED & 100% OPERATIONAL",
    "Status: Processing tools ready for AI coding agents!"
  ];

  let currentIndex = 0;
  testCode.textContent = "";

  simulationTimer = setInterval(() => {
    if (currentIndex < lines.length) {
      testCode.textContent += (currentIndex > 0 ? "\n" : "") + lines[currentIndex];
      currentIndex++;
    } else {
      clearInterval(simulationTimer);
      simulationTimer = null;
      runDoctorBtn.textContent = "✔ Verified";
      setTimeout(() => {
        runDoctorBtn.textContent = "▶ Run Simulation";
        runDoctorBtn.disabled = false;
      }, 3000);
    }
  }, 160);
});

showTest("doctor");

// ── 3. Agent Clients ──
const clients = {
  codex: {
    label: "Codex CLI",
    command: "codex mcp add flowkit -- flowkit-mcp --workspace /path/to/files",
    note: "Verify with codex mcp list",
    docs: "https://learn.chatgpt.com/docs/extend/mcp",
  },
  claude: {
    label: "Claude Code",
    command: "claude mcp add --transport stdio flowkit -- flowkit-mcp --workspace /path/to/files",
    note: "Verify with claude mcp list",
    docs: "https://code.claude.com/docs/en/mcp",
  },
  agy: {
    label: "Google Antigravity (AGY)",
    command: `Create .agents/mcp_config.json:\n{\n  "mcpServers": {\n    "flowkit": {\n      "command": "flowkit-mcp",\n      "args": ["--workspace", "/path/to/files"]\n    }\n  }\n}`,
    note: "Open /mcp in AGY to inspect the connection",
    docs: "https://antigravity.google/docs/mcp/",
  },
};

const clientCode = document.querySelector("#client-command code");
const clientLabel = document.querySelector("#client-label");
const clientNote = document.querySelector("#client-note");
const clientDocs = document.querySelector("#client-docs");
const clientCopy = document.querySelector("#copy-client");
let activeClient = "codex";

function showClient(name) {
  activeClient = name;
  const client = clients[name];
  clientCode.textContent = client.command;
  clientLabel.textContent = client.label;
  clientNote.textContent = client.note;
  clientDocs.href = client.docs;
  document.querySelectorAll("[data-client]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.client === name));
  });
}

document.querySelectorAll("[data-client]").forEach((tab) => {
  tab.addEventListener("click", () => showClient(tab.dataset.client));
});

clientCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(clients[activeClient].command);
    clientCopy.textContent = "Copied";
    clientCopy.classList.add("copied");
    setTimeout(() => {
      clientCopy.textContent = "Copy";
      clientCopy.classList.remove("copied");
    }, 1800);
  } catch {
    clientCopy.textContent = "Select command";
  }
});
showClient(activeClient);

// ── 4. Benchmark Copy ──
const benchmarkCopy = document.querySelector("#copy-benchmark");
benchmarkCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("npm run benchmark:mcp");
    benchmarkCopy.textContent = "Copied";
    benchmarkCopy.classList.add("copied");
    setTimeout(() => {
      benchmarkCopy.textContent = "Copy";
      benchmarkCopy.classList.remove("copied");
    }, 1800);
  } catch {
    benchmarkCopy.textContent = "Select command";
  }
});
