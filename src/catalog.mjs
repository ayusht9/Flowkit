export const catalog = [
  ...["audio", "video"].flatMap((type) => [
    { type: `${type}.upload`, category: type === "audio" ? "Audio" : "Video", title: `Upload ${type}`, description: `Start with an ${type} file`, inputType: type, outputType: type, icon: "upload", color: "blue", group: "Input" },
    { type: `${type}.pipe`, category: type === "audio" ? "Audio" : "Video", title: "Pipe", description: "Pass media through unchanged", inputType: type, outputType: type, icon: "arrow", color: "teal", group: "Pipe" },
    { type: `${type}.preview`, category: type === "audio" ? "Audio" : "Video", title: `Preview & download ${type}`, description: `Play and download the ${type}`, inputType: type, outputType: type, icon: "download", color: "orange", group: "Output" },
  ]),
  { type: "audio.convert", category: "Audio", title: "Convert audio", description: "Convert to MP3 or WAV with FFmpeg", inputType: "audio", outputType: "audio", icon: "audio", color: "purple", group: "Transform" },
  { type: "audio.trim", category: "Audio", title: "Trim audio", description: "Choose a start time and duration", inputType: "audio", outputType: "audio", icon: "audio", color: "purple", group: "Transform" },
  { type: "video.trim", category: "Video", title: "Trim video", description: "Trim and encode a browser-ready MP4", inputType: "video", outputType: "video", icon: "video", color: "purple", group: "Transform" },
  { type: "video.extractAudio", category: "Video", title: "Extract audio", description: "Save a video's audio track as MP3 or WAV", inputType: "video", outputType: "audio", icon: "audio", color: "purple", group: "Transform" },
  ...["document", "markdown", "image"].map((type) => ({
    type: `${type}.pipe`, category: type === "image" ? "Image" : "Text",
    title: "Pipe", description: "Pass the output to the next step unchanged",
    inputType: type, outputType: type, icon: "arrow", color: "teal", group: "Pipe",
  })),
  { type: "image.upload", category: "Image", title: "Upload image", description: "Start with a PNG or JPEG", inputType: "image", outputType: "image", icon: "upload", color: "blue", group: "Input" },
  { type: "image.resize", category: "Image", title: "Resize image", description: "Fit within dimensions, preserving aspect ratio", inputType: "image", outputType: "image", icon: "settings", color: "purple", group: "Transform" },
  { type: "image.preview", category: "Image", title: "Preview & download image", description: "Inspect and download the resized PNG", inputType: "image", outputType: "image", icon: "download", color: "orange", group: "Output" },
  {
    type: "file.upload",
    category: "Text",
    title: "Upload document",
    description: "Start with a file from your computer",
    inputType: "document",
    outputType: "document",
    icon: "upload",
    color: "blue",
    group: "Input",
  },
  {
    type: "document.toMarkdown",
    category: "Text",
    title: "Convert to Markdown",
    description: "Preserve headings, lists, and tables",
    inputType: "document",
    outputType: "markdown",
    icon: "document",
    color: "purple",
    group: "Transform",
    section: "Text",
  },
  ...[
    ["document.toHtml", "Convert to HTML", "Create a standalone web document", "Office"],
    ["document.toDocx", "Convert to Word", "Create a Microsoft Word .docx file", "Office"],
    ["document.toOdt", "Convert to OpenDocument", "Create an editable .odt file", "Office"],
    ["document.toEpub", "Convert to EPUB", "Create an EPUB 3 ebook", "Office"],
    ["document.toPdf", "Create PDF", "Create a PDF using Pandoc's installed PDF engine", "PDF"],
  ].map(([type, title, description, section]) => ({
    type, category: "Text", title, description, section,
    inputType: "document", outputType: "document", icon: "document", color: "purple", group: "Transform",
  })),
  {
    type: "context.clean",
    category: "Text",
    title: "Clean Markdown",
    description: "Normalize spacing and blank lines",
    inputType: "markdown",
    outputType: "markdown",
    icon: "sparkles",
    color: "teal",
    group: "Transform",
  },
  {
    type: "document.preview",
    category: "Text",
    title: "Download document",
    description: "Download the converted office or PDF file",
    inputType: "document",
    outputType: "document",
    icon: "download",
    color: "orange",
    group: "Output",
  },
  {
    type: "artifact.preview",
    category: "Text",
    title: "Preview & download",
    description: "Inspect the result and save a .md file",
    inputType: "markdown",
    outputType: "markdown",
    icon: "download",
    color: "orange",
    group: "Output",
  },
];

export function mediaWorkflow(type = "audio") {
  if (!["audio", "video"].includes(type)) throw new TypeError("Choose audio or video");
  return { name: type === "audio" ? "Audio conversion" : "Video trim", nodes: [
    { id: "media-upload", type: "operation", position: { x: 80, y: 240 }, data: { operation: `${type}.upload`, options: {} } },
    { id: "media-process", type: "operation", position: { x: 380, y: 240 }, data: { operation: type === "audio" ? "audio.convert" : "video.trim", options: type === "audio" ? { format: "mp3" } : { startSeconds: 0, durationSeconds: 10 } } },
    { id: "media-download", type: "operation", position: { x: 680, y: 240 }, data: { operation: `${type}.preview`, options: {} } },
  ], edges: [{ id: "media-input", source: "media-upload", target: "media-process" }, { id: "media-output", source: "media-process", target: "media-download" }] };
}

