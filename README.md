# FlowKit

Visual workflows and MCP tools for document and media processing. Implemented: the linear pipeline executor, reusable operation registry, and Pandoc document-to-Markdown adapter.

## Run

Requires Node.js 22 or newer. No npm dependencies. Real document conversion additionally requires Pandoc.

```sh
node --test
node examples/pipeline.mjs
```

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

The CLI reads a local file explicitly selected by its user. A future upload/MCP layer must supply authorized bytes. Conversion uses a private temporary directory, fixed arguments without a shell, Pandoc's `--sandbox`, a 20 MiB input cap, 8 MiB output cap, 30-second timeout, and 512 MiB Haskell heap limit. Temporary input files are removed after success or failure. No filters, custom flags, or PDF engines are accepted. Markdown output remains untrusted content and needs safe rendering in the future UI.

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

The visual editor will use the pipeline executor. External MCP agents can call `registry.execute(type, input, options, { signal })` directly and choose their own next steps.

## Current boundary

The executor demo uses in-memory text operations. The document demo performs real Pandoc conversion. FFmpeg, ImageMagick, PDF adapters, OS/container worker isolation, artifact storage, the HTTP API, MCP transport, RAG, and the UI are separate implementation steps. Pandoc's reader/writer sandbox and process limits do not provide container-level isolation.

Original planning material is retained locally under `archieve/`, which is ignored by Git.

## Git workflow

Use a branch per feature, verify it, and commit it. Leave merging for a later explicit step. `feature/pandoc-conversion` builds on `feature/pipeline-executor`, which builds on the archive-cleanup branch. These branches remain unmerged into `main`.
