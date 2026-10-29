import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  catalog,
  defaultWorkflow,
  imageWorkflow,
  mediaWorkflow,
  toPipeline,
  parseWorkflow,
} from "../src/catalog.mjs";
import { nodeKinds, fileTypes, fileCategory, outputCategory, nodeKind, nodeItem, processOptions, defaultOptions, adaptNodes, connectNodes } from "../src/node-builder.mjs";
import { Icon } from "./icons.jsx";
import "./styles.css";

function readWorkspace() {
  try {
    const stored = JSON.parse(localStorage.getItem("flowkit.workspace"));
    if (!Array.isArray(stored?.workflows)) return { workflows: [], activeId: null };
    const workflows = stored.workflows.flatMap((entry) => {
      try {
        return typeof entry.id === "string" ? [{ id: entry.id, workflow: parseWorkflow(entry.workflow) }] : [];
      } catch { return []; }
    });
    return { workflows, activeId: stored.activeId };
  } catch { return { workflows: [], activeId: null }; }
}
const workspace = readWorkspace();
const activeWorkflow = workspace.workflows.find((entry) => entry.id === workspace.activeId);
const initialWorkflow = activeWorkflow?.workflow || defaultWorkflow();
const initial = { ...initialWorkflow, nodes: adaptNodes(initialWorkflow.nodes, initialWorkflow.edges) };
const formatBytes = (bytes) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const nodeTypes = { operation: OperationNode };
const isUpload = (type) => catalog.find((item) => item.type === type)?.group === "Input";
const isPreview = (type) => catalog.find((item) => item.type === type)?.group === "Output";
const binaryMime = (value) => value.mimeType || ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska" })[value.name?.split(".").at(-1).toLowerCase()] || "application/octet-stream";

// Group badge helper
function NodeGroupBadge({ group }) {
  if (!group) return null;
  const classes = { Input: "badge-input", Transform: "badge-transform", Output: "badge-output", Pipe: "badge-pipe" };
  return <span className={`node-group-badge ${classes[group] || ""}`}>{group}</span>;
}

// Subtitle helper
function NodeSubtitle({ item, data }) {
  if (item.group === "Pipe") return "Pass through unchanged";
  if (isUpload(item.type)) return data.filename || "Drop or upload a file";
  if (item.type === "document.toMarkdown") return "via Pandoc · Markdown";
  if (item.type === "context.clean") return "Normalize spacing";
  if (item.type === "artifact.preview") return "Preview & download .md";
  if (item.type === "image.preview") return "Preview & download image";
  if (item.type.startsWith("image.") && item.type !== "image.upload") return "ImageMagick · PNG";
  return item.description || "";
}

function OperationNode({ data, selected }) {
  const node = { data };
  const item = nodeItem(node);
  const kind = nodeKind(node);
  const catalogItem = catalog.find((c) => c.type === item.type);
  const group = catalogItem?.group;
  const statusState = data.status || "idle";

  return (
    <div
      className={`operation-node card-node ${item.color} ${selected ? "is-selected" : ""} state-${statusState}`}
    >
      {kind === "process" && <div className="card-file-type nodrag nopan">
        <FileTypeSelector category={data.fileType} locked={data.inferred}
          disabled={data.running} onChange={data.onFileTypeChange} />
      </div>}

      {/* Hover action buttons */}
      <div className="node-actions nodrag nopan">
        <button
          aria-label={`Configure ${item.title}`}
          title="Configure node"
          onClick={(event) => {
            event.stopPropagation();
            data.onConfigure();
          }}
        >
          <Icon name="settings" size={13} />
        </button>
        <button
          aria-label={`Delete ${item.title}`}
          title="Delete node"
          disabled={data.running}
          onClick={(event) => {
            event.stopPropagation();
            data.onRemove();
          }}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>

      {/* Card body */}
      <div className="card-body">
        {/* Icon with handles and status ring */}
        <div className="card-icon-col">
          {!isUpload(item.type) && (
            <Handle
              type="target"
              position={data.reverse ? Position.Right : Position.Left}
              aria-label={`${item.title} input`}
            />
          )}
          <div className={`card-icon-ring state-${statusState}`}>
            <div className="card-icon-inner">
              <Icon name={item.icon} size={24} />
            </div>
            {data.status === "succeeded" && (
              <span className="node-success">
                <Icon name="check" size={10} />
              </span>
            )}
            {data.status === "running" && <span className="spinner" />}
            {data.status === "failed" && <span className="node-failure">!</span>}
          </div>
          {!isPreview(item.type) && (
            <Handle
              type="source"
              position={data.reverse ? Position.Left : Position.Right}
              aria-label={`${item.title} output`}
            />
          )}
        </div>

        {/* Text content */}
        <div className="card-text">
          <NodeGroupBadge group={group} />
          <h3 className="card-heading">{item.title}</h3>
          <p className="card-subtitle">
            <NodeSubtitle item={item} data={data} />
          </p>
          {data.status && (
            <span className={`node-status-pill status-${statusState}`}>
              {statusState === "succeeded"
                ? `✓ ${Math.round(data.durationMs)} ms`
                : statusState === "running" || statusState === "started"
                  ? "Running…"
                  : statusState === "failed"
                    ? "Failed"
                    : statusState}
            </span>
          )}
        </div>

        {/* Append button */}
        {data.canAppend && (
          <button
            className="append-node nodrag nopan"
            aria-label={`Add after ${item.title}`}
            title="Add next step"
            disabled={data.running}
            onClick={(event) => {
              event.stopPropagation();
              data.onAddAfter();
            }}
          >
            <Icon name="plus" size={13} />
          </button>
        )}
      </div>

      {/* Process node selectors */}
      {kind === "process" && (
        <div className="card-selectors nodrag nopan">
          <OperationSelector category={data.fileType} operation={data.operation}
            inputType={data.inputType} disabled={data.running} onChange={data.onOperationChange} />
        </div>
      )}
    </div>
  );
}

