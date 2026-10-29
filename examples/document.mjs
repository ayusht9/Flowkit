import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { OperationRegistry } from '../src/operations.mjs';
import { createDocumentToMarkdown } from '../src/document.mjs';
import { runPipeline } from '../src/pipeline.mjs';

try {
  const file = process.argv[2] || new URL('./fixtures/sample.html', import.meta.url);
  const name = typeof file === 'string' ? basename(file) : 'sample.html';
  const registry = new OperationRegistry().register('document.toMarkdown', createDocumentToMarkdown({
    executable: process.env.PANDOC_PATH || 'pandoc',
  }));
  const result = await runPipeline({
    nodes: [{ id: 'convert', type: 'document.toMarkdown' }], edges: [],
  }, registry, {
    input: { type: 'document', value: { name, data: await readFile(file) } },
  });
  if (result.status !== 'succeeded') throw new Error(result.error?.message || result.status);
  console.log(`Converted ${name} to Markdown in ${Math.round(result.durationMs)} ms:\n`);
  console.log(result.output.value.text);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
