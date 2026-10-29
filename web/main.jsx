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
      <div className="node-actions nodrag nopan">
        <button
          aria-label={`Configure ${item.title}`}
          title="Configure node"
          onClick={(event) => {
            event.stopPropagation();
            data.onConfigure();
          }}
        >
          <Icon name="settings" size={14} />
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
          <Icon name="trash" size={14} />
        </button>
      </div>
      <div className="node-tile">
        {item.type !== "file.upload" && (
          <Handle
            type="target"
            position={data.reverse ? Position.Right : Position.Left}
            aria-label={`${item.title} input`}
          />
        )}
        <Icon name={item.icon} size={37} />
        {data.status === "succeeded" ? (
          <span className="node-success">
            <Icon name="check" size={13} />
          </span>
        ) : data.status === "running" ? (
          <span className="spinner" />
        ) : data.status === "failed" ? (
          <span className="node-failure">!</span>
        ) : null}
        {item.type !== "artifact.preview" && (
          <Handle
            type="source"
            position={data.reverse ? Position.Left : Position.Right}
            aria-label={`${item.title} output`}
          />
        )}
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
            <Icon name="plus" size={14} />
          </button>
        )}
      </div>
      <h3>{item.title}</h3>
      <p>
        {item.type === "file.upload"
          ? data.filename || "Start with a document"
          : item.type === "document.toMarkdown"
            ? "Pandoc"
            : item.type === "context.clean"
              ? "Normalize spacing"
              : "Markdown output"}
      </p>
      {data.status && (
        <span className="node-status">
          {data.status === "succeeded"
            ? `${Math.round(data.durationMs)} ms`
            : data.status === "started"
              ? "Running"
              : data.status}
        </span>
      )}
    </div>
  );
}

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [name, setName] = useState(initial.name);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
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
  const [saved, setSaved] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const fileRef = useRef(null);
  const importRef = useRef(null);
  const abortRef = useRef(null);
  const helpRef = useRef(null);
  const menuRef = useRef(null);
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
  }, [showHelp]);
  useEffect(() => {
    if (showLibrary) searchRef.current?.focus();
  }, [showLibrary]);
  useEffect(() => {
    if (menuOpen) menuRef.current?.showModal();
  }, [menuOpen]);
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

  function openLibrary(id = null) {
    setAnchorId(id);
    setSearch("");
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

  function addNode(type, position) {
    if (running) return;
    if (nodes.length >= 20) {
      setMessage("A workflow can contain up to 20 nodes.");
      return;
    }
    const id = crypto.randomUUID();
    const anchor = nodes.find((node) => node.id === anchorId);
    const item = catalog.find((item) => item.type === type);
    const from = catalog.find((item) => item.type === anchor?.data.operation);
    if (
      anchor &&
      (from.outputType !== item.inputType ||
        edges.some((edge) => edge.source === anchorId))
    ) {
      setMessage("Choose a compatible next step with an available connection.");
      return;
    }
    const location =
      position ||
      (anchor
        ? { x: anchor.position.x + 260, y: anchor.position.y }
        : flow.screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          }));
    setNodes((current) => [
      ...current,
      {
        id,
        type: "operation",
        position: location,
        data: {
          operation: type,
          options: type === "context.clean" ? { collapseBlankLines: true } : {},
        },
      },
    ]);
    if (anchor)
      setEdges((current) => [
        ...current,
        { id: crypto.randomUUID(), source: anchorId, target: id },
      ]);
    setSelectedId(id);
    setShowLibrary(false);
    setInspectorOpen(false);
    setAnchorId(null);
    setInspectorTab("settings");
    invalidate();
    if (anchor)
      setTimeout(
        () => flow.fitView({ padding: 0.3, maxZoom: 1.2, duration: 200 }),
        50,
      );
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
      setMessage("Upload a document or use the sample before running.");
      return;
    }
    if (running) return;
    invalidate();
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
          running,
          canAppend:
            node.data.operation !== "artifact.preview" &&
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
  const anchorItem = catalog.find(
    (item) => item.type === anchor?.data.operation,
  );
  const filtered = catalog.filter(
    (item) =>
      (!anchorItem ||
        (item.type !== "file.upload" &&
          item.inputType === anchorItem.outputType)) &&
      `${item.title} ${item.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const successCount = Object.values(states).filter(
    (state) => state.status === "succeeded",
  ).length;

  return (
    <div className="app-shell">
      <main className="workspace">
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
        <div className="floating-title">
          <button
            className="hamburger icon-button"
            aria-label="Open workflow menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Icon name="menu" size={21} />
          </button>
          <img src="/flowkit.svg" alt="FlowKit" width="25" height="25" />
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
        <div className="floating-tools">
          <button
            className="source-chip"
            onClick={() => fileRef.current.click()}
            disabled={running}
            title="Choose source document"
          >
            <Icon name={file ? "document" : "upload"} size={16} />
            <span>{file?.name || "Choose document"}</span>
          </button>
          <button
            className="sample-shortcut"
            aria-label="Try with a sample document"
            onClick={loadSample}
            disabled={running}
          >
            Use sample
          </button>
          <button
            className="button add-node-button"
            aria-label="Add node"
            aria-expanded={showLibrary}
            onClick={() => {
              if (showLibrary) setShowLibrary(false);
              else openLibrary();
            }}
            disabled={running}
          >
            <Icon name="plus" size={19} />
            <span>Add node</span>
          </button>
        </div>
        <div className="canvas-meta">
          <span className="local-dot" />
          Local workflow <span> / </span>
          {nodes.length} nodes · {edges.length} connections
        </div>
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

        <span className="canvas-hint">
          Drag to move · Scroll to zoom · Select a connection and press Delete
          to remove it
        </span>
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
            {filtered.map((item) => (
              <button
                key={item.type}
                className="palette-node"
                draggable={!running}
                disabled={running}
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/flowkit", item.type);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setDragImage(
                    event.currentTarget.querySelector(".palette-icon"),
                    20,
                    20,
                  );
                }}
                onClick={() => addNode(item.type)}
                title={`Drag or click to add ${item.title}`}
              >
                <span className={`palette-icon ${item.color}`}>
                  <Icon name={item.icon} size={24} />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
                <Icon name="plus" size={16} />
              </button>
            ))}
          </div>
          {!filtered.length && (
            <p className="no-matches">No compatible nodes match your search.</p>
          )}
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
                    <Icon name="document" size={14} /> Try with a sample
                    document <Icon name="arrow" size={14} />
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
                                  edges.find(
                                    (edge) => edge.source === selectedId,
                                  )?.target ||
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
        <dialog
          ref={menuRef}
          className="workflow-menu"
          aria-label="Workflow menu"
          onCancel={() => setMenuOpen(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setMenuOpen(false);
          }}
        >
          <div className="menu-heading">
            <img src="/flowkit.svg" alt="" width="28" height="28" />
            <strong>FlowKit</strong>
            <button
              className="icon-button"
              aria-label="Close workflow menu"
              onClick={() => setMenuOpen(false)}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          <button
            disabled={running}
            onClick={() => {
              setMenuOpen(false);
              reset(true);
            }}
          >
            <Icon name="plus" />
            New workflow
          </button>
          <button
            disabled={running}
            onClick={() => {
              setMenuOpen(false);
              reset();
            }}
          >
            <Icon name="workflow" />
            Use document template
          </button>
          <div className="menu-divider" />
          <button
            disabled={running}
            onClick={() => {
              setMenuOpen(false);
              importRef.current.click();
            }}
          >
            <Icon name="upload" />
            Import workflow
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              saveWorkflow();
            }}
          >
            <Icon name="download" />
            Export workflow
          </button>
          <div className="menu-divider" />
          <button
            onClick={() => {
              setMenuOpen(false);
              setShowHelp(true);
            }}
          >
            <Icon name="help" />
            Quick guide
          </button>
          <p>Document workflows · Runs locally</p>
        </dialog>
      )}

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
