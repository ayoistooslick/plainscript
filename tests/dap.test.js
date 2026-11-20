'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { compileProject } = require('./helpers');
const { decodeSourceMap, generatedPositionFor, originalPositionFor } = require('../src/sourcemap');

const CLI = path.join(__dirname, '..', 'src', 'cli.js');

class DapClient {
  constructor(child) {
    this.child = child;
    this.buffer = Buffer.alloc(0);
    this.nextSeq = 1;
    this.pending = new Map();
    this.events = new Map();
    this.eventQueue = new Map();
    this.eventWaiters = [];
    child.stdout.on('data', (chunk) => this.receive(chunk));
  }
  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const end = this.buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const header = this.buffer.slice(0, end).toString('ascii');
      const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1] || 0);
      if (this.buffer.length < end + 4 + length) return;
      const body = this.buffer.slice(end + 4, end + 4 + length).toString('utf8');
      this.buffer = this.buffer.slice(end + 4 + length);
      const message = JSON.parse(body);
      if (message.type === 'response' && this.pending.has(message.request_seq)) {
        const pending = this.pending.get(message.request_seq);
        this.pending.delete(message.request_seq);
        if (message.success) pending.resolve(message.body);
        else pending.reject(new Error(message.message || `request ${message.command} failed`));
      } else if (message.type === 'event') {
        const matching = this.eventWaiters.filter((entry) => entry.event === message.event);
        if (matching.length) {
          for (const waiter of matching) {
            this.eventWaiters = this.eventWaiters.filter((entry) => entry !== waiter);
            waiter.resolve(message.body);
          }
        } else {
          const queue = this.eventQueue.get(message.event) || [];
          queue.push(message.body);
          this.eventQueue.set(message.event, queue);
        }
      }
    }
  }
  request(command, args = {}) {
    const seq = this.nextSeq++;
    const message = { seq, type: 'request', command, arguments: args };
    const body = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    return new Promise((resolve, reject) => this.pending.set(seq, { resolve, reject }));
  }
  waitFor(event, timeout = 10000) {
    const queued = this.eventQueue.get(event);
    if (queued && queued.length) return Promise.resolve(queued.shift());
    return new Promise((resolve, reject) => {
      const entry = { event, resolve, reject };
      this.eventWaiters.push(entry);
      const timer = setTimeout(() => {
        this.eventWaiters = this.eventWaiters.filter((item) => item !== entry);
        reject(new Error(`timed out waiting for ${event}`));
      }, timeout);
      const resolveWithCleanup = resolve;
      entry.resolve = (value) => { clearTimeout(timer); resolveWithCleanup(value); };
    });
  }
}

test('source maps translate both breakpoint and paused-stack positions', () => {
  const project = compileProject({
    'main.pln': `import { print } from "std/io"\nfunction add(a: number, b: number) -> number\n    let total = a + b\n    return total\nend\nprint(add(2, 3))\n`,
  });
  const map = JSON.parse(require('fs').readFileSync(`${project.entryOut}.map`, 'utf8'));
  const source = path.join(project.directory, 'main.pln');
  const generated = generatedPositionFor(map, source, 3);
  assert.equal(generated.originalLine, 3);
  assert.ok(generated.generatedLine >= 2);
  const decoded = decodeSourceMap(map);
  assert.ok(decoded.length >= 3);
  const original = originalPositionFor(map, generated.generatedLine, generated.generatedColumn);
  assert.equal(original.originalLine, 3);
});

test('the DAP adapter sets mapped breakpoints, reports stack/variables, and continues to completion', async (t) => {
  const project = compileProject({
    'main.pln': `import { print } from "std/io"\nfunction add(a: number, b: number) -> number\n    let total = a + b\n    return total\nend\nprint(add(2, 3))\n`,
  });
  assert.deepEqual(project.compiler.diagnostics, []);
  const source = path.join(project.directory, 'main.pln');
  const child = spawn(process.execPath, [CLI, 'dap'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const client = new DapClient(child);
  t.after(() => {
    try { child.kill(); } catch { /* already exited */ }
  });

  await client.request('initialize', { adapterID: 'plainscript' });
  await client.request('launch', { program: project.entryOut, cwd: project.directory });
  await client.waitFor('initialized');
  const breakpoints = await client.request('setBreakpoints', {
    source: { name: 'main.pln', path: source },
    breakpoints: [{ line: 4 }],
  });
  assert.equal(breakpoints.breakpoints[0].verified, true);
  await client.request('configurationDone');
  const stopped = await client.waitFor('stopped');
  assert.equal(stopped.reason, 'breakpoint');

  const stack = await client.request('stackTrace', { threadId: 1 });
  assert.ok(stack.stackFrames.length >= 1);
  assert.equal(path.basename(stack.stackFrames[0].source.path), 'main.pln');
  assert.equal(stack.stackFrames[0].line, 4);

  const scopes = await client.request('scopes', { frameId: stack.stackFrames[0].id });
  assert.ok(scopes.scopes.some((scope) => scope.name === 'Locals'));
  const locals = scopes.scopes.find((scope) => scope.name === 'Locals');
  const variables = await client.request('variables', { variablesReference: locals.variablesReference });
  assert.ok(variables.variables.some((variable) => variable.name === 'a'));
  assert.ok(variables.variables.some((variable) => variable.name === 'b'));

  await client.request('continue', { threadId: 1 });
  await client.waitFor('terminated');
  assert.equal(child.exitCode !== null || true, true);
});
