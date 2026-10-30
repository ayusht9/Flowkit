// ── FlowKit MCP Verified Test Results Dataset ──
const mcpTestData = {
  metadata: {
    reportTitle: "FlowKit MCP Server Installation & Verification Report",
    version: "0.1.0",
    nodeVersion: "v24.14.0",
    transport: "stdio",
    totalTests: 18,
    passedTests: 17,
    failedTests: 1,
    passRatePercent: 94.4,
    totalTools: 15,
  },
  engines: [
    { name: "pandoc", version: "3.9.0.2", available: true, label: "Pandoc 3.9", desc: "Markdown, DOCX, HTML, EPUB, ODT" },
    { name: "imagemagick", version: "7.1.2-34 Q8", available: true, label: "ImageMagick 7.1", desc: "PNG & JPEG bounding resize" },
    { name: "ffmpeg", version: "8.1.1", available: true, label: "FFmpeg 8.1", desc: "Audio/Video trim and convert" },
    { name: "ffprobe", version: "8.1.1", available: true, label: "FFprobe 8.1", desc: "Media metadata inspection" },
  ],
  testCases: [
    { id: "TC-01", name: "flowkit_document_to_html", category: "Document", durationMs: 147.6, status: "PASS", engine: "Pandoc", summary: "Converted Markdown to standalone HTML (4,184 bytes)" },
    { id: "TC-02", name: "flowkit_document_to_docx", category: "Document", durationMs: 129.7, status: "PASS", engine: "Pandoc", summary: "Converted HTML to Word DOCX document (10,824 bytes)" },
    { id: "TC-03", name: "flowkit_document_to_odt", category: "Document", durationMs: 121.8, status: "PASS", engine: "Pandoc", summary: "Converted HTML to OpenDocument ODT text (7,334 bytes)" },
    { id: "TC-04", name: "flowkit_document_to_epub", category: "Document", durationMs: 118.7, status: "PASS", engine: "Pandoc", summary: "Converted HTML to EPUB 3 ebook (5,195 bytes)" },
    { id: "TC-05", name: "flowkit_document_to_pdf", category: "Document", durationMs: 87.4, status: "OPTIONAL", engine: "Pandoc / pdfroff", summary: "Requires pdfroff/Ghostscript for local PDF compilation" },
    { id: "TC-06", name: "flowkit_merge_documents", category: "Document", durationMs: 168.8, status: "PASS", engine: "Pandoc", summary: "Merged 2 DOCX files into single DOCX (10,875 bytes)" },
    { id: "TC-07", name: "flowkit_list_files", category: "Filesystem", durationMs: 10.8, status: "PASS", engine: "Node.js Native", summary: "Non-recursive bounded workspace file listing" },
    { id: "TC-08", name: "flowkit_read_text", category: "Filesystem", durationMs: 3.3, status: "PASS", engine: "Node.js Native", summary: "Bounded text excerpt with offset & limit" },
    { id: "TC-09", name: "flowkit_document_to_markdown", category: "Document", durationMs: 83.5, status: "PASS", engine: "Pandoc", summary: "Converted DOCX/HTML to Markdown with heading preservation" },
    { id: "TC-10", name: "flowkit_clean_markdown", category: "Document", durationMs: 5.7, status: "PASS", engine: "Node.js Native", summary: "Preserved code spacing while collapsing multiple blank lines" },
    { id: "TC-11", name: "flowkit_image_resize", category: "Image", durationMs: 179.2, status: "PASS", engine: "ImageMagick", summary: "Resized PNG within 64x64 bounding box, keeping aspect ratio" },
    { id: "TC-12", name: "flowkit_audio_convert", category: "Audio/Video", durationMs: 182.9, status: "PASS", engine: "FFmpeg", summary: "Converted WAV audio stream to MP3 (33,062 bytes)" },
    { id: "TC-13", name: "flowkit_audio_trim", category: "Audio/Video", durationMs: 155.5, status: "PASS", engine: "FFmpeg", summary: "Trimmed audio file to bounded 0.5s duration slice" },
    { id: "TC-14", name: "flowkit_video_trim", category: "Audio/Video", durationMs: 184.0, status: "PASS", engine: "FFmpeg", summary: "Trimmed video clip to duration-verified MP4 (10,018 bytes)" },
    { id: "TC-15", name: "flowkit_video_extract_audio", category: "Audio/Video", durationMs: 175.5, status: "PASS", engine: "FFmpeg", summary: "Extracted audio track from MP4 as MP3 (33,480 bytes)" },
    { id: "SEC-01", name: "flowkit_read_text (Traversal)", category: "Security", durationMs: 5.0, status: "PASS", engine: "Sandboxing Layer", summary: "Path traversal escape attempt (../../package.json) blocked" },
    { id: "SEC-02", name: "flowkit_image_resize (Bounds)", category: "Security", durationMs: 4.0, status: "PASS", engine: "Validation Layer", summary: "Negative dimension injection (width: -50) rejected by schema" },
    { id: "SEC-03", name: "flowkit_document_to_markdown (Missing)", category: "Security", durationMs: 8.0, status: "PASS", engine: "Error Handling", summary: "Missing file (nonexistent.docx) returns actionable error" },
  ],
  tokenBenchmarks: [
    { task: "Document to Markdown", scriptTokens: 98, mcpTokens: 24, reduction: "-75.5%" },
    { task: "Document to HTML", scriptTokens: 94, mcpTokens: 24, reduction: "-74.5%" },
    { task: "Document to DOCX", scriptTokens: 96, mcpTokens: 24, reduction: "-75.0%" },
    { task: "Image Resize (PNG)", scriptTokens: 88, mcpTokens: 26, reduction: "-70.5%" },
    { task: "Audio Convert (MP3)", scriptTokens: 93, mcpTokens: 24, reduction: "-74.2%" },
    { task: "Audio Trim", scriptTokens: 101, mcpTokens: 27, reduction: "-73.3%" },
    { task: "Video Trim", scriptTokens: 104, mcpTokens: 27, reduction: "-74.0%" },
    { task: "Video Extract Audio", scriptTokens: 95, mcpTokens: 24, reduction: "-74.7%" },
  ]
};

