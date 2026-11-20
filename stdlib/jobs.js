// Background job queue with optional durable storage.
//
// The queue is an in-process scheduler: it bounds concurrency, retries with
// backoff, supports cooperative cancellation and drains on shutdown. Passing a
// `store` adapter makes job records durable. On restart, call `handle(name,
// work)` for every persisted handler name, then await `queue.ready`; pending
// and interrupted jobs are re-enqueued. A function cannot be serialized, so a
// durable queue always needs its handlers registered explicitly.

import { cancellation, cancel, isCancelled, CancellationError } from './task.js';

export class JobError extends Error {
  constructor(job, message, cause) {
    super(message);
    this.name = 'JobError';
    this.code = 'PS_JOB_FAILED';
    this.job = job;
    this.attempts = job ? job.attempts : 0;
    this.cause = cause;
  }
}

export class JobTimeoutError extends Error {
  constructor(job, milliseconds) {
    super(`job ${job.name} exceeded its ${milliseconds}ms timeout`);
    this.name = 'JobTimeoutError';
    this.code = 'PS_JOB_TIMEOUT';
    this.job = job;
    this.timeout = milliseconds;
  }
}

export class JobCancelledError extends Error {
  constructor(job, reason) {
    super(`job ${job.name} was cancelled`);
    this.name = 'JobCancelledError';
    this.code = 'PS_JOB_CANCELLED';
    this.job = job;
    this.reason = reason;
  }
}

function normalizeOptions(options = {}) {
  return {
    concurrency: Math.max(1, Math.floor(Number(options.concurrency) || 1)),
    retries: Math.max(0, Math.floor(Number(options.retries) || 0)),
    retryDelay: Math.max(0, Number(options.retryDelay) || 0),
    timeout: options.timeout === undefined ? 0 : Math.max(0, Number(options.timeout) || 0),
    retryBackoff: options.retryBackoff === undefined ? 2 : Math.max(0, Number(options.retryBackoff) || 0),
  };
}

function jobRecord(job) {
  return {
    id: job.id,
    name: job.name,
    payload: job.payload,
    state: job.state,
    attempts: job.attempts,
    retries: job.retries,
    retryDelay: job.retryDelay,
    retryBackoff: job.retryBackoff,
    timeout: job.timeout,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error ? String(job.error.message || job.error) : null,
    updatedAt: Date.now(),
  };
}

// A deterministic in-memory store is useful for tests and for applications
// that only need persistence across a controlled drain, not across a crash.
export function memoryStore() {
  const records = new Map();
  return {
    async save(record) { records.set(record.id, JSON.parse(JSON.stringify(record))); },
    async load() { return [...records.values()].map((record) => JSON.parse(JSON.stringify(record))); },
    async delete(id) { records.delete(id); },
    async close() {},
    get size() { return records.size; },
  };
}

