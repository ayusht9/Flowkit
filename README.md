# FlowKit

Visual workflows and MCP tools for document and media processing. The first implementation is the linear pipeline executor and reusable operation registry.

## Run

Requires Node.js 22 or newer. No dependencies or installation step.

```sh
node --test
node examples/pipeline.mjs
```

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

The demo uses in-memory text operations to verify orchestration. FFmpeg, Pandoc, ImageMagick, PDF adapters, worker isolation, file storage, the HTTP API, MCP transport, and the UI are separate implementation steps.

Original planning material is retained locally under `archieve/`, which is ignored by Git.

## Git workflow

Use a branch per feature, verify it, and commit it. Leave merging for a later explicit step. The executor feature is based on the archive-cleanup branch; neither has been merged into `main`.