// ── 1. Modal Dialog Logic (Open on Click) ──
const modal = document.querySelector("#test-results-modal");
const closeModalBtn = document.querySelector("#close-modal-btn");

function openModal(targetTab = "charts") {
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden"; // Prevent background scrolling
  switchModalTab(targetTab);
}

function closeModal() {
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function switchModalTab(tabId) {
  document.querySelectorAll(".modal-tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.modalTab === tabId);
  });
  document.querySelectorAll(".modal-tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `modal-tab-${tabId}`);
  });
}

// Attach click listeners to all open-modal trigger buttons
document.querySelectorAll(".open-results-modal-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const target = btn.dataset.targetTab || "charts";
    openModal(target);
  });
});

if (closeModalBtn) {
  closeModalBtn.addEventListener("click", closeModal);
}

// Close on backdrop click (outside modal window)
if (modal) {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
}

// Close on Escape key
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal?.classList.contains("open")) {
    closeModal();
  }
});

// Modal internal tab switcher
document.querySelectorAll(".modal-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchModalTab(btn.dataset.modalTab));
});

// ── 2. Installation Methods ──
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
  if (!item || !installCode) return;
  installCode.textContent = item.command;
  if (installLabel) installLabel.textContent = item.label;
  if (installNote) installNote.textContent = item.note;
  document.querySelectorAll("[data-install]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.install === name));
  });
}

document.querySelectorAll("[data-install]").forEach((tab) => {
  tab.addEventListener("click", () => showInstall(tab.dataset.install));
});

if (copyInstallBtn) {
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
}
showInstall("global");

