// Structured concurrency primitives for PlainScript.
//
// Semantics:
// - A task group owns every task started through it. close() waits for all
//   started tasks, then returns their results in start order or rejects with the
//   first failure. A failure cancels the group's siblings.
// - Cancellation is cooperative. Cancelling a signal runs its callbacks,
//   propagates to child signals, and is idempotent. It cannot stop synchronous
//   user code, JavaScript promises or host operations that ignore the signal.
// - Channel operations participate in cancellation and are deterministic:
//   close wakes every waiter with ChannelClosedError.
// - Timers are always cleared by delay() and timeout().

export class CancellationError extends Error {
  constructor(message = 'task cancelled', reason) {
    super(message);
    this.name = 'CancellationError';
    this.code = 'PS_TASK_CANCELLED';
    this.reason = reason;
  }
}

export class TaskTimeoutError extends Error {
  constructor(milliseconds) {
    super(`task exceeded its ${milliseconds}ms timeout`);
    this.name = 'TaskTimeoutError';
    this.code = 'PS_TASK_TIMEOUT';
    this.timeout = milliseconds;
  }
}

export class ChannelClosedError extends Error {
  constructor(message = 'channel is closed') {
    super(message);
    this.name = 'ChannelClosedError';
    this.code = 'PS_CHANNEL_CLOSED';
  }
}

export class TaskGroupError extends Error {
  constructor(errors) {
    super('one or more tasks failed');
    this.name = 'TaskGroupError';
    this.code = 'PS_TASK_GROUP';
    this.errors = errors;
    this.cause = errors[0];
  }
}

const groupState = new WeakMap();
const channelState = new WeakMap();

function makeSignal(parent) {
  const signal = {
    cancelled: false,
    reason: null,
    listeners: new Set(),
    parent: null,
    detach: null,
  };
  if (parent) {
    if (parent.cancelled) {
      signal.cancelled = true;
      signal.reason = parent.reason;
    } else {
      signal.parent = parent;
      const listener = () => cancel(signal, parent.reason);
      parent.listeners.add(listener);
      signal.detach = () => parent.listeners.delete(listener);
    }
  }
  return signal;
}

export function cancellation(reason) {
  const signal = makeSignal(null);
  if (reason !== undefined) cancel(signal, reason);
  return signal;
}

export function isCancelled(signal) {
  return Boolean(signal && signal.cancelled);
}

export function cancel(signal, reason = 'cancelled') {
  if (!signal || signal.cancelled) return false;
  signal.cancelled = true;
  signal.reason = reason;
  const listeners = [...signal.listeners];
  signal.listeners.clear();
  if (signal.detach) {
    signal.detach();
    signal.detach = null;
  }
  for (const listener of listeners) {
    try { listener(reason); } catch { /* cancellation must remain deterministic */ }
  }
  return true;
}

export function throwIfCancelled(signal) {
  if (isCancelled(signal)) throw new CancellationError('task cancelled', signal.reason);
}

export function onCancel(signal, callback) {
  if (!signal) return () => {};
  if (signal.cancelled) {
    callback(signal.reason);
    return () => {};
  }
  const listener = (reason) => callback(reason);
  signal.listeners.add(listener);
  return () => signal.listeners.delete(listener);
}

export function group(options = {}) {
  const settings = typeof options === 'string' ? { label: options } : (options || {});
  const parent = settings.parent || settings.signal || null;
  const g = {
    label: settings.label || 'task group',
    signal: makeSignal(parent),
    tasks: [],
    active: new Set(),
    closed: false,
    closing: false,
    firstError: null,
    closePromise: null,
  };
  groupState.set(g, g);
  Object.defineProperty(g, 'cancelled', {
    enumerable: true,
    get() { return Boolean(g.signal.cancelled); },
  });
  return g;
}

function failGroup(g, error) {
  if (g.firstError === null) g.firstError = error;
  if (!g.signal.cancelled) cancel(g.signal, error);
  for (const entry of g.active) {
    if (entry.signal && !entry.signal.cancelled) cancel(entry.signal, error);
  }
}

