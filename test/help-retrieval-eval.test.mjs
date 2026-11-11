import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieve, assess, cases } from '../scripts/eval-help-retrieval.mjs';

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
