# FlowKit

Visual workflow builder and MCP server offering prebuilt document and media tools, with optional RAG for compact, source-cited AI context.

## Product promise

People build pipelines in the visual workspace, where FlowKit sequences the steps. External AI agents call individual prewritten operations through MCP (Model Context Protocol) and control their own subsequent steps, retrieval, and model calls. The two interfaces reuse operation implementations and validation, while orchestration belongs to the caller.

```text
Visual editor -> FlowKit pipeline executor -> Prebuilt operations
External agent -> MCP individual tool calls -> Prebuilt operations

Visual workflow results -> Download OR optional FlowKit RAG / cited answer
MCP tool results -> External agent decides the next step
```

FlowKit targets two separate sources of token usage:

1. **Code-generation tokens:** agents select existing operations and supply structured parameters instead of writing and debugging scripts.
2. **Context tokens:** extraction and optional RAG select relevant evidence instead of sending entire source representations to the model.

Ordinary conversion, resizing, trimming, and downloads do not require RAG or a language model. Savings are measured, not guaranteed.

## Core tools

| Input | Execution tools | Output for RAG |
|---|---|---|
| PDF | qpdf, Ghostscript, pdftotext, Tesseract | Page-aware text and page images |
| DOCX, HTML, EPUB, Markdown | Pandoc | Structured Markdown with headings and tables |
| Images | ImageMagick, Tesseract | Optimized image, OCR text, and metadata |
| Audio | FFmpeg, speech-to-text | Timestamped transcript |
| Video | FFmpeg, ImageMagick, speech-to-text | Transcript and representative keyframes |

qpdf handles PDF structure, Ghostscript renders or compresses pages, Pandoc converts structured documents, FFmpeg processes audio/video, and ImageMagick prepares images. FlowKit handles validation, metadata, chunking, retrieval, context construction, and token measurement.

## Hackathon MVP

Demonstrate one useful pipeline for every original tool family:

1. **PDF:** extract page-aware text and answer with page citations.
2. **Document:** convert DOCX to structured Markdown and retrieve relevant sections.
3. **Image:** resize an image and extract visible text with OCR.
4. **Audio:** extract or normalize audio and create a timestamped transcript.
5. **Video:** trim or extract audio, transcribe it, and answer with timestamp citations. Keyframes are an optional preview.
6. Offer shared chunking, embedding, retrieval, and context-building nodes as an optional continuation of extraction workflows.
7. Expose the same operations through a working MCP server and demonstrate one external agent calling them without generating scripts.
8. Show code-generation and context-token savings separately, alongside execution time and answer quality.

The MVP supports one input at a time and linear pipelines. It does not need accounts, persistence, billing, collaboration, or arbitrary workflow graphs. A downloadable transformed file is a complete workflow result even without an AI answer.

## User experience

### Workspace

- File upload and sample files
- Searchable node palette grouped by file type
- Drag-and-drop pipeline canvas
- Selected-node settings
- Node progress and duration
- Output preview and download
- Question input and cited answer
- Retrieved-context inspector
- Token, cost, and latency comparison

### Example pipelines

```text
PDF Upload
 -> Extract Text
 -> OCR Missing Pages
 -> Clean
 -> Chunk
 -> Retrieve
 -> Ask AI
```

```text
DOCX Upload
 -> Pandoc to Markdown
 -> Chunk by Heading
 -> Retrieve
 -> Ask AI
```

```text
Image Upload
 -> Resize
 -> OCR
 -> Chunk
 -> Retrieve
 -> Ask AI
```

```text
Video Upload
 -> Extract Audio
 -> Transcribe
 -> Build Timestamped Chunks
 -> Retrieve
 -> Ask AI
```

The application provides working templates for these pipelines. Users rearrange compatible nodes or change safe options. Conversion-only templates include DOCX to Markdown and image resize/convert followed by download.

FFmpeg handles media processing; speech-to-text requires a separate transcription model. ImageMagick prepares images; Tesseract extracts visible text. Understanding diagrams or silent video scenes requires vision processing, which is deferred. OCR and transcripts alone do not capture all visual information.

## Node catalog

### Inputs and outputs

- `file.upload`
- `artifact.preview`
- `artifact.download`

### PDF

- `pdf.inspect`
- `pdf.selectPages`
- `pdf.compress`
- `pdf.extractText`
- `pdf.renderPages`
- `pdf.ocrMissingPages`

