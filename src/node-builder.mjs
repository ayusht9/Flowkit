import { catalog, canConnect } from "./catalog.mjs";
import { imageOperations } from './image-operations.mjs';
import { mediaOperations } from './media-operations.mjs';
import { pdfOperations } from './pdf-operations.mjs';

export const nodeKinds = [
  { kind: "upload", title: "Upload", description: "Start with your input file", icon: "upload", color: "blue" },
  { kind: "process", title: "Process", description: "Choose a file type and operation", icon: "settings", color: "purple" },
  { kind: "pipe", title: "Pipe", description: "Merge documents or pass one file through", icon: "arrow", color: "teal" },
  { kind: "download", title: "Download", description: "Preview and download the result", icon: "download", color: "orange" },
];
export const fileTypes = ["Image", "Text", "Audio", "Video", "PDF"];
export function fileCategory(name = "") {
  return /\.pdf$/i.test(name) ? 'PDF' : /\.(png|jpe?g)$/i.test(name) ? "Image" : /\.(mp3|wav|m4a)$/i.test(name) ? "Audio" : /\.(mp4|mov|webm|mkv)$/i.test(name) ? "Video" : "Text";
}
export function outputCategory(item) {
  return ({ pdf: 'PDF', image: "Image", audio: "Audio", video: "Video", document: "Text", markdown: "Text" })[item?.outputType] || item?.category;
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
  const pdf = pdfOperations.find(item => item.type === operation);
  if (pdf) return { ...pdf.defaults };
  const image = imageOperations.find(item => item.type === operation);
  if (image) return { ...image.defaults };
  const media = mediaOperations.find(item => item.type === operation);
  if (media) return { ...media.defaults };
  return operation === "context.clean" ? { collapseBlankLines: true } : {};
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
      operation = ['document.merge', 'pdf.merge'].includes(node.data.operation) && ['PDF', 'Text'].includes(category)
        ? (category === 'PDF' ? 'pdf.merge' : 'document.merge')
        : `${input?.outputType || nodeItem(node).inputType || (category === "Text" ? "document" : category.toLowerCase())}.pipe`;
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