function FileTypeSelector({ category, locked, disabled, onChange }) {
  return <label className="process-selector nodrag nopan" onClick={(event) => event.stopPropagation()}>
    <span>File type{locked && <small>From input</small>}</span>
    <select aria-label="File type" value={category} disabled={disabled || locked}
      onKeyDown={(event) => event.stopPropagation()} onChange={(event) => onChange(event.target.value)}>
      {fileTypes.map((type) => <option key={type}>{type}</option>)}
    </select>
  </label>;
}

function OperationSelector({ category, operation, inputType, disabled, onChange }) {
  const options = processOptions(category, inputType);
  return <label className="process-selector nodrag nopan" onClick={(event) => event.stopPropagation()}>
    <span>Operation</span>
    <select aria-label="Operation" value={operation} disabled={disabled || !options.length}
      onKeyDown={(event) => event.stopPropagation()} onChange={(event) => onChange(event.target.value)}>
      {!options.length && <option value="">No operations available yet</option>}
      {options.map((item) => <option key={item.type} value={item.type}>{item.title}</option>)}
    </select>
  </label>;
}

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [name, setName] = useState(initial.name);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const [pickerProcess, setPickerProcess] = useState(false);
  const [pickerFileType, setPickerFileType] = useState("Text");
  const [pickerOperation, setPickerOperation] = useState("document.toMarkdown");
  const [showLibrary, setShowLibrary] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorId, setAnchorId] = useState(null);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [events, setEvents] = useState([]);
  const [states, setStates] = useState({});
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [inspectorTab, setInspectorTab] = useState("settings");
  const [showLog, setShowLog] = useState(false);
  const [saved, setSaved] = useState(Boolean(activeWorkflow));
  const [savedWorkflows, setSavedWorkflows] = useState(workspace.workflows);
  const [workflowId, setWorkflowId] = useState(activeWorkflow?.id || null);
  const [workflowDialog, setWorkflowDialog] = useState(null);
  const [dialogName, setDialogName] = useState("");
  const [template, setTemplate] = useState("blank");
  const [showCanvasHint, setShowCanvasHint] = useState(true);
  const fileRef = useRef(null);
  const importRef = useRef(null);
  const abortRef = useRef(null);
  const menuRef = useRef(null);
  const workflowDialogRef = useRef(null);
  const searchRef = useRef(null);
  const flow = useReactFlow();
  const selected = nodes.find((node) => node.id === selectedId);
  const selectedItem = selected ? nodeItem(selected) : null;
  const output = result?.output?.value;
  const inputCategory = file ? fileCategory(file.name) : nodes.find((node) => isUpload(node.data.operation))?.data.fileType || "Text";
  const mediaOutput = isPreview(selected?.data.operation) && ["audio", "video"].includes(result?.output?.type) ? output : null;
  const imageOutput = selectedItem?.type === "image.preview" && result?.output?.type === "image" ? output : null;
  const nodeOutput = result?.nodes?.find(
    (node) => node.id === selectedId,
  )?.output;

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    const focusSearch = (event) => {
      if (
        event.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName,
        ) &&
        !menuOpen && !workflowDialog
      ) {
        event.preventDefault();
        setAnchorId(null);
        setInspectorOpen(false);
        setShowLibrary(true);
        searchRef.current?.focus();
      }
    };
    const closePanels = (event) => {
      if (event.key === "Escape") {
        setShowLibrary(false);
        setInspectorOpen(false);
      }
    };
    window.addEventListener("keydown", closePanels);
    window.addEventListener("keydown", focusSearch);
    return () => {
      window.removeEventListener("keydown", focusSearch);
      window.removeEventListener("keydown", closePanels);
    };
  }, [menuOpen, workflowDialog]);
  useEffect(() => {
    if (showLibrary) searchRef.current?.focus();
  }, [showLibrary]);
  useEffect(() => {
    if (menuOpen) menuRef.current?.showModal();
  }, [menuOpen]);
  useEffect(() => {
    if (workflowDialog) workflowDialogRef.current?.showModal();
  }, [workflowDialog]);
  useEffect(() => {
    const timer = setTimeout(
      () => flow.fitView({ padding: 0.25, duration: 200 }),
      100,
    );
    return () => clearTimeout(timer);
  }, [showLog]);
  function invalidate(markDirty = true) {
    setResult(null);
    setStates({});
    setEvents([]);
    if (markDirty) setSaved(false);
    setMessage("");
  }

  async function chooseFile(candidate) {
    if (!candidate || running) return;
    if (!/\.(png|jpe?g|docx|html?|epub|md|mp3|wav|m4a|mp4|mov|webm|mkv)$/i.test(candidate.name)) {
      setMessage("Choose a supported document, image, audio (WAV/MP3/M4A), or video (MP4/MOV/WebM/MKV) file.");
      return;
    }
    if (candidate.size === 0 || candidate.size > 20 * 1024 * 1024) {
      setMessage("Choose a file between 1 byte and 20 MiB.");
      return;
    }
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read this file."));
        reader.readAsDataURL(candidate);
      });
      setFile({ name: candidate.name, data, size: candidate.size });
      setNodes((current) => adaptNodes(current, edges, candidate.name));
      invalidate();
    } catch (error) {
      setMessage(error.message);
    }
  }

  function openLibrary(id = null) {
    setAnchorId(id);
    setSearch("");
    const source = nodes.find((node) => node.id === id);
    const sourceItem = source ? nodeItem(source) : null;
    const category = outputCategory(sourceItem) || (file ? fileCategory(file.name) : "Text");
    setPickerFileType(category);
    setPickerOperation(processOptions(category, sourceItem?.outputType)[0]?.type || "");
    setPickerProcess(Boolean(source));
    setShowLibrary(true);
    setInspectorOpen(false);
  }

  function removeNode(id) {
    if (running) return;
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) =>
      current.filter((edge) => edge.source !== id && edge.target !== id),
    );
    if (selectedId === id) {
      setSelectedId(null);
      setInspectorOpen(false);
    }
    invalidate();
  }

  function addNode(request, position) {
    if (running) return;
    if (nodes.length >= 20) { setMessage("A workflow can contain up to 20 nodes."); return; }
    const spec = typeof request === "string" ? { kind: request } : request;
    if (!spec || typeof spec !== "object") return;
    const kind = nodeKinds.some((item) => item.kind === spec.kind) ? spec.kind : nodeKind({ data: { operation: spec.kind } });
    if (!kind) return;
    if (kind === "upload" && nodes.some((node) => nodeKind(node) === "upload")) { setMessage("This workflow already has an Upload node."); return; }
    const id = crypto.randomUUID();
    const anchor = nodes.find((node) => node.id === anchorId);
    const category = (anchor && outputCategory(nodeItem(anchor))) || spec.fileType || (file ? fileCategory(file.name) : "Text");
    const operation = spec.operation || (catalog.some((item) => item.type === spec.kind) ? spec.kind : {
      upload: category === "Text" ? "file.upload" : `${category.toLowerCase()}.upload`, process: processOptions(category)[0]?.type || "",
      pipe: category === "Text" ? "document.pipe" : `${category.toLowerCase()}.pipe`, download: category === "Text" ? "artifact.preview" : `${category.toLowerCase()}.preview`,
    }[kind]);
    const location = position || (anchor ? { x: anchor.position.x + 300, y: anchor.position.y }
      : flow.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 }));
    const candidates = [...nodes, { id, type: "operation", position: location,
      data: { kind, fileType: category, operation, options: defaultOptions(operation) } }];
    const connection = anchor ? connectNodes({ source: anchor.id, target: id }, candidates, edges, file?.name) : null;
    if (anchor && !connection) { setMessage("Choose a compatible next step with an available connection."); return; }
    setNodes(connection?.nodes || adaptNodes(candidates, edges, file?.name));
    if (connection) setEdges(connection.edges);
    setSelectedId(id); setShowLibrary(false); setInspectorOpen(false); setAnchorId(null); setInspectorTab("settings"); invalidate();
    if (anchor) setTimeout(() => flow.fitView({ padding: 0.3, maxZoom: 1.2, duration: 200 }), 50);
  }
  function changeProcess(id, changes) {
    if (running) return;
    setNodes((current) => adaptNodes(current.map((node) => node.id === id
      ? { ...node, data: { ...node.data, ...changes, options: defaultOptions(changes.operation) } } : node), edges, file?.name));
    invalidate();
  }
  const isValidConnection = useCallback((connection) => Boolean(connectNodes(connection, nodes, edges, file?.name)), [nodes, edges, file]);
  const connect = useCallback((connection) => {
    if (running) return;
    const next = connectNodes(connection, nodes, edges, file?.name);
    if (next) { setNodes(next.nodes); setEdges(next.edges); invalidate(); }
  }, [nodes, edges, running, file]);

  function reset(blank = false, image = false, media = null) {
    const template = blank
      ? { name: "Untitled workflow", nodes: [], edges: [] }
      : media ? mediaWorkflow(media) : image ? imageWorkflow() : defaultWorkflow();
    setFile(null);
    setWorkflowId(null);
    setNodes(adaptNodes(template.nodes, template.edges));
    setEdges(template.edges);
    setName(template.name);
    setSelectedId(null);
    setShowLibrary(false);
    setInspectorOpen(false);
    setAnchorId(null);
    invalidate();
    setTimeout(() => flow.fitView({ padding: 0.25, duration: 250 }), 50);
  }

  function download(text, filename, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function currentWorkflow(workflowName = name) {
    return parseWorkflow({
      name: workflowName,
      nodes: nodes.map(({ id, position, data }) => ({ id, position, data })),
      edges: edges.map(({ source, target }) => ({ source, target })),
    });
  }

  function exportWorkflow() {
    download(
      JSON.stringify(currentWorkflow(), null, 2),
      `${name.replace(/[^a-z0-9-]/gi, "-").slice(0, 60) || "workflow"}.flowkit.json`,
      "application/json",
    );
  }

  function saveWorkflow(asNew = false, workflowName = name) {
    try {
      const workflow = currentWorkflow(workflowName.trim() || "Untitled workflow");
      const id = asNew || !workflowId ? crypto.randomUUID() : workflowId;
      const next = [...savedWorkflows.filter((entry) => entry.id !== id), { id, workflow }];
      localStorage.setItem("flowkit.workspace", JSON.stringify({ activeId: id, workflows: next }));
      setSavedWorkflows(next);
      setWorkflowId(id);
      setName(workflow.name);
      setSaved(true);
      setMenuOpen(false);
      setWorkflowDialog(null);
    } catch {
      setMessage("Could not save in this browser. Check browser storage permissions.");
      setMenuOpen(false);
      setWorkflowDialog(null);
    }
  }

  function exportResult(payload = result?.output) {
    if (!payload) return;
    if (["image", "audio", "video"].includes(payload.type)) {
      download(Uint8Array.from(atob(payload.value.data), (character) => character.charCodeAt(0)), payload.value.name,
        binaryMime(payload.value));
    } else {
      download(payload.value.text, `${(payload.value.source || "result").replace(/\.[^.]+$/, "")}.md`, "text/markdown");
    }
  }

  async function importWorkflow(candidate) {
    if (!candidate) return;
    try {
      if (candidate.size > 1024 * 1024)
        throw new Error("Workflow files must be smaller than 1 MiB.");
      const imported = parseWorkflow(JSON.parse(await candidate.text()));
      setNodes(adaptNodes(imported.nodes, imported.edges));
      setEdges(imported.edges);
      setName(imported.name);
      setFile(null);
      setWorkflowId(null);
      setSelectedId(null);
      setShowLibrary(false);
      setInspectorOpen(false);
      invalidate();
      setTimeout(() => flow.fitView({ padding: 0.25 }), 50);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function run() {
    if (!file) {
      setMessage(`Upload a ${inputCategory === "Text" ? "document" : inputCategory.toLowerCase() + " file"} before processing.`);
      return;
    }
    if (running) return;
    invalidate(false);
    setRunning(true);
    setShowLog(false);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline: toPipeline(nodes, edges),
          input: { name: file.name, data: file.data },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let complete = false;
      const receive = (event) => {
        if (event.type === "result") {
          complete = true;
          setResult(event.result);
          setStates(
            Object.fromEntries(
              event.result.nodes.map((node) => [node.id, node]),
            ),
          );
          if (event.result.status === "succeeded") {
            setInspectorTab("output");
            setInspectorOpen(true);
            setShowLibrary(false);
            setSelectedId(
              nodes.find((node) => isPreview(node.data.operation))
                ?.id,
            );
          } else
            setMessage(
              event.result.error?.message || "Workflow did not complete.",
            );
        } else {
          setEvents((current) => [...current, event]);
          if (event.nodeId)
            setStates((current) => ({
              ...current,
              [event.nodeId]: {
                ...current[event.nodeId],
                status: event.type.split(".")[1],
                durationMs: event.durationMs,
              },
            }));
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          if (line.trim()) receive(JSON.parse(line));
        }
        if (done) break;
      }
      if (!complete)
        throw new Error(
          "The connection ended before the workflow finished. Try running it again.",
        );
    } catch (error) {
      if (controller.signal.aborted) {
        setMessage("Workflow cancelled.");
        setStates((current) =>
          Object.fromEntries(
            Object.entries(current).map(([id, state]) => [
              id,
              state.status === "started" || state.status === "running"
                ? { ...state, status: "cancelled" }
                : state,
            ]),
          ),
        );
      } else setMessage(error.message);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  const displayNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === selectedId,
        data: {
          ...node.data,
          ...states[node.id],
          status:
            states[node.id]?.status === "started"
              ? "running"
              : states[node.id]?.status,
          filename: file?.name,
          running,
          inferred: edges.some((edge) => edge.target === node.id),
          inputType: nodeItem(nodes.find((source) => source.id === edges.find((edge) => edge.target === node.id)?.source)).outputType,
          onFileTypeChange: (fileType) => changeProcess(node.id, { fileType, operation: "" }),
          onOperationChange: (operation) => changeProcess(node.id, { operation }),
          canAppend:
            !isPreview(node.data.operation) &&
            !edges.some((edge) => edge.source === node.id),
          onAddAfter: () => openLibrary(node.id),
          onRemove: () => removeNode(node.id),
          onConfigure: () => {
            setSelectedId(node.id);
            setInspectorTab("settings");
            setShowLibrary(false);
            setInspectorOpen(true);
          },
        },
      })),
    [nodes, states, selectedId, file, edges, running],
  );
  const displayEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        animated: running,
        type: "smoothstep",
        style: {
          stroke:
            states[edge.source]?.status === "succeeded" ? "#52a48b" : "#b9adcf",
          strokeWidth: 1.7,
        },
      })),
    [edges, running, states],
  );
  const anchor = nodes.find((node) => node.id === anchorId);
  const anchorItem = anchor ? nodeItem(anchor) : null;
  const pickerCategory = outputCategory(anchorItem) || pickerFileType;
  const pickerChoices = processOptions(pickerCategory, anchorItem?.outputType);
  const selectedOperation = pickerChoices.some((item) => item.type === pickerOperation) ? pickerOperation : pickerChoices[0]?.type || "";
  const filteredKinds = nodeKinds.filter((item) =>
    `${item.title} ${item.description}`.toLowerCase().includes(search.trim().toLowerCase()) ||
    (item.kind === "process" && pickerChoices.some((operation) => operation.title.toLowerCase().includes(search.trim().toLowerCase()))));
  const successCount = Object.values(states).filter(
    (state) => state.status === "succeeded",
  ).length;

  return (
    <div className="app-shell" onClickCapture={showCanvasHint ? () => setShowCanvasHint(false) : undefined}>
      <main className="workspace">
        <div
          className="flow-canvas"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const payload = event.dataTransfer.getData("application/flowkit");
            if (payload) {
              let spec;
              try { spec = JSON.parse(payload); } catch { spec = { kind: payload }; }
              addNode(
                spec,
                flow.screenToFlowPosition({
                  x: event.clientX,
                  y: event.clientY,
                }),
              );
            } else if (event.dataTransfer.files[0])
              chooseFile(event.dataTransfer.files[0]);
          }}
        >
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            onNodesChange={(changes) => {
              if (!running) {
                onNodesChange(changes);
                if (changes.some((change) => change.type === "remove"))
                  invalidate();
              }
            }}
            onEdgesChange={(changes) => {
              if (!running) {
                onEdgesChange(changes);
                if (changes.some((change) => change.type === "remove"))
                  invalidate();
              }
            }}
            onConnect={connect}
            onNodeDragStop={() => setSaved(false)}
            isValidConnection={isValidConnection}
            onNodeClick={(event, node) => {
              if (event.target.closest(".react-flow__handle")) return;
              setSelectedId(node.id);
              setInspectorTab("settings");
              setInspectorOpen(true);
              setShowLibrary(false);
            }}
            onPaneClick={() => {
              setSelectedId(null);
              setInspectorOpen(false);
              setShowLibrary(false);
            }}
            nodesDraggable={!running}
            nodesConnectable={!running}
            elementsSelectable={!running}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
            minZoom={0.25}
            maxZoom={2}
            snapToGrid
            snapGrid={[20, 20]}
            deleteKeyCode={["Backspace", "Delete"]}
            defaultEdgeOptions={{ type: "smoothstep" }}
          >
            <Background color="#cdced3" gap={20} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
          {!nodes.length && (
            <div className="empty-canvas">
              <button
                className="first-node"
                onClick={() => openLibrary()}
                aria-label="Add first step"
              >
                <Icon name="plus" size={30} />
              </button>
              <h2>Add your first step</h2>
              <p>Pick a tool, connect the steps, and make it flow.</p>
              <button className="subtle-button" onClick={() => reset()}>
                Or start with the document template{" "}
                <Icon name="arrow" size={15} />
              </button>
            </div>
          )}
        </div>
        <header className="app-navbar">
          <div className="navbar-brand">
            <button className="hamburger icon-button" aria-label="Open workflow menu"
              aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
              <Icon name="menu" size={21} />
            </button>
            <img src="/flowkit.svg" alt="" width="27" height="27" />
            <strong>FlowKit</strong>
          </div>
          <div className="navbar-workflow">
            <span>{name}</span><small>{saved ? "Saved" : "Unsaved"}</small>
          </div>
          <nav className="navbar-actions" aria-label="Workflow actions">
            <button aria-label="Add node" aria-expanded={showLibrary}
              onClick={() => showLibrary ? setShowLibrary(false) : openLibrary()} disabled={running}>
              <Icon name="plus" size={16} /> Add Node
            </button>
            <button onClick={() => fileRef.current.click()} disabled={running} title={file?.name || "Upload a source file"}>
              <Icon name="upload" size={16} /> Upload
            </button>
            <button className={running ? "processing" : "process-action"}
              onClick={running ? () => abortRef.current?.abort() : run}>
              <Icon name={running ? "stop" : "play"} size={16} /> {running ? "Cancel" : "Process"}
            </button>
            <button onClick={() => importRef.current.click()} disabled={running} title="Import workflow JSON">
              <Icon name="upload" size={16} /> Import
            </button>
            <button onClick={() => exportResult()} disabled={running || result?.status !== "succeeded"}
              title="Download the processed file">
              <Icon name="download" size={16} /> Export
            </button>
          </nav>
        </header>
        <button
          className="execution-toggle button"
          onClick={() => setShowLog((value) => !value)}
          aria-expanded={showLog}
        >
          <Icon name="clock" size={16} />
          <span>Execution log</span>
          {events.length > 0 && (
            <span className="count-dot">{successCount}</span>
          )}
        </button>
        {message && (
          <div
            className={`message-banner ${message.includes("cancelled") ? "neutral" : ""}`}
            role="alert"
          >
            <Icon name="info" size={17} />
            <span>{message}</span>
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => setMessage("")}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {showLog && (
          <section className="execution-log" aria-label="Execution log">
            <div className="log-heading">
              <strong>
                <Icon name="clock" size={14} /> Execution log
              </strong>
              <button
                className="icon-button"
                aria-label="Close execution log"
                onClick={() => setShowLog(false)}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
            <div className="log-lines">
              {!events.length ? (
                <p>Run a workflow to see each step here.</p>
              ) : (
                events.map((event, index) => (
                  <div className="log-line" key={index}>
                    <span
                      className={
                        event.type.includes("succeeded") ? "log-check" : "muted"
                      }
                    >
                      <Icon
                        name={
                          event.type.includes("succeeded") ? "check" : "clock"
                        }
                        size={13}
                      />
                    </span>
                    <span>
                      {event.nodeId
                        ? catalog.find(
                            (item) =>
                              item.type ===
                              nodes.find((node) => node.id === event.nodeId)
                                ?.data.operation,
                          )?.title || event.nodeId
                        : "Workflow"}
                    </span>
                    <span>{event.type.split(".")[1]}</span>
                    <small>
                      {event.durationMs !== undefined
                        ? `${Math.round(event.durationMs)} ms`
                        : ""}
                    </small>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {showCanvasHint && <span className="canvas-hint">
          Drag to move · Scroll to zoom · Select a connection and press Delete
          to remove it
        </span>}
      </main>
      {showLibrary && (
        <aside className="node-picker" aria-label="Node library">
          <div className="panel-heading">
            <div>
              <h2>{anchorItem ? "What happens next?" : "Add a step"}</h2>
              <p>
                {anchorItem
                  ? `After ${anchorItem.title}`
                  : "Choose a tool for your workflow."}
              </p>
            </div>
            <button
              className="icon-button"
              aria-label="Close node library"
              onClick={() => setShowLibrary(false)}
            >
              <Icon name="close" size={19} />
            </button>
          </div>
          <label className="search-box">
            <Icon name="search" size={17} />
            <input
              ref={searchRef}
              placeholder="Search nodes…"
              aria-label="Find a node"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <kbd>/</kbd>
          </label>
          <div className="picker-list">
            {filteredKinds.map((item) => {
              const disabled = running || (item.kind === "upload" && (Boolean(anchor) || nodes.some((node) => nodeKind(node) === "upload"))) ||
                (item.kind === "download" && anchorItem?.outputType === "document");
              const spec = { kind: item.kind, fileType: pickerCategory, operation: item.kind === "process" ? selectedOperation : undefined };
              return <button key={item.kind} className="palette-node" aria-label={item.title}
                draggable={!disabled && (item.kind !== "process" || Boolean(selectedOperation))} disabled={disabled}
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/flowkit", JSON.stringify(spec));
                  event.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => item.kind === "process" ? setPickerProcess((value) => !value) : addNode(spec)}
                aria-expanded={item.kind === "process" ? pickerProcess : undefined}
                title={disabled ? (item.kind === "upload" ? "Only one Upload node is needed" : "Process the document before downloading") : `Drag or click to add ${item.title}`}>
                <span className={`palette-icon ${item.color}`}><Icon name={item.icon} size={24} /></span>
                <span><strong>{item.title}</strong><small>{item.description}</small></span>
                <Icon name={item.kind === "process" ? "chevron" : "plus"} size={16} />
              </button>;
            })}
            {!filteredKinds.length && <p className="no-matches">No nodes match your search.</p>}
            {pickerProcess && <section className="process-picker" aria-label="Configure Process">
              <FileTypeSelector category={pickerCategory} locked={Boolean(anchor)} disabled={running}
                onChange={(category) => { setPickerFileType(category); setPickerOperation(processOptions(category)[0]?.type || ""); }} />
              <OperationSelector category={pickerCategory} operation={selectedOperation} inputType={anchorItem?.outputType}
                disabled={running} onChange={setPickerOperation} />
              {!pickerChoices.length && <p className="category-empty">{pickerCategory} operations are coming soon.</p>}
              <button className="button primary" disabled={running || !selectedOperation}
                draggable={!running && Boolean(selectedOperation)}
                title={selectedOperation ? `Drag or click to add ${nodeItem({ data: { operation: selectedOperation } }).title}` : undefined}
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/flowkit", JSON.stringify({ kind: "process", fileType: pickerCategory, operation: selectedOperation }));
                  event.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => addNode({ kind: "process", fileType: pickerCategory, operation: selectedOperation })}>
                <Icon name="plus" size={15} /> Add Process
              </button>
            </section>}
          </div>
          <div className="picker-tip">
            <Icon name="info" size={16} />
            <span>
              Drag onto the canvas to place a node.
              <br />
              Click to add it automatically.
            </span>
          </div>
        </aside>
      )}
      {inspectorOpen && (
        <aside className="inspector" aria-label="Node editor">
          <div className="inspector-heading">
            <Icon name="settings" size={17} />
            <h2>{selectedItem ? "Node details" : "Workflow details"}</h2>
            <button
              className="icon-button"
              aria-label="Close node editor"
              onClick={() => setInspectorOpen(false)}
            >
              <Icon name="close" size={17} />
            </button>
            {selected && (
              <button
                className="icon-button"
                aria-label="Delete selected node"
                onClick={() => removeNode(selectedId)}
                disabled={running}
              >
                <Icon name="trash" size={16} />
              </button>
            )}
          </div>
          <div className="inspector-tabs">
            <button
              className={inspectorTab === "settings" ? "active" : ""}
              onClick={() => setInspectorTab("settings")}
            >
              Parameters
            </button>
            <button
              className={inspectorTab === "output" ? "active" : ""}
              onClick={() => setInspectorTab("output")}
            >
              Output {output && <span className="output-dot" />}
            </button>
          </div>
          <div className="inspector-body">
            {inspectorTab === "settings" ? (
              <>
                <div className="selected-summary">
                  <span
                    className={`node-icon ${selectedItem?.color || "purple"}`}
                  >
                    <Icon name={selectedItem?.icon || "workflow"} size={22} />
                  </span>
                  <h3>{selectedItem?.title || name || "Untitled workflow"}</h3>
                  <p>
                    {selectedItem?.description ||
                      "Select a node to configure it and inspect its output."}
                  </p>
                </div>
                <div className="inspector-section">
                  <label className="field-label">Source {inputCategory === "Text" ? "document" : inputCategory.toLowerCase()}</label>
                  <div className="source-summary">
                    <Icon name={({ Image: "image", Audio: "audio", Video: "video", Text: "document" })[inputCategory]} size={20} />
                    <div><strong>{file?.name || "No file uploaded"}</strong>
                      <small>{file ? formatBytes(file.size) : "Use Upload in the navbar, or drop a file on the canvas."}</small>
                    </div>
                  </div>
                  <p className="file-types">
                    {({ Image: "PNG, JPEG · 16 million pixels", Audio: "WAV, MP3, M4A · Up to 5 minutes", Video: "MP4, MOV, WebM, MKV · Up to 5 minutes / 1080p", Text: "DOCX, HTML, EPUB, Markdown" })[inputCategory]} · Up to 20 MiB
                  </p>
                </div>
                {selectedItem?.type === "image.resize" && (
                  <div className="inspector-section resize-settings">
                    <p>Fit within these bounds while preserving aspect ratio. Leave one dimension blank to scale by the other.</p>
                    {["width", "height"].map((dimension) => (
                      <label key={dimension}>
                        {dimension === "width" ? "Maximum width (px)" : "Maximum height (px)"}
                        <input type="number" min="1" max="4096" step="1"
                          value={selected.data.options?.[dimension] ?? ""} disabled={running}
                          onChange={(event) => {
                            const value = event.target.value;
                            setNodes((current) => current.map((node) => {
                              if (node.id !== selectedId) return node;
                              const options = { ...node.data.options };
                              if (value === "") delete options[dimension];
                              else options[dimension] = Number(value);
                              return { ...node, data: { ...node.data, options } };
                            }));
                            invalidate();
                          }} />
                      </label>
                    ))}
                    <small>1–4096 pixels per dimension. Output: PNG.</small>
                  </div>
                )}
                {selectedItem?.group === "Transform" && ["Audio", "Video"].includes(selectedItem.category) && (
                  <div className="inspector-section resize-settings">
                    <p>FFmpeg processes your file locally on the server. Maximum output: 8 MiB.</p>
                    {selectedItem.outputType === "audio" && <label>Output format
                      <select aria-label="Audio output format" disabled={running} value={selected.data.options?.format || "mp3"}
                        onChange={(event) => { setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, options: { ...node.data.options, format: event.target.value } } } : node)); invalidate(); }}>
                        <option value="mp3">MP3</option><option value="wav">WAV</option>
                      </select>
                    </label>}
                    {selectedItem.type.endsWith(".trim") && ["startSeconds", "durationSeconds"].map((key) => (
                      <label key={key}>{key === "startSeconds" ? "Start (seconds)" : "Duration (seconds)"}
                        <input type="number" min={key === "startSeconds" ? 0 : 0.01} max="300" step="0.01"
                          aria-label={key === "startSeconds" ? "Start (seconds)" : "Duration (seconds)"} disabled={running}
                          value={selected.data.options?.[key] ?? ""}
                          onChange={(event) => { const value = Number(event.target.value); setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, options: { ...node.data.options, [key]: value } } } : node)); invalidate(); }} />
                      </label>
                    ))}
                  </div>
                )}
                {selectedItem?.type === "context.clean" && (
                  <div className="inspector-section">
                    <label className="checkbox-setting">
                      <input
                        type="checkbox"
                        checked={
                          selected.data.options?.collapseBlankLines !== false
                        }
                        disabled={running}
                        onChange={(event) => {
                          setNodes((current) =>
                            current.map((node) =>
                              node.id === selectedId
                                ? {
                                    ...node,
                                    data: {
                                      ...node.data,
                                      options: {
                                        collapseBlankLines:
                                          event.target.checked,
                                      },
                                    },
                                  }
                                : node,
                            ),
                          );
                          invalidate();
                        }}
                      />
                      <span>
                        Collapse extra blank lines
                        <small>Keep one empty line between blocks.</small>
                      </span>
                    </label>
                  </div>
                )}
                {selectedItem && (
                  <div className="inspector-section">
                    <label className="field-label">Data flow</label>
                    <div className="data-flow">
                      <span>{selectedItem.inputType}</span>
                      <Icon name="arrow" size={14} />
                      <span>{selectedItem.outputType}</span>
                    </div>
                    {!isPreview(selectedItem.type) && (
                      <label className="next-node-setting">
                        <span>Next node</span>
                        <select
                          aria-label="Next node"
                          disabled={running}
                          value={
                            edges.find((edge) => edge.source === selectedId)
                              ?.target || ""
                          }
                          onChange={(event) => {
                            const target = event.target.value;
                            const remaining = edges.filter(
                              (edge) => edge.source !== selectedId,
                            );
                            const next = target
                              ? connectNodes({ source: selectedId, target }, nodes, remaining, file?.name)
                              : { nodes: adaptNodes(nodes, remaining, file?.name), edges: remaining };
                            if (next) { setNodes(next.nodes); setEdges(next.edges); invalidate(); }
                          }}
                        >
                          <option value="">Not connected</option>
                          {nodes
                            .filter(
                              (node) =>
                                node.id ===
                                  edges.find(
                                    (edge) => edge.source === selectedId,
                                  )?.target ||
                                connectNodes(
                                  { source: selectedId, target: node.id },
                                  nodes,
                                  edges.filter(
                                    (edge) => edge.source !== selectedId,
                                  ),
                                  file?.name,
                                ),
                            )
                            .map((node) => (
                              <option key={node.id} value={node.id}>
                                {
                                  catalog.find(
                                    (item) => item.type === node.data.operation,
                                  )?.title
                                }{" "}
                                ({node.id.slice(0, 8)})
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    {selectedItem.type === "document.toMarkdown" && (
                      <div className="setting-row">
                        <span>Output format</span>
                        <strong>GitHub Markdown</strong>
                      </div>
                    )}
                    <div className="setting-row">
                      <span>Execution</span>
                      <strong>Local</strong>
                    </div>
                  </div>
                )}
                <div className="quiet-note">
                  <Icon name="info" size={16} />
                  <p>
                    Prebuilt tools do the work. No AI calls or generated scripts
                    are needed for this workflow.
                  </p>
                </div>
              </>
            ) : (
              <>
                {mediaOutput ? (
                  <div className="media-output">
                    {result.output.type === "video"
                      ? <video controls preload="metadata" aria-label="Video preview" src={`data:${binaryMime(mediaOutput)};base64,${mediaOutput.data}`} />
                      : <audio controls preload="metadata" aria-label="Audio preview" src={`data:${binaryMime(mediaOutput)};base64,${mediaOutput.data}`} />}
                    <p>{mediaOutput.name}</p>
                    {mediaOutput.durationSeconds && <p>{mediaOutput.durationSeconds.toFixed(2)} seconds</p>}
                    <button className="button primary download-result" onClick={() => exportResult()}><Icon name="download" size={16} /> Download media</button>
                  </div>
                ) : imageOutput ? (
                  <>
                    <img className="image-preview" alt="Resized image" src={`data:${imageOutput.mimeType || (/\.jpe?g$/i.test(imageOutput.name) ? "image/jpeg" : "image/png")};base64,${imageOutput.data}`} />
                    {imageOutput.width && <p>{imageOutput.width} × {imageOutput.height} pixels</p>}
                    <button className="button primary download-result" onClick={() => exportResult()}>
                      <Icon name="download" size={16} /> Download image
                    </button>
                  </>
                ) : ["image", "audio", "video"].includes(nodeOutput?.type) ? (
                  <div className="output-document">
                    <strong>{nodeOutput.value.name}</strong>
                    <p>{formatBytes(nodeOutput.value.size)} · {nodeOutput.value.width ? `${nodeOutput.value.width} × ${nodeOutput.value.height} pixels` : `${nodeOutput.type} file`}</p>
                  </div>
                ) : nodeOutput?.type === "document" ? (
                  <div className="output-document">
                    <Icon name="document" size={25} />
                    <strong>{nodeOutput.value.source}</strong>
                    <p>{formatBytes(nodeOutput.value.size)} uploaded</p>
                  </div>
                ) : nodeOutput?.value?.text !== undefined ||
                  output?.text !== undefined ? (
                  <>
                    <div className="output-heading">
                      <span className="success-pill">
                        <Icon name="check" size={13} />{" "}
                        {result?.status === "succeeded"
                          ? "Complete"
                          : "Step complete"}
                      </span>
                      <span>
                        {formatBytes(
                          new Blob([nodeOutput?.value?.text ?? output?.text])
                            .size,
                        )}
                      </span>
                    </div>
                    <pre
                      className="markdown-preview"
                      aria-label="Markdown output"
                    >
                      {nodeOutput?.value?.text ?? output?.text}
                    </pre>
                    <button
                      className="button primary download-result"
                      onClick={() =>
                        download(
                          nodeOutput?.value?.text ?? output.text,
                          `${(nodeOutput?.value?.source || output.source || "result").replace(/\.[^.]+$/, "")}.md`,
                          "text/markdown",
                        )
                      }
                    >
                      <Icon name="download" size={16} /> Download Markdown
                    </button>
                    <p className="output-note">
                      Plain-text preview. Original document structure is
                      preserved where possible.
                    </p>
                  </>
                ) : (
                  <div className="empty-output">
                    <span>
                      <Icon name="code" size={28} />
                    </span>
                    <h3>Your output will appear here.</h3>
                    <p>
                      Add a document and run the workflow to see what your tools
                      produce.
                    </p>
                    <button
                      className="subtle-button"
                      onClick={() => setInspectorTab("settings")}
                    >
                      Choose a source document <Icon name="arrow" size={15} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="inspector-foot">
            <span className="mini-logo">
              <Icon name="workflow" size={14} />
            </span>{" "}
            Built for humans. Ready for agents.
          </div>
        </aside>
      )}
      {menuOpen && (
        <dialog ref={menuRef} className="workflow-menu" aria-label="Workflow menu"
          onCancel={() => setMenuOpen(false)}
          onClick={(event) => { if (event.target === event.currentTarget) setMenuOpen(false); }}>
          <div className="menu-heading">
            <strong>Workflow</strong>
            <button className="icon-button" aria-label="Close workflow menu" onClick={() => setMenuOpen(false)}>
              <Icon name="close" size={18} />
            </button>
          </div>
          <label className="menu-field">Workflow name
            <input aria-label="Workflow name" value={name} maxLength={100} disabled={running}
              onChange={(event) => { setName(event.target.value); setSaved(false); }} />
          </label>
          {savedWorkflows.length > 0 && <label className="menu-field">Saved in this browser
            <select aria-label="Saved workflows" value={workflowId || ""} disabled={running}
              onChange={(event) => {
                const entry = savedWorkflows.find((item) => item.id === event.target.value);
                if (!entry) return;
                setNodes(adaptNodes(entry.workflow.nodes, entry.workflow.edges)); setEdges(entry.workflow.edges); setName(entry.workflow.name);
                setFile(null); setWorkflowId(entry.id); setSelectedId(null); setInspectorOpen(false);
                setShowLibrary(false); invalidate(); setSaved(true); setMenuOpen(false);
                setTimeout(() => flow.fitView({ padding: 0.25 }), 50);
              }}>
              <option value="" disabled>Choose a saved workflow</option>
              {savedWorkflows.map((entry) => <option key={entry.id} value={entry.id}>{entry.workflow.name}</option>)}
            </select>
          </label>}
          <div className="menu-divider" />
          <button disabled={running} onClick={() => {
            setMenuOpen(false); setDialogName("Untitled workflow"); setTemplate("blank"); setWorkflowDialog("new");
          }}><Icon name="plus" /> New</button>
          <button disabled={running} onClick={() => saveWorkflow()}><Icon name="save" /> Save</button>
          <button disabled={running} onClick={() => {
            setMenuOpen(false); setDialogName(`${name || "Untitled workflow"} copy`); setWorkflowDialog("copy");
          }}><Icon name="copy" /> Save as new</button>
          <p>Workflows are saved in this browser.</p>
        </dialog>
      )}
      {workflowDialog && (
        <dialog ref={workflowDialogRef} className="help-dialog workflow-dialog"
          aria-labelledby="workflow-dialog-title" onCancel={() => setWorkflowDialog(null)}
          onClick={(event) => { if (event.target === event.currentTarget) setWorkflowDialog(null); }}>
          <form onSubmit={(event) => {
            event.preventDefault();
            if (workflowDialog === "copy") saveWorkflow(true, dialogName);
            else {
              reset(template === "blank", template === "image", ["audio", "video"].includes(template) ? template : null);
              setName(dialogName.trim() || "Untitled workflow"); setWorkflowDialog(null);
            }
          }}>
            <h2 id="workflow-dialog-title">{workflowDialog === "copy" ? "Save as new" : "New workflow"}</h2>
            <label className="menu-field">Name
              <input aria-label="New workflow name" value={dialogName} maxLength={100}
                onChange={(event) => setDialogName(event.target.value)} autoFocus required />
            </label>
            {workflowDialog === "new" && <label className="menu-field">Start with
              <select aria-label="Workflow template" value={template} onChange={(event) => setTemplate(event.target.value)}>
                <option value="blank">Blank canvas</option>
                <option value="text">Text / document</option>
                <option value="image">Image resize</option>
                <option value="audio">Audio conversion</option>
                <option value="video">Video trim</option>
              </select>
            </label>}
            <div className="dialog-actions">
              <button type="button" className="button" onClick={() => setWorkflowDialog(null)}>Cancel</button>
              <button type="submit" className="button primary">{workflowDialog === "copy" ? "Save copy" : "Create"}</button>
            </div>
          </form>
        </dialog>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".png,.jpg,.jpeg,.docx,.html,.htm,.epub,.md,.wav,.mp3,.m4a,.mp4,.mov,.webm,.mkv"
        hidden
        onChange={(event) => {
          chooseFile(event.target.files[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={importRef}
        type="file"
        accept=".json"
        hidden
        onChange={(event) => {
          importWorkflow(event.target.files[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <ReactFlowProvider>
    <App />
  </ReactFlowProvider>,
);
