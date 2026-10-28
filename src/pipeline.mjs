import { performance } from 'node:perf_hooks';
import { assertRecord } from './operations.mjs';

export function validatePipeline(pipeline, registry) {
  assertRecord(pipeline, 'Pipeline');
  if (!Array.isArray(pipeline.nodes) || !pipeline.nodes.length) {
    throw new TypeError('Pipeline must contain at least one node');
  }
  if (!Array.isArray(pipeline.edges)) throw new TypeError('Edges must be an array');

  const nodes = new Map();
  for (const original of pipeline.nodes) {
    assertRecord(original, 'Node');
    if (typeof original.id !== 'string' || !original.id.trim() || nodes.has(original.id)) {
      throw new TypeError('Node IDs must be unique, nonempty strings');
    }
    registry.get(original.type);
    const options = structuredClone(original.options === undefined ? {} : original.options);
    registry.validateOptions(original.type, options);
    nodes.set(original.id, { id: original.id, type: original.type, options });
  }

  const next = new Map();
  const previous = new Set();
  for (const edge of pipeline.edges) {
    assertRecord(edge, 'Edge');
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      throw new TypeError('Every edge must reference existing nodes');
    }
    if (next.has(edge.source) || previous.has(edge.target)) {
      throw new TypeError('Only linear pipelines are supported; branching and merging are not allowed');
    }
    const source = registry.get(nodes.get(edge.source).type);
    const target = registry.get(nodes.get(edge.target).type);
    if (source.outputType !== target.inputType) {
      throw new TypeError(`Incompatible connection: ${edge.source} -> ${edge.target}`);
    }
    next.set(edge.source, edge.target);
    previous.add(edge.target);
  }

  const roots = [...nodes.keys()].filter(id => !previous.has(id));
  if (roots.length !== 1) {
    throw new TypeError('Pipeline must have one connected start node and no cycles');
  }
  const ordered = [];
  const visited = new Set();
  let id = roots[0];
  while (id !== undefined && !visited.has(id)) {
    visited.add(id);
    ordered.push(nodes.get(id));
    id = next.get(id);
  }
  if (ordered.length !== nodes.size || id !== undefined) {
    throw new TypeError('Pipeline must be connected and contain no cycles');
  }
  return ordered;
}

/** Invalid definitions reject before execution; operation failures return a failed run. */
export async function runPipeline(pipeline, registry, { input, signal, onEvent } = {}) {
  const ordered = validatePipeline(pipeline, registry);
  assertRecord(input, 'Pipeline input');
  if (input.type !== registry.get(ordered[0].type).inputType || !Object.hasOwn(input, 'value')) {
    throw new TypeError('Pipeline input must match the first operation input type and contain a value');
  }
  if (onEvent !== undefined && typeof onEvent !== 'function') {
    throw new TypeError('onEvent must be a function');
  }
  const started = performance.now();
  const result = {
    status: 'running',
    nodes: ordered.map(node => ({ id: node.id, type: node.type, status: 'pending' })),
    output: null,
  };
  // Observers receive copies; their exceptions reject the call instead of becoming tool errors.
  const emit = async event => { await onEvent?.(structuredClone(event)); };
  await emit({ type: 'pipeline.started' });
  let value = input;

  for (let index = 0; index < ordered.length; index++) {
    const node = ordered[index];
    const state = result.nodes[index];
    if (signal?.aborted) {
      result.status = 'cancelled';
      break;
    }
    state.status = 'running';
    const nodeStarted = performance.now();
    await emit({ type: 'node.started', nodeId: node.id });
    try {
      value = await registry.execute(node.type, value, node.options, { signal });
      state.status = 'succeeded';
      state.output = value;
    } catch (error) {
      state.status = signal?.aborted ? 'cancelled' : 'failed';
      state.error = error instanceof Error ? error.message : String(error);
      result.status = state.status;
      result.error = { nodeId: node.id, message: state.error };
    }
    state.durationMs = performance.now() - nodeStarted;
    await emit({ type: `node.${state.status}`, nodeId: node.id, durationMs: state.durationMs, error: state.error });
    if (result.status !== 'running') break;
  }

  if (result.status === 'running') {
    result.status = 'succeeded';
    result.output = value;
  }
  for (const state of result.nodes) {
    if (state.status === 'pending') state.status = 'skipped';
  }
  result.durationMs = performance.now() - started;
  await emit({ type: `pipeline.${result.status}`, durationMs: result.durationMs });
  return result;
}
