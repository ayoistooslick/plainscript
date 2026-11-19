'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ROOT, runSource } = require('./helpers');

async function jobsModule() {
  return import(pathToFileURL(path.join(ROOT, 'stdlib', 'jobs.js')).toString());
}

test('jobs run with bounded concurrency and drain to completion', async () => {
  const { queue } = await jobsModule();
  const q = queue({ concurrency: 2 });
  let active = 0;
  let peak = 0;
  const order = [];
  for (let index = 0; index < 5; index += 1) {
    q.add('work', async (payload) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(payload);
      active -= 1;
      return payload;
    }, index);
  }
  await q.drain();
  assert.equal(peak, 2);
  assert.deepEqual(order.sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  assert.deepEqual(q.stats().running, 0);
});

test('jobs retry failures and expose the final error', async () => {
  const { queue } = await jobsModule();
  const q = queue({ retries: 2, retryDelay: 1 });
  let attempts = 0;
  const job = q.add('flaky', async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('try again');
    return 'ok';
  });
  assert.equal(await job.promise, 'ok');
  assert.equal(attempts, 3);
  let failures = 0;
  const failed = q.add('always-fail', async () => {
    failures += 1;
    throw new Error('nope');
  });
  await assert.rejects(failed.promise, /nope/);
  assert.equal(failures, 3);
});

test('job timeout cancels a cooperative handler and rejects the job', async () => {
  const { queue } = await jobsModule();
  const q = queue({ concurrency: 1 });
  let cancelled = false;
  const job = q.add('slow', async (payload, signal) => {
    signal.listeners.add(() => { cancelled = true; });
    await new Promise(() => {});
  }, null, { timeout: 10 });
  await assert.rejects(job.promise, /exceeded its 10ms timeout/);
  assert.equal(cancelled, true);
});

test('cancelling a queued job prevents it from running', async () => {
  const { queue } = await jobsModule();
  const q = queue({ concurrency: 1 });
  let release;
  q.add('block', () => new Promise((resolve) => { release = resolve; }));
  await Promise.resolve();
  const second = q.add('second', async () => 'ran');
  assert.equal(second.cancel('not needed'), true);
  release();
  await q.drain();
  await assert.rejects(second.promise, /cancelled/);
});

test('closing a queue settles a job waiting to retry', async () => {
  const { queue } = await jobsModule();
  const q = queue({ retries: 3, retryDelay: 50 });
  const job = q.add('retry-later', async () => { throw new Error('fail'); });
  // Wait until the first failure has scheduled the retry.
  await new Promise((resolve) => setTimeout(resolve, 10));
  await q.close();
  await assert.rejects(job.promise, /cancelled/);
});

test('the queue is usable from compiled PlainScript', () => {
  const result = runSource(`import { queue } from "std/jobs"
import { print } from "std/io"

let jobs = queue({ concurrency: 1 })
let job = jobs.add("greet", async (payload: any) => "hello {payload}", "Ada")
print(await job.promise)
await jobs.drain()
jobs.close()
`);
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
  assert.equal(result.stdout, 'hello Ada\n');
});
