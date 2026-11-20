'use strict';

// These tests run the committed integration projects, not snippets. Each case
// compiles the real .pln source from integrations/, starts or renders the
// generated JavaScript, and asserts on what the framework actually produces.
//
// The React + Vite bundling and Next.js production builds live in
// scripts/verify-integrations.js because they need a full framework install and
// take far longer than the compiler suite.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const { ROOT, compileProject } = require('./helpers');

function integrationSource(...parts) {
  return fs.readFileSync(path.join(ROOT, 'integrations', ...parts), 'utf8');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch (failure) {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function compileIntegration(...parts) {
  const project = compileProject({ 'main.pln': integrationSource(...parts) });
  const errors = project.compiler.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  assert.deepStrictEqual(errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`), []);
  return project;
}

function start(project, env = {}) {
  const child = spawn(process.execPath, [project.entryOut], {
    cwd: project.directory,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return {
    child,
    output: () => stdout,
    error: () => stderr,
    stop: () => child.kill('SIGKILL'),
  };
}

test('SQLite integration inserts, queries, aggregates and rolls back', () => {
  const project = compileIntegration('sqlite', 'src', 'main.pln');
  const child = require('child_process').spawnSync(process.execPath, [project.entryOut], {
    cwd: project.directory,
    encoding: 'utf8',
  });
  assert.strictEqual(child.status, 0, child.stderr);
  assert.match(child.stdout, /inserted ids: 1, 2/);
  assert.match(child.stdout, /1\. write the compiler \(done: false\)/);
  assert.match(child.stdout, /2\. ship 2\.1 \(done: true\)/);
  assert.match(child.stdout, /summary: 2 tasks, 1 done/);
  assert.match(child.stdout, /after rollback: 2 tasks/);
});

test('async HTTP integration serves requests and fetches them back', async () => {
  const project = compileIntegration('http-client', 'src', 'main.pln');
  const port = await freePort();
  const child = require('child_process').spawnSync(process.execPath, [project.entryOut], {
    cwd: project.directory,
    encoding: 'utf8',
    env: { ...process.env, PORT: String(port) },
    timeout: 15000,
  });
  assert.strictEqual(child.status, 0, child.stderr);
  assert.match(child.stdout, /hello from std\/http #1/);
  assert.match(child.stdout, /server handled 2 requests/);
});

test('the Express 5 API serves a real HTTP session', { timeout: 30000 }, async () => {
  const project = compileIntegration('express-api', 'src', 'main.pln');
  const port = await freePort();
  const server = start(project, { PORT: String(port) });
  const base = `http://127.0.0.1:${port}`;

  try {
    assert.ok(await waitForServer(`${base}/health`), `express did not start: ${server.error()}`);

    const health = await (await fetch(`${base}/health`)).json();
    assert.deepStrictEqual(health, { status: 'ok', framework: 'express', notes: 0 });

    const created = await fetch(`${base}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'verify express' }),
    });
    assert.strictEqual(created.status, 201);
    assert.deepStrictEqual(await created.json(), { id: 1, body: 'verify express' });

    const invalid = await fetch(`${base}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(invalid.status, 400);
    assert.deepStrictEqual(await invalid.json(), { error: 'body is required' });

    const updated = await fetch(`${base}/notes/1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'verified' }),
    });
    assert.strictEqual(updated.status, 200);

    const one = await (await fetch(`${base}/notes/1`)).json();
    assert.deepStrictEqual(one, { id: 1, body: 'verified' });

    const missing = await fetch(`${base}/notes/99`);
    assert.strictEqual(missing.status, 404);

    const deleted = await (await fetch(`${base}/notes/1`, { method: 'DELETE' })).json();
    assert.deepStrictEqual(deleted, { deleted: true, id: 1 });

    const list = await (await fetch(`${base}/notes`)).json();
    assert.deepStrictEqual(list, []);
  } finally {
    server.stop();
  }
});

test('the React component renders through react-dom/server', { timeout: 30000 }, () => {
  const project = compileProject({ 'main.pln': integrationSource('react-vite', 'src', 'App.pln') });
  const errors = project.compiler.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  assert.deepStrictEqual(errors.map((diagnostic) => diagnostic.message), []);

  const script = path.join(project.outRoot, 'render-check.js');
  fs.writeFileSync(script, `import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const { App } = await import("./main.js");
process.stdout.write(renderToStaticMarkup(createElement(App)));
`);
  const child = require('child_process').spawnSync(process.execPath, [script], {
    cwd: project.outRoot,
    encoding: 'utf8',
  });
  assert.strictEqual(child.status, 0, child.stderr);
  assert.match(child.stdout, /PlainScript \+ React \+ Vite/);
  assert.match(child.stdout, /0 of 0 task\(s\) remaining/);
  assert.match(child.stdout, /Add task/);
});

test('the CLI application parses arguments, persists JSON and sets exit codes', () => {
  const project = compileIntegration('cli-app', 'src', 'main.pln');
  const run = (...argv) => require('child_process').spawnSync(
    process.execPath,
    [project.entryOut, ...argv],
    { cwd: project.directory, encoding: 'utf8' },
  );

  const added = run('add', 'write the docs');
  assert.strictEqual(added.status, 0, added.stderr);
  assert.strictEqual(added.stdout.trim(), 'added 1: write the docs');

  assert.strictEqual(run('add', 'ship 2.1').status, 0);
  const listed = run('list');
  assert.strictEqual(listed.stdout, '[ ] 1. write the docs\n[ ] 2. ship 2.1\n');

  const completed = run('done', '1');
  assert.strictEqual(completed.status, 0, completed.stderr);
  assert.match(run('list').stdout, /\[x\] 1\. write the docs/);

  const removed = run('remove', '2');
  assert.strictEqual(removed.status, 0, removed.stderr);
  assert.strictEqual(run('list').stdout, '[x] 1. write the docs\n');

  // Usage errors exit 2; a missing task exits 1.
  assert.strictEqual(run().status, 2);
  assert.strictEqual(run('done').status, 2);
  const missing = run('done', '99');
  assert.strictEqual(missing.status, 1);
  assert.match(missing.stderr, /no task 99/);

  // The store is real JSON on disk, so a later process sees the same tasks.
  const stored = JSON.parse(fs.readFileSync(path.join(project.directory, 'tasks.json'), 'utf8'));
  assert.deepStrictEqual(stored, [{ id: 1, title: 'write the docs', done: true }]);
});

test('the multi-module project builds every module and emits declarations', { timeout: 60000 }, () => {
  const directory = path.join(ROOT, 'integrations', 'multi-module');
  const cli = path.join(ROOT, 'src', 'cli.js');
  const build = require('child_process').spawnSync(process.execPath, [cli, 'build', '--declarations'], {
    cwd: directory,
    encoding: 'utf8',
  });
  try {
    assert.strictEqual(build.status, 0, build.stderr);

    const dist = path.join(directory, 'dist');
    for (const name of ['main.js', 'cart.js', 'money.js', 'main.d.pln', 'cart.d.pln', 'money.d.pln']) {
      assert.ok(fs.existsSync(path.join(dist, name)), `expected ${name} in dist`);
    }

    // Declarations carry the cross-module types.
    const cartDeclaration = fs.readFileSync(path.join(dist, 'cart.d.pln'), 'utf8');
    assert.match(cartDeclaration, /LineItem/);
    assert.match(cartDeclaration, /Money/);

    const executed = require('child_process').spawnSync(process.execPath, [path.join(dist, 'main.js')], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.strictEqual(executed.status, 0, executed.stderr);
    assert.strictEqual(
      executed.stdout,
      '  2 x keyboard = 178 USD\n  1 x monitor = 240 USD\ntotal: 418 USD\nsubtotal: 418 USD\n',
    );
  } finally {
    fs.rmSync(path.join(directory, 'dist'), { recursive: true, force: true });
  }
});

test('a cross-module type error is reported at the importing call site', () => {
  const project = compileProject({
    'main.pln': `#syntax 2.1
import { addItem, emptyCart } from "./cart.pln"

set cart to emptyCart("USD")
set cart to addItem(cart, "keyboard", "expensive", 2)
`,
    'cart.pln': integrationSource('multi-module', 'src', 'cart.pln'),
    'money.pln': integrationSource('multi-module', 'src', 'money.pln'),
  });
  const errors = project.compiler.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  assert.ok(errors.length > 0, 'expected a type error');
  assert.ok(errors.some((diagnostic) => /text.*number|number.*text/i.test(diagnostic.message)));
  assert.ok(errors.every((diagnostic) => diagnostic.span.file.endsWith('main.pln')));
});

test('the full-stack project serves SQLite-backed notes and renders the React client', { timeout: 90000 }, async () => {
  const directory = path.join(ROOT, 'integrations', 'fullstack');
  const cli = path.join(ROOT, 'src', 'cli.js');
  const port = await freePort();
  const database = path.join(directory, `.test-notes-${process.pid}.db`);
  const base = `http://127.0.0.1:${port}`;

  const launch = () => spawn(process.execPath, [cli, 'run', 'src/server.pln'], {
    cwd: directory,
    env: { ...process.env, PORT: String(port), DATABASE_FILE: database },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let server = launch();
  let stderr = '';
  server.stderr.on('data', (chunk) => { stderr += chunk; });

  const stop = () => new Promise((resolve) => {
    if (server.exitCode !== null || server.signalCode !== null) { resolve(); return; }
    server.once('exit', () => resolve());
    server.kill('SIGTERM');
    setTimeout(() => { try { server.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 5000).unref();
  });

  try {
    assert.ok(await waitForServer(`${base}/health`), `fullstack server did not start: ${stderr}`);

    assert.deepStrictEqual(await (await fetch(`${base}/health`)).json(), { status: 'ok', notes: 0 });

    const created = await (await fetch(`${base}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'ship 2.1' }),
    })).json();
    assert.deepStrictEqual(created, { id: 1, body: 'ship 2.1', done: false });

    await fetch(`${base}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'write docs' }),
    });

    const incomplete = await fetch(`${base}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(incomplete.status, 400);

    const completed = await (await fetch(`${base}/notes/1`, { method: 'PATCH' })).json();
    assert.deepStrictEqual(completed, { id: 1, body: 'ship 2.1', done: true });

    await stop();
    server = launch();
    assert.ok(await waitForServer(`${base}/health`), 'server did not restart');
    const persisted = await (await fetch(`${base}/notes`)).json();
    assert.deepStrictEqual(persisted, [
      { id: 1, body: 'ship 2.1', done: true },
      { id: 2, body: 'write docs', done: false },
    ]);

    const deleted = await (await fetch(`${base}/notes/2`, { method: 'DELETE' })).json();
    assert.deepStrictEqual(deleted, { deleted: true, id: 2 });
    assert.strictEqual((await fetch(`${base}/notes/99`, { method: 'DELETE' })).status, 404);
  } finally {
    await stop();
    fs.rmSync(database, { force: true });
    fs.rmSync(`${database}-journal`, { force: true });
  }

  // The React half imports the same Note type and renders real markup.
  const build = require('child_process').spawnSync(process.execPath, [cli, 'build', 'src/App.pln'], {
    cwd: directory,
    encoding: 'utf8',
  });
  assert.strictEqual(build.status, 0, build.stderr + build.stdout);

  const script = path.join(directory, 'render-check.mjs');
  fs.writeFileSync(script, `import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const { App } = await import("./generated/App.js");
const notes = [{ id: 1, body: "ship 2.1", done: true }, { id: 2, body: "write docs", done: false }];
process.stdout.write(renderToStaticMarkup(createElement(App, { notes })));
`);
  try {
    const rendered = require('child_process').spawnSync(process.execPath, [script], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.strictEqual(rendered.status, 0, rendered.stderr);
    assert.match(rendered.stdout, /PlainScript full-stack notes/);
    assert.match(rendered.stdout, /1 of 2 note\(s\) remaining/);
    assert.match(rendered.stdout, /<span class="body">ship 2\.1<\/span>/);
  } finally {
    fs.rmSync(script, { force: true });
    fs.rmSync(path.join(directory, 'generated'), { recursive: true, force: true });
  }
});