export function imageWorkflow() {
  return {
    name: "Resize image",
    nodes: [
      { id: "upload-image", type: "operation", position: { x: 80, y: 240 }, data: { operation: "image.upload", options: {} } },
      { id: "resize", type: "operation", position: { x: 340, y: 240 }, data: { operation: "image.resize", options: { width: 800, height: 800 } } },
      { id: "preview-image", type: "operation", position: { x: 600, y: 240 }, data: { operation: "image.preview", options: {} } },
    ],
    edges: [ { id: "image-resize", source: "upload-image", target: "resize" }, { id: "resize-preview", source: "resize", target: "preview-image" } ],
  };
}

export function defaultWorkflow() {
  return {
    name: "Document to context",
    nodes: [
      {
        id: "upload",
        type: "operation",
        position: { x: 80, y: 240 },
        data: { operation: "file.upload", options: {} },
      },
      {
        id: "convert",
        type: "operation",
        position: { x: 340, y: 240 },
        data: { operation: "document.toMarkdown", options: {} },
      },
      {
        id: "clean",
        type: "operation",
        position: { x: 600, y: 240 },
        data: {
          operation: "context.clean",
          options: { collapseBlankLines: true },
        },
      },
      {
        id: "preview",
        type: "operation",
        position: { x: 860, y: 240 },
        data: { operation: "artifact.preview", options: {} },
      },
    ],
    edges: [
      { id: "upload-convert", source: "upload", target: "convert" },
      { id: "convert-clean", source: "convert", target: "clean" },
      { id: "clean-preview", source: "clean", target: "preview" },
    ],
  };
}

export function toPipeline(nodes, edges) {
  return {
    nodes: nodes.map((node) => {
      if (!node.data.operation) throw new Error("Choose an available operation for every Process node.");
      return {
        id: node.id,
        type: node.data.operation,
        options: node.data.options || {},
      };
    }),
    edges: edges.map(({ source, target }) => ({ source, target })),
  };
}

export function canConnect(connection, nodes, edges) {
  if (connection.source === connection.target) return false;
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  const from = catalog.find((item) => item.type === source?.data.operation);
  const to = catalog.find((item) => item.type === target?.data.operation);
  if (
    !from ||
    !to ||
    to.group === "Input" ||
    from.group === "Output" ||
    from.outputType !== to.inputType
  )
    return false;
  if (
    edges.some(
      (edge) =>
        edge.source === connection.source || edge.target === connection.target,
    )
  )
    return false;
  let id = connection.target;
  const visited = new Set();
  while (id && !visited.has(id)) {
    if (id === connection.source) return false;
    visited.add(id);
    id = edges.find((edge) => edge.source === id)?.target;
  }
  return true;
}

export function parseWorkflow(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.name !== "string" ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges)
  ) {
    throw new Error("Choose a FlowKit workflow JSON file.");
  }
  if (value.nodes.length > 20 || value.edges.length > 20)
    throw new Error("Workflows support up to 20 nodes.");
  const ids = new Set();
  const nodes = value.nodes.map((node) => {
    if (
      !node ||
      typeof node.id !== "string" ||
      !node.id ||
      ids.has(node.id) ||
      !(catalog.some((item) => item.type === node.data?.operation) ||
        (node.data?.kind === "process" && node.data.operation === ""))
    ) {
      throw new Error(
        "The workflow contains an unknown operation or invalid node ID.",
      );
    }
    ids.add(node.id);
    if (
      !Number.isFinite(node.position?.x) ||
      !Number.isFinite(node.position?.y)
    )
      throw new Error("Invalid node position.");
    const options = node.data.options ?? {};
    if (!options || typeof options !== "object" || Array.isArray(options))
      throw new Error("Invalid node options.");
    return {
      id: node.id,
      type: "operation",
      position: { x: node.position.x, y: node.position.y },
      data: {
        operation: node.data.operation,
        options,
        ...(["upload", "process", "pipe", "download"].includes(node.data.kind) ? { kind: node.data.kind } : {}),
        ...(["Image", "Text", "Audio", "Video"].includes(node.data.fileType) ? { fileType: node.data.fileType } : {}),
        ...(node.data.reverse === true ? { reverse: true } : {}),
      },
    };
  });
  const edges = [];
  for (const edge of value.edges) {
    if (!edge || !canConnect(edge, nodes, edges))
      throw new Error(
        "The workflow contains incompatible or circular connections.",
      );
    edges.push({
      id: `edge-${edges.length}`,
      source: edge.source,
      target: edge.target,
    });
  }
  return { name: value.name.slice(0, 100), nodes, edges };
}
