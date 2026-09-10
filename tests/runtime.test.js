// Tests for PlainScript v2.1.1  -  one deterministic compiler, no Complex
// Compilation:
//   language: booleans/null, arithmetic, and/or/not, try/recover,
//             wait for, retry, HTTP client expressions
//   backend:  uploads, api keys, sessions, cookies, rate limits,
//             Google OAuth routes, 404 catch-all
//   auth:     scrypt password hashing, signed tokens
//   database: portable engine chain (native probe + wasm fallback)
//
// Run with: node tests/runtime.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate, createGenerationContext, wrapAsync } = require('../compiler/generator');
const { format } = require('../compiler/formatter');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

const pendingTests = [];
let lastTest = Promise.resolve();

function testAsync(name, fn) {
  const run = () => fn().then(
    () => { console.log(`  PASS  ${name}`); passed++; },
    (e) => { console.log(`  FAIL  ${name}`); console.log(`        ${e.message}`); failed++; },
  );
  lastTest = lastTest.then(run, run);
  pendingTests.push(lastTest);
}

function assert(actual, expected) {
  const a = String(actual).trim();
  const e = String(expected).trim();
  if (a !== e) throw new Error(`Expected:\n        ${e}\n        Got:\n        ${a}`);
}

function assertIncludes(actual, expected) {
  if (!String(actual).includes(expected)) {
    throw new Error(`Expected to include:\n        ${expected}\n        Got:\n        ${String(actual).trim()}`);
  }
}

function compileProgram(source) {
  const context = createGenerationContext();
  let js = generate(parse(tokenize(source)), context);
  if (context.needsAsync) js = wrapAsync(js);
  return js;
}

async function runProgram(js, stubs = {}, extraParams = {}) {
  const logs = [];
  const sandboxConsole = {
    log: (...args) => logs.push(args.map(String).join(' ')),
    error: (...args) => logs.push('[err] ' + args.map(String).join(' ')),
  };
  const match = js.match(/^\(async \(\) => \{\n([\s\S]*)\n\}\)\(\);$/);
  const body = match ? `return (async () => {\n${match[1]}\n})();` : `${js}\n;return undefined;`;
  const params = ['require', 'console', 'process', ...Object.keys(extraParams)];
  const fn = new Function(...params, body)((name) => {
    if (Object.prototype.hasOwnProperty.call(stubs, name)) return stubs[name];
    return require(name);
  }, sandboxConsole, { env: {} }, ...Object.values(extraParams));
  await Promise.resolve(fn);
  return logs;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !predicate()) await sleep(25);
}

// Boots a generated web program on an ephemeral port (awaiting async-wrapped
// programs so databases are open before requests fly).
async function runWebProgram(js) {
  const realExpress = require('express');
  const captured = [];
  const express = (...args) => {
    const app = realExpress(...args);
    const originalListen = app.listen.bind(app);
    app.listen = (...listenArgs) => {
      const server = originalListen(...listenArgs);
      captured.push(server);
      return server;
    };
    return app;
  };
  for (const key of Object.keys(realExpress)) express[key] = realExpress[key];

  const match = js.match(/^\(async \(\) => \{\n([\s\S]*)\n\}\)\(\);$/);
  const body = match ? `return (async () => {\n${match[1]}\n})();` : `${js}\n;return undefined;`;
  const promise = new Function('require', 'console', body)((name) => (
    name === 'express' ? express : require(name)
  ), console);
  await Promise.resolve(promise);

  await waitFor(() => captured.length > 0);
  const server = captured[captured.length - 1];
  await sleep(50);
  return { server, port: server.address().port };
}

// ── Language: literals, arithmetic, logic ────────────────────────────────────

console.log('\nv2.1.1 language');

test('booleans and null are keywords that compile to JS', () => {
  const js = compileProgram('remember yes as true\nremember no as false\nremember nothing as null\nshow yes\nshow no\nshow nothing');
  assertIncludes(js, 'let yes = true;');
  assertIncludes(js, 'let no = false;');
  assertIncludes(js, 'let nothing = null;');
});

testAsync('boolean/null programs run correctly', async () => {
  const logs = await runProgram(compileProgram('show true\nshow false\nshow null'));
  assert(JSON.stringify(logs), JSON.stringify(['true', 'false', 'null']));
});

testAsync('arithmetic precedence follows standard math rules', async () => {
  const logs = await runProgram(compileProgram(
    'show 2 + 3 * 4\nshow (2 + 3) * 4\nshow 10 - 4 - 3\nshow 20 / 4 / 5\nshow 10 % 3'
  ));
  assert(JSON.stringify(logs), JSON.stringify(['14', '20', '3', '1', '1']));
});

