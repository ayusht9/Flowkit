import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieve, assess, cases, modelSettings } from '../scripts/eval-help-retrieval.mjs';

test('model settings preserve exact IDs and omit sampling parameters for GPT-5 nano', () => {
  assert.deepEqual(modelSettings('gpt-5-nano'), { model: 'gpt-5-nano', reasoning: { effort: 'minimal' }, max_output_tokens: 2000 });
  assert.equal(modelSettings('gpt-4o-mini').temperature, 0);
  assert.throws(() => modelSettings('gpt-5o-nano'), /Supported evaluation models/);
});

test('retrieval ranks matches deterministically and omits unrelated sections', () => {
  assert.deepEqual(retrieve('trim video', ['audio only', 'trim video duration', 'video codec'], 2), ['trim video duration', 'video codec']);
});

test('plan assessment rejects invalid options, incompatible chains and wrong semantics', () => {
  const step = (type, options) => ({ type, options: { startSeconds: null, durationSeconds: null, format: null, ...options } });
  assert.equal(assess({ supported: true, steps: [step('video.trim', { startSeconds: 12, durationSeconds: 20 })] }, cases[0].expected).passed, true);
  assert.equal(assess({ supported: true, steps: [step('video.trim', { startSeconds: 13, durationSeconds: 20 })] }, cases[0].expected).passed, false);
  assert.throws(() => assess({ supported: true, steps: [step('video.trim', { startSeconds: 0, durationSeconds: -1 })] }, null));
  assert.throws(() => assess({ supported: true, steps: [step('video.extractAudio', { format: 'wav' }), step('video.trim', { startSeconds: 0, durationSeconds: 1 })] }, null), /Incompatible/);
  assert.equal(assess({ supported: false, steps: [] }, null).passed, true);
  assert.equal(assess({ supported: false, steps: [] }, cases[0].expected).passed, false);
  assert.equal(assess({ supported: false, steps: [step('audio.convert', { format: 'mp3' })] }, null).passed, false);
});
