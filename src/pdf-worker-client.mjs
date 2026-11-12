import { Worker } from 'node:worker_threads';

export async function runPdfWorker(workerData, { signal, timeoutMs = 30_000 } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-worker.mjs', import.meta.url), {
      workerData, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 8 },
    });
    let message, failure;
    const stop = error => { failure = error; void worker.terminate(); };
    const abort = () => stop(new DOMException('Operation cancelled', 'AbortError'));
    const timer = setTimeout(() => stop(new Error('PDF worker exceeded its execution limit')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    worker.on('message', value => { message = value; });
    worker.on('error', () => { failure ||= new Error('PDF worker failed within its resource limits'); });
    worker.once('exit', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0 || !message?.ok) reject(new Error(message?.code === 'ALREADY_SIGNED'
        ? 'This PDF already has a digital signature; use an unsigned copy to avoid invalidating it'
        : 'PDF signing or inspection failed; check the file, signature placement, certificate, and password'));
      else resolve(message.result);
    });
  });
}