testAsync('unary minus works on literals and expressions', async () => {
  const logs = await runProgram(compileProgram(
    'remember n as 5\nshow -n\nshow -(2 + 3)\nshow 10 + -4'
  ));
  assert(JSON.stringify(logs), JSON.stringify(['-5', '-5', '6']));
});

testAsync("and / or / not combine conditions", async () => {
  const logs = await runProgram(compileProgram([
    'if 1 is 1 and 2 is 2',
    'show "both"',
    'done',
    'if 1 is 1 or 2 is 3',
    'show "either"',
    'done',
    'if not 1 is 2',
    'show "negated"',
    'done',
    'if 1 is 1 and not 2 is 3',
    'show "mixed"',
    'done',
  ].join('\n')));
  assert(JSON.stringify(logs), JSON.stringify(['both', 'either', 'negated', 'mixed']));
});

test('or binds looser than and', () => {
  // 1 is 1 or (1 is 2 and 1 is 2) → true. If or bound tighter this would be
  // (1 is 1 or 1 is 2) and 1 is 2 → false.
  const js = compileProgram('if 1 is 1 or 1 is 2 and 1 is 2\nshow "yes"\ndone');
  // JS already binds && tighter than ||, so the generated expression is
  // correct without extra parentheses.
  assertIncludes(js, 'if (1 === 1 || 1 === 2 && 1 === 2)');
});

testAsync('try/recover catches runtime errors', async () => {
  const logs = await runProgram(compileProgram([
    'try',
    'remember broken as jsonDecode("{oops")',
    'show "never"',
    'recover as error',
    'show "caught"',
    'done',
    'show "after"',
  ].join('\n')));
  assert(JSON.stringify(logs), JSON.stringify(['caught', 'after']));
});

testAsync('try without recover swallows the error silently', async () => {
  const logs = await runProgram(compileProgram([
    'try',
    'remember broken as jsonDecode("{oops")',
    'done',
    'show "still running"',
  ].join('\n')));
  assert(JSON.stringify(logs), JSON.stringify(['still running']));
});

testAsync('"wait for" awaits async values', async () => {
  const js = compileProgram([
    'make later()',
    'give 42',
    'done',
    'remember value as wait for later()',
    'show value',
    'show wait for later() + 1',
  ].join('\n'));
  assertIncludes(js, '(await later())');
  const logs = await runProgram(js);
  assert(JSON.stringify(logs), JSON.stringify(['42', '43']));
});

testAsync('retry succeeds after transient failures', async () => {
  const js = compileProgram([
    'remember attempts as 0',
    'retry 3 times every 0 seconds',
    'attempts becomes attempts + 1',
    'if attempts is 1',
    'remember broken as jsonDecode("{oops")',
    'done',
    'show "survived after " + text(attempts)',
    'done',
  ].join('\n'));
  const logs = await runProgram(js);
  assert(JSON.stringify(logs), JSON.stringify(['survived after 2']));
});

test('retry grammar validates its clauses', () => {
  let threw = false;
  try { compileProgram('retry three times\nshow "x"\ndone'); } catch (_) { threw = true; }
  if (!threw) throw new Error('expected non-numeric retry count to fail');
  threw = false;
  try { compileProgram('retry 3 time\nshow "x"\ndone'); } catch (_) { threw = true; }
  if (!threw) throw new Error('expected "time" (singular) to fail');
});

testAsync('retry exhausts all attempts then continues the program', async () => {
  const logs = await runProgram(compileProgram([
    'remember calls as 0',
    'retry 3 times every 0 seconds',
    'calls becomes calls + 1',
    'remember broken as jsonDecode("{oops")',
    'done',
    'show "calls: " + text(calls)',
  ].join('\n')));
  if (logs.filter(l => l.startsWith('[err]')).length !== 1) {
    throw new Error('expected exactly one logged error from the final attempt, got: ' + JSON.stringify(logs));
  }
  assert(logs[logs.length - 1], 'calls: 3');
});

testAsync('http client parses JSON responses into a record', async () => {
  const fakeFetch = async (url, options) => ({
    ok: true,
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null), entries: () => [] },
    text: async () => '{"name":"plainscript"}',
    url,
    options,
  });
  const js = compileProgram([
    'remember r as get "http://example.test/api"',
    'show status of r',
    'show name of data of r',
  ].join('\n'));
  assertIncludes(js, "__httpRequest('GET'");
  const logs = await runProgramWithFetch(js, fakeFetch);
  assert(JSON.stringify(logs), JSON.stringify(['200', 'plainscript']));
});

