# Setting up FlowKit

Walk the user through these steps when no `flowkit_*` tools are available. Run commands only with the user's permission.

## 1. Install the server

Requires Node.js 22.12 or newer (`node --version`).

```sh
npm install --global flowkit-mcp
```

Alternative without a global install: use `npx -y flowkit-mcp` wherever `flowkit-mcp` appears below. On Windows, if PowerShell blocks the command, use `flowkit-mcp.cmd` and `npm.cmd`.

## 2. Install the engines the user needs

Only the groups the user plans to use are required.

| Engine | Needed for | macOS | Ubuntu / Debian | Windows |
| --- | --- | --- | --- | --- |
| Pandoc | Documents | `brew install pandoc` | `sudo apt install pandoc` | `winget install JohnMacFarlane.Pandoc` |
| qpdf | PDF tools | `brew install qpdf` | `sudo apt install qpdf` | `winget install QPDF.QPDF` |
| Ghostscript | PDF size reduction | `brew install ghostscript` | `sudo apt install ghostscript` | `winget install ArtifexSoftware.GhostScript` |
| ImageMagick | Images | `brew install imagemagick` | `sudo apt install imagemagick` | `winget install ImageMagick.ImageMagick` |
| FFmpeg | Audio and video | `brew install ffmpeg` | `sudo apt install ffmpeg` | `winget install Gyan.FFmpeg` |

Document → PDF export additionally needs pdfroff (GNU groff).

## 3. Choose a workspace and check the setup

The workspace is the only folder FlowKit can read and write. Suggest a dedicated folder that holds just the files to process, not the user's whole home directory.

```sh
flowkit-mcp --doctor --workspace /absolute/path/to/files
```

Every engine the user needs should show `ready`. If an engine is installed somewhere unusual, set its path in the client's `env`: `PANDOC_PATH`, `QPDF_PATH`, `GHOSTSCRIPT_PATH`, `IMAGEMAGICK_PATH`, `FFMPEG_PATH`, `FFPROBE_PATH`.

## 4. Connect the agent

Ready-to-edit templates are in [`config/`](../config/). Replace `/absolute/path/to/files` with the workspace.

| Client | How |
| --- | --- |
| Claude Code | `claude mcp add --transport stdio flowkit -- flowkit-mcp --workspace /absolute/path/to/files` |
| Codex CLI | `codex mcp add flowkit -- flowkit-mcp --workspace /absolute/path/to/files` |
| Claude Desktop | Settings → Developer → Edit Config; merge `config/mcp-servers.json` into `claude_desktop_config.json` |
| Cursor | Merge `config/mcp-servers.json` into `.cursor/mcp.json` or `~/.cursor/mcp.json` |
| VS Code (Copilot) | Copy `config/vscode-mcp.json` to `.vscode/mcp.json` |
| Codex (config file) | Merge `config/codex-config.toml` into `~/.codex/config.toml` |
| Other MCP clients | stdio server, command `flowkit-mcp`, args `--workspace <dir>` |

Then **restart the client** (or reload its MCP servers) so the tools appear.

## 5. Optional: load fewer tools

All 46 tool definitions cost about 6,000 tokens per session. To load only some groups, add `--tools` with a comma-separated list: `document`, `pdf`, `image`, `audio`, `video`. File listing, text reading, and metadata are always included. For example, `--tools pdf,image` loads 20 tools.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The client can't start the server | Run the exact command with `--doctor` in a terminal. On Windows, use `flowkit-mcp.cmd` or `npx -y flowkit-mcp`. |
| `Choose a workspace directory with --workspace` | Add `--workspace` with an existing absolute path. |
| Tools missing after an upgrade | Restart the client, and check that `--tools` / `FLOWKIT_TOOLS` isn't limiting groups. |

More detail: https://github.com/ayusht9/Flowkit#readme