### Documents

- `document.toMarkdown`
- `document.extractStructure`

### Images

- `image.resize`
- `image.convert`
- `image.ocr`

### Audio and video

- `audio.normalize`
- `audio.transcribe`
- `video.extractAudio`
- `video.extractKeyframes`
- `video.trim`

### Context and RAG

- `context.clean`
- `context.chunk`
- `context.embed`
- `context.retrieve`
- `context.build`
- `context.measureTokens`
- `ai.answer`

Only nodes needed by the five demo pipelines must be implemented. The catalog describes the product boundary, not a requirement to expose every CLI option.

## Unified content model

All extractors emit the same basic record with format-specific location metadata:

```json
{
  "id": "quarterly-review-125-162",
  "kind": "transcript",
  "text": "The presenter explains the deployment architecture...",
  "source": "quarterly-review.mp4",
  "location": {
    "startSeconds": 125,
    "endSeconds": 162
  },
  "tokenCount": 184
}
```

Examples of `location`:

- PDF: `{ "page": 12 }`
- Document: `{ "heading": "Revenue", "section": 3 }`
- Image: `{ "region": [120, 80, 640, 240] }`
- Audio/video: `{ "startSeconds": 125, "endSeconds": 162 }`
- Video keyframe: `{ "timestampSeconds": 141 }`

This shared model lets one RAG implementation work across every file type and produce page, section, region, or timestamp citations.

## Pipeline representation

The visual editor and FlowKit pipeline executor share one JSON format. External agents make individual MCP tool calls and do not need to submit this graph. This example is an extraction-only workflow; RAG nodes can follow it:

```json
{
  "nodes": [
    { "id": "upload", "type": "file.upload" },
    { "id": "audio", "type": "video.extractAudio" },
    { "id": "transcript", "type": "audio.transcribe" }
  ],
  "edges": [
    { "source": "upload", "target": "audio" },
    { "source": "audio", "target": "transcript" }
  ]
}
```

Each node declares accepted input types, output types, safe settings, and its executable. FlowKit rejects incompatible connections before running.

## Architecture

```text
React pipeline editor       External AI agent
        |                         |
        v                         v
FlowKit pipeline executor   MCP individual tool calls
        |                         |
        +------------+------------+
                     |
                     v
         Prebuilt operation registry
        |
        v
Validate arguments and artifact access
        |
        v
Isolated operation worker
        |
        +-- qpdf / Ghostscript / pdftotext / Tesseract
        +-- Pandoc
        +-- FFmpeg
        +-- ImageMagick
        +-- Speech-to-text provider
        |
        v
Processed artifacts -> Compact MCP result -> Agent's own next steps
        |
        +-- FlowKit preview / download
        |
        v
Optional unified content records
        |
        v
In-memory embeddings and retrieval
        |
        v
Answer + citations + token benchmark
```

Native commands use fixed executables and constructed argument arrays. FlowKit never accepts arbitrary shell commands or raw user-provided flags.

For the hackathon, use one frontend/API, one isolated execution worker, temporary artifact storage, and an in-memory retrieval index. Cache extraction and embeddings within the job session so repeated questions do not reprocess the file.

## MCP access

MCP is a core platform interface alongside the visual editor. It invokes individual operations from the same registry without entering the visual workflow's pipeline executor. External agents own sequencing and may perform further processing, retrieval, or model calls themselves.

- Expose concise schemas for the implemented operations, such as `image.resize` and `document.toMarkdown` (map internal names to protocol-compatible tool names as needed).
- Provide individual operation tools and a job-status tool for longer operations. Pipeline submission through MCP is outside the MVP scope.
- Reference files through authorized artifact IDs or a defined upload/import mechanism, never arbitrary host filesystem paths.
- Return compact results: job status, artifact references, metadata, and concise errors. Keep binary content and verbose logs out of model context.
- Let agents request extracted context or citations explicitly rather than returning every intermediate result.
- Demonstrate an external MCP client converting a document or resizing an image using prewritten operations.

## Retrieval and context rules

- Preserve page, heading, region, and timestamp metadata through every node.
- Chunk text on semantic boundaries before fixed lengths.
- Retrieve a fixed maximum number of chunks.
- Cap final context by token count.
- Display every text chunk sent to the model; show keyframes as previews until vision processing is implemented.
- Answer "not found in the provided context" when evidence is missing.
- Never describe a retrieved subset as exhaustive analysis of the source.
- Keep original artifacts available during the job so users can inspect citations.

