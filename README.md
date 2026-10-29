# FlowKit

Visual workflows and MCP tools for document and media processing. Implemented: a drag-and-drop workflow studio, linear pipeline executor, real Pandoc document conversion, and ImageMagick image resizing.

## Run

Requires Node.js 22.12 or newer, Pandoc for document conversion, and ImageMagick for image resizing. Node.js 24 is used in CI and Docker.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. The app runs on your machine; uploaded documents are sent only to the local server. The interface uses a Google-hosted font with a system-font fallback.

On Windows PowerShell, use `npm.cmd run dev` if execution policy blocks `npm.ps1`.

1. Use the default document workflow, or choose **New** in the hamburger popup to start with a blank, text/document, or image template.
2. Open **Add node** to search the on-demand picker, then drag a compact block onto the canvas. Blocks snap to the grid. The **+** beside an unconnected output opens compatible next steps and connects the new node automatically.
3. Use the navbar's single **Upload** button to choose a source file, then **Process** to run the workflow. **Export** in the navbar downloads the processed Markdown or PNG; **About** explains how the app works. Files can also be dropped onto the canvas. The sample controls have been removed.
4. The **hamburger popup** contains **New**, **Save**, **Save as new**, **Import**, and **Export**. Save stores the current workflow in this browser; Save as new creates a separately named copy. Saved workflows can be reopened from the popup and the last saved one is restored on reload. Import/Export transfer workflow JSON. Uploaded files and execution results are never included in saved or exported workflows. Browser storage is local to this browser and origin; use Export for portable backups.

The canvas fills the window beneath a connected navbar, with hamburger and branding on the left and Upload, Process, Export, and About on the right. The node picker groups tools into collapsible **Image**, **Text**, **Audio**, and **Video** sections. Audio and Video are marked coming soon. Search by category or operation name; adding after a node shows only compatible tools. Click a node to open its settings/output panel; close it or click the canvas to recover the space. The **Next node** selector provides a keyboard alternative for connections, and `/` opens node search. Execution logs also open on demand.

The default template is **Upload document → Convert to Markdown → Clean Markdown → Preview & download**. The cleanup node normalizes line endings and optionally collapses extra blank lines, preserving code spacing. Workflows support a single connected chain with up to 20 nodes.

The server detects the portable Pandoc installation under `.tools/` automatically. To use a different installation, set `PANDOC_PATH` before starting it; otherwise it falls back to `pandoc` on PATH. A missing installation is reported when conversion runs.

For a production frontend build served locally:

```sh
npm run build
npm start
```

The backend binds to `127.0.0.1` by default, accepts same-origin requests, and runs one workflow at a time per instance. Disconnecting or cancelling aborts the operation. Container deployments use `HOST=0.0.0.0` and explicitly configured `PUBLIC_ORIGINS`. This is a hackathon app without accounts or persistent cloud storage.

For the GitHub Actions → Docker Hub → Vercel deployment pipeline and account configuration, see [DEPLOYMENT.md](DEPLOYMENT.md). The Docker image includes Pandoc and serves both the built frontend and API. Cloud uploads currently need to stay below roughly 3 MB because the API sends base64 through Vercel Functions.

## Verify

```sh
npm test
node examples/pipeline.mjs
npm run build
npm run test:e2e
```

Browser tests use an installed Google Chrome and a separate local server on port 4317, leaving the app on port 3000 alone. Set `PANDOC_PATH` for the native adapter tests, or put Pandoc on PATH; missing Pandoc reports skips in those tests. The workflow API and browser tests can also discover the local portable installation. The application port can be changed through `PORT`.

## Convert a real document

