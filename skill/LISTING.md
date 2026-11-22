# Agensi listing for the FlowKit skill

Copy these fields into the Agensi upload form. Build the zip first with `npm run skill:pack`; it's written to `dist/flowkit-skill-<version>.zip`.

## Name

FlowKit: Local File Tools

## Short description

Lets your agent convert documents, edit PDFs, and process images, audio, and video locally through the FlowKit MCP server, with no scripts to write.

## Description

FlowKit is an open-source MCP server with 46 local tools for everyday file work. It runs on your machine with Pandoc, qpdf, Ghostscript, ImageMagick, and FFmpeg. This skill teaches your agent when to reach for FlowKit and how to use it well:

- **Picks the right tool** for requests like "merge these PDFs and shrink them," "convert this DOCX to Markdown," "make a JPEG thumbnail," or "cut a 90-second clip and normalize the audio."
- **Chains steps correctly** by passing each result's path to the next call, one call at a time.
- **Avoids common errors:** page-range syntax, decrypt-before-edit, sign-last, password files instead of passwords in arguments, and size limits.
- **Recovers from errors** with a lookup table for every FlowKit error message.
- **Sets FlowKit up if it's missing,** with install commands for macOS, Linux, and Windows and config templates for Claude Code, Claude Desktop, Codex, Cursor, and VS Code.

Why use it: in FlowKit's published benchmark, one tool call uses about 80% fewer tokens than having the agent write and run its own script, and 65–77% fewer on multi-step workflows. Files never leave your machine.

**Requirements:** the free `flowkit-mcp` package from npm (Node.js 22.12+) and the native engines for the file types you use. The skill includes setup steps. FlowKit is MIT licensed: https://github.com/ayusht9/Flowkit

## Tags

mcp, pdf, documents, pandoc, ffmpeg, imagemagick, file-conversion, images, audio, video, local, productivity

## Price

Free. FlowKit itself is open source, so a free skill removes the last barrier to trying it.

## What's in the zip

| File | Purpose |
| --- | --- |
| `SKILL.md` | When to use FlowKit, tool selection, chaining, rules, errors, reporting |
| `references/tools.md` | Every tool's arguments, defaults, and limits (generated from MCP.md) |
| `references/recipes.md` | Multi-step workflows for documents, PDFs, images, audio, and video |
| `references/setup.md` | Install, engine setup, client connection, troubleshooting |
| `config/` | MCP config templates for Claude Desktop/Cursor/Antigravity, VS Code, and Codex |
| `LICENSE` | MIT |

## Releasing an update

1. Change `skill/flowkit/` (or MCP.md for tool details).
2. Run `npm test` (includes the skill checks) and `npm run skill:pack`.
3. Upload the new zip to Agensi as a new version.