export async function sqliteStore(file = ':memory:') {
  let sqlite;
  try {
    sqlite = await import('node:sqlite');
  } catch (cause) {
    throw new Error(`sqliteStore requires Node 22+ with node:sqlite: ${cause.message}`);
  }
  const raw = new sqlite.DatabaseSync(file);
  raw.exec(`CREATE TABLE IF NOT EXISTS plainscript_jobs (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    payload TEXT,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    retries INTEGER NOT NULL,
    retry_delay INTEGER NOT NULL,
    retry_backoff REAL NOT NULL,
    timeout INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    error TEXT,
    updated_at INTEGER NOT NULL
  )`);
  raw.exec('CREATE INDEX IF NOT EXISTS plainscript_jobs_state ON plainscript_jobs (state)');
  const row = (record) => ({
    id: record.id,
    name: record.name,
    payload: record.payload === null || record.payload === undefined ? null : JSON.stringify(record.payload),
    state: record.state,
    attempts: record.attempts,
    retries: record.retries,
    retry_delay: record.retryDelay,
    retry_backoff: record.retryBackoff,
    timeout: record.timeout,
    created_at: record.createdAt,
    started_at: record.startedAt,
    finished_at: record.finishedAt,
    error: record.error,
    updated_at: record.updatedAt,
  });
  return {
    async save(record) {
      const value = row(record);
      raw.prepare(`INSERT INTO plainscript_jobs
        (id, name, payload, state, attempts, retries, retry_delay, retry_backoff, timeout, created_at, started_at, finished_at, error, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, payload=excluded.payload, state=excluded.state, attempts=excluded.attempts,
          retries=excluded.retries, retry_delay=excluded.retry_delay, retry_backoff=excluded.retry_backoff,
          timeout=excluded.timeout, created_at=excluded.created_at, started_at=excluded.started_at,
          finished_at=excluded.finished_at, error=excluded.error, updated_at=excluded.updated_at`)
        .run(...Object.values(value));
    },
    async load() {
      const rows = raw.prepare(`SELECT id, name, payload, state, attempts, retries, retry_delay, retry_backoff, timeout,
        created_at, started_at, finished_at, error, updated_at FROM plainscript_jobs ORDER BY id ASC`).all();
      return rows.map((value) => ({
        id: value.id,
        name: value.name,
        payload: value.payload === null ? null : JSON.parse(value.payload),
        state: value.state,
        attempts: value.attempts,
        retries: value.retries,
        retryDelay: value.retry_delay,
        retryBackoff: value.retry_backoff,
        timeout: value.timeout,
        createdAt: value.created_at,
        startedAt: value.started_at === null ? null : value.started_at,
        finishedAt: value.finished_at === null ? null : value.finished_at,
        error: value.error,
        updatedAt: value.updated_at,
      }));
    },
    async delete(id) { raw.prepare('DELETE FROM plainscript_jobs WHERE id = ?').run(id); },
    async close() { raw.close(); },
    raw,
  };
}

