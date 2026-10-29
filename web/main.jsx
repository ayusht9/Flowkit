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
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  catalog,
  defaultWorkflow,
  toPipeline,
  canConnect,
  parseWorkflow,
} from "../src/catalog.mjs";
import { Icon } from "./icons.jsx";
import "./styles.css";

const initial = defaultWorkflow();
const formatBytes = (bytes) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const nodeTypes = { operation: OperationNode };

function OperationNode({ data, selected }) {
  const item = catalog.find((item) => item.type === data.operation);
  return (
    <div
      className={`operation-node ${item.color} ${selected ? "is-selected" : ""} state-${data.status || "idle"}`}
    >
      {item.type !== "file.upload" && (
        <Handle
          type="target"
          position={data.reverse ? Position.Right : Position.Left}
          aria-label={`${item.title} input`}
        />
      )}
      <div className="node-top">
        <span className={`node-icon ${item.color}`}>
          <Icon name={item.icon} size={22} />
        </span>
        <span className="node-engine">
          {item.type === "document.toMarkdown" ? "Pandoc" : item.group}
        </span>
        {data.status === "succeeded" ? (
          <span className="node-success">
            <Icon name="check" size={15} />
          </span>
        ) : data.status === "running" ? (
          <span className="spinner" />
        ) : (
          <span className="node-menu">•••</span>
        )}
      </div>
      <h3>{item.title}</h3>
      <p>
        {item.type === "file.upload" && data.filename
          ? data.filename
          : item.description}
      </p>
      <div className="node-footer">
        <span className={`type-tag ${item.color}`}>
          {item.outputType === "document" ? "Document" : "Markdown"}
        </span>
        <span>
          {data.status === "succeeded"
            ? `${Math.round(data.durationMs)} ms`
            : data.status === "failed"
              ? "Failed"
              : data.status === "cancelled"
                ? "Cancelled"
                : "Ready"}
        </span>
      </div>
      {item.type !== "artifact.preview" && (
        <Handle
          type="source"
          position={data.reverse ? Position.Left : Position.Right}
          aria-label={`${item.title} output`}
        />
      )}
    </div>
  );
}

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [name, setName] = useState(initial.name);
  const [selectedId, setSelectedId] = useState("convert");
  const [search, setSearch] = useState("");
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [events, setEvents] = useState([]);
  const [states, setStates] = useState({});
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [inspectorTab, setInspectorTab] = useState("settings");
  const [showLog, setShowLog] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const fileRef = useRef(null);
  const importRef = useRef(null);
  const abortRef = useRef(null);
  const helpRef = useRef(null);
  const searchRef = useRef(null);
  const flow = useReactFlow();
  const selected = nodes.find((node) => node.id === selectedId);
  const selectedItem = catalog.find(
    (item) => item.type === selected?.data.operation,
  );
  const output = result?.output?.value;
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
        !showHelp
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [showHelp]);
  useEffect(() => {
    if (showHelp) helpRef.current?.showModal();
  }, [showHelp]);
  useEffect(() => {
    const timer = setTimeout(
      () => flow.fitView({ padding: 0.25, duration: 200 }),
      100,
    );
    return () => clearTimeout(timer);
  }, [showLog]);
  function invalidate() {
    setResult(null);
    setStates({});
    setEvents([]);
    setSaved(false);
    setMessage("");
  }

  async function chooseFile(candidate) {
    if (!candidate || running) return;
    if (!/\.(docx|html?|epub|md)$/i.test(candidate.name)) {
      setMessage(
        "Choose a DOCX, HTML, EPUB, or Markdown document. PDF and media tools are coming next.",
      );
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
      invalidate();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadSample() {
    try {
      const response = await fetch("/api/sample");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setFile(data);
      invalidate();
    } catch (error) {
      setMessage(error.message);
    }
  }

  function addNode(type, position) {
    if (running) return;
    const id = crypto.randomUUID();
    if (nodes.length >= 20) {
      setMessage("A workflow can contain up to 20 nodes.");
      return;
    }
    setNodes((current) => [
      ...current,
      {
        id,
        type: "operation",
        position: position || {
          x: 150 + current.length * 35,
          y: 160 + current.length * 30,
        },
        data: {
          operation: type,
          options: type === "context.clean" ? { collapseBlankLines: true } : {},
        },
      },
    ]);
    setSelectedId(id);
    setInspectorTab("settings");
    invalidate();
  }

  const isValidConnection = useCallback(
    (connection) => canConnect(connection, nodes, edges),
    [nodes, edges],
  );
  const connect = useCallback(
    (connection) => {
      if (!running && canConnect(connection, nodes, edges)) {
        setEdges((current) => addEdge(connection, current));
        invalidate();
      }
    },
    [nodes, edges, running],
  );

  function reset(blank = false) {
    const template = blank
      ? { name: "Untitled workflow", nodes: [], edges: [] }
      : defaultWorkflow();
    setNodes(template.nodes);
    setEdges(template.edges);
    setName(template.name);
    setSelectedId(blank ? null : "convert");
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

  function saveWorkflow() {
    const serializable = {
      name,
      nodes: nodes.map(({ id, position, data }) => ({ id, position, data })),
      edges: edges.map(({ source, target }) => ({ source, target })),
    };
    download(
      JSON.stringify(serializable, null, 2),
      `${name.replace(/[^a-z0-9-]/gi, "-").slice(0, 60) || "workflow"}.flowkit.json`,
      "application/json",
    );
    setSaved(true);
  }

  async function importWorkflow(candidate) {
    if (!candidate) return;
    try {
      if (candidate.size > 1024 * 1024)
        throw new Error("Workflow files must be smaller than 1 MiB.");
      const imported = parseWorkflow(JSON.parse(await candidate.text()));
      setNodes(imported.nodes);
      setEdges(imported.edges);
      setName(imported.name);
      setSelectedId(imported.nodes[0]?.id);
      invalidate();
      setTimeout(() => flow.fitView({ padding: 0.25 }), 50);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function run() {
    if (!file) {
      setMessage("Upload a document or use the sample before running.");
      return;
    }
    if (running) return;
    invalidate();
    setRunning(true);
    setShowLog(true);
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
            setSelectedId(
              nodes.find((node) => node.data.operation === "artifact.preview")
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
        },
      })),
    [nodes, states, selectedId, file],
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
  const filtered = catalog.filter((item) =>
    `${item.title} ${item.description}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const successCount = Object.values(states).filter(
    (state) => state.status === "succeeded",
  ).length;

  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Main navigation">
        <a className="brand-icon" href="/" aria-label="FlowKit home">
          <img src="/flowkit.svg" alt="" />
        </a>
        <button
          className="rail-button active"
          aria-label="Workflow studio"
          title="Workflow studio"
        >
          <Icon name="workflow" size={21} />
        </button>
        <button
          className="rail-button"
          aria-label="Import workflow"
          title="Import workflow"
          onClick={() => importRef.current.click()}
          disabled={running}
        >
          <Icon name="folder" size={21} />
        </button>
        <div className="rail-bottom">
          <button
            className="rail-button"
            aria-label="How to use FlowKit"
            onClick={() => setShowHelp(true)}
          >
            <Icon name="help" size={21} />
          </button>
          <span className="avatar" title="Local workspace">
            Y
          </span>
        </div>
      </aside>
      <header className="app-header">
        <div className="header-title">
          <span className="brand-name">FlowKit</span>
          <span className="header-divider" />
          <span className="workspace-label">Personal workspace</span>
          <Icon name="chevron" size={13} />
          <span>Workflows</span>
        </div>
        <div className="header-right">
          <span className="local-indicator">
            <i /> Local workspace
          </span>
          <button className="subtle-button" onClick={() => setShowHelp(true)}>
            <Icon name="help" size={16} /> Quick guide
          </button>
        </div>
      </header>
      <div className="workflow-toolbar">
        <div className="workflow-heading">
          <span className="small-flow-icon">
            <Icon name="workflow" />
          </span>
          <input
            aria-label="Workflow name"
            value={name}
            maxLength={100}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
            disabled={running}
          />
          <span className="draft-badge">{saved ? "Exported" : "Draft"}</span>
        </div>
        <div className="toolbar-actions">
          <button
            className="subtle-button"
            onClick={() => importRef.current.click()}
            disabled={running}
          >
            <Icon name="upload" size={15} /> Import
          </button>
          <button className="button secondary" onClick={saveWorkflow}>
            <Icon name="download" size={15} /> Export workflow
          </button>
        </div>
      </div>
      <aside className="library">
        <div className="library-heading">
          <div>
            <h2>Build your workflow</h2>
            <p>Small tools. Powerful connections.</p>
          </div>
          <button
            className="icon-button"
            aria-label="New workflow"
            title="New workflow"
            onClick={() => reset(true)}
            disabled={running}
          >
            <Icon name="plus" />
          </button>
        </div>
        <label className="search-box">
          <Icon name="search" size={16} />
          <input
            ref={searchRef}
            placeholder="Find a node…"
            aria-label="Find a node"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <kbd>/</kbd>
        </label>
        <div className="library-scroll">
          <div className="section-label">
            Available nodes <span>{filtered.length}</span>
          </div>
          <div className="node-palette">
            {filtered.map((item) => (
              <button
                key={item.type}
                className="palette-node"
                draggable={!running}
                disabled={running}
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/flowkit", item.type);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => addNode(item.type)}
                title={`Drag or click to add ${item.title}`}
              >
                <span className={`palette-icon ${item.color}`}>
                  <Icon name={item.icon} />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.type === "document.toMarkdown"
                      ? "Powered by Pandoc"
                      : item.group}
                  </small>
                </span>
                <Icon name="plus" size={14} />
              </button>
            ))}
          </div>
          {!filtered.length && (
            <p className="muted empty-search">No matching nodes.</p>
          )}
          <div className="section-label upcoming-label">
            More tools, same canvas
          </div>
          <div className="upcoming-tools">
            {[
              ["image", "ImageMagick", "Images"],
              ["video", "FFmpeg", "Audio & video"],
              ["document", "PDF tools", "PDF documents"],
              ["database", "RAG", "Search & answers"],
            ].map(([icon, title, label]) => (
              <div className="upcoming-tool" key={title}>
                <Icon name={icon} size={17} />
                <span>
                  {title}
                  <small>{label}</small>
                </span>
                <span className="soon-badge">Next</span>
              </div>
            ))}
          </div>
          <div className="template-card">
            <span className="template-icon">
              <Icon name="grid" size={19} />
            </span>
            <h3>A head start, included.</h3>
            <p>Load the document template and make it yours.</p>
            <button onClick={() => reset()} disabled={running}>
              Use document template <Icon name="arrow" size={15} />
            </button>
          </div>
        </div>
        <div className="library-foot">
          <Icon name="info" size={15} />
          <span>
            Drag a node onto the canvas.
            <br />
            Click to add one with your keyboard.
          </span>
        </div>
      </aside>
      <main className="workspace">
        <div className="canvas-toolbar">
          <div className="canvas-tabs">
            <span className="selected">
              <Icon name="workflow" size={15} /> Editor
            </span>
            <button onClick={() => setShowLog((value) => !value)}>
              <Icon name="clock" size={15} /> Execution log{" "}
              {events.length > 0 && (
                <span className="count-dot">
                  {
                    events.filter((event) => event.type === "node.succeeded")
                      .length
                  }
                </span>
              )}
            </button>
          </div>
          <button
            className="subtle-button"
            onClick={() => reset()}
            disabled={running}
            title="Restore the default connected workflow"
          >
            <Icon name="reset" size={14} /> Reset template
          </button>
        </div>
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
        <div
          className="flow-canvas"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const type = event.dataTransfer.getData("application/flowkit");
            if (catalog.some((item) => item.type === type))
              addNode(
                type,
                flow.screenToFlowPosition({
                  x: event.clientX,
                  y: event.clientY,
                }),
              );
            else if (event.dataTransfer.files[0])
              chooseFile(event.dataTransfer.files[0]);
          }}
        >
          <div className="canvas-caption">
            <span className="caption-dot" /> Your ideas, connected.
            <small>
              {nodes.length} nodes · {edges.length} connections
            </small>
          </div>
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
              setSelectedId(node.id);
              setInspectorTab("settings");
            }}
            onPaneClick={() => setSelectedId(null)}
            nodesDraggable={!running}
            nodesConnectable={!running}
            elementsSelectable={!running}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.3}
            maxZoom={1.6}
            deleteKeyCode={["Backspace", "Delete"]}
            defaultEdgeOptions={{ type: "smoothstep" }}
          >
            <Background color="#dce0eb" gap={22} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
          {!nodes.length && (
            <div className="empty-canvas">
              <span className="empty-flow">
                <Icon name="workflow" size={32} />
              </span>
              <h2>Every great workflow starts somewhere.</h2>
              <p>Drag a node from the library, or start with a template.</p>
              <button className="button primary" onClick={() => reset()}>
                Use document template
              </button>
            </div>
          )}
          <div className="canvas-tip">
            <Icon name="info" size={14} /> Drag to move · Scroll to zoom ·
            Connect the dots
          </div>
        </div>
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
        <footer className="run-bar">
          <div className="run-status">
            <span
              className={`status-dot ${running ? "working" : result?.status === "succeeded" ? "success" : ""}`}
            />
            <div>
              <strong>
                {running
                  ? `Running ${successCount} of ${nodes.length} steps`
                  : result?.status === "succeeded"
                    ? "Workflow completed"
                    : "Ready when you are"}
              </strong>
              <small>
                {result?.status === "succeeded"
                  ? `${result.nodes.length} steps · ${Math.round(result.durationMs)} ms`
                  : "Your files stay on this machine"}
              </small>
            </div>
          </div>
          {running ? (
            <button
              className="button danger"
              onClick={() => abortRef.current?.abort()}
            >
              <Icon name="stop" size={15} /> Cancel run
            </button>
          ) : (
            <button className="button primary run-button" onClick={run}>
              <Icon name="play" size={15} /> Run workflow
            </button>
          )}
        </footer>
      </main>
      <aside className="inspector">
        <div className="inspector-heading">
          <Icon name="settings" size={17} />
          <h2>{selectedItem ? "Node details" : "Workflow details"}</h2>
          {selected && (
            <button
              className="icon-button"
              aria-label="Delete selected node"
              onClick={() => {
                setNodes((current) =>
                  current.filter((node) => node.id !== selectedId),
                );
                setEdges((current) =>
                  current.filter(
                    (edge) =>
                      edge.source !== selectedId && edge.target !== selectedId,
                  ),
                );
                setSelectedId(null);
                invalidate();
              }}
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
                <label className="field-label">Source document</label>
                <button
                  className={`upload-box ${file ? "has-file" : ""}`}
                  onClick={() => fileRef.current.click()}
                  disabled={running}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    chooseFile(event.dataTransfer.files[0]);
                  }}
                >
                  <span className="upload-symbol">
                    <Icon name={file ? "document" : "upload"} size={22} />
                  </span>
                  <strong>{file?.name || "Drop your document here"}</strong>
                  <small>
                    {file
                      ? `${formatBytes(file.size)} · Click to replace`
                      : "or click to browse files"}
                  </small>
                </button>
                <p className="file-types">
                  DOCX, HTML, EPUB, Markdown · Up to 20 MiB
                </p>
                <button
                  className="sample-button"
                  onClick={loadSample}
                  disabled={running}
                >
                  <Icon name="document" size={14} /> Try with a sample document{" "}
                  <Icon name="arrow" size={14} />
                </button>
              </div>
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
                                      collapseBlankLines: event.target.checked,
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
                  {selectedItem.type !== "artifact.preview" && (
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
                          if (
                            !target ||
                            canConnect(
                              { source: selectedId, target },
                              nodes,
                              remaining,
                            )
                          ) {
                            setEdges(
                              target
                                ? [
                                    ...remaining,
                                    {
                                      id: crypto.randomUUID(),
                                      source: selectedId,
                                      target,
                                    },
                                  ]
                                : remaining,
                            );
                            invalidate();
                          }
                        }}
                      >
                        <option value="">Not connected</option>
                        {nodes
                          .filter(
                            (node) =>
                              node.id ===
                                edges.find((edge) => edge.source === selectedId)
                                  ?.target ||
                              canConnect(
                                { source: selectedId, target: node.id },
                                nodes,
                                edges.filter(
                                  (edge) => edge.source !== selectedId,
                                ),
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
              {nodeOutput?.type === "document" ? (
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
                    Plain-text preview. Original document structure is preserved
                    where possible.
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
      <input
        ref={fileRef}
        type="file"
        accept=".docx,.html,.htm,.epub,.md"
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
      {showHelp && (
        <dialog
          ref={helpRef}
          className="help-dialog"
          aria-labelledby="help-title"
          onCancel={() => setShowHelp(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowHelp(false);
          }}
        >
          <button
            className="icon-button close-dialog"
            aria-label="Close guide"
            onClick={() => setShowHelp(false)}
          >
            <Icon name="close" />
          </button>
          <span className="node-icon purple">
            <Icon name="workflow" size={24} />
          </span>
          <h2 id="help-title">A few steps. A useful result.</h2>
          <ol>
            <li>Upload a document or try the included sample.</li>
            <li>
              Drag nodes from the library. Connect an output dot to a compatible
              input dot.
            </li>
            <li>
              Run the workflow and inspect each step in the execution log.
            </li>
            <li>
              Download your Markdown. Export the workflow to reuse its layout
              and settings.
            </li>
          </ol>
          <p>
            Workflows run in a single chain. Select a node or connection and
            press Delete to remove it. Your source file is never included in a
            workflow export.
          </p>
          <button className="button primary" onClick={() => setShowHelp(false)}>
            Got it, let's build
          </button>
        </dialog>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <ReactFlowProvider>
    <App />
  </ReactFlowProvider>,
);
