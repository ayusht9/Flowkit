# FlowKit MCP

FlowKit exposes 46 local tools over MCP stdio. The connected LLM chooses each step and passes the returned artifact path into its next call. The tools reuse the same validated operation registry as the visual workflow app.

## Connect an MCP host

Install dependencies with `npm install`. Install Pandoc, ImageMagick and FFmpeg/FFprobe for the operations you want to use. No LLM API key is required by this server; your MCP host provides the model.

PDF page operations, encryption/decryption, and PDF metadata require [qpdf](https://github.com/qpdf/qpdf/releases), available for Windows, macOS, and Linux. Image recompression in PDF Size Reducer additionally uses [Ghostscript](https://ghostscript.com/releases/gsdnld.html). FlowKit tests use qpdf 12.2.0 and Ghostscript 10.08.0 locally; the container and CI use distribution packages. Add executables to PATH or set `QPDF_PATH` / `GHOSTSCRIPT_PATH`. The repository discovers its ignored `.tools/ghostscript/bin/gswin64c.exe` test copy automatically. The npm package does not bundle native software. PDF editing and PKCS#12 signing libraries are installed as npm dependencies.

To install the CLI from npm and verify both the package and native processors:

```sh
npm install --global flowkit-mcp --foreground-scripts
flowkit-mcp --setup
flowkit-mcp --doctor --workspace /absolute/path/to/workspace
```

Use `flowkit-mcp.cmd` on Windows if PowerShell resolves a blocked `.ps1` shim. Add `--json` for a machine-readable report. The command exits unsuccessfully when a required native processor is missing.

Installation prints a native-tool setup notice when npm allows lifecycle scripts and displays their output. `--foreground-scripts` makes that output visible; if scripts are disabled or hidden, run `flowkit-mcp --setup` afterwards. The setup command requires no workspace or installed processors and does not download or change anything. Normal MCP stdio startup does not print the notice to stdout.

npm 12 blocks dependency install scripts by default. Add `--allow-scripts=flowkit-mcp` to the install command to allow only FlowKit's text-only notice, or use `flowkit-mcp --setup` after installing without scripts.

Tested setup recommendations are Pandoc 3.13, ImageMagick 7.1.1-47, and FFmpeg/FFprobe 9.0.2. They are not enforced minimum versions or compatibility guarantees for newer releases. The container also uses ImageMagick 6 through `convert`. PDF export additionally requires pdfroff (GNU groff) and Ghostscript. Install the processors for your intended operations and put them on PATH or configure the executable variables below. Human-readable `--doctor` output shows detected versions and the setup guide; JSON output includes a `recommendation` object for each processor.

### Connect Codex

```sh
codex mcp add flowkit -- flowkit-mcp --workspace /absolute/path/to/files
codex mcp list
```

The equivalent TOML is in [`clients/codex.config.toml.example`](clients/codex.config.toml.example).

### Connect Claude Code

```sh
claude mcp add --transport stdio flowkit -- flowkit-mcp --workspace /absolute/path/to/files
claude mcp list
```

The equivalent project configuration is in [`clients/claude.mcp.json`](clients/claude.mcp.json).

### Connect Google Antigravity (AGY)

Copy [`clients/agy.mcp_config.json`](clients/agy.mcp_config.json) to `<workspace>/.agents/mcp_config.json`, replace the workspace path, then open `/mcp` inside AGY to inspect the connection. AGY also supports the global `~/.gemini/config/mcp_config.json` location.

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
| `flowkit_pdf_merge` | `inputPaths` (2-10 PDFs, ordered) | One PDF in the specified input order, with page count |
| `flowkit_pdf_extract` | `inputPath`, `pages` (default `all`) | One PDF containing selected pages, in selection order |
| `flowkit_pdf_rotate` | `inputPath`, `pages` (default `all`), `degrees` (90, 180, 270; default 90) | PDF with selected pages rotated clockwise relative to their existing rotation |
| `flowkit_pdf_remove` | `inputPath`, `pages` (required) | PDF with selected pages removed; at least one page must remain |
| `flowkit_pdf_reverse` | `inputPath` | PDF with all pages in reverse order |
| `flowkit_pdf_reduce` | `inputPath`, `factor` (1-10; default 2), `autoQuality` (default true), `quality` (20-95; default 80) | Size-reduced PDF with actual savings, achieved factor, quality used, and `targetMet` |
| `flowkit_pdf_sign` | `inputPath`, `mode` (`image` or `certificate`), attachment paths and placement options described below | Visible signature image or a detached certificate digital signature |
| `flowkit_pdf_encrypt` | `inputPath`, `passwordFilePath`, optional `ownerPasswordFilePath` | AES-256 encrypted PDF with an opening password |
| `flowkit_pdf_decrypt` | `inputPath`, `passwordFilePath` | Unencrypted PDF using a supplied opening or owner password |
| `flowkit_file_metadata` | `inputPath` | Shared read-only metadata for documents, PDFs, images, audio, and video; no artifact is created |
| `flowkit_document_to_html` | `inputPath` | Supported document to standalone HTML |
| `flowkit_document_to_docx` | `inputPath` | Supported document to Word DOCX |
| `flowkit_document_to_odt` | `inputPath` | Supported document to OpenDocument ODT |
| `flowkit_document_to_epub` | `inputPath` | Supported document to EPUB 3 |
| `flowkit_document_to_pdf` | `inputPath` | Supported document to PDF |
| `flowkit_document_to_text` | `inputPath` | Readable plain text (`.txt`); read bounded excerpts with `flowkit_read_text` |
| `flowkit_document_to_rtf` | `inputPath` | Rich Text Format (`.rtf`) |
| `flowkit_document_to_latex` | `inputPath` | Standalone LaTeX source (`.tex`); no compilation |
| `flowkit_document_to_rst` | `inputPath` | reStructuredText source (`.rst`) |
| `flowkit_document_to_asciidoc` | `inputPath` | AsciiDoc source (`.adoc`), export only |
| `flowkit_document_to_pptx` | `inputPath` | PowerPoint (`.pptx`), export only; level-2 headings begin slides |
| `flowkit_merge_documents` | `inputPaths` (2-10 same-format files) | Combined Word DOCX |
| `flowkit_list_files` | `directory` (default `.`) | Up to 100 non-hidden entries; no recursion or symlink following |
| `flowkit_read_text` | `inputPath`, `offset` (default 0), `limit` (default 2000, max 12000) | Text excerpt, total characters, next offset |
| `flowkit_document_to_markdown` | `inputPath` | Supported document → Markdown |
| `flowkit_clean_markdown` | `inputPath`, `collapseBlankLines` (default true) | New normalized Markdown file |
| `flowkit_image_resize` | `inputPath`, `width` and/or `height` (1–4096) | PNG/JPEG → resized PNG |
| `flowkit_image_crop` | `inputPath`, `width`, `height` (1–4096), `x`, `y` (0–8191; default 0) | Crop inside the auto-oriented image; output PNG |
| `flowkit_image_rotate` | `inputPath`, `degrees` (90, 180, 270; default 90) | Clockwise rotation; output PNG |
| `flowkit_image_flip` | `inputPath`, `direction` (`horizontal`, `vertical`, `both`; default `horizontal`) | Mirror/flip; output PNG |
| `flowkit_image_grayscale` | `inputPath` | Grayscale PNG |
| `flowkit_image_blur` | `inputPath`, `sigma` (0.1–10; default 1) | Gaussian blur; output PNG |
| `flowkit_image_sharpen` | `inputPath`, `sigma` (0.1–5; default 1) | Sharpen details; output PNG |
| `flowkit_image_convert` | `inputPath`, `format` (`png` or `jpeg`; default `png`), `quality` (1–100; default 85, JPEG only) | PNG/JPEG conversion; JPEG flattens transparency onto white |
| `flowkit_audio_convert` | `inputPath`, `format` (`mp3` or `wav`, default `mp3`) | WAV/MP3/M4A → audio file |
| `flowkit_audio_trim` | `inputPath`, `startSeconds`, `durationSeconds`, `format` | Trimmed audio file |
| `flowkit_video_trim` | `inputPath`, `startSeconds`, `durationSeconds` | MP4/MOV/WebM/MKV → trimmed H.264 MP4 |
| `flowkit_video_extract_audio` | `inputPath`, `format` | Video → MP3/WAV audio track |
| `flowkit_audio_volume` | `inputPath`, `gainDb` (−60 to +12; default 0), `format` | Adjust volume; positive gain can clip |
| `flowkit_audio_fade` | `inputPath`, `fadeInSeconds`, `fadeOutSeconds` (0–30; default 0.25 each), `format` | Fade in/out; the combined fades must fit the source duration |
| `flowkit_audio_normalize` | `inputPath`, `targetLufs` (−24 to −9; default −16), `format` | Single-pass loudness normalization; fixed target peak −1.5 dBTP and LRA 11 |
| `flowkit_video_convert` | `inputPath`, `quality` (`compact`, `balanced`, `high`; default `balanced`) | H.264/AAC MP4; CRF 28, 23 or 18 respectively |
| `flowkit_video_resize` | `inputPath`, `width` and/or `height` (2–1920) | Fit without upscaling; preserve aspect ratio and round dimensions down to even pixels |
| `flowkit_video_rotate` | `inputPath`, `degrees` (90, 180, 270; default 90) | Clockwise rotation into MP4 |
| `flowkit_video_flip` | `inputPath`, `direction` (`horizontal`, `vertical`, `both`; default `horizontal`) | Mirror/flip into MP4 |
| `flowkit_video_mute` | `inputPath` | MP4 with the audio track removed |

All input paths are relative to the configured workspace. Unknown options and arbitrary native flags are rejected. One tool call runs at a time per server process; a concurrent request returns a busy error and can be retried after the first completes. Cancellation reaches the native operation and removes its temporary files.

Native PDF transformations accept unencrypted `.pdf` files with a matching signature. Pages use 1-based numbers or ascending ranges, for example `1-3,5` or `3,1-2`, without spaces. `all` selects the whole file. Out-of-range pages and arbitrary qpdf flags are rejected. Extraction writes a single new PDF; to split into multiple files, make a separate extraction call for each desired range. Removal drops selected pages and keeps the rest in their original order; removing every page is rejected. Reversal reverses the entire document. Rotation retains unselected pages and rotates selected pages without rasterizing. Merge order follows `inputPaths` in MCP and incoming connection order in the editor; the merge inspector lists that order.

PDF inputs must total at most 20 MiB per operation and contain at most 1000 pages; transformed results are limited to 1000 pages and 8 MiB. PDF operations have a 30-second execution budget. Files are processed in private temporary directories and cleaned on success, error, timeout, and cancellation. Native outputs are checked with qpdf and verified for expected page count. Results include `pageCount`, MIME type, byte size, encryption status, and the reusable artifact path. Encrypted PDFs must be decrypted with a supplied password before other transformations. Source files remain unchanged. PDF transformations can change document features and invalidate existing digital signatures; sign last. These tools do not sanitize PDF active content. PDF input remains unsupported by Pandoc document conversions; use the dedicated PDF tools for existing PDFs.

### Size Reducer and quality

`factor: 2` requests half the original size; `factor: 4` requests one quarter. Auto quality first tries lossless stream/object compression, then tries image-resolution/JPEG quality profiles from higher to lower quality until the target is met or all profiles are exhausted. Manual mode (`autoQuality: false`) uses the requested `quality` and a resolution derived from the factor. Lossless results are kept when they already meet the target. These are best-effort targets, not exact byte-size guarantees. Smaller PDFs can be difficult to reduce further. The original bytes are retained if no candidate is smaller, subject to the 8 MiB output cap.

Results include `originalSizeBytes`, signed `sizeChangeBytes` (negative means smaller), `requestedFactor`, `achievedFactor`, `targetMet`, `autoQuality`, `qualityUsed`, `resolutionDpi`, and `compressionMethod`. Image recompression can reduce visual quality and change annotations, forms, links, bookmarks, and other features. Source files remain intact. The previous Optimize operation is removed; imported legacy Optimize nodes migrate to factor 1 (lossless behavior).

### Signing and encryption

`flowkit_pdf_sign` defaults to `mode: image`: supply `signatureImagePath` (PNG/JPEG, at most 2 MiB), `page` (1-based, default 1), `x`/`y` (default 36), `width` (default 160), and `height` (default 60). Coordinates are PDF points from the crop-box lower-left before page rotation. The image is fit proportionally inside the rectangle, which must remain within the page. This is a visible image, not a cryptographic signature.

For `mode: certificate`, supply `certificatePath` to a `.p12`/`.pfx` bundle containing its private key and certificate, and optionally `certificatePasswordFilePath`. Optional `name` and `reason` strings are limited to 200 characters. This creates an invisible detached CMS digital signature; certificate trust, expiry, and revocation are evaluated by the reader, not granted by FlowKit. No timestamp authority or network lookup is used. Existing filled digital signatures are rejected by both signing modes to avoid invalidating them. Signing and PDF property parsing run in workers with 256 MiB heap and execution limits. Signature attachments are limited to 2 MiB.

Encryption always uses AES-256 and a non-empty opening password. If an owner password is omitted, FlowKit generates a random one. Decryption requires a supplied opening or owner password; it does not guess passwords. MCP credentials are read from UTF-8 files using workspace-relative password paths (up to 1024 bytes, no line breaks except an optional final newline). Password values never enter command arguments or tool responses. Native encryption jobs/passwords are written to private temporary files and removed afterwards. Source password/certificate files in the workspace remain the user's responsibility.

The editor collects passwords and signature/certificate attachments separately from operation options. They are session-only and excluded from workflow history, saves, exports, execution events, and results. Browser requests carry them as `runtimeInputs` keyed by node ID; the server validates bounds and passes them only to execution. Temporary certificate/password material is cleaned on success, failure, timeout, and cancellation.

### Shared metadata engine

The standalone Inspect PDF operation is removed. `flowkit_file_metadata` and `POST /api/metadata` use the same bounded metadata engine. Upload nodes inspect automatically and show a compact summary on the node plus detailed metadata in its editor. Refresh is available if inspection fails or returns partial metadata. Replacing a source aborts its previous metadata request so stale results cannot overwrite the new file.

Every report includes name, byte size, filename/detected extension, detected kind, MIME type, `status`, `details`, and `warnings`. PDFs include page count, encryption, available document properties and geometry for up to 25 pages. Encrypted PDFs report encryption with unavailable page count, without requesting a password. Images include dimensions, bit depth, color space, and orientation. Media includes duration, container, and up to 16 stream codec/dimension/channel/sample-rate summaries. UTF-8 text includes character/line counts; DOCX/ODT/EPUB include basic container/format metadata. Contents and binary data are never returned. Inputs are limited to 20 MiB; native inspection has a ten-second budget and bounded output. Missing processors or malformed files preserve basic metadata with `status: partial` and warnings. Legacy Inspect workflow nodes migrate to pass-through PDF Pipes.

Pandoc inputs include DOCX, ODT, HTML/HTM, EPUB, Markdown (`.md`/`.markdown`), TXT, RTF, LaTeX (`.tex`), and reStructuredText (`.rst`). Markdown and TXT are parsed as CommonMark. PDF, AsciiDoc and PowerPoint are export-only for compatibility with older Pandoc installations. LaTeX output is source text and requires no TeX installation; PDF still requires the configured pdfroff engine. Conversions use fixed options and Pandoc's sandbox; user filters, templates, scripts, include paths and native flags cannot be supplied. Format conversion can lose layout or features that the target cannot represent; PowerPoint maps headings to slides rather than reproducing document page layouts.

FFmpeg effects retain the existing 20 MiB upload/source-file, five-minute duration, 1080p pixel-area and 60 fps limits. Audio outputs are stereo 44.1 kHz MP3 (128 kbit/s) or PCM WAV; `format` defaults to `mp3`. Video outputs are re-encoded H.264 MP4 with optional AAC audio; mute removes audio entirely. Outputs are inspected with FFprobe and include actual duration and video dimensions/frame rate. Normalization is single-pass: exact loudness/peak targets depend on source content; silence remains silence. Encoding is lossy for MP3 and H.264, including video transformations. No user-supplied filtergraphs, codecs, URLs or executable flags are accepted.

Media outputs default to 64 MiB in the local development server (`npm run dev`) and 8 MiB in hosted mode and MCP. Set the trusted process environment variable `FLOWKIT_MEDIA_MAX_OUTPUT_MIB` to an integer from 1 to 256 to override either default. For example, add `"FLOWKIT_MEDIA_MAX_OUTPUT_MIB": "64"` to an MCP host's `env` configuration. Generated audio/video artifacts can be passed between media operations up to that configured size; MCP source files outside `.flowkit-artifacts/` and browser uploads remain limited to 20 MiB. The editor reads the active media limit from the server. Image/document caps remain unchanged. Raising a cap increases temporary disk and memory use; it does not enable chunked transfers or remove the existing duration/resolution/time limits.

Image operations accept PNG/JPEG with matching signatures and at most 16 million pixels. They use the first frame, apply EXIF orientation, and strip metadata. Crop offsets start at the top-left of the oriented image; rectangles extending outside it are rejected. Transform outputs are PNG; use `flowkit_image_convert` last for JPEG. JPEG conversion replaces transparency with white, and `quality` controls JPEG encoding only. The existing 20 MiB input, 8 MiB output and native resource limits apply.

Image processing limits pixel-cache heap memory to 128 MiB, memory mapping to 256 MiB, and disk caching to 1 GiB per native invocation. Cache files are directed to the operation's private temporary folder and removed with it on completion, failure, or cancellation. High-resolution effects can still hit processor policy or execution limits; resize first or reduce effect strength if a resource-limit error occurs.

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

Paths must remain within the selected workspace, including after resolving symlinks. Source files/uploads are limited to 20 MiB; non-media MCP outputs remain limited to 8 MiB. Media outputs and generated media intermediates use the configured cap described above. Existing media limits apply: five minutes, video up to 1080p pixel area and 60 fps, and native subprocess execution deadlines. Text reads accept `.md`, `.markdown` or `.txt` and use JavaScript character offsets. Markdown cleanup accepts `.md`; convert other formats first.

This is a local stdio server, not an authenticated remote endpoint. The existing web deployment does not expose it. Native file processing still needs OS/container worker isolation before hosting untrusted users. File contents and filenames are untrusted document data, not instructions to the agent.

## Verification

`flowkit-mcp --doctor --workspace <path>` verifies the installed CLI, workspace and six native executables. `node --test test/mcp.test.mjs test/pdf.test.mjs test/pdf-security.test.mjs` covers MCP discovery/chaining, metadata, limits, credentials, compression, AES-256, visible signatures, and cryptographic certificate verification. Certificate fixtures/verification use OpenSSL (Windows tests also discover Git's bundled OpenSSL). `npm run test:e2e -- e2e/pdf.spec.mjs e2e/pdf-security.spec.mjs` checks the full editor flows and that saved workflows exclude secrets and attachments.

Run `npm run benchmark:mcp` for a reproducible JSON comparison between fixed MCP calls and explicit generated-script instructions. It measures actual UTF-8 payload bytes and reports a transparent `bytes / 4` token estimate, including the one-time MCP tool-schema cost. It is not provider billing data; use your model host's usage fields for exact billed input/output tokens.
