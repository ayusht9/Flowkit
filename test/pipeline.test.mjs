import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationRegistry } from '../src/operations.mjs';
import { runPipeline, validatePipeline } from '../src/pipeline.mjs';

function setup() {
  const calls = [];
  const registry = new OperationRegistry().register('append', {
    inputType: 'text', outputType: 'text',
    validateOptions(options) {
      if (typeof options.suffix !== 'string' || Object.keys(options).some(key => key !== 'suffix')) {
        throw new TypeError('Only a string suffix is accepted');
      }
    },
    validateInput(value) {
      if (typeof value !== 'string') throw new TypeError('Expected string content');
    },
    run: async (input, options) => {
      calls.push(options.suffix);
      return { type: 'text', value: input.value + options.suffix };
    },
  });
  return { registry, calls };
}

const node = (id, suffix = id) => ({ id, type: 'append', options: { suffix } });
const edge = (source, target) => ({ source, target });
const input = { type: 'text', value: 'start' };

test('runs in edge order, passes outputs, and emits progress without mutating the graph', async () => {
  const { registry, calls } = setup();
  const graph = { nodes: [node('c'), node('a'), node('b')], edges: [edge('b', 'c'), edge('a', 'b')] };
  const original = structuredClone(graph);
  const events = [];
  const result = await runPipeline(graph, registry, { input, onEvent: event => events.push(event) });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.deepEqual(result.output, { type: 'text', value: 'startabc' });
  assert.deepEqual(result.nodes.map(state => state.status), ['succeeded', 'succeeded', 'succeeded']);
  assert.equal(result.nodes[0].output.value, 'starta');
  assert.ok(result.durationMs >= 0);
  assert.ok(result.nodes.every(state => state.durationMs >= 0));
  assert.deepEqual(events.map(event => event.type), [
    'pipeline.started', 'node.started', 'node.succeeded', 'node.started',
    'node.succeeded', 'node.started', 'node.succeeded', 'pipeline.succeeded',
  ]);
  assert.deepEqual(graph, original);
});

test('supports a single node and direct calls without pipeline orchestration', async () => {
  const { registry } = setup();
  const direct = await registry.execute('append', input, { suffix: '!' });
  const result = await runPipeline({ nodes: [node('one', '!')], edges: [] }, registry, { input });
  assert.deepEqual(result.output, direct);
});

test('merges multiple pipeline inputs before continuing to one output', async () => {
  const registry = new OperationRegistry()
    .register('source', { inputType: 'text', outputType: 'text', run: async value => value })
    .register('merge', { inputType: 'text', outputType: 'text', acceptsMany: true,
      run: async value => ({ type: 'text', value: value.value.join('+') }) })
    .register('finish', { inputType: 'text', outputType: 'text', run: async value => value });
  const graph = { nodes: [
    { id: 'a', type: 'source' }, { id: 'b', type: 'source' },
    { id: 'merge', type: 'merge' }, { id: 'finish', type: 'finish' },
  ], edges: [edge('a', 'merge'), edge('b', 'merge'), edge('merge', 'finish')] };
  const result = await runPipeline(graph, registry, { inputs: {
    a: { type: 'text', value: 'first' }, b: { type: 'text', value: 'second' },
  } });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.value, 'first+second');
});

const invalidGraphs = [
  ['empty graph', { nodes: [], edges: [] }],
  ['missing edges', { nodes: [node('a')] }],
  ['duplicate IDs', { nodes: [node('a'), node('a')], edges: [] }],
  ['unknown operation', { nodes: [{ id: 'a', type: 'missing' }], edges: [] }],
  ['unknown endpoint', { nodes: [node('a')], edges: [edge('a', 'missing')] }],
  ['disconnected nodes', { nodes: [node('a'), node('b')], edges: [] }],
  ['self cycle', { nodes: [node('a')], edges: [edge('a', 'a')] }],
  ['cycle', { nodes: [node('a'), node('b')], edges: [edge('a', 'b'), edge('b', 'a')] }],
  ['disconnected cycle', { nodes: [node('a'), node('b'), node('c')], edges: [edge('b', 'c'), edge('c', 'b')] }],
  ['branch', { nodes: [node('a'), node('b'), node('c')], edges: [edge('a', 'b'), edge('a', 'c')] }],
  ['merge into a single-input operation', { nodes: [node('a'), node('b'), node('c')], edges: [edge('a', 'c'), edge('b', 'c')] }],
  ['duplicate edge', { nodes: [node('a'), node('b')], edges: [edge('a', 'b'), edge('a', 'b')] }],
  ['invalid downstream options', { nodes: [node('a'), node('b', 42)], edges: [edge('a', 'b')] }],
  ['null options', { nodes: [{ ...node('a'), options: null }], edges: [] }],
];