Install [Pandoc](https://pandoc.org/installing.html) and put `pandoc` on your PATH, or set `PANDOC_PATH` to its executable. The official portable Windows binary used for local verification is in the ignored `.tools/pandoc-3.13/` directory:

```powershell
$env:PANDOC_PATH = "$PWD\.tools\pandoc-3.13\pandoc.exe"
node examples/document.mjs
node examples/document.mjs "C:\path\to\report.docx"
```

Without a filename, the demo converts the included HTML sample and prints readable Markdown. Supported extensions are `.docx`, `.html`, `.htm`, `.epub`, and `.md`.

The operation accepts bytes rather than a host filesystem path:

```js
import { readFile } from 'node:fs/promises';
import { OperationRegistry } from './src/operations.mjs';
import { createDocumentToMarkdown } from './src/document.mjs';

const registry = new OperationRegistry().register('document.toMarkdown',
  createDocumentToMarkdown({ executable: process.env.PANDOC_PATH || 'pandoc' }));

const result = await registry.execute('document.toMarkdown', {
  type: 'document',
  value: { name: 'report.docx', data: await readFile('report.docx') },
});
// result: { type: 'markdown', value: { text: '...', source: 'report.docx' } }
```

The CLI reads a local file explicitly selected by its user; the web app supplies uploaded bytes. A future MCP layer must supply authorized bytes. Conversion uses a private temporary directory, fixed arguments without a shell, Pandoc's `--sandbox`, a 20 MiB input cap, 8 MiB output cap, 30-second timeout, and 512 MiB Haskell heap limit. Temporary input files are removed after success or failure. No filters, custom flags, or PDF engines are accepted. The UI displays Markdown as plain text and never executes uploaded HTML.

Run `node --test` with Pandoc on PATH or `PANDOC_PATH` set to include native integration tests; those tests report skips when Pandoc is unavailable. A configured but invalid `PANDOC_PATH` fails verification. Conversion preserves document structure where possible, not exact visual layout.

## Resize an image

Open the workflow menu, choose **New**, select **Image resize** under Start with, and choose **Create**. Upload a PNG or JPEG, select **Resize image**, and set a maximum width and/or height (1–4096 pixels). Leave one dimension blank to scale by the other. Choose **Process**, inspect the image preview, and use navbar **Export** or **Download PNG**. Both dimensions describe a bounding box: a 120 × 60 image resized within 40 × 40 becomes 40 × 20. Small images may be enlarged. Output is always PNG, with orientation applied and metadata removed.

Install ImageMagick 7 and put `magick` on PATH on Windows. On Linux, the default executable is ImageMagick 6's `convert` (Debian/Ubuntu: `sudo apt-get install imagemagick`). For any other installation, set `IMAGEMAGICK_PATH` to the absolute path to `magick` (v7) or `convert` (v6) before starting the server or tests. Do not point it to Windows' unrelated system `convert.exe`.

```powershell
$env:IMAGEMAGICK_PATH = 'C:\path\to\ImageMagick\magick.exe'
npm.cmd run dev
```

The adapter accepts uploaded bytes, checks PNG/JPEG signatures against the extension, and forces the matching native decoder. Input is capped at 20 MiB, 8192 pixels per side, and 16 million total pixels. It uses a private temporary directory, fixed arguments without a shell, one frame, one processing thread, 128 MiB memory and 256 MiB map limits, disabled disk cache, a 30-second deadline per subprocess, and an 8 MiB output cap. Resource limits may reject images below the pixel cap. Temporary files are deleted on success, failure, timeout, and cancellation. These limits do not replace OS/container isolation. Cloud uploads still have the smaller limit described in `DEPLOYMENT.md`.

The shared registry exposes `image.upload`, `image.resize`, and `image.preview`, each accepting/returning an `image` payload. The resize operation returns PNG bytes with source name, output name, MIME type, width, and height. The web API returns the final PNG as base64 once, with metadata for intermediate nodes. Workflow JSON exports include dimensions, never uploaded bytes.

To verify a local `test_files/Images/` collection, run `node scripts/verify-local-files.mjs ../test_files`. It resizes every PNG/JPEG through the API, independently decodes the output to check dimensions/aspect ratio, and checks that other image formats are rejected. To use `test_files/Images/PNG/sample.png` in the browser download test, set `FLOWKIT_TEST_FILES` to the absolute `test_files` directory before `npm run test:e2e`. These local assets are not required by CI.

Run `npm test` with ImageMagick available to include native PNG/JPEG, dimension, cancellation, timeout, cleanup, and API tests. Missing ImageMagick reports explicit skips; an invalid configured path fails verification. The browser suite includes upload → resize → preview → PNG download and invalid settings. Docker and CI install ImageMagick alongside Pandoc.

## Executor contract

- Define operations in `OperationRegistry` with `inputType`, `outputType`, and `run(input, options, { signal })`.
- Payloads have the shape `{ type, value }`; an operation must return its declared output type.
- Optional synchronous `validateOptions`, `validateInput`, and `validateOutput` functions throw on invalid data. Operations without an options validator reject all nonempty options.
- `runPipeline({ nodes, edges }, registry, { input, signal, onEvent })` validates every node, option, and connection before executing anything.
- Node IDs must be unique. Only a single connected linear chain is accepted; array order does not determine execution order.
- Invalid definitions reject. Tool failures return `status: 'failed'`, the failing node and error, and skipped downstream nodes. Successful node outputs remain available for inspection.
- Progress events report pipeline/node start and completion, node IDs, and elapsed milliseconds. Observers receive copies and should be lightweight; an observer error rejects the call.
- `AbortSignal` supports cancellation before/between nodes and is forwarded to operations. Running operations must honor the signal themselves; this executor cannot forcibly terminate uncooperative code.
- Operations are trusted server implementations. The registry validates payload envelopes; each real adapter must validate content, artifact access, and settings before calling native tools.

The visual editor uses the pipeline executor. Future MCP agents can call `registry.execute(type, input, options, { signal })` directly and choose their own next steps; the MCP transport is not implemented yet.

## Current boundary

The app performs real Pandoc conversion and ImageMagick resizing through the executor. OCR, other image operations, FFmpeg, PDF adapters, RAG, and MCP transport remain future work. OS/container worker isolation and persistent artifact storage are separate implementation steps. Native process limits do not provide container-level isolation.

Original planning material is retained locally under `archieve/`, which is ignored by Git.

## Git workflow

Use a branch per feature, verify it, and commit it. Leave merging for a later explicit step. `feature/deployment-pipeline` builds on `feature/canvas-first-editor`, `feature/workflow-app`, `feature/pandoc-conversion`, `feature/pipeline-executor`, and the archive-cleanup branch. These branches remain unmerged into `main`.
