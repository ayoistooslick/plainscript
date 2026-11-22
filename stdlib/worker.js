// Worker threads are real OS threads. The main side starts the compiled module
// as a worker and waits for one result; the worker side installs a handler with
// workerMain. A timeout terminates the worker and rejects with an Error.

import { Worker, isMainThread, parentPort, threadId, workerData } from 'node:worker_threads';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function runInWorker(modulePath, input, options = {}) {
  return new Promise((resolve, reject) => {
    const target = path.resolve(modulePath);
    let settled = false;
    let timer = null;
    const worker = new Worker(pathToFileURL(target), {
      workerData: {
        __plainscriptWorker: true,
        input,
        extra: options.workerData === undefined ? null : options.workerData,
      },
    });
    const finish = (failure, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (failure) reject(failure);
      else resolve(value);
    };
    if (options.timeout && options.timeout > 0) {
      timer = setTimeout(() => {
        worker.terminate().then(() => finish(new Error(`Worker "${modulePath}" exceeded ${options.timeout} ms.`)));
      }, options.timeout);
    }
    worker.once('message', (message) => {
      if (!message || typeof message !== 'object' || !('ok' in message)) {
        finish(new Error(`Worker "${modulePath}" sent an invalid result.`));
        return;
      }
      if (message.ok) finish(null, message.value);
      else finish(new Error(message.error || 'Worker failed.'));
    });
    worker.once('error', (failure) => finish(failure));
    worker.once('exit', (code) => {
      if (!settled) finish(new Error(`Worker "${modulePath}" exited with code ${code} before sending a result.`));
    });
  });
}

export function workerMain(handler) {
  if (isMainThread || !workerData || !workerData.__plainscriptWorker) return;
  const reply = (message) => {
    if (parentPort) parentPort.postMessage(message);
  };
  Promise.resolve()
    .then(() => handler(workerData.input))
    .then((value) => reply({ ok: true, value }))
    .catch((failure) => reply({
      ok: false,
      error: failure && failure.message ? failure.message : String(failure),
    }));
}

export function isMainThread() {
  return isMainThread;
}

export function threadId() {
  return threadId;
}
