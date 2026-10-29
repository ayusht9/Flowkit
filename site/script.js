const command = `git clone --depth 1 https://github.com/ayusht9/Flowkit.git flowkit-mcp
cd flowkit-mcp && npm install
npm run mcp -- --workspace /path/to/files`;
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
