# Changelog

All notable changes to `flowkit-mcp` are listed here. Versions follow [semantic versioning](https://semver.org/).

## Unreleased

- Added a full benchmark suite (`npm run benchmark`): 13 tasks, multi-step workflows, retries, tool-list cost per group, session break-even, output kept out of context, execution time for every tool, and safety-boundary checks. It writes [docs/BENCHMARKS.md](docs/BENCHMARKS.md), SVG charts, and the site's data.
- Added the MIT license, contributing guide, security policy, code of conduct, and issue and pull request templates.
- Rewrote the README and landing page, with screenshots captured by `npm run screenshots`.

## 0.3.1 — 2026-11-22

- Published the 0.3.0 changes under a new version number after a staged 0.3.0 upload blocked reuse of that version.

## 0.3.0 — 2026-11-22

- Added PDF tools: `flowkit_pdf_merge`, `flowkit_pdf_extract`, `flowkit_pdf_rotate`, `flowkit_pdf_remove`, `flowkit_pdf_reverse`, `flowkit_pdf_reduce`, `flowkit_pdf_encrypt`, `flowkit_pdf_decrypt`, and `flowkit_pdf_sign` (qpdf, Ghostscript).
- Added `flowkit_file_metadata`, a read-only metadata tool for documents, PDFs, images, audio, and video.
- Added `--tools` / `FLOWKIT_TOOLS` to load only the `document`, `pdf`, `image`, `audio`, or `video` tool groups.
- Cut the tool list from about 9,300 to 6,100 tokens: compact schemas, enums instead of `anyOf`, and shared limits in the server instructions.

## 0.2.1 — 2026-11-12

- Added `flowkit-mcp --setup` and native-engine installation guidance in `--doctor`.

## 0.2.0 — 2026-11-12

- Added seven ImageMagick tools, six Pandoc exports, and eight FFmpeg audio and video tools.
- Made media output caps configurable with `FLOWKIT_MEDIA_MAX_OUTPUT_MIB`.

## 0.1.0 — 2026-10-30

- First release of the MCP server over stdio.
