'use strict';

// Cross-language interoperability: the JSON-RPC bridge, generated clients,
// HTTP mode, Python in both directions, C/C++ headers and the PlainScript
// bridge client.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const { ROOT, sandbox, writeFiles, runProject } = require('./helpers');
const protocol = require('../src/interop/protocol');
const { loadBridgeModule, createHandler, serveHttp } = require('../src/interop/bridge');
const { SUPPORTED, generateBindings } = require('../src/interop/bindings');

const CLI = path.join(ROOT, 'src', 'cli.js');
const hasPython = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
const hasGcc = spawnSync('gcc', ['--version'], { encoding: 'utf8' }).status === 0;

const MODULE_SOURCE = `#syntax 2.1
import { count } from "std/list"

export type Totals
    count: number
    total: number
end

export define add(a: number, b: number) returns number
    return a + b
end

export define greet(name: text) returns text
    return "Hello, {name}!"
end

export define totals(values: list of number) returns Totals
    set sum to 0
    for each value in values
        change sum to sum + value
    end
    return { count: count(values), total: sum }
end

export define explode() returns nothing
    throw "bridge exploded"
end

export async define later(ms: number) returns number
    return ms * 2
end
`;

function fixture() {
  const directory = sandbox();
  writeFiles(directory, { 'main.pln': MODULE_SOURCE });
  return { directory, entry: path.join(directory, 'main.pln') };
}

function oneShot(entry, method, args) {
  const result = spawnSync(process.execPath, [CLI, 'bridge', entry, `--call=${method}`, `--args=${JSON.stringify(args || [])}`], {
    encoding: 'utf8',
  });
  return result;
}