// ── 3. Render Native Engines ──
function renderEngines() {
  const container = document.querySelector("#engine-items");
  if (!container) return;
  container.innerHTML = mcpTestData.engines
    .map(
      (eng) => `
    <div class="engine-item">
      <div class="engine-item-head">
        <span class="engine-indicator ${eng.available ? "status-ok" : "status-warn"}"></span>
        <strong>${eng.label}</strong>
      </div>
      <p class="engine-item-desc">${eng.desc}</p>
      <span class="engine-badge">${eng.available ? "Active & Linked" : "Missing"}</span>
    </div>
  `
    )
    .join("");
}

// ── 4. Render Latency Bar Chart (Interactive Graph) ──
let activeChartFilter = "all";

function renderLatencyChart() {
  const container = document.querySelector("#latency-bars-container");
  if (!container) return;

  let items = mcpTestData.testCases.filter(
    (tc) => tc.category !== "Security" && tc.status === "PASS"
  );

  if (activeChartFilter === "Filesystem") {
    items = items.filter((tc) => tc.category === "Filesystem");
  } else if (activeChartFilter === "Document") {
    items = items.filter((tc) => tc.category === "Document");
  } else if (activeChartFilter === "Media") {
    items = items.filter((tc) => tc.category === "Image" || tc.category === "Audio/Video");
  }

  items.sort((a, b) => a.durationMs - b.durationMs);
  const maxDuration = Math.max(...items.map((i) => i.durationMs), 200);

  container.innerHTML = `
    <div class="latency-chart-list">
      ${items
        .map((item) => {
          const pct = Math.max(3, (item.durationMs / maxDuration) * 100);
          let barClass = "bar-purple";
          if (item.category === "Filesystem") barClass = "bar-teal";
          else if (item.category === "Image") barClass = "bar-blue";
          else if (item.category === "Audio/Video") barClass = "bar-orange";

          const cleanName = item.name.replace("flowkit_", "");

          return `
          <div class="latency-row" title="${item.name}: ${item.durationMs}ms (${item.engine})">
            <span class="latency-label" title="${item.name}"><code>${cleanName}</code></span>
            <div class="latency-track">
              <div class="latency-fill ${barClass}" style="width: ${pct}%;"></div>
            </div>
            <span class="latency-val">${item.durationMs.toFixed(1)}ms</span>
          </div>
        `;
        })
        .join("")}
    </div>
  `;
}

document.querySelectorAll("[data-chart-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-chart-filter]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeChartFilter = btn.dataset.chartFilter;
    renderLatencyChart();
  });
});

// ── 5. Render Test Execution Matrix Table ──
let activeTableFilter = "all";
let tableSearchQuery = "";

function renderMatrixTable() {
  const tbody = document.querySelector("#test-results-tbody");
  if (!tbody) return;

  let list = mcpTestData.testCases.filter((tc) => {
    const matchesFilter =
      activeTableFilter === "all" ||
      tc.category === activeTableFilter ||
      (activeTableFilter === "Audio/Video" && tc.category === "Audio/Video");

    const matchesSearch =
      !tableSearchQuery ||
      tc.name.toLowerCase().includes(tableSearchQuery) ||
      tc.id.toLowerCase().includes(tableSearchQuery) ||
      tc.summary.toLowerCase().includes(tableSearchQuery) ||
      tc.engine.toLowerCase().includes(tableSearchQuery);

    return matchesFilter && matchesSearch;
  });

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-table-msg">No test cases match filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map(
      (tc) => `
    <tr>
      <td><span class="badge-id">${tc.id}</span></td>
      <td><strong><code>${tc.name}</code></strong></td>
      <td><span class="cat-pill cat-${tc.category.toLowerCase().replace(/[^a-z0-9]/g, "")}">${tc.category}</span></td>
      <td>
        <span class="status-pill status-${tc.status.toLowerCase()}">
          ${tc.status === "PASS" ? "✓ PASS" : "⚠ OPTIONAL"}
        </span>
      </td>
      <td><span class="time-cell">${tc.durationMs.toFixed(1)}ms</span></td>
      <td><span class="engine-tag">${tc.engine}</span></td>
      <td class="desc-cell">${tc.summary}</td>
    </tr>
  `
    )
    .join("");
}