for (const [name, graph] of invalidGraphs) {
  test(`rejects ${name} before any operation runs`, async () => {
    const { registry, calls } = setup();
    await assert.rejects(runPipeline(graph, registry, { input }), TypeError);
    assert.deepEqual(calls, []);
  });
}

test('rejects incompatible connections and invalid initial input', async () => {
  const { registry, calls } = setup();
  registry.register('image', { inputType: 'image', outputType: 'image', run: async value => value });
  assert.throws(() => validatePipeline({
    nodes: [node('a'), { id: 'b', type: 'image' }], edges: [edge('a', 'b')],
  }, registry), /Incompatible/);
  await assert.rejects(runPipeline({ nodes: [node('a')], edges: [] }, registry, {
    input: { type: 'image', value: 'artifact-id' },
  }), /input/);
  assert.deepEqual(calls, []);
});

test('stops on failure, retains successful outputs, and skips downstream nodes', async () => {
  const { registry, calls } = setup();
  registry.register('fail', {
    inputType: 'text', outputType: 'text', run: async () => { throw new Error('Conversion failed'); },
  });
  const events = [];
  const result = await runPipeline({
    nodes: [node('a'), { id: 'b', type: 'fail' }, node('c')], edges: [edge('a', 'b'), edge('b', 'c')],
  }, registry, { input, onEvent: event => events.push(event) });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.error, { nodeId: 'b', message: 'Conversion failed' });
  assert.deepEqual(result.nodes.map(state => state.status), ['succeeded', 'failed', 'skipped']);
  assert.equal(result.output, null);
  assert.equal(result.nodes[0].output.value, 'starta');
  assert.deepEqual(calls, ['a']);
  assert.equal(events.at(-1).type, 'pipeline.failed');
});

test('rejects invalid output envelopes', async () => {
  for (const output of [null, { type: 'image', value: 'wrong' }, { type: 'text' }]) {
    const registry = new OperationRegistry().register('bad', {
      inputType: 'text', outputType: 'text', run: async () => output,
    });
    const result = await runPipeline({ nodes: [{ id: 'bad', type: 'bad' }], edges: [] }, registry, { input });
    assert.equal(result.status, 'failed');
    assert.equal(result.error.nodeId, 'bad');
  }
});

test('runs adapter-specific input and output validators', async () => {
  const registry = new OperationRegistry().register('checked', {
    inputType: 'text', outputType: 'text',
    validateInput: value => assert.equal(typeof value, 'string'),
    validateOutput: value => assert.equal(typeof value, 'string'),
    run: async () => ({ type: 'text', value: 5 }),
  });
  await assert.rejects(registry.execute('checked', { type: 'text', value: 5 }));
  await assert.rejects(registry.execute('checked', input));
});

test('cancels before any node starts', async () => {
  const { registry, calls } = setup();
  const controller = new AbortController();
  controller.abort();
  const result = await runPipeline({ nodes: [node('a')], edges: [] }, registry, {
    input, signal: controller.signal,
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.nodes[0].status, 'skipped');
  assert.deepEqual(calls, []);
});

test('forwards cancellation to the active operation and skips subsequent nodes', async () => {
  const { registry, calls } = setup();
  const controller = new AbortController();
  registry.register('cancel', {
    inputType: 'text', outputType: 'text',
    run: async (value, options, { signal }) => {
      assert.equal(signal, controller.signal);
      controller.abort();
      signal.throwIfAborted();
    },
  });
  const result = await runPipeline({
    nodes: [{ id: 'a', type: 'cancel' }, node('b')], edges: [edge('a', 'b')],
  }, registry, { input, signal: controller.signal });
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(result.nodes.map(state => state.status), ['cancelled', 'skipped']);
  assert.deepEqual(calls, []);
});

test('progress observers cannot mutate execution and observer errors reject the call', async () => {
  const { registry } = setup();
  const graph = { nodes: [node('a')], edges: [] };
  const result = await runPipeline(graph, registry, {
    input, onEvent: event => { event.type = 'modified'; },
  });
  assert.equal(result.status, 'succeeded');
  await assert.rejects(runPipeline(graph, registry, {
    input, onEvent: () => { throw new Error('Observer failed'); },
  }), /Observer failed/);
});

test('registry rejects duplicate definitions and unknown options', async () => {
  const registry = new OperationRegistry().register('identity', {
    inputType: 'text', outputType: 'text', run: async value => value,
  });
  assert.throws(() => registry.register('identity', {}), /unique/);
  assert.throws(() => registry.register('bad', { inputType: 'text', outputType: 'text' }), /run/);
  await assert.rejects(registry.execute('identity', input, { command: 'untrusted' }), /does not accept options/);
});
