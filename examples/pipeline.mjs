import { OperationRegistry } from '../src/operations.mjs';
import { runPipeline } from '../src/pipeline.mjs';

const registry = new OperationRegistry();
registry.register('text.trim', {
  inputType: 'text',
  outputType: 'text',
  validateInput(value) {
    if (typeof value !== 'string') throw new TypeError('Expected string content');
  },
  run: async input => ({ type: 'text', value: input.value.trim() }),
});
registry.register('text.uppercase', {
  inputType: 'text',
  outputType: 'text',
  run: async input => ({ type: 'text', value: input.value.toUpperCase() }),
});

const result = await runPipeline({
  nodes: [{ id: 'trim', type: 'text.trim' }, { id: 'uppercase', type: 'text.uppercase' }],
  edges: [{ source: 'trim', target: 'uppercase' }],
}, registry, {
  input: { type: 'text', value: '  Hello FlowKit  ' },
  onEvent: event => console.log(JSON.stringify(event)),
});

console.log(JSON.stringify(result, null, 2));
if (result.status !== 'succeeded') process.exitCode = 1;
