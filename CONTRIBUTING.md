# Contributing to FlowKit

Thanks for helping! Bug reports, docs fixes, and focused improvements are all welcome. For a new tool or a larger change, please [open an issue](https://github.com/ayusht9/Flowkit/issues/new/choose) first so we can agree on the shape before you write code.

## Set up

You need Node.js 22.12+ and whichever native engines the area you're working on uses: [Pandoc](https://pandoc.org/installing.html) (documents), [qpdf](https://github.com/qpdf/qpdf/releases) and [Ghostscript](https://ghostscript.com/releases/gsdnld.html) (PDF), [ImageMagick 7](https://imagemagick.org/script/download.php) (images), and [FFmpeg](https://ffmpeg.org/download.html) (audio/video).

```sh
git clone https://github.com/ayusht9/Flowkit.git
cd Flowkit
npm install
npm run mcp:doctor      # shows which engines were found
```

## Run things

| Task | Command |
| --- | --- |
| Workflow studio with hot reload | `npm run dev`, then open http://127.0.0.1:3000 |
| MCP server from source | `node mcp-server.mjs --workspace ./some-folder` |
| Unit and integration tests | `npm test` |
| Browser tests | `npm run build && npm run test:e2e` |
| Full benchmark (regenerates `docs/BENCHMARKS.md`, charts, site data) | `npm run benchmark` |
| README and site screenshots | `npm run build && npm run screenshots` |

Tests that need a native engine skip with a reason when it's missing, so you can work on one area without installing everything.

## Branches

- `main` holds released work; `develop` is for integration.
- Branch from the latest `develop` (for example `feature/pdf-watermark`) and open your pull request against `develop`.

## Adding or changing a tool

1. Define the operation in its catalog (`src/pdf-operations.mjs`, `src/image-operations.mjs`, `src/media-operations.mjs`, or `src/document-formats.mjs`) and implement it in the matching adapter (`src/pdf.mjs`, `src/image.mjs`, `src/media.mjs`, or `src/document.mjs`).
2. Validate every option with explicit bounds; never pass user input to a shell. Native engines run with fixed arguments, timeouts, and temporary directories.
3. Inputs must stay inside the workspace, and outputs go to a new file under `.flowkit-artifacts/`. Never overwrite a source file.
4. Return metadata (path, size, dimensions, duration, page count), not file bytes.
5. Keep the description short. Shared limits live in the server instructions in `src/mcp.mjs`.
6. Add tests in `test/` (and `e2e/` if the studio changed), update [MCP.md](MCP.md), and re-run `npm run benchmark`.

## Pull request checklist

- `npm test` and `npm run build` pass.
- Docs and [CHANGELOG.md](CHANGELOG.md) (under "Unreleased") are updated.
- The PR is focused on one change and explains how you verified it.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE). Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).
