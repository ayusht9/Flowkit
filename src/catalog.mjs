export const catalog = [
  {
    type: "file.upload",
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
    title: "Convert to Markdown",
    description: "Preserve headings, lists, and tables",
    inputType: "document",
    outputType: "markdown",
    icon: "document",
    color: "purple",
    group: "Transform",
  },
  {
    type: "context.clean",
    title: "Clean Markdown",
    description: "Normalize spacing and blank lines",
    inputType: "markdown",
    outputType: "markdown",
    icon: "sparkles",
    color: "teal",
    group: "Transform",
  },
  {
    type: "artifact.preview",
    title: "Preview & download",
    description: "Inspect the result and save a .md file",
    inputType: "markdown",
    outputType: "markdown",
    icon: "download",
    color: "orange",
    group: "Output",
  },
];

export function defaultWorkflow() {
  return {
    name: "Document to context",
    nodes: [
      {
        id: "upload",
        type: "operation",
        position: { x: 60, y: 110 },
        data: { operation: "file.upload", options: {} },
      },
      {
        id: "convert",
        type: "operation",
        position: { x: 390, y: 110 },
        data: { operation: "document.toMarkdown", options: {} },
      },
      {
        id: "clean",
        type: "operation",
        position: { x: 390, y: 360 },
        data: {
          operation: "context.clean",
          options: { collapseBlankLines: true },
          reverse: true,
        },
      },
      {
        id: "preview",
        type: "operation",
        position: { x: 60, y: 360 },
        data: { operation: "artifact.preview", options: {}, reverse: true },
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
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.operation,
      options: node.data.options || {},
    })),
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
    to.type === "file.upload" ||
    from.type === "artifact.preview" ||
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
      !catalog.some((item) => item.type === node.data?.operation)
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