export function run(g, task) {
  if (!g || !g.signal) return Promise.reject(new TypeError('run expects a task group'));
  if (g.closed || g.closing) return Promise.reject(new Error('task group is closed'));
  if (typeof task !== 'function') return Promise.reject(new TypeError('task must be a function'));
  const signal = makeSignal(g.signal);
  const entry = { signal, result: undefined };
  g.tasks.push(entry);
  g.active.add(entry);
  let promise;
  try {
    promise = Promise.resolve(task(signal));
  } catch (error) {
    promise = Promise.reject(error);
  }
  entry.promise = promise;
  promise.then(
    (result) => {
      entry.result = result;
      g.active.delete(entry);
      if (signal.detach) signal.detach();
    },
    (error) => {
      g.active.delete(entry);
      failGroup(g, error);
      if (signal.detach) signal.detach();
    },
  );
  // Keep the internal bookkeeping rejection handled; the returned promise still
  // rejects for the caller.
  promise.catch(() => {});
  return promise;
}

export function cancelGroup(g, reason = 'cancelled') {
  if (!g || !g.signal) return false;
  const changed = cancel(g.signal, reason);
  for (const entry of g.active) cancel(entry.signal, reason);
  return changed;
}

export function close(g) {
  if (!g || !g.signal) return Promise.reject(new TypeError('close expects a task group'));
  if (g.closePromise) return g.closePromise;
  g.closing = true;
  g.closePromise = (async () => {
    // New tasks are rejected once closing begins, so one snapshot is enough.
    await Promise.allSettled([...g.active].map((entry) => entry.promise));
    g.closed = true;
    g.closing = false;
    if (g.firstError !== null) throw g.firstError;
    if (g.signal.cancelled) throw new CancellationError('task group cancelled', g.signal.reason);
    return g.tasks.map((entry) => entry.result);
  })();
  return g.closePromise;
}

export function all(g) {
  return close(g);
}

export function delay(milliseconds, signal) {
  if (signal && signal.cancelled) {
    return Promise.reject(new CancellationError('task cancelled', signal.reason));
  }
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(undefined);
    }, Math.max(0, Number(milliseconds) || 0));
    if (signal) {
      unsubscribe = onCancel(signal, (reason) => {
        clearTimeout(timer);
        reject(new CancellationError('task cancelled', reason));
      });
    }
  });
}

export function timeout(milliseconds, task, parent) {
  if (typeof task !== 'function') return Promise.reject(new TypeError('timeout expects a task function'));
  const signal = makeSignal(parent || null);
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      cancel(signal, 'timeout');
      reject(new TaskTimeoutError(milliseconds));
    }, Math.max(0, Number(milliseconds) || 0));
  });
  let work;
  try {
    work = Promise.resolve(task(signal));
  } catch (error) {
    work = Promise.reject(error);
  }
  work.catch(() => {});
  const raced = Promise.race([work, deadline]);
  return raced.finally(() => {
    clearTimeout(timer);
    if (signal.detach) signal.detach();
  });
}

export function channel(capacity = 0) {
  const size = Math.max(0, Math.floor(Number(capacity) || 0));
  const state = {
    capacity: size,
    values: [],
    receivers: [],
    senders: [],
    closed: false,
  };
  const ch = {
    send(value, signal) { return channelSend(state, value, signal); },
    receive(signal) { return channelReceive(state, signal); },
    close() { return channelClose(state); },
    get closed() { return state.closed; },
    get size() { return state.values.length; },
  };
  channelState.set(ch, state);
  return ch;
}

function removeWaiter(list, waiter) {
  const index = list.indexOf(waiter);
  if (index >= 0) list.splice(index, 1);
}

function settleWaiter(waiter, value) {
  if (waiter.done) return false;
  waiter.done = true;
  if (waiter.unsubscribe) waiter.unsubscribe();
  waiter.resolve(value);
  return true;
}

function rejectWaiter(waiter, error) {
  if (waiter.done) return false;
  waiter.done = true;
  if (waiter.unsubscribe) waiter.unsubscribe();
  waiter.reject(error);
  return true;
}

