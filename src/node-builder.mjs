import { catalog, canConnect } from "./catalog.mjs";

export const nodeKinds = [
  { kind: "upload", title: "Upload", description: "Start with your input file", icon: "upload", color: "blue" },
  { kind: "process", title: "Process", description: "Choose a file type and operation", icon: "settings", color: "purple" },
  { kind: "pipe", title: "Pipe", description: "Merge documents or pass one file through", icon: "arrow", color: "teal" },
  { kind: "download", title: "Download", description: "Preview and download the result", icon: "download", color: "orange" },
];
export const fileTypes = ["Image", "Text", "Audio", "Video"];
export function fileCategory(name = "") {
  return /\.(png|jpe?g)$/i.test(name) ? "Image" : /\.(mp3|wav|m4a)$/i.test(name) ? "Audio" : /\.(mp4|mov|webm|mkv)$/i.test(name) ? "Video" : "Text";
}
export function outputCategory(item) {
  return ({ image: "Image", audio: "Audio", video: "Video", document: "Text", markdown: "Text" })[item?.outputType] || item?.category;
}
export function nodeKind(node) {
  const group = catalog.find((item) => item.type === node?.data?.operation)?.group;
  return node?.data?.kind || ({ Input: "upload", Transform: "process", Pipe: "pipe", Output: "download" })[group];
}
export function nodeItem(node) {
  return catalog.find((item) => item.type === node?.data?.operation) || {
    type: "", title: "Process", icon: "settings", color: "purple", category: node?.data?.fileType,
    description: "Choose an available operation", inputType: null, outputType: null,
  };
}
export function processOptions(category, inputType) {
  return catalog.filter((item) => item.group === "Transform" && item.category === category &&
    (!inputType || item.inputType === inputType));
}
export function defaultOptions(operation) {
  if (operation === "audio.convert" || operation === "video.extractAudio") return { format: "mp3" };
  if (operation === "audio.trim") return { startSeconds: 0, durationSeconds: 10, format: "mp3" };
  if (operation === "video.trim") return { startSeconds: 0, durationSeconds: 10 };
  return operation === "image.resize" ? { width: 800, height: 800 } :
    operation === "context.clean" ? { collapseBlankLines: true } : {};
}

// Resolve upstream first so changing an upload also updates Process, Pipe, and Download descendants.
export function adaptNodes(nodes, edges, filename) {
  const resolved = new Map();
  const visiting = new Set();
  function resolve(id) {
    if (resolved.has(id)) return resolved.get(id);
    const node = nodes.find((item) => item.id === id);
    if (!node || visiting.has(id)) return node;
    visiting.add(id);
    const parentId = edges.find((edge) => edge.target === id)?.source;
    const parent = parentId ? resolve(parentId) : null;
    const input = parent ? nodeItem(parent) : null;
    const kind = nodeKind(node);
    let category = outputCategory(input) || node.data.fileType || nodeItem(node).category || "Text";
    let operation = node.data.operation;
    if (kind === "upload") {
      category = filename ? fileCategory(filename) : category;
      operation = category === "Text" ? "file.upload" : `${category.toLowerCase()}.upload`;
    } else if (kind === "process") {
      const options = processOptions(category, input?.outputType);
      if (!options.some((item) => item.type === operation)) operation = options[0]?.type || "";
    } else if (kind === "pipe") {
      operation = node.data.operation === "document.merge" ? "document.merge" : `${input?.outputType || nodeItem(node).inputType || (category === "Text" ? "document" : category.toLowerCase())}.pipe`;
    } else if (kind === "download") {
      operation = category === "Text" ? (input?.outputType === "document" ? "document.preview" : "artifact.preview") : `${category.toLowerCase()}.preview`;
    }
    const next = { ...node, data: { ...node.data, kind, fileType: category, operation,
      options: operation === node.data.operation ? node.data.options || {} : defaultOptions(operation) } };
    resolved.set(id, next);
    visiting.delete(id);
    return next;
  }
  return nodes.map((node) => resolve(node.id));
}

export function connectNodes(connection, nodes, edges, filename) {
  const nextEdges = [...edges, { id: `${connection.source}-${connection.target}`, ...connection }];
  const nextNodes = adaptNodes(nodes, nextEdges, filename);
  return canConnect(connection, nextNodes, edges) ? { nodes: nextNodes, edges: nextEdges } : null;
}
