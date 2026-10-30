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
  const previous = new Map();
  for (const edge of pipeline.edges) {
    assertRecord(edge, 'Edge');
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      throw new TypeError('Every edge must reference existing nodes');
    }
    const targetDefinition = registry.get(nodes.get(edge.target).type);
    if (next.has(edge.source) || (previous.has(edge.target) && !targetDefinition.acceptsMany)) {
      throw new TypeError('Branching is not allowed; only merge operations accept multiple inputs');
    }
    const source = registry.get(nodes.get(edge.source).type);
    const target = registry.get(nodes.get(edge.target).type);
    if (source.outputType !== target.inputType) {
      throw new TypeError(`Incompatible connection: ${edge.source} -> ${edge.target}`);
    }
    next.set(edge.source, edge.target);
    previous.set(edge.target, [...(previous.get(edge.target) || []), edge.source]);
  }

  const roots = [...nodes.keys()].filter(id => !previous.has(id));
  if (!roots.length) throw new TypeError('Pipeline must have a connected start node and no cycles');
  if ([...nodes.keys()].filter(id => !next.has(id)).length !== 1) throw new TypeError('Pipeline inputs must converge into one output');
  const ordered = [];
  const visited = new Set();
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id); ordered.push(nodes.get(id));
    const target = next.get(id);
    if (target && previous.get(target).every(source => visited.has(source))) queue.push(target);
  }
  if (ordered.length !== nodes.size) {
    throw new TypeError('Pipeline must be connected and contain no cycles');
  }
  return ordered;
}

/** Invalid definitions reject before execution; operation failures return a failed run. */
export async function runPipeline(pipeline, registry, { input, inputs, signal, onEvent } = {}) {
  const ordered = validatePipeline(pipeline, registry);
  const edges = pipeline.edges;
  const roots = ordered.filter(node => !edges.some(edge => edge.target === node.id));
  const supplied = inputs || (roots.length === 1 ? { [roots[0].id]: input } : null);
  assertRecord(supplied, 'Pipeline inputs');
  for (const root of roots) if (supplied[root.id]?.type !== registry.get(root.type).inputType || !Object.hasOwn(supplied[root.id] || {}, 'value'))
    throw new TypeError('Each pipeline start node requires a matching input');
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
  const outputs = new Map();

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
      const sources = edges.filter(edge => edge.target === node.id).map(edge => outputs.get(edge.source));
      const definition = registry.get(node.type);
      const value = sources.length ? (definition.acceptsMany ? { type: definition.inputType, value: sources.map(source => source.value) } : sources[0]) : supplied[node.id];
      const output = await registry.execute(node.type, value, node.options, { signal });
      outputs.set(node.id, output);
      state.status = 'succeeded';
      state.output = output;
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
    result.output = outputs.get(ordered.at(-1).id);
  }
  for (const state of result.nodes) {
    if (state.status === 'pending') state.status = 'skipped';
  }
  result.durationMs = performance.now() - started;
  await emit({ type: `pipeline.${result.status}`, durationMs: result.durationMs });
  return result;
}