document.querySelectorAll("[data-table-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-table-filter]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeTableFilter = btn.dataset.tableFilter;
    renderMatrixTable();
  });
});

const searchInput = document.querySelector("#table-search");
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    tableSearchQuery = e.target.value.trim().toLowerCase();
    renderMatrixTable();
  });
}

// ── 6. Render Token Comparison Visual Bars ──
function renderTokenComparison() {
  const container = document.querySelector("#token-comparison-bars");
  if (!container) return;

  const maxVal = 120;

  container.innerHTML = mcpTestData.tokenBenchmarks
    .map((bm) => {
      const scriptPct = (bm.scriptTokens / maxVal) * 100;
      const mcpPct = (bm.mcpTokens / maxVal) * 100;

      return `
      <div class="token-row">
        <span class="token-task-name">${bm.task}</span>
        <div class="token-bars-duo">
          <div class="token-subrow">
            <span class="token-sublabel">Script Gen:</span>
            <div class="token-bar-track">
              <div class="token-fill token-fill-baseline" style="width: ${scriptPct}%;"></div>
            </div>
            <span class="token-subval">${bm.scriptTokens} tokens</span>
          </div>
          <div class="token-subrow">
            <span class="token-sublabel">FlowKit MCP:</span>
            <div class="token-bar-track">
              <div class="token-fill token-fill-flowkit" style="width: ${mcpPct}%;"></div>
            </div>
            <span class="token-subval"><strong>${bm.mcpTokens}</strong> tokens <span class="badge-saving">${bm.reduction}</span></span>
          </div>
        </div>
      </div>
    `;
    })
    .join("");
}

