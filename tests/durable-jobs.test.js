'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ROOT } = require('./helpers');

async function jobsModule() {
  return import(pathToFileURL(path.join(ROOT, 'stdlib', 'jobs.js')).toString());
}

test('a memory store recovers pending jobs and preserves their attempts', async () => {
  const { queue, memoryStore } = await jobsModule();
  const store = memoryStore();
  const record = {
    id: 7, name: 'resume-me', payload: { value: 4 }, state: 'running', attempts: 1,
    retries: 2, retryDelay: 0, retryBackoff: 2, timeout: 0,
    createdAt: Date.now(), startedAt: Date.now(), finishedAt: null, error: null, updatedAt: Date.now(),
  };
  await store.save(record);
  const q = queue({ store, concurrency: 1 });
  let observedAttempts = null;
  q.handle('resume-me', async (payload) => { observedAttempts = payload.value; return 'done'; });
  assert.equal(await q.ready, 1);
  await q.drain();
  assert.equal(observedAttempts, 4);
  assert.equal(q.get(7).state, 'completed');
  assert.equal(q.get(7).attempts, 2);
});

test('SQLite persistence survives reopening and keeps completed status records', async () => {
  const { queue, sqliteStore } = await jobsModule();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-jobs-'));
  const file = path.join(directory, 'jobs.sqlite');
  const store = await sqliteStore(file);
  const q = queue({ store, concurrency: 1 });
  q.handle('work', async (payload) => payload * 2);
  const job = q.add('work', async (payload) => payload * 2, 21);
  assert.equal(await job.promise, 42);
  await q.drain();
  assert.equal(q.get(job.id).state, 'completed');
  await q.close();

  const reopened = await sqliteStore(file);
  const q2 = queue({ store: reopened });
  await q2.ready;
  assert.equal(q2.get(job.id).state, 'completed');
  assert.equal(q2.get(job.id).attempts, 1);
  await q2.close();
});

test('a durable queue records retries and failures', async () => {
  const { queue, sqliteStore } = await jobsModule();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-jobs-retry-'));
  const store = await sqliteStore(path.join(directory, 'jobs.sqlite'));
  const q = queue({ store, concurrency: 1, retries: 1, retryDelay: 0 });
  q.handle('flaky', async () => { throw new Error('still broken'); });
  const job = q.add('flaky', async () => { throw new Error('still broken'); });
  await assert.rejects(job.promise, /still broken/);
  await q.drain();
  const record = q.get(job.id);
  assert.equal(record.state, 'failed');
  assert.equal(record.attempts, 2);
  assert.match(record.error, /still broken/);
  await q.close();
});

test('unregistered recovered handlers fail instead of silently disappearing', async () => {
  const { queue, memoryStore } = await jobsModule();
  const store = memoryStore();
  await store.save({
    id: 3, name: 'missing', payload: null, state: 'pending', attempts: 0,
    retries: 0, retryDelay: 0, retryBackoff: 2, timeout: 0,
    createdAt: Date.now(), startedAt: null, finishedAt: null, error: null, updatedAt: Date.now(),
  });
  const q = queue({ store });
  await q.ready;
  assert.equal(q.get(3).state, 'failed');
  assert.match(q.get(3).error, /no handler registered/);
  await q.close();
});
