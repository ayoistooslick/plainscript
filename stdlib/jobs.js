// Small, dependency-free background job queue for server processes.
//
// This is deliberately an in-process scheduler, not a distributed queue. It
// provides bounded concurrency, retries with backoff, cooperative cancellation,
// per-job timeouts and graceful draining. Durable work should persist the job
// record in a database and enqueue it again at startup; the shape of the
// handler is intentionally independent of the storage layer.

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

export function queue(options = {}) {
  const defaults = normalizeOptions(options);
  const state = {
    defaults,
    pending: [],
    delayed: new Set(),
    running: new Set(),
    nextId: 1,
    closed: false,
    draining: false,
    listeners: new Map(),
    drainWaiters: [],
  };

  const emit = (event, job) => {
    for (const listener of state.listeners.get(event) || []) {
      try { listener(job); } catch { /* event observers cannot break the queue */ }
    }
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
    state.running.delete(job);
    if (status === 'completed') job.resolve(value);
    else job.reject(error);
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
          state.running.delete(job);
          state.delayed.add(job);
          const delay = job.retryDelay * Math.pow(job.retryBackoff, job.attempts - 1);
          job.retryTimer = setTimeout(() => {
            job.retryTimer = null;
            state.delayed.delete(job);
            if (job.state === 'pending' && !state.closed) {
              state.pending.unshift(job);
              schedule();
            } else if (job.state === 'pending') {
              job.state = 'cancelled';
              job.finishedAt = Date.now();
              job.reject(new JobCancelledError(job, 'queue closed'));
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
    if (state.closed) return;
    while (state.running.size < state.defaults.concurrency && state.pending.length) {
      const job = state.pending.shift();
      if (job.state === 'pending') attempt(job);
    }
    settleDrain();
  };

  const q = {
    add(name, work, payload = null, jobOptions = {}) {
      if (state.closed) throw new Error('job queue is closed');
      if (typeof name !== 'string' || !name) throw new TypeError('job name must be non-empty text');
      if (typeof work !== 'function') throw new TypeError('job work must be a function');
      const settings = normalizeOptions({ ...state.defaults, ...jobOptions });
      const job = {
        id: state.nextId++,
        name,
        payload,
        work,
        retries: settings.retries,
        retryDelay: settings.retryDelay,
        retryBackoff: settings.retryBackoff,
        timeout: settings.timeout,
        attempts: 0,
        state: 'pending',
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        signal: null,
        resolve: null,
        reject: null,
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
          job.reject(new JobCancelledError(job, reason));
          emit('cancelled', job);
          settleDrain();
          return true;
        }
        if (job.state === 'running') {
          job.state = 'cancelled';
          state.running.delete(job);
          if (job.signal) cancel(job.signal, reason);
          job.finishedAt = Date.now();
          job.reject(new JobCancelledError(job, reason));
          emit('cancelled', job);
          settleDrain();
          return true;
        }
        return false;
      };
      state.pending.push(job);
      emit('queued', job);
      schedule();
      return job;
    },
    start() {
      state.closed = false;
      schedule();
      return q;
    },
    async drain() {
      if (!state.pending.length && !state.running.size && !state.delayed.size) return;
      state.draining = true;
      await new Promise((resolve) => state.drainWaiters.push(resolve));
    },
    async close(reason = 'queue closed') {
      state.closed = true;
      for (const job of [...state.pending]) job.cancel(reason);
      for (const job of [...state.delayed]) {
        clearTimeout(job.retryTimer);
        job.retryTimer = null;
        job.state = 'cancelled';
        job.finishedAt = Date.now();
        job.reject(new JobCancelledError(job, reason));
        emit('cancelled', job);
      }
      state.delayed.clear();
      await q.drain();
    },
    stats() {
      return {
        pending: state.pending.length,
        running: state.running.size,
        delayed: state.delayed.size,
        closed: state.closed,
        total: state.pending.length + state.running.size + state.delayed.size,
      };
    },
    on(event, handler) {
      if (!state.listeners.has(event)) state.listeners.set(event, new Set());
      state.listeners.get(event).add(handler);
      return () => state.listeners.get(event).delete(handler);
    },
    get closed() { return state.closed; },
  };
  return q;
}

export function createQueue(options = {}) {
  return queue(options);
}

export async function runJobs(jobs) {
  return jobs.drain();
}

export { CancellationError };