export function queue(options = {}) {
  const defaults = normalizeOptions(options);
  const store = options.store || null;
  const state = {
    defaults,
    store,
    handlers: new Map(),
    records: new Map(),
    pending: [],
    delayed: new Set(),
    running: new Set(),
    nextId: 1,
    closed: false,
    draining: false,
    recovering: false,
    listeners: new Map(),
    drainWaiters: [],
    writes: new Set(),
    storageErrors: [],
  };

  const emit = (event, job) => {
    for (const listener of state.listeners.get(event) || []) {
      try { listener(job); } catch { /* event observers cannot break the queue */ }
    }
  };

  const snapshot = (job) => {
    const record = jobRecord(job);
    state.records.set(record.id, record);
    return record;
  };

  const track = (promise) => {
    const tracked = Promise.resolve(promise).catch((failure) => {
      state.storageErrors.push(failure);
      emit('storage-error', { error: failure });
      return null;
    });
    state.writes.add(tracked);
    tracked.finally(() => state.writes.delete(tracked));
    return tracked;
  };

  const persist = (job) => {
    const record = snapshot(job);
    if (!store) return Promise.resolve(record);
    return track(store.save(record));
  };

  const flushWrites = async () => {
    while (state.writes.size) await Promise.all([...state.writes]);
  };

  const settleDrain = () => {
    if (state.pending.length || state.running.size || state.delayed.size || !state.draining) return;
    state.draining = false;
    for (const resolve of state.drainWaiters.splice(0)) resolve();
  };

  const finish = (job, status, value, error) => {
    if (job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled') return;
    job.state = status;
    job.finishedAt = Date.now();
    job.error = error || null;
    state.running.delete(job);
    if (status === 'completed') job.resolve(value);
    else job.reject(error);
    persist(job);
    emit(status, job);
    settleDrain();
    schedule();
  };

  const attempt = (job) => {
    if (job.state === 'cancelled') return;
    job.state = 'running';
    job.attempts += 1;
    job.startedAt = Date.now();
    state.running.add(job);
    persist(job);
    const signal = cancellation();
    job.signal = signal;
    let timer = null;
    let timedOut = false;
    const work = Promise.resolve().then(() => job.work(job.payload, signal));
    const timeout = job.timeout > 0
      ? new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          if (!isCancelled(signal)) cancel(signal, new Error('job timeout'));
          reject(new JobTimeoutError(job, job.timeout));
        }, job.timeout);
      })
      : null;
    const raced = timeout ? Promise.race([work, timeout]) : work;
    raced.then(
      (value) => {
        if (timer) clearTimeout(timer);
        if (job.state === 'cancelled') return;
        finish(job, 'completed', value);
      },
      (error) => {
        if (timer) clearTimeout(timer);
        if (job.state === 'cancelled') return;
        if (timedOut || error instanceof JobTimeoutError) {
          finish(job, 'failed', undefined, error);
          return;
        }
        if (job.attempts <= job.retries) {
          job.state = 'pending';
          job.error = error;
          state.running.delete(job);
          state.delayed.add(job);
          persist(job);
          const delay = job.retryDelay * Math.pow(job.retryBackoff, job.attempts - 1);
          job.retryTimer = setTimeout(() => {
            job.retryTimer = null;
            state.delayed.delete(job);
            if (job.state === 'pending' && !state.closed) {
              state.pending.unshift(job);
              persist(job);
              schedule();
            } else if (job.state === 'pending') {
              job.state = 'cancelled';
              job.finishedAt = Date.now();
              job.reject(new JobCancelledError(job, 'queue closed'));
              persist(job);
              emit('cancelled', job);
              settleDrain();
            }
          }, delay);
          settleDrain();
          return;
        }
        finish(job, 'failed', undefined, error instanceof Error ? error : new JobError(job, String(error), error));
      },
    );
    work.catch(() => {});
  };

  const schedule = () => {
    if (state.closed || state.recovering) return;
    while (state.running.size < state.defaults.concurrency && state.pending.length) {
      const job = state.pending.shift();
      if (job.state === 'pending') attempt(job);
    }
    settleDrain();
  };

  const createJob = (details) => {
    const {
      id, name, payload, work, retries, retryDelay, retryBackoff, timeout,
      attempts = 0, state: jobState = 'pending', createdAt = Date.now(), startedAt = null, finishedAt = null,
    } = details;
    const job = {
      id,
      name,
      payload,
      work,
      retries,
      retryDelay,
      retryBackoff,
      timeout: Number(timeout) || 0,
      attempts,
      state: jobState,
      createdAt,
      startedAt,
      finishedAt,
      error: null,
      signal: null,
      resolve: null,
      reject: null,
      retryTimer: null,
    };
    const promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    promise.catch(() => {});
    job.promise = promise;
    job.cancel = (reason = 'cancelled') => {
      if (job.state === 'pending') {
        const index = state.pending.indexOf(job);
        if (index >= 0) state.pending.splice(index, 1);
        if (job.retryTimer) {
          clearTimeout(job.retryTimer);
          job.retryTimer = null;
          state.delayed.delete(job);
        }
        job.state = 'cancelled';
        job.finishedAt = Date.now();
        job.error = new JobCancelledError(job, reason);
        job.reject(job.error);
        persist(job);
        emit('cancelled', job);
        settleDrain();
        return true;
      }
      if (job.state === 'running') {
        job.state = 'cancelled';
        state.running.delete(job);
        if (job.signal) cancel(job.signal, reason);
        job.finishedAt = Date.now();
        job.error = new JobCancelledError(job, reason);
        job.reject(job.error);
        persist(job);
        emit('cancelled', job);
        settleDrain();
        return true;
      }
      return false;
    };
    return job;
  };

  const enqueue = (job, { persistFirst = true } = {}) => {
    const identified = job.id === undefined ? { ...job, id: state.nextId++ } : job;
    if (identified.id >= state.nextId) state.nextId = identified.id + 1;
    state.records.set(identified.id, jobRecord(identified));
    state.pending.push(identified);
    emit('queued', identified);
    if (persistFirst && store) {
      track(persist(identified)).then(() => schedule());
    } else {
      persist(identified);
      schedule();
    }
    return identified;
  };

  const q = {
    add(name, work, payload = null, jobOptions = {}) {
      if (state.closed) throw new Error('job queue is closed');
      if (typeof name !== 'string' || !name) throw new TypeError('job name must be non-empty text');
      if (typeof work !== 'function') throw new TypeError('job work must be a function');
      state.handlers.set(name, work);
      const settings = normalizeOptions({ ...state.defaults, ...jobOptions });
      const job = createJob({
        id: state.nextId++,
        name,
        payload,
        work,
        ...settings,
      });
      return enqueue(job);
    },
    handle(name, work) {
      if (typeof name !== 'string' || !name) throw new TypeError('job name must be non-empty text');
      if (typeof work !== 'function') throw new TypeError('job work must be a function');
      state.handlers.set(name, work);
      return q;
    },
    async recover() {
      if (!store) return 0;
      state.recovering = true;
      try {
        const records = await store.load();
        let recovered = 0;
        for (const record of records) {
        state.records.set(record.id, record);
        if (!['pending', 'running', 'delayed'].includes(record.state)) continue;
        const work = state.handlers.get(record.name);
        if (!work) {
          const failed = {
            ...record,
            state: 'failed',
            finishedAt: Date.now(),
            error: `no handler registered for "${record.name}"`,
            updatedAt: Date.now(),
          };
          state.records.set(failed.id, failed);
          track(store.save(failed));
          state.storageErrors.push(new Error(failed.error));
          emit('failed', failed);
          continue;
        }
        const job = createJob({
          id: record.id,
          name: record.name,
          payload: record.payload,
          work,
          retries: record.retries,
          retryDelay: record.retryDelay,
          retryBackoff: record.retryBackoff,
          timeout: record.timeout,
          attempts: record.attempts,
          state: 'pending',
          createdAt: record.createdAt,
          startedAt: null,
          finishedAt: null,
        });
          job.error = record.error ? new Error(record.error) : null;
          enqueue(job, { persistFirst: false });
          recovered += 1;
          emit('recovered', job);
        }
        await flushWrites();
        return recovered;
      } finally {
        state.recovering = false;
        schedule();
      }
    },
    start() {
      state.closed = false;
      schedule();
      return q;
    },
    async drain() {
      if (!state.pending.length && !state.running.size && !state.delayed.size) {
        await flushWrites();
        return;
      }
      state.draining = true;
      await new Promise((resolve) => state.drainWaiters.push(resolve));
      await flushWrites();
    },
    async close(reason = 'queue closed') {
      state.closed = true;
      // Do not close a store while initial recovery is still loading or saving
      // records; otherwise a shutdown racing startup can lose persisted work.
      if (store) {
        try { await q.ready; } catch { /* the queue is still closable */ }
      }
      for (const job of [...state.pending]) job.cancel(reason);
      for (const job of [...state.delayed]) {
        clearTimeout(job.retryTimer);
        job.retryTimer = null;
        job.state = 'cancelled';
        job.finishedAt = Date.now();
        job.error = new JobCancelledError(job, reason);
        job.reject(job.error);
        persist(job);
        emit('cancelled', job);
      }
      state.delayed.clear();
      await q.drain();
      await flushWrites();
      if (store && typeof store.close === 'function') await store.close();
    },
    get(id) {
      return state.records.get(Number(id)) || null;
    },
    list(filter = null) {
      const records = [...state.records.values()].sort((a, b) => a.id - b.id);
      return filter ? records.filter((record) => record.state === filter) : records;
    },
    stats() {
      return {
        pending: state.pending.length,
        running: state.running.size,
        delayed: state.delayed.size,
        closed: state.closed,
        total: state.pending.length + state.running.size + state.delayed.size,
        recorded: state.records.size,
      };
    },
    on(event, handler) {
      if (!state.listeners.has(event)) state.listeners.set(event, new Set());
      state.listeners.get(event).add(handler);
      return () => state.listeners.get(event).delete(handler);
    },
    get closed() { return state.closed; },
    get ready() { return state.ready; },
    get storageErrors() { return [...state.storageErrors]; },
  };
  state.ready = store ? q.recover() : Promise.resolve(0);
  // A failed initial recovery must remain visible to the caller through
  // `ready`, while the queue itself stays usable with an empty record set.
  if (store) state.ready.catch(() => {});
  return q;
}

export function createQueue(options = {}) {
  return queue(options);
}

export async function runJobs(jobs) {
  return jobs.drain();
}

export { CancellationError };