function startBridge(entry) {
  const child = spawn(process.execPath, [CLI, 'bridge', entry], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  const waiting = [];
  const reader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  reader.on('line', (line) => {
    lines.push(line);
    const waiter = waiting.shift();
    if (waiter) waiter(line);
  });
  return {
    child,
    request: (message) => new Promise((resolve) => {
      waiting.push((line) => resolve(JSON.parse(line)));
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }),
    write: (text) => child.stdin.write(text),
    stop: () => new Promise((resolve) => {
      child.once('exit', resolve);
      child.stdin.end();
      setTimeout(() => child.kill(), 2000).unref();
    }),
    lines,
  };
}

test('the JSON-RPC protocol validates messages and frames one object per line', () => {
  const encoded = protocol.serialize(protocol.request(1, 'add', [2, 3]));
  const decoded = protocol.parse(encoded);
  assert.strictEqual(decoded.method, 'add');
  assert.deepStrictEqual(decoded.params, [2, 3]);
  assert.throws(() => protocol.parse('not json'), /Invalid JSON/);
  assert.throws(() => protocol.parse('{"jsonrpc":"1.0","method":"x"}'), /Unsupported JSON-RPC version/);
  assert.strictEqual(protocol.isRequest({ jsonrpc: '2.0', id: 1, method: 'x' }), true);
  assert.strictEqual(protocol.isNotification({ jsonrpc: '2.0', method: 'x' }), true);
});

test('the bridge manifest describes exported functions and types', () => {
  const { entry } = fixture();
  const result = spawnSync(process.execPath, [CLI, 'bridge', entry, '--manifest'], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.strictEqual(manifest.protocol, 'plainscript-jsonrpc/1');
  assert.deepStrictEqual(manifest.functions.map((fn) => fn.name), ['add', 'explode', 'greet', 'later', 'totals']);
  const add = manifest.functions.find((fn) => fn.name === 'add');
  assert.deepStrictEqual(add.params.map((parameter) => parameter.name), ['a', 'b']);
  assert.strictEqual(add.params[0].type.kind, 'number');
  assert.strictEqual(manifest.functions.find((fn) => fn.name === 'later').async, true);
  const totals = manifest.functions.find((fn) => fn.name === 'totals');
  assert.strictEqual(totals.returns.kind, 'record');
  assert.strictEqual(totals.returns.fields.count.type.kind, 'number');
});

test('one-shot calls marshal values, objects and async functions', () => {
  const { entry } = fixture();
  assert.strictEqual(oneShot(entry, 'add', [2, 3]).stdout.trim(), '5');
  assert.strictEqual(oneShot(entry, 'greet', ['Ada']).stdout.trim(), '"Hello, Ada!"');
  assert.strictEqual(oneShot(entry, 'totals', [[1, 2, 3]]).stdout.trim(), '{"count":3,"total":6}');
  assert.strictEqual(oneShot(entry, 'later', [21]).stdout.trim(), '42');
  const failed = oneShot(entry, 'explode', []);
  assert.strictEqual(failed.status, 1);
  assert.match(failed.stderr, /bridge exploded/);
});

test('stdio serving handles batches, notifications, named params and errors', async () => {
  const { entry } = fixture();
  const bridge = startBridge(entry);
  try {
    const single = await bridge.request({ jsonrpc: '2.0', id: 1, method: 'add', params: [4, 5] });
    assert.deepStrictEqual(single, { jsonrpc: '2.0', id: 1, result: 9 });

    const named = await bridge.request({ jsonrpc: '2.0', id: 2, method: 'greet', params: { name: 'named' } });
    assert.strictEqual(named.result, 'Hello, named!');

    const batch = await bridge.request([
      { jsonrpc: '2.0', id: 3, method: 'add', params: [1, 1] },
      { jsonrpc: '2.0', method: 'add', params: [9, 9] },
      { jsonrpc: '2.0', id: 4, method: 'missing', params: [] },
    ]);
    assert.strictEqual(batch.length, 2);
    assert.strictEqual(batch[0].result, 2);
    assert.strictEqual(batch[1].error.code, protocol.ERROR_CODES.METHOD_NOT_FOUND);

    const invalid = await bridge.request({ jsonrpc: '2.0', id: 5, method: 'add', params: [1] });
    assert.strictEqual(invalid.error.code, protocol.ERROR_CODES.INVALID_PARAMS);

    const ping = await bridge.request({ jsonrpc: '2.0', id: 6, method: '__ping' });
    assert.strictEqual(ping.result.ok, true);
  } finally {
    await bridge.stop();
  }
});

test('HTTP mode serves the same messages over POST /rpc', async () => {
  const { directory, entry } = fixture();
  const loaded = await loadBridgeModule(entry, { root: directory });
  const handle = createHandler({ module: loaded.module, manifest: loaded.manifest });
  const server = await serveHttp(handle, { manifest: loaded.manifest, port: 0 });
  try {
    const health = await fetch(`${server.url}/health`);
    assert.deepStrictEqual(await health.json(), { ok: true, module: 'main' });

    const response = await fetch(`${server.url}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'add', params: [6, 7] }),
    });
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), { jsonrpc: '2.0', id: 9, result: 13 });

    const manifest = await fetch(`${server.url}/manifest`);
    assert.strictEqual((await manifest.json()).module, 'main');
  } finally {
    await new Promise((resolve) => server.server.close(resolve));
  }
});

test('bindings are generated for every supported language', () => {
  const { directory, entry } = fixture();
  const output = path.join(directory, 'bindings');
  const result = spawnSync(process.execPath, [CLI, 'bindings', entry, `--out=${output}`], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  const generated = generateBindings(JSON.parse(fs.readFileSync(path.join(output, 'plainscript.manifest.json'), 'utf8')), SUPPORTED, entry);
  assert.ok(generated.length >= 13);
  for (const file of generated) {
    assert.ok(fs.existsSync(path.join(output, file.name)), `${file.language} ${file.name}`);
  }
  assert.ok(fs.existsSync(path.join(output, 'README.md')));
  assert.match(fs.readFileSync(path.join(output, 'main_bridge.h'), 'utf8'), /ps_add/);
  assert.match(fs.readFileSync(path.join(output, 'main_bridge.go'), 'utf8'), /func \(c \*Client\) Add/);
  assert.match(fs.readFileSync(path.join(output, 'BridgeClient.java'), 'utf8'), /class BridgeClient/);
  assert.match(fs.readFileSync(path.join(output, 'BridgeClient.swift'), 'utf8'), /final class BridgeClient/);
});

test('generated Python and JavaScript clients call the bridge end-to-end', { skip: !hasPython ? 'python3 is not installed' : false }, () => {
  const { directory, entry } = fixture();
  const output = path.join(directory, 'bindings');
  const generated = spawnSync(process.execPath, [CLI, 'bindings', entry, '--lang=python,javascript', `--out=${output}`], { encoding: 'utf8' });
  assert.strictEqual(generated.status, 0, generated.stderr);

  const python = spawnSync('python3', ['-c', `
import sys
sys.path.insert(0, ${JSON.stringify(output)})
from main_bridge import Client
with Client(command=sys.argv[1], args=[sys.argv[2], "bridge", sys.argv[3]]) as client:
    print(client.add(2, 3))
    print(client.greet("Ada"))
    print(client.totals([1,2,3]))
    print(client.later(21))
    try:
        client.explode()
    except Exception as error:
        print(type(error).__name__, str(error))
`, process.execPath, CLI, entry], { encoding: 'utf8' });
  assert.strictEqual(python.status, 0, python.stderr);
  assert.strictEqual(python.stdout.replace(/\r\n/g, '\n'), "5\nHello, Ada!\n{'count': 3, 'total': 6}\n42\nBridgeError bridge exploded\n");

  const javascript = spawnSync(process.execPath, ['--input-type=module', '-e', `
import { Client } from ${JSON.stringify(pathToFileURL(path.join(output, 'main_bridge.mjs')).href)};
const client = new Client(${JSON.stringify(process.execPath)}, [${JSON.stringify(CLI)}, "bridge", ${JSON.stringify(entry)}]);
console.log(await client.add(4, 6));
console.log(await client.greet("JS"));
client.close();
`], { encoding: 'utf8' });
  assert.strictEqual(javascript.status, 0, javascript.stderr);
  assert.strictEqual(javascript.stdout, '10\nHello, JS!\n');
});

test('PlainScript calls a Python service through std/bridge', { skip: !hasPython ? 'python3 is not installed' : false }, () => {
  const directory = sandbox();
  writeFiles(directory, {
    'service.py': `def add(a, b):\n    return a + b\n\ndef greet(name):\n    return f"Hello from Python, {name}!"\n\ndef explode():\n    raise RuntimeError("python exploded")\n`,
    'main.pln': `#syntax 2.1
import { open, close } from "std/bridge"
import { print } from "std/io"

set python to open("python3", [${JSON.stringify(path.join(ROOT, 'src', 'interop', 'python_server.py'))}, ${JSON.stringify(path.join(directory, 'service.py'))}])
print(python.pid > 0)
print(await python.request("add", [2, 3]))
print(await python.request("greet", ["PlainScript"]))
try
    await python.request("explode", [])
catch problem
    print("caught: {problem.message}")
end
close(python)
print("closed")
`,
  });
  const run = runProject({ 'main.pln': fs.readFileSync(path.join(directory, 'main.pln'), 'utf8') });
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(run.stdout, 'true\n5\nHello from Python, PlainScript!\ncaught: python exploded\nclosed\n');
});

test('the generated C client compiles and calls the bridge', { skip: process.platform === 'win32' ? 'the generated C client is POSIX-only (popen)' : (!hasGcc ? 'gcc is not installed' : false) }, () => {
  const { directory, entry } = fixture();
  const output = path.join(directory, 'bindings');
  const generated = spawnSync(process.execPath, [CLI, 'bindings', entry, '--lang=c', `--out=${output}`], { encoding: 'utf8' });
  assert.strictEqual(generated.status, 0, generated.stderr);

  const usage = path.join(directory, 'use.c');
  fs.writeFileSync(usage, `#include "main_bridge.h"
#include <stdio.h>
int main(void) {
    char* result = ps_add("7", "8");
    if (!result) return 1;
    printf("%s", result);
    ps_free(result);
    return 0;
}
`);
  const binary = path.join(directory, 'use');
  const compile = spawnSync('gcc', [
    '-std=c11',
    '-I', output,
    `-DPS_COMMAND="${process.execPath} ${CLI}"`,
    `-DPS_ENTRY="${entry}"`,
    usage,
    '-o', binary,
  ], { encoding: 'utf8' });
  assert.strictEqual(compile.status, 0, compile.stderr);
  const run = spawnSync(binary, [], { encoding: 'utf8' });
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(run.stdout.trim(), '15');
});
