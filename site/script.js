const command = `npm install --global https://github.com/ayusht9/Flowkit.git
flowkit-mcp --doctor --workspace /path/to/files`;
const button = document.querySelector("#copy-command");
button.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(command);
    button.textContent = "Copied"; button.classList.add("copied");
    window.setTimeout(() => { button.textContent = "Copy"; button.classList.remove("copied"); }, 1800);
  } catch {
    button.textContent = "Select command";
    const selection = window.getSelection(); selection.removeAllRanges();
    const range = document.createRange(); range.selectNodeContents(document.querySelector("#install-command")); selection.addRange(range);
  }
});

const clients = {
  codex: { label: "Codex CLI", command: "codex mcp add flowkit -- flowkit-mcp --workspace /path/to/files", note: "Verify with codex mcp list", docs: "https://learn.chatgpt.com/docs/extend/mcp" },
  claude: { label: "Claude Code", command: "claude mcp add --transport stdio flowkit -- flowkit-mcp --workspace /path/to/files", note: "Verify with claude mcp list", docs: "https://code.claude.com/docs/en/mcp" },
  agy: { label: "Google Antigravity (AGY)", command: `Create .agents/mcp_config.json:\n{\n  "mcpServers": {\n    "flowkit": {\n      "command": "flowkit-mcp",\n      "args": ["--workspace", "/path/to/files"]\n    }\n  }\n}`, note: "Open /mcp in AGY to inspect the connection", docs: "https://antigravity.google/docs/mcp/" },
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
  document.querySelectorAll("[data-client]").forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.client === name)));
}
document.querySelectorAll("[data-client]").forEach((tab) => tab.addEventListener("click", () => showClient(tab.dataset.client)));
clientCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(clients[activeClient].command);
    clientCopy.textContent = "Copied"; clientCopy.classList.add("copied");
    window.setTimeout(() => { clientCopy.textContent = "Copy"; clientCopy.classList.remove("copied"); }, 1800);
  } catch { clientCopy.textContent = "Select command"; }
});
showClient(activeClient);
