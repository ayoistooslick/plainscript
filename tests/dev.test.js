// tests/dev.test.js
// Tests for Phase 8: Modern Dev Loop & Live HMR Server (plainscript dev)

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { IncrementalGraph, HmrRuntime, DevServer } = require('../compiler/dev');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

console.log('\n── Phase 8: Modern Dev Loop & Live HMR Server ──\n');

// 1. Incremental Dependency Graph
test('IncrementalGraph tracks file compilation and caching', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-graph-test-'));
  const fileA = path.join(tmp, 'a.pln');
  fs.writeFileSync(fileA, 'remember count as 42\n', 'utf8');

  const graph = new IncrementalGraph();
  const res = graph.updateFile(fileA);

  assert.strictEqual(res.changed, true);
  assert.ok(graph.getCachedJs(fileA));
  assert.ok(graph.getCachedAst(fileA));

  // Second update with same content -> no change
  const res2 = graph.updateFile(fileA);
  assert.strictEqual(res2.changed, false);

  // Invalidate
  const affected = graph.invalidate(fileA);
  assert.strictEqual(affected.has(path.normalize(fileA)), true);

  // Cleanup
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('IncrementalGraph tracks import dependency edges', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-graph-deps-'));
  const fileA = path.join(tmp, 'math.pln');
  const fileB = path.join(tmp, 'main.pln');

  fs.writeFileSync(fileA, 'make add(x, y)\n  give x + y\ndone\n', 'utf8');
  fs.writeFileSync(fileB, 'import "./math.pln"\nremember res as add(1, 2)\n', 'utf8');

  const graph = new IncrementalGraph();
  graph.updateFile(fileA);
  graph.updateFile(fileB);

  const dependentsOfA = graph.getDependents(fileA);
  assert.strictEqual(dependentsOfA.has(path.normalize(fileB)), true);

  const affected = graph.invalidate(fileA);
  assert.strictEqual(affected.has(path.normalize(fileA)), true);
  assert.strictEqual(affected.has(path.normalize(fileB)), true);

  fs.rmSync(tmp, { recursive: true, force: true });
});

// 2. HMR Runtime In-Memory Hot Swapping
test('HmrRuntime executes PlainScript and hot-swaps functions preserving global state', () => {
  const runtime = new HmrRuntime();
  const fakeFile = path.resolve('virtual_app.pln');

  // Initial code: define state and function
  const codeV1 = [
    'remember globalState as 100',
    'make calculate(x)',
    '  give x + 1',
    'done',
  ].join('\n');

  const v1 = runtime.reloadModule(fakeFile, codeV1);
  assert.strictEqual(v1.ok, true);

  // Run calculation in runtime
  let res1 = runtime.executeSnippet('calculate(10)');
  assert.strictEqual(res1, 11);
  assert.strictEqual(runtime.executeSnippet('globalState'), 100);

  // Mutate state in sandbox
  runtime.executeSnippet('globalState = 500;');

  // Hot-swap calculate function
  const codeV2 = [
    'make calculate(x)',
    '  give x * 10',
    'done',
  ].join('\n');

  const v2 = runtime.reloadModule(fakeFile, codeV2);
  assert.strictEqual(v2.ok, true);

  // Check that function is updated while global state is preserved!
  let res2 = runtime.executeSnippet('calculate(10)');
  assert.strictEqual(res2, 100);
  assert.strictEqual(runtime.executeSnippet('globalState'), 500);
});

test('HmrRuntime isolates syntax errors without corrupting runtime', () => {
  const runtime = new HmrRuntime();
  const fakeFile = path.resolve('virtual_err.pln');

  const codeGood = [
    'make hello()',
    '  give "world"',
    'done',
  ].join('\n');
  const res = runtime.reloadModule(fakeFile, codeGood);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(runtime.executeSnippet('hello()'), 'world');

  // Load broken code
  const codeBad = 'make broken( ... unclosed';
  const badRes = runtime.reloadModule(fakeFile, codeBad);
  assert.strictEqual(badRes.ok, false);
  assert.ok(badRes.error);

  // Runtime still functions with previous state
  assert.strictEqual(runtime.executeSnippet('hello()'), 'world');
});

// 3. DevServer Initialization & SSE Middleware
test('DevServer initializes, creates SSE client stream, and stops cleanly', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-devserver-'));
  const entry = path.join(tmp, 'app.pln');
  fs.writeFileSync(entry, 'remember msg as "hello dev"\n', 'utf8');

  const server = new DevServer(entry, { port: 3000 });
  assert.strictEqual(server.entryFile, path.normalize(entry));

  // Test SSE middleware helper
  let headersSet = {};
  let writtenData = [];
  const req = {
    url: '/__plain_hmr',
    headers: { accept: 'text/event-stream' },
    on: () => {},
  };
  const res = {
    writeHead: (status, headers) => {
      headersSet = { status, ...headers };
    },
    write: (chunk) => {
      writtenData.push(chunk);
    },
    end: () => {},
  };

  const handled = server.createSseMiddleware()(req, res);
  assert.strictEqual(handled, true);
  assert.strictEqual(headersSet.status, 200);
  assert.strictEqual(headersSet['Content-Type'], 'text/event-stream');
  assert.ok(writtenData.some(c => c.includes('connected')));

  // Broadcast test
  server.broadcast('test_event', { foo: 'bar' });
  assert.ok(writtenData.some(c => c.includes('test_event') && c.includes('foo')));

  server.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}
