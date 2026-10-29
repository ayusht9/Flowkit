# FlowKit

Visual workflows and MCP tools for document and media processing. Implemented: a drag-and-drop workflow studio, linear pipeline executor, and real Pandoc document conversion.

## Run

Requires Node.js 22.12 or newer and Pandoc for document conversion.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. The app runs on your machine; uploaded documents are sent only to the local server. The interface uses a Google-hosted font with a system-font fallback.

On Windows PowerShell, use `npm.cmd run dev` if execution policy blocks `npm.ps1`.

1. Choose **Try with a sample document**, or upload a DOCX, HTML, EPUB, or Markdown file.
2. Move nodes around, drag new nodes from the library, and connect compatible handles. Clicking library buttons also adds nodes; the inspector's **Next node** selector provides a keyboard alternative for connections.
3. Choose **Run workflow**. Inspect each step's progress and output, then download the generated Markdown.
4. Export the workflow as JSON to keep its layout and settings. Import it to continue later. Workflow exports never include your uploaded file.

The default template is **Upload document → Convert to Markdown → Clean Markdown → Preview & download**. The cleanup node normalizes line endings and optionally collapses extra blank lines, preserving code spacing. Workflows support a single connected chain with up to 20 nodes.

The server detects the portable Pandoc installation under `.tools/` automatically. To use a different installation, set `PANDOC_PATH` before starting it; otherwise it falls back to `pandoc` on PATH. A missing installation is reported when conversion runs.

For a production frontend build served locally:

```sh
npm run build
npm start
```

The backend binds to `127.0.0.1`, accepts same-origin requests, and runs one workflow at a time. Disconnecting or cancelling aborts the operation. This is a local hackathon app, without accounts, cloud storage, or a public multi-user service.

## Verify

```sh
npm test
node examples/pipeline.mjs
npm run build
npm run test:e2e
```

Browser tests use an installed Google Chrome. Set `PANDOC_PATH` for the native adapter tests, or put Pandoc on PATH; missing Pandoc reports skips in those tests. The workflow API and browser tests can also discover the local portable installation.

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

The app performs real Pandoc conversion through the executor. FFmpeg, ImageMagick, PDF adapters, RAG, and MCP transport are visibly marked as future work. OS/container worker isolation and persistent artifact storage are separate implementation steps. Pandoc's reader/writer sandbox and process limits do not provide container-level isolation.

Original planning material is retained locally under `archieve/`, which is ignored by Git.

## Git workflow

Use a branch per feature, verify it, and commit it. Leave merging for a later explicit step. `feature/workflow-app` builds on `feature/pandoc-conversion`, which builds on `feature/pipeline-executor` and the archive-cleanup branch. These branches remain unmerged into `main`.