async function runProgramWithFetch(js, fetchImpl) {
  const logs = [];
  const sandboxConsole = { log: (...a) => logs.push(a.map(String).join(' ')), error: () => {} };
  const match = js.match(/^\(async \(\) => \{\n([\s\S]*)\n\}\)\(\);$/);
  const body = `return (async () => {\n${match[1]}\n})();`;
  const fn = new Function('fetch', 'require', 'console', body)(fetchImpl, (n) => require(n), sandboxConsole);
  await Promise.resolve(fn);
  return logs;
}

testAsync('post with body and headers serialises correctly', async () => {
  let seen = null;
  const fakeFetch = async (url, options) => {
    seen = { url, options };
    return {
      ok: false,
      status: 401,
      headers: { get: () => 'application/json', entries: () => [] },
      text: async () => '{"error":"no"}',
    };
  };
  const js = compileProgram(
    'remember r as post "https://api.test/login" with { user: "ada", password: "secret" } headers { accept: "application/json" } timeout 1500\nshow status of r'
  );
  assertIncludes(js, "__httpRequest('POST'");
  const logs = await runProgramWithFetch(js, fakeFetch);
  assert(JSON.stringify(logs), '["401"]');
  assert(seen.url, 'https://api.test/login');
  assert(seen.options.body, '{"user":"ada","password":"secret"}');
  assert(seen.options.headers.accept, 'application/json');
});

testAsync('delete "<url>" is an HTTP request, not a SQL block', async () => {
  let method = null;
  const fakeFetch = async (_url, options) => {
    method = options.method;
    return { ok: true, status: 204, headers: { get: () => 'text/plain', entries: () => [] }, text: async () => '' };
  };
  const js = compileProgram('delete "https://api.test/items/7"\nshow "gone"');
  assertIncludes(js, "__httpRequest('DELETE'");
  const logs = await runProgramWithFetch(js, fakeFetch);
  assert(method, 'DELETE');
  assert(JSON.stringify(logs), '["gone"]');
});

// ── Auth runtime ─────────────────────────────────────────────────────────────

console.log('\nv2.1.1 auth runtime');

testAsync('hashPassword/checkPassword roundtrip', async () => {
  const logs = await runProgram(compileProgram([
    'remember hash as hashPassword("s3cret")',
    'show checkPassword("s3cret", hash)',
    'show checkPassword("wrong", hash)',
  ].join('\n')));
  assert(JSON.stringify(logs), JSON.stringify(['true', 'false']));
});

testAsync('tokens survive a roundtrip and reject tampering/expiry', async () => {
  const logs = await runProgram(compileProgram([
    'remember t as createToken({ user: "ada" }, "shhh", 60)',
    'show user of readToken(t, "shhh")',
    'show readToken(t + "x", "shhh")',
    'show readToken(t, "wrong-key")',
    'remember expired as createToken({ user: "bob" }, "shhh", -10)',
    'show readToken(expired, "shhh")',
  ].join('\n')));
  assert(JSON.stringify(logs), JSON.stringify(['ada', 'null', 'null', 'null']));
});

// ── Database engine chain ────────────────────────────────────────────────────

console.log('\nv2.1.1 database engines');

testAsync('using "wasm" runs SQLite through WebAssembly', async () => {
  const logs = await runProgram(compileProgram([
    'database ":memory:" using "wasm"',
    'execute',
    '    CREATE TABLE t (v TEXT)',
    'done',
    'insert',
    '    INSERT INTO t VALUES ("wasm")',
    'done',
    'remember rows as query',
    '    SELECT v FROM t',
    'done',
    'show rows[0].v',
  ].join('\n')));
  assert(JSON.stringify(logs), '["wasm"]');
});

testAsync('wasm databases persist to disk across runs', async () => {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-db-')), 'data.db');
  const fileRef = dbFile.replace(/\\/g, '/');
  await runProgram(compileProgram([
    `database "${fileRef}" using "wasm"`,
    'execute',
    '    CREATE TABLE t (v TEXT)',
    'done',
    'insert',
    '    INSERT INTO t VALUES ("kept")',
    'done',
  ].join('\n')));
  if (!fs.existsSync(dbFile)) throw new Error('database file was not written');
  const logs = await runProgram(compileProgram([
    `database "${fileRef}" using "wasm"`,
    'remember rows as query',
    '    SELECT v FROM t',
    'done',
    'show rows[0].v',
  ].join('\n')));
  assert(JSON.stringify(logs), '["kept"]');
});

