'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const root = path.resolve(__dirname, '..');
const demo = path.join(root, 'demos/contracts-fullstack');

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startApi(port, databasePath) {
  const child = spawn(process.execPath, ['../../src/cli.js', 'run', 'src/server.pln'], {
    cwd: demo,
    env: { ...process.env, PORT: String(port), DB_PATH: databasePath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`demo API exited early: ${logs}`);
    try {
      const response = await fetch(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'demo', password: 'plainscript-demo' }),
      });
      if (response.status === 200) {
        const payload = await response.json();
        return { child, origin, token: payload.token };
      }
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGTERM');
  throw new Error(`demo API did not become ready: ${logs}`);
}

async function stopApi(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

test('contracts full-stack demo sources compile', () => {
  for (const entry of ['src/shared.pln', 'src/server.pln', 'src/App.pln']) {
    const result = spawnSync(process.execPath, [path.join(root, 'src/cli.js'), 'check', entry], {
      cwd: demo,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${entry}: ${result.stdout}${result.stderr}`);
  }
});

test('SQLite contract API validates, authorizes, mutates, and persists operation data', async (t) => {
  if (Number(process.versions.node.split('.')[0]) < 22) {
    t.skip('demo uses Node 22 built-in node:sqlite');
    return;
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-contract-demo-'));
  const databasePath = path.join(directory, 'tasks.sqlite');
  const port = await freePort();
  let server;
  try {
    let api = await startApi(port, databasePath);
    server = api.child;
    const origin = api.origin;
    const authorized = { authorization: `Bearer ${api.token}` };

    const denied = await fetch(`${origin}/api/tasks`);
    assert.equal(denied.status, 403);
    const badLogin = await fetch(`${origin}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'wrong' }),
    });
    assert.equal(badLogin.status, 401);
    const invalid = await fetch(`${origin}/api/tasks`, {
      method: 'POST', headers: { ...authorized, 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(invalid.status, 400);

    const created = await fetch(`${origin}/api/tasks`, {
      method: 'POST', headers: { ...authorized, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'contract integration' }),
    });
    assert.equal(created.status, 200);
    assert.deepEqual(await created.json(), { id: 1, title: 'contract integration', done: false });

    const toggled = await fetch(`${origin}/api/tasks/toggle`, {
      method: 'POST', headers: { ...authorized, 'content-type': 'application/json' }, body: JSON.stringify({ id: 1 }),
    });
    assert.deepEqual(await toggled.json(), { id: 1, title: 'contract integration', done: true });
    const found = await fetch(`${origin}/api/tasks/get`, {
      method: 'POST', headers: { ...authorized, 'content-type': 'application/json' }, body: JSON.stringify({ id: 1 }),
    });
    assert.deepEqual(await found.json(), { ok: true, value: { id: 1, title: 'contract integration', done: true } });
    const missing = await fetch(`${origin}/api/tasks/get`, {
      method: 'POST', headers: { ...authorized, 'content-type': 'application/json' }, body: JSON.stringify({ id: 999 }),
    });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'NOT_FOUND');
    await stopApi(server);
    server = null;

    api = await startApi(port, databasePath);
    server = api.child;
    const authorizedAfterRestart = { authorization: `Bearer ${api.token}` };
    const listed = await fetch(`${api.origin}/api/tasks`, { headers: authorizedAfterRestart });
    assert.deepEqual(await listed.json(), [{ id: 1, title: 'contract integration', done: true }]);
  } finally {
    if (server) await stopApi(server);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