function channelSend(state, value, signal) {
  if (state.closed) return Promise.reject(new ChannelClosedError());
  if (signal && signal.cancelled) return Promise.reject(new CancellationError('task cancelled', signal.reason));
  const receiver = state.receivers.shift();
  if (receiver) {
    settleWaiter(receiver, value);
    return Promise.resolve();
  }
  if (state.capacity > 0 && state.values.length < state.capacity) {
    state.values.push(value);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const waiter = { kind: 'send', value, resolve, reject, done: false, unsubscribe: null };
    state.senders.push(waiter);
    if (signal) {
      waiter.unsubscribe = onCancel(signal, (reason) => {
        removeWaiter(state.senders, waiter);
        rejectWaiter(waiter, new CancellationError('task cancelled', reason));
      });
    }
  });
}

function channelReceive(state, signal) {
  if (signal && signal.cancelled) return Promise.reject(new CancellationError('task cancelled', signal.reason));
  if (state.values.length > 0) {
    const value = state.values.shift();
    const sender = state.senders.shift();
    if (sender) {
      state.values.push(sender.value);
      settleWaiter(sender, undefined);
    }
    return Promise.resolve(value);
  }
  const sender = state.senders.shift();
  if (sender) {
    settleWaiter(sender, undefined);
    return Promise.resolve(sender.value);
  }
  if (state.closed) return Promise.reject(new ChannelClosedError());
  return new Promise((resolve, reject) => {
    const waiter = { kind: 'receive', resolve, reject, done: false, unsubscribe: null };
    state.receivers.push(waiter);
    if (signal) {
      waiter.unsubscribe = onCancel(signal, (reason) => {
        removeWaiter(state.receivers, waiter);
        rejectWaiter(waiter, new CancellationError('task cancelled', reason));
      });
    }
  });
}

function channelClose(state) {
  if (state.closed) return;
  state.closed = true;
  for (const receiver of state.receivers.splice(0)) rejectWaiter(receiver, new ChannelClosedError());
  for (const sender of state.senders.splice(0)) rejectWaiter(sender, new ChannelClosedError('channel closed before send completed'));
  state.values.length = 0;
}

export async function spawnWorker(source, options = {}) {
  const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
  let worker;
  let node = false;
  if (isNode) {
    const { Worker: NodeWorker } = await import('node:worker_threads');
    const { pathToFileURL } = await import('node:url');
    let url;
    if (source instanceof URL) url = source;
    else if (/^[a-z]+:/i.test(String(source))) url = new URL(source);
    else url = new URL(String(source), pathToFileURL(`${process.cwd()}/`));
    worker = new NodeWorker(url, options);
    node = true;
  } else if (typeof Worker !== 'undefined') {
    worker = new Worker(source, options);
  } else {
    throw new Error('workers are not available in this runtime');
  }
  const listeners = new Set();
  const errors = new Set();
  const onMessage = (handler) => {
    if (node) worker.on('message', handler);
    else worker.addEventListener('message', (event) => handler(event.data));
    return () => {
      if (node) worker.off('message', handler);
      else worker.removeEventListener('message', handler);
    };
  };
  const onError = (handler) => {
    if (node) worker.on('error', handler);
    else worker.addEventListener('error', handler);
    return () => {
      if (node) worker.off('error', handler);
      else worker.removeEventListener('error', handler);
    };
  };
  const join = new Promise((resolve, reject) => {
    if (node) {
      worker.once('exit', (code) => resolve(code));
      worker.once('error', reject);
    } else {
      worker.addEventListener('error', reject);
    }
  });
  join.catch(() => {});
  return {
    raw: worker,
    post(message) { worker.postMessage(message); },
    onMessage,
    onError,
    terminate() { return worker.terminate(); },
    join,
  };
}

// A small amount of introspection is useful for tests without exposing the
// internal state objects.
export function inspectGroup(g) {
  const state = groupState.get(g);
  if (!state) return null;
  return {
    label: state.label,
    tasks: state.tasks.length,
    active: state.active.size,
    closed: state.closed,
    cancelled: Boolean(state.signal.cancelled),
    firstError: state.firstError,
  };
}

export function inspectChannel(ch) {
  const state = channelState.get(ch);
  if (!state) return null;
  return {
    capacity: state.capacity,
    size: state.values.length,
    senders: state.senders.length,
    receivers: state.receivers.length,
    closed: state.closed,
  };
}
