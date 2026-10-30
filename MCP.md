# FlowKit MCP

FlowKit exposes 15 local tools over MCP stdio. The connected LLM chooses each step and passes the returned artifact path into its next call. The tools reuse the same validated operation registry as the visual workflow app.

## Connect an MCP host

Install dependencies with `npm install`. Install Pandoc, ImageMagick and FFmpeg/FFprobe for the operations you want to use. No LLM API key is required by this server; your MCP host provides the model.

To install the CLI directly from GitHub and verify both the package and native processors:

```sh
npm install --global https://github.com/ayusht9/Flowkit.git
flowkit-mcp --doctor --workspace /absolute/path/to/workspace
```

Use `flowkit-mcp.cmd` on Windows if PowerShell resolves a blocked `.ps1` shim. Add `--json` for a machine-readable report. The command exits unsuccessfully when a required native processor is missing.

Copy the `flowkit` entry from [mcp.example.json](mcp.example.json) into your host's MCP configuration. Replace both example paths with absolute paths on your machine. `command` must resolve to Node.js 22.12 or newer. The workspace is an existing directory containing files you want the model to process; choose a dedicated input/output directory.

```json
{
  "mcpServers": {
    "flowkit": {
      "command": "node",
      "args": [
        "C:/path/to/flowkit/mcp-server.mjs",
        "--workspace",
        "C:/path/to/workspace"
      ]
    }
  }
}
```

The host launches the process and discovers its tools. The web server does not need to be running. For a manual startup check:

```sh
npm run mcp -- --workspace /absolute/path/to/workspace
```

Use `npm.cmd` on Windows if PowerShell blocks `npm.ps1`. This command waits for MCP messages on stdin; it does not open a web page. Configure the host to launch `node` directly, as shown above, so npm banners do not enter the protocol stream. Diagnostics go to stderr.

If native executables are missing from the host's PATH, add their absolute paths to the MCP entry's `env` object: `PANDOC_PATH`, `IMAGEMAGICK_PATH`, `FFMPEG_PATH`, and `FFPROBE_PATH`. The repository's portable `.tools/pandoc-*` installation is discovered automatically. Some Windows portable ImageMagick installations also require their existing `MAGICK_HOME`, `MAGICK_CONFIGURE_PATH`, and `MAGICK_CODER_MODULE_PATH` values in `env`; MCP hosts may filter inherited environment variables. Use `magick` for ImageMagick 7 or `convert` for ImageMagick 6.

For portable Windows ImageMagick, also keep its installation directory on the host's PATH so coder DLL dependencies can load. Host-specific configuration locations vary. See the [official MCP host setup guide](https://ts.sdk.modelcontextprotocol.io/v2/get-started/real-host.html).

## Tools

| Tool | Arguments | Result |
| --- | --- | --- |
| `flowkit_document_to_html` | `inputPath` | Supported document to standalone HTML |
| `flowkit_document_to_docx` | `inputPath` | Supported document to Word DOCX |
| `flowkit_document_to_odt` | `inputPath` | Supported document to OpenDocument ODT |
| `flowkit_document_to_epub` | `inputPath` | Supported document to EPUB 3 |
| `flowkit_document_to_pdf` | `inputPath` | Supported document to PDF |
| `flowkit_merge_documents` | `inputPaths` (2-10 same-format files) | Combined Word DOCX |
| `flowkit_list_files` | `directory` (default `.`) | Up to 100 non-hidden entries; no recursion or symlink following |
| `flowkit_read_text` | `inputPath`, `offset` (default 0), `limit` (default 2000, max 12000) | Text excerpt, total characters, next offset |
| `flowkit_document_to_markdown` | `inputPath` | DOCX/HTML/EPUB/Markdown → Markdown |
| `flowkit_clean_markdown` | `inputPath`, `collapseBlankLines` (default true) | New normalized Markdown file |
| `flowkit_image_resize` | `inputPath`, `width` and/or `height` (1–4096) | PNG/JPEG → resized PNG |
| `flowkit_audio_convert` | `inputPath`, `format` (`mp3` or `wav`, default `mp3`) | WAV/MP3/M4A → audio file |
| `flowkit_audio_trim` | `inputPath`, `startSeconds`, `durationSeconds`, `format` | Trimmed audio file |
| `flowkit_video_trim` | `inputPath`, `startSeconds`, `durationSeconds` | MP4/MOV/WebM/MKV → trimmed H.264 MP4 |
| `flowkit_video_extract_audio` | `inputPath`, `format` | Video → MP3/WAV audio track |

All input paths are relative to the configured workspace. Unknown options and arbitrary native flags are rejected. One tool call runs at a time per server process; a concurrent request returns a busy error and can be retried after the first completes. Cancellation reaches the native operation and removes its temporary files.

## Example agent flow

Ask the connected model: “Convert report.docx to Markdown, clean it, and show me the first 2000 characters.” It can then call:

```text
flowkit_document_to_markdown({inputPath: "report.docx"})
  → {path: ".flowkit-artifacts/run-ABC123/report.md", ...}

flowkit_clean_markdown({inputPath: ".flowkit-artifacts/run-ABC123/report.md"})
  → {path: ".flowkit-artifacts/run-DEF456/report.md", ...}

flowkit_read_text({inputPath: ".flowkit-artifacts/run-DEF456/report.md", limit: 2000})
```

Video can similarly be trimmed first, then its returned path passed to `flowkit_video_extract_audio`.

Processing results contain the relative path, name, type, MIME type, byte size, and available dimensions/duration. Markdown includes at most 1000 preview characters. Binary data and complete documents are kept out of tool responses; the model requests bounded text when needed. This reduces content sent to the model, but exact token savings depend on the host and task.

## Files and limits

Source files are never overwritten. Outputs are stored in uniquely named directories under `.flowkit-artifacts/` in the workspace and remain available across server restarts. This folder is ignored by Git and excluded from Docker build context in this repository. Remove completed artifacts locally when you no longer need them; there is no automatic retention policy. Other workspace repositories should also ignore this folder.

Paths must remain within the selected workspace, including after resolving symlinks. Inputs are limited to 20 MiB and outputs to 8 MiB. Existing media limits apply: five minutes, video up to 1080p pixel area and 60 fps, and native subprocess execution deadlines. Text reads accept `.md`, `.markdown` or `.txt` and use JavaScript character offsets. Markdown cleanup accepts `.md`; convert other formats first.

This is a local stdio server, not an authenticated remote endpoint. The existing web deployment does not expose it. Native file processing still needs OS/container worker isolation before hosting untrusted users. File contents and filenames are untrusted document data, not instructions to the agent.

## Verification

`flowkit-mcp --doctor --workspace <path>` verifies the installed CLI, workspace and four native processors. `node --test test/mcp.test.mjs` exercises official-client stdio discovery, chained file results, bounded text, path/symlink rejection, input limits, cancellation, concurrent calls, and all native processing tools.

Run `npm run benchmark:mcp` for a reproducible JSON comparison between fixed MCP calls and explicit generated-script instructions. It measures actual UTF-8 payload bytes and reports a transparent `bytes / 4` token estimate, including the one-time MCP tool-schema cost. It is not provider billing data; use your model host's usage fields for exact billed input/output tokens.