testAsync('the default driver probes native first and still works', async () => {
  const logs = await runProgram(compileProgram([
    'database ":memory:"',
    'execute',
    '    CREATE TABLE t (n NUMBER)',
    'done',
    'remember sevens as 7',
    'remember info as insert',
    '    INSERT INTO t VALUES ({sevens})',
    'done',
    'show changes of info',
  ].join('\n')));
  assert(JSON.stringify(logs), '["1"]');
});

// ── Web middleware (live Express) ────────────────────────────────────────────

console.log('\nv2.1.1 web middleware');

testAsync('require api key rejects missing/wrong keys and accepts the right one', async () => {
  const { port, server } = await runWebProgram(compileProgram([
    'web app',
    'require api key from "kay-123"',
    'route get "/data"',
    'reply json',
    '    ok is true',
    'done',
    'done',
    'start 0',
  ].join('\n')));
  try {
    const missing = await fetch(`http://localhost:${port}/data`);
    assert(missing.status, '401');
    const wrong = await fetch(`http://localhost:${port}/data`, { headers: { 'x-api-key': 'nope' } });
    assert(wrong.status, '401');
    const right = await fetch(`http://localhost:${port}/data`, { headers: { 'x-api-key': 'kay-123' } });
    assert(right.status, '200');
    assert((await right.json()).ok, 'true');
  } finally { server.close(); }
});

testAsync('sessions persist per client and destroy on demand', async () => {
  const { port, server } = await runWebProgram(compileProgram([
    'web app',
    'enable sessions "test-secret"',
    'route post "/cart"',
    'cart of session of request becomes [ "apple" ]',
    'reply json',
    '    cart is cart of session of request',
    'done',
    'done',
    'route get "/cart"',
    'reply json',
    '    cart is cart of session of request',
    'done',
    'done',
    'route post "/logout"',
    'destroy session',
    'reply "bye"',
    'done',
    'start 0',
  ].join('\n')));
  try {
    const put = await fetch(`http://localhost:${port}/cart`, { method: 'POST' });
    assert((await put.json()).cart[0], 'apple');
    const cookie = put.headers.get('set-cookie').split(';')[0];
    const get = await fetch(`http://localhost:${port}/cart`, { headers: { cookie } });
    assert((await get.json()).cart[0], 'apple');
    await fetch(`http://localhost:${port}/logout`, { method: 'POST', headers: { cookie } });
    const afterLogout = await fetch(`http://localhost:${port}/cart`, { headers: { cookie } });
    const body = await afterLogout.json();
    if (body.cart && body.cart.length === 1) throw new Error('session survived destroy');
  } finally { server.close(); }
});

testAsync('cookies can be set with expiry, read back and cleared', async () => {
  const { port, server } = await runWebProgram(compileProgram([
    'web app',
    'route get "/theme"',
    'show cookie("theme")',
    'reply "ok"',
    'done',
    'route get "/login"',
    'set cookie "theme" to "dark" expires in 7 days',
    'reply "welcome"',
    'done',
    'route get "/reset"',
    'clear cookie "theme"',
    'reply "reset"',
    'done',
    'start 0',
  ].join('\n')));
  try {
    const login = await fetch(`http://localhost:${port}/login`);
    const setCookie = login.headers.get('set-cookie');
    assertIncludes(setCookie, 'theme=dark');
    assertIncludes(setCookie, 'Max-Age=604800');
    const read = await fetch(`http://localhost:${port}/theme`, { headers: { cookie: 'theme=dark' } });
    assert((await read.text()), 'ok');
    const reset = await fetch(`http://localhost:${port}/reset`);
    assertIncludes(reset.headers.get('set-cookie'), 'theme=;');
  } finally { server.close(); }
});

testAsync('rate limiting returns 429 once the window quota is spent', async () => {
  const { port, server } = await runWebProgram(compileProgram([
    'web app',
    'limit requests to 2 per minute',
    'route get "/ping"',
    'reply "pong"',
    'done',
    'start 0',
  ].join('\n')));
  try {
    assert((await fetch(`http://localhost:${port}/ping`)).status, '200');
    assert((await fetch(`http://localhost:${port}/ping`)).status, '200');
    const third = await fetch(`http://localhost:${port}/ping`);
    assert(third.status, '429');
    assertIncludes(JSON.stringify(await third.json()), 'Too many requests');
  } finally { server.close(); }
});