## Benchmark

### Code-generation savings

Run the same transformation task with the same model and equivalent instructions in two conditions: agent-generated scripts versus FlowKit MCP tools. Record all model calls, tool-schema overhead, input/output tokens, retries, elapsed time, and output correctness. Reusable tools still consume schema and call tokens; quantify the net difference.

### Context savings

For each question-answering demo pipeline, show the following report (illustrative values, not measured results):

```text
Source representation:  182,400 tokens
Retrieved evidence:       6,800 tokens
Final model context:      7,250 tokens
Reduction:                  96.0%
Citations:                      6
Processing time:             4.2s
```

Compare FlowKit against sending the full extracted representation. Measure:

- Input tokens
- Model cost
- Processing and response latency
- Retrieval accuracy
- Citation accuracy
- Unsupported-answer rejection

Token reduction only counts as a success when the answer retains the required evidence. Use the same question and answer model for both conditions. If full context exceeds the model limit, report that limitation rather than inventing a baseline run.

Report embedding, OCR, transcription, model usage, and preprocessing costs alongside inference savings. Distinguish first-run indexing cost from subsequent-query cost. Compare image/video token usage only when the provider reports usage or a documented estimator is available; file-size reduction alone is not a token metric.

## Evaluation fixtures

Keep one small sample for each format:

- Text PDF and scanned PDF
- DOCX with headings and a table
- Screenshot or receipt containing text
- Short audio clip with known transcript
- Short video containing speech and scene changes

Each sample needs expected extracted content and at least two questions with expected citations. Include questions whose answers are absent.

## Build order

### Phase 1: shared foundation

- File validation and temporary artifact handling
- Pipeline JSON types and connection validation
- Linear node executor
- Unified content record
- Chunking, token counting, in-memory embedding, and retrieval
- Shared operation registry with declared input/output types and structured results

### Phase 2: document vertical slices

- PDF text extraction with page citations
- OCR fallback for scanned pages
- Pandoc conversion with heading citations
- Cited answers and token report

### Phase 3: media vertical slices

- Image resize and OCR with region metadata
- Audio normalization and timestamped transcription
- Video audio extraction and keyframe sampling
- Timestamped retrieval and answers

### Phase 4: visual builder

- Pipeline templates
- Node palette and canvas
- Node settings, progress, duration, and output inspection
- Reject invalid connections visually
- MCP adapter invoking individual operations from the registry; orchestration stays with the external agent
- One external-agent integration demo with artifact input/output

### Phase 5: benchmark and demo

- Add the five fixtures and expected answers
- Run accuracy and token comparisons
- Compare generated scripts against MCP tool calls separately from the RAG comparison
- Add reset and sample-workflow controls
- Record the end-to-end demonstration

## AI provider

Keep model, embedding, vision, and transcription credentials server-side:

```text
AI_API_KEY=
AI_BASE_URL=
AI_MODEL=
EMBEDDING_MODEL=
TRANSCRIPTION_MODEL=
```

AI Grants India may fund access, but FlowKit must work with manual pipelines and deterministic file operations when model credits are unavailable. Confirm quota, expiry, models, commercial permission, and data retention before using its key.

## Production requirements

- File signature and MIME validation
- Per-format size, duration, resolution, and page limits
- Container isolation for native tools
- Worker memory, CPU, disk, and execution time limits
- Safe argument arrays without shell interpolation
- Malware scanning for public uploads
- Encrypted temporary storage and automatic deletion
- Job cancellation and bounded retries
- Pinned native-tool versions
- Redacted logs and usage monitoring
- Provider timeout, quota, privacy, and failure handling

## Deferred

- Branches, loops, and parallel graph execution
- Multiple inputs in one pipeline
- Accounts, collaboration, and persistent file libraries
- Persistent vector database
- Natural-language generation of pipeline JSON
- Vision understanding of diagrams and silent video scenes
- Marketplace, billing, crypto, and tokens
- Native desktop packaging

## Pitch

> FlowKit is a visual workflow builder and MCP server offering prebuilt document and media tools to reduce AI code-generation tokens.
> It uses RAG to deliver relevant, source-cited context, further reducing token usage and cost.
