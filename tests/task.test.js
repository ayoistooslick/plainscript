'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { runSource, ROOT } = require('./helpers');

test('task groups wait for all tasks and preserve start order', () => {
  const result = runSource(`import { group, run, close, delay } from "std/task"
import { print } from "std/io"

async function work(label: text, milliseconds: number) -> text
    await delay(milliseconds)
    return label
end

let tasks = group("ordered")
run(tasks, async (signal: any) => await work("slow", 25))
run(tasks, async (signal: any) => await work("fast", 1))
let results = await close(tasks)
for result in results
    print(result)
end
`);
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
  assert.equal(result.stdout, 'slow\nfast\n');
});

test('a failing task cancels siblings and close rejects after cleanup', () => {
  const result = runSource(`import { group, run, close, delay } from "std/task"
import { print } from "std/io"

async function patient(signal: any) -> text
    try
        await delay(1000, signal)
        return "finished"
    catch error
        return "cancelled"
    end
end

async function failing() -> text
    await delay(5)
    throw "boom"
end

let tasks = group()
let patientResult = run(tasks, async (signal: any) => await patient(signal))
run(tasks, async (signal: any) => await failing())
try
    await close(tasks)
catch error
    print("close:{error}")
end
print("sibling:{await patientResult}")
`);
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
  assert.equal(result.stdout, 'close:boom\nsibling:cancelled\n');
});

test('timeout cancels a cooperative task and reports a timeout error', () => {
  const result = runSource(`import { timeout, delay } from "std/task"
import { print } from "std/io"

let observed = "none"
try
    await timeout(10, async (signal: any) => await delay(500, signal))
catch error
    observed = error.name
end
print(observed)
`);
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
  assert.equal(result.stdout, 'TaskTimeoutError\n');
});

test('cancellation is idempotent and listener cleanup is observable', () => {
  const result = runSource(`import { cancellation, cancel, isCancelled, onCancel } from "std/task"
import { print } from "std/io"

let calls = 0
function note(reason: any) -> nothing
    calls = calls + 1
end

let signal = cancellation()
onCancel(signal, note)
print("{isCancelled(signal)}")
cancel(signal)
cancel(signal)
print("{calls}")
print("{isCancelled(signal)}")
`);
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
  assert.equal(result.stdout, 'false\n1\ntrue\n');
});

test('channels provide buffered backpressure and close errors', () => {
  const result = runSource(`import { channel, Channel } from "std/task"
import { print } from "std/io"

let values: Channel<number> = channel(1)
await values.send(1)
let queued = values.send(2)
print(await values.receive())
await queued
print(await values.receive())
values.close()
try
    await values.receive()
catch error
    print(error.name)
end
`);
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
  assert.equal(result.stdout, '1\n2\nChannelClosedError\n');
});

test('worker handles exchange messages and terminate cleanly in Node', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'stdlib', 'task.js')).toString());
  const source = 'data:text/javascript,' + encodeURIComponent(`
    import { parentPort } from 'node:worker_threads';
    parentPort.on('message', (message) => {
      if (message === 'ping') parentPort.postMessage('pong');
    });
  `);
  const worker = await module.spawnWorker(source);
  const message = new Promise((resolve) => worker.onMessage(resolve));
  worker.post('ping');
  assert.equal(await message, 'pong');
  const code = await worker.terminate();
  assert.equal(typeof code, 'number');
});