testAsync('when nothing matches serves a custom 404', async () => {
  const { port, server } = await runWebProgram(compileProgram([
    'web app',
    'route get "/known"',
    'reply "here"',
    'done',
    'when nothing matches',
    'status 404',
    'reply json',
    '    error is "No such road"',
    'done',
    'done',
    'start 0',
  ].join('\n')));
  try {
    assert((await fetch(`http://localhost:${port}/known`)).status, '200');
    const res = await fetch(`http://localhost:${port}/unknown/road`);
    assert(res.status, '404');
    const body = await res.json();
    assert(body.error, 'No such road');
  } finally { server.close(); }
});

testAsync('google oauth registers redirect and callback endpoints', async () => {
  const { port, server } = await runWebProgram(compileProgram([
    'web app',
    'google oauth',
    'id is env("GOOGLE_ID")',
    'secret is env("GOOGLE_SECRET")',
    'callback is "http://localhost:0/auth/google/callback"',
    'landing is "/"',
    'done',
    'start 0',
  ].join('\n')));
  try {
    const res = await fetch(`http://localhost:${port}/auth/google`, { redirect: 'manual' });
    assert(res.status, '302');
    const location = res.headers.get('location');
    assertIncludes(location, 'accounts.google.com');
    assertIncludes(location, 'state=');
    const bad = await fetch(`http://localhost:${port}/auth/google/callback?state=forged`);
    assert(bad.status, '400');
  } finally { server.close(); }
});

testAsync('accept uploads stores files and upload()/uploads() expose them', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-uploads-'));
  const { port, server } = await runWebProgram(compileProgram([
    'web app',
    `accept uploads limit "5 MB" allow ["image/png"] folder "${folder.replace(/\\/g, '/')}"`,
    'route post "/single"',
    'remember file as upload("doc")',
    'reply json',
    '    name is name of file',
    '    size is size of file',
    '    type is type of file',
    'done',
    'done',
    'route post "/many"',
    'remember files as uploads("docs")',
    'reply json',
    '    count is length(files)',
    'done',
    'done',
    'route post "/reject-type"',
    'remember file as upload("doc")',
    'reply "should not reach here"',
    'done',
    'start 0',
  ].join('\n')));
  try {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const single = await fetch(`http://localhost:${port}/single`, {
      method: 'POST',
      body: (() => { const fd = new FormData(); fd.append('doc', new Blob([png], { type: 'image/png' }), 'pic.png'); return fd; })(),
    });
    const body = await single.json();
    assert(body.name, 'pic.png');
    assert(body.type, 'image/png');
    if (!(body.size > 0)) throw new Error('uploaded file has no size');
    const many = await fetch(`http://localhost:${port}/many`, {
      method: 'POST',
      body: (() => {
        const fd = new FormData();
        fd.append('docs', new Blob([png], { type: 'image/png' }), 'a.png');
        fd.append('docs', new Blob([png], { type: 'image/png' }), 'b.png');
        return fd;
      })(),
    });
    assert((await many.json()).count, '2');
    const rejected = await fetch(`http://localhost:${port}/reject-type`, {
      method: 'POST',
      body: (() => { const fd = new FormData(); fd.append('doc', new Blob([Buffer.from('hello')], { type: 'text/plain' }), 'note.txt'); return fd; })(),
    });
    assert(rejected.status, '415');
    // /single wrote pic.png, /many wrote a.png and b.png (diskStorage folder).
    const written = fs.readdirSync(folder);
    assert(written.length, '3');
  } finally { server.close(); }
});

// ── Formatter ────────────────────────────────────────────────────────────────

console.log('\nv2.1.1 formatter');

test('try/recover, retry, when-nothing-matches indent correctly', () => {
  const formatted = format([
    'try',
    'show 1',
    'recover as error',
    'show 2',
    'done',
    'when nothing matches',
    'status 404',
    'done',
  ].join('\n'));
  // House style: one blank line separates top-level blocks (same as
  // "otherwise" between if branches).
  assert(formatted, [
    'try',
    '    show 1',
    '',
    'recover as error',
    '    show 2',
    'done',
    '',
    'when nothing matches',
    '    status 404',
    'done',
  ].join('\n'));
});

test('HTTP delete statements do not open SQL-style blocks', () => {
  const formatted = format('delete "https://api.test/x"\nshow "done"');
  if (formatted.trim().split('\n').length !== 2) throw new Error('unexpected block indentation:\n' + formatted);
});

// ── Summary ──────────────────────────────────────────────────────────────────

(async () => {
  await Promise.all(pendingTests);
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