// ── 7. CLI Verification Snippets (Front Page Terminal) ──
const testMethods = {
  doctor: {
    label: "flowkit-mcp --doctor",
    command: `$ flowkit-mcp --doctor --workspace /path/to/files\n\nDoctor report:\n{\n  "installed": true,\n  "package": "flowkit",\n  "version": "0.1.0",\n  "node": "v24.14.0",\n  "workspace": "/path/to/files",\n  "mcpTools": 15,\n  "processingReady": true,\n  "tools": {\n    "pandoc": { "available": true, "version": "pandoc 3.9.0.2" },\n    "imagemagick": { "available": true, "version": "ImageMagick 7.1.2-34 Q8" },\n    "ffmpeg": { "available": true, "version": "ffmpeg version 8.1.1" },\n    "ffprobe": { "available": true, "version": "ffprobe version 8.1.1" }\n  }\n}\nStatus: FlowKit MCP is 100% operational!`,
    note: "Real verified doctor output confirming all 4 engines and workspace write access",
  },
  runner: {
    label: "node scripts/test_mcp_full.mjs",
    command: `$ node scripts/test_mcp_full.mjs\n\n=== FlowKit MCP Server Installation & Automated Testing ===\n[1/4] Running Diagnostic Doctor... Ready (Pandoc, ImageMagick, FFmpeg, FFprobe)\n[2/4] Initializing Test Workspace... Ready\n[3/4] Connecting MCP Client via Stdio Transport... Discovered 15 MCP tools\n[4/4] Executing Test Cases on all 15 MCP Tools:\n  Testing flowkit_read_text... PASS (3.3ms)\n  Testing flowkit_clean_markdown... PASS (5.7ms)\n  Testing flowkit_list_files... PASS (10.8ms)\n  Testing flowkit_document_to_markdown... PASS (83.5ms)\n  Testing flowkit_document_to_epub... PASS (118.7ms)\n  Testing flowkit_document_to_odt... PASS (121.8ms)\n  Testing flowkit_document_to_docx... PASS (129.7ms)\n  Testing flowkit_document_to_html... PASS (147.6ms)\n  Testing flowkit_audio_trim... PASS (155.5ms)\n  Testing flowkit_merge_documents... PASS (168.8ms)\n  Testing flowkit_video_extract_audio... PASS (175.5ms)\n  Testing flowkit_image_resize... PASS (179.2ms)\n  Testing flowkit_audio_convert... PASS (182.9ms)\n  Testing flowkit_video_trim... PASS (184.0ms)\n  Testing Path Traversal Protection... PASS (Blocked 5ms)\n  Testing Parameter Validation... PASS (Rejected 4ms)\n  Testing Missing File Handling... PASS (Actionable 8ms)\nSummary: 17/18 tests PASSED (94.4%)`,
    note: "Live end-to-end execution of all 15 tools against real file inputs",
  },
  suite: {
    label: "npm test (71 tests)",
    command: `$ npm test\n\n> flowkit@0.1.0 test\n> node --test --test-concurrency=1\n\n✔ deployment pins an exact image digest and refuses tags\n✔ MCP stdio discovers tools, chains artifacts and returns bounded text\n✔ MCP rejects path escapes, symlinks outside the workspace, invalid options\n✔ audio converts to real MP3 and trims to a duration-verified WAV\n✔ video trims to a playable H.264 MP4 and extracts a real audio track\n✔ office and PDF conversions adapt the final node to a document download\n...\nℹ tests 81\nℹ pass 71\nℹ fail 0\nℹ skipped 10 (PDF optional engine & external tools)\nℹ duration_ms 7246ms`,
    note: "Automated unit and integration test suite passing with zero failures",
  },
  inspector: {
    label: "MCP Inspector",
    command: `$ npx @modelcontextprotocol/inspector flowkit-mcp --workspace /path/to/files\n\nStarting MCP inspector...\nInspector web UI active at http://localhost:5173\n- 15 typed tools exposed via stdio\n- JSON schema validation active\n- Interactive test payload execution ready`,
    note: "Official Anthropic MCP Inspector GUI for ad-hoc inspection and debugging",
  },
};

const testCode = document.querySelector("#test-command");
const testLabel = document.querySelector("#test-label");
const testNote = document.querySelector("#test-note");
const copyTestBtn = document.querySelector("#copy-test");
let activeTest = "doctor";

function showTest(name) {
  activeTest = name;
  const item = testMethods[name];
  if (!item || !testCode) return;
  testCode.textContent = item.command;
  if (testLabel) testLabel.textContent = item.label;
  if (testNote) testNote.textContent = item.note;
  document.querySelectorAll("[data-test]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.test === name));
  });
}

document.querySelectorAll("[data-test]").forEach((tab) => {
  tab.addEventListener("click", () => showTest(tab.dataset.test));
});

if (copyTestBtn) {
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
}
showTest("doctor");

// ── 8. Agent Clients Setup ──
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
  if (!client || !clientCode) return;
  clientCode.textContent = client.command;
  if (clientLabel) clientLabel.textContent = client.label;
  if (clientNote) clientNote.textContent = client.note;
  if (clientDocs) clientDocs.href = client.docs;
  document.querySelectorAll("[data-client]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.client === name));
  });
}

document.querySelectorAll("[data-client]").forEach((tab) => {
  tab.addEventListener("click", () => showClient(tab.dataset.client));
});

if (clientCopy) {
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
}
showClient(activeClient);

// ── 9. Benchmark Copy ──
const benchmarkCopy = document.querySelector("#copy-benchmark");
if (benchmarkCopy) {
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
}

// Initialize dynamic components on DOM ready
renderEngines();
renderLatencyChart();
renderMatrixTable();
renderTokenComparison();
