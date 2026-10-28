# FlowKit diagrams

Diagram definitions prepared for the FlowKit Miro board. These have not yet been published to Miro.

## 1. Platform architecture

```mermaid
flowchart TD
  UI[Visual workflow editor] --> Pipeline[FlowKit pipeline executor]
  Pipeline --> Validate[Validate pipeline and artifact access]
  Validate --> Runner[Prebuilt operations and isolated worker]
  Agent[External AI agent] --> MCP[MCP server]
  MCP --> Call[Validate individual tool call and artifact access]
  Call --> Runner
  Runner --> PDF[qpdf / Ghostscript / pdftotext]
  Runner --> Docs[Pandoc]
  Runner --> Images[ImageMagick / Tesseract]
  Runner --> Media[FFmpeg / speech-to-text]
  PDF --> Outputs[Artifacts and source-located content]
  Docs --> Outputs
  Images --> Outputs
  Media --> Outputs
  Outputs --> Download[FlowKit preview and download]
  Outputs --> RAG[Optional FlowKit RAG pipeline]
  RAG --> Answer[Context export or cited answer]
  Outputs --> Result[Compact MCP result and artifact references]
  Result --> Agent
  Agent --> Next[Agent chooses further processing or its own RAG and model calls]
```

## 2. User journey

```mermaid
flowchart LR
  Upload[Upload file] --> Template[Choose workflow template]
  Template --> Edit[Drag nodes and configure settings]
  Edit --> Check{Compatible connections?}
  Check -->|No| Edit
  Check -->|Yes| Run[Run pipeline]
  Run --> Inspect[Inspect progress and node outputs]
  Inspect --> Result{Desired result}
  Result -->|File transformation| Download[Preview and download]
  Result -->|Question answering| Question[Ask question]
  Question --> Evidence[Inspect retrieved evidence]
  Evidence --> Answer[Answer with source citations]
```

## 3. File-specific templates

```mermaid
flowchart LR
  PDF[PDF] --> Text[pdftotext]
  Text --> Missing{Pages missing usable text?}
  Missing -->|Yes| OCR[Ghostscript render and Tesseract OCR]
  Missing -->|No| Records[Unified content with source locations]
  OCR --> Records
  DOCX[DOCX / HTML / EPUB] --> Pandoc[Pandoc to structured Markdown]
  Pandoc --> Records
  Image[Image] --> Resize[ImageMagick resize / convert]
  Resize --> ImageOCR[Tesseract OCR]
  ImageOCR --> Records
  Audio[Audio] --> Normalize[FFmpeg normalize]
  Video[Video] --> Extract[FFmpeg extract audio]
  Extract --> Normalize
  Normalize --> STT[Timestamped transcription]
  STT --> Records
  Resize --> Artifact[Download transformed artifact]
  Pandoc --> Artifact
  Video --> Trim[FFmpeg trim]
  Trim --> Artifact
```

## 4. RAG lifecycle

```mermaid
flowchart TD
  Source[Extracted content with source locations] --> Clean[Clean cautiously]
  Clean --> Chunk[Chunk by page / heading / timestamp]
  Chunk --> Embed[Create embeddings once]
  Embed --> Index[Session index and cached chunks]
  Question[User question] --> QEmbed[Embed question]
  QEmbed --> Retrieve[Retrieve relevant chunks]
  Index --> Retrieve
  Retrieve --> Budget[Build context within token budget]
  Budget --> Inspect[Expose selected evidence]
  Inspect --> Export[Export AI-ready context]
  Inspect --> Model[Answer model]
  Model --> Response[Cited answer or insufficient-evidence response]
```

## 5. MCP operation execution

```mermaid
sequenceDiagram
  participant Agent as AI agent
  participant MCP as FlowKit MCP
  participant Operation as Prebuilt operation
  participant Tool as Native tool
  Agent->>MCP: Discover concise operation schemas
  MCP-->>Agent: Supported tools and parameter types
  Agent->>MCP: Run operation with artifact ID and settings
  MCP->>Operation: Validate and invoke one operation
  Operation->>Tool: Execute fixed program with argument array
  Tool-->>Operation: Output artifact or execution error
  Operation-->>MCP: Job status and artifact metadata
  MCP-->>Agent: Compact result with artifact reference
  Note over Agent: Agent controls subsequent steps, retrieval, and model calls
  Note over Agent,Tool: Existing implementations replace generated scripts
```

## 6. Token-savings evaluation

```mermaid
flowchart TD
  Evaluation[Equivalent tasks and quality checks] --> Tools[Execution comparison]
  Evaluation --> Context[Context comparison]
  Tools --> Scripts[Agent generates and debugs scripts]
  Tools --> MCP[Agent calls prebuilt MCP tools]
  Scripts --> ToolMetrics[Tokens including schemas / retries / time / output correctness]
  MCP --> ToolMetrics
  Context --> Full[Full extracted representation]
  Context --> RAG[Retrieved evidence]
  Full --> ContextMetrics[Input tokens / cost / latency / answer and citation accuracy]
  RAG --> ContextMetrics
  ToolMetrics --> Report[Report both savings separately]
  ContextMetrics --> Report
  Extra[Include extraction, embedding, transcription, and indexing costs] --> Report
```

## 7. Hackathon build sequence

```mermaid
flowchart LR
  Foundation[Shared types, artifacts, validation, executor] --> Adapters[PDF, Pandoc, ImageMagick, FFmpeg adapters]
  Adapters --> Retrieval[Unified extraction and optional RAG]
  Retrieval --> Interfaces[Visual templates and MCP adapter]
  Interfaces --> Verify[Fixtures, integration checks, token benchmarks]
  Verify --> Demo[End-to-end demo and pitch]
```
