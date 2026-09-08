// Tests for PlainScript v2.1.0 — deterministic backend capabilities:
//   HTTP routing (methods, groups, accessors, status, CORS, validation)
//   filesystem operations, text / number / collection helpers,
//   databases (SQLite live, PostgreSQL shape, transactions),
//   email, cron scheduling, background jobs, WebSocket servers, Redis cache.
//
// Run with: node tests/backend.test.js
// (Standalone harness; the main suite is tests/compiler.test.js.)

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
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

// Async tests are queued and joined before the summary (see bottom).
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
  if (a !== e) {
    throw new Error(`Expected:\n        ${e}\n        Got:\n        ${a}`);
  }
}

function assertIncludes(actual, expected) {
  if (!String(actual).includes(expected)) {
    throw new Error(`Expected to include:\n        ${expected}\n        Got:\n        ${String(actual).trim()}`);
  }
}

function assertThrows(source, expectedMessage) {
  try {
    compileProgram(source);
  } catch (e) {
    if (expectedMessage && !e.message.includes(expectedMessage)) {
      throw new Error(`Expected error containing:\n        ${expectedMessage}\n        Got:\n        ${e.message}`);
    }
    return;
  }
  throw new Error(`Expected compilation to fail${expectedMessage ? ` with "${expectedMessage}"` : ''}, but it succeeded.`);
}

// Compile PlainScript source the way `plainscript build` does (async runtime wrapper).
function compileProgram(source) {
  const context = createGenerationContext();
  let js = generate(parse(tokenize(source)), context);
  if (context.needsAsync) js = wrapAsync(js);
  return js;
}

// Execute generated code with real Node modules passed through except the
// ones listed in stubs (module name → value). Returns captured console logs.
function runGenerated(js, stubs = {}, env = {}) {
  const logs = [];
  const sandboxConsole = {
    log: (...args) => logs.push(args.map(String).join(' ')),
    error: (...args) => logs.push('[err] ' + args.map(String).join(' ')),
  };
  new Function('require', 'console', 'process', js)((name) => {
    if (Object.prototype.hasOwnProperty.call(stubs, name)) return stubs[name];
    return require(name);
  }, sandboxConsole, { env });
  return logs;
}

// Same as runGenerated but awaits the program's promise (async-wrapped
// output), rethrowing any runtime error it produces. wrapAsync emits
// "(async () => {\n…\n})();"; the statement form is rewritten into the same
// arrow invoked through `return`, so the program runs exactly once and its
// promise is observable.
async function runGeneratedAsync(js, stubs = {}, env = {}) {
  const logs = [];
  const sandboxConsole = {
    log: (...args) => logs.push(args.map(String).join(' ')),
    error: (...args) => logs.push('[err] ' + args.map(String).join(' ')),
  };
  const match = js.match(/^\(async \(\) => \{\n([\s\S]*)\n\}\)\(\);$/);
  const body = match
    ? `return (async () => {\n${match[1]}\n})();`
    : `${js}\n;return undefined;`;
  const fn = new Function('require', 'console', 'process', body)((name) => {
    if (Object.prototype.hasOwnProperty.call(stubs, name)) return stubs[name];
    return require(name);
  }, sandboxConsole, { env });
  await fn;
  return logs;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !predicate()) await sleep(25);
}

// Boots a generated web program against the REAL express module on an
// ephemeral port by wrapping app.listen so we learn the assigned port.
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

  new Function('require', 'console', js)((name) => {
    if (name === 'express') return express;
    return require(name);
  }, console);

  await waitFor(() => captured.length > 0);
  const server = captured[captured.length - 1];
  await sleep(50);
  const address = server.address();
  return { server, port: address.port };
}

// ── HTTP routing ─────────────────────────────────────────────────────────────

test('http: route methods compile to app.get/post/put/patch/delete', () => {
  const js = compileProgram(`web app
route get "/a"
reply "1"
done
route post "/b"
reply "2"
done
route put "/c"
reply "3"
done
route patch "/d"
reply "4"
done
route delete "/e"
reply "5"
done
`);
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    assertIncludes(js, `app.${method}(`);
  }
});

test('http: plain route stays GET', () => {
  const js = compileProgram(`web app
route "/ping"
reply "pong"
done
`);
  assertIncludes(js, 'app.get(');
});

test('http: group prefixes nested routes', () => {
  const js = compileProgram(`web app
group "/api/v1"
route get "/users"
reply "u"
done
done
`);
  assertIncludes(js, '"/api/v1/users"');
});

test('http: param/query/header accessors bind request data', () => {
  const js = compileProgram(`web app
route get "/u/:id"
remember who as param("id")
remember page as query("page")
remember auth as header("x-token")
reply who
done
`);
  assertIncludes(js, 'req.params["id"]');
  assertIncludes(js, 'req.query["page"]');
  assertIncludes(js, 'req.headers["x-token"]');
});

test('http: accessors are a compile error outside routes', () => {
  assertThrows('show param("id")', 'param');
});

test('http: status sets the response code without breaking assignments', () => {
  const js = compileProgram(`web app
route get "/x"
status 201
reply "made"
done
`);
  assertIncludes(js, 'res.status(201)');
  // "status becomes n" keeps its variable meaning.
  const js2 = compileProgram(`status becomes 404
show status
`);
  assertIncludes(js2, 'status = 404');
});

test('http: allow cors adds middleware before routes', () => {
  const js = compileProgram(`web app
allow cors
route get "/"
reply "hi"
done
`);
  const middlewarePos = js.indexOf("app.use((req, res, next)");
  const routePos = js.indexOf('app.get(');
  if (middlewarePos < 0) throw new Error('CORS middleware missing from output');
  if (routePos < 0 || middlewarePos > routePos) throw new Error('CORS middleware must come before routes');
});

test('http: validate returns missing field names', () => {
  const js = compileProgram(`web app
route post "/signup"
remember missing as validate(body of request, ["name", "email"])
reply missing
done
`);
  assertIncludes(js, '__validate(req.body, ["name", "email"])');
});

testAsync('http: live server serves methods, validation, and CORS', async () => {
  const js = compileProgram(`web app
allow cors
route get "/hello/:name"
reply "hi " + param("name")
done
route post "/check"
remember missing as validate(body of request, ["name"])
remember count as length(missing)
if count is greater than 0
status 400
reply missing
otherwise
reply "ok"
done
done
start 0
`);
  const { server, port } = await runWebProgram(js);
  try {
    const getRes = await fetch(`http://127.0.0.1:${port}/hello/plainscript`);
    assert(await getRes.text(), 'hi plainscript');

    const bad = await fetch(`http://127.0.0.1:${port}/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert(bad.status, 400);
    assert(JSON.stringify(await bad.json()), '["name"]');

    const good = await fetch(`http://127.0.0.1:${port}/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ana' }),
    });
    assert(good.status, 200);
    assert(await good.text(), 'ok');

    const preflight = await fetch(`http://127.0.0.1:${port}/check`, {
      method: 'OPTIONS',
      headers: { 'origin': 'http://example.com', 'access-control-request-method': 'POST' },
    });
    assert(preflight.status, 204);
    assert(preflight.headers.get('access-control-allow-origin'), '*');
  } finally {
    server.close();
  }
});

// ── Filesystem ───────────────────────────────────────────────────────────────

testAsync('filesystem: write/read/append/copy/move/list/delete roundtrip', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-fs-'));
  const q = (p) => p.replace(/\\/g, '\\\\');
  const src = `writeFile("${q(path.join(dir, 'a.txt'))}", "one")
appendFile("${q(path.join(dir, 'a.txt'))}", "-two")
remember text as readFile("${q(path.join(dir, 'a.txt'))}")
copyFile("${q(path.join(dir, 'a.txt'))}", "${q(path.join(dir, 'b.txt'))}")
moveFile("${q(path.join(dir, 'b.txt'))}", "${q(path.join(dir, 'c.txt'))}")
deleteFile("${q(path.join(dir, 'c.txt'))}")
makeFolder("${q(path.join(dir, 'sub'))}")
deleteFolder("${q(path.join(dir, 'sub'))}")
remember files as listFolder("${q(dir)}")
show text
show join(files, ",")
`;
  const logs = runGenerated(compileProgram(src));
  assert(logs[0], 'one-two');
  // After deletions only a.txt remains; order is not guaranteed on all platforms.
  const listed = logs[1].split(',').sort();
  assert(JSON.stringify(listed), JSON.stringify(['a.txt']));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Stdlib helpers ───────────────────────────────────────────────────────────

test('stdlib: sort uses unified ordering across types', () => {
  const logs = runGenerated(compileProgram(`show sort([5, 1, 3])`));
  assert(logs[0], '1,3,5');
});

test('stdlib: collection helpers behave', () => {
  const logs = runGenerated(compileProgram(`show reverse([1, 2, 3])
show unique([1, 1, 2])
show sum([1, 2, 3])
show smallest([5, 2, 9])
show largest([5, 2, 9])
show keys({ name: "ana" })
show values({ name: "ana" })
show hasKey({ name: "ana" }, "name")
`));
  assert(logs[0], '3,2,1');
  assert(logs[1], '1,2');
  assert(logs[2], '6');
  assert(logs[3], '2');
  assert(logs[4], '9');
  assert(logs[5], 'name');
  assert(logs[6], 'ana');
  assert(logs[7], 'true');
});

test('stdlib: text and number helpers behave', () => {
  const logs = runGenerated(compileProgram(`show trim("  hi  ")
show replace("a-b-c", "-", "+")
show split("a,b,c", ",")
show join(["a", "b"], "-")
show number("42") + 1
show text(42) + "!"
show floor(3.7)
show ceiling(3.2)
`));
  assert(JSON.stringify(logs), JSON.stringify(['hi', 'a+b+c', 'a,b,c', 'a-b', '43', '42!', '3', '4']));
});

// ── Databases ────────────────────────────────────────────────────────────────

testAsync('database: sqlite insert/transaction/query against :memory:', async () => {
  const js = compileProgram(`database ":memory:"
execute
    CREATE TABLE users (name TEXT, age NUMBER)
done
remember who as "bo"
remember who2 as "cy"
remember info as insert
    INSERT INTO users (name, age) VALUES ({who}, 31)
done
transaction
    insert
        INSERT INTO users (name, age) VALUES ({who2}, 40)
    done
done
remember minAge as 30
remember adults as query
    SELECT name FROM users WHERE age >= {minAge} ORDER BY name
done
for each row in adults
show row.name
done
`);
  // v2.1.1 — opening a database is async (native probe with wasm fallback),
  // so the generated program runs inside the async wrapper.
  const logs = await runGeneratedAsync(js);
  assert(JSON.stringify(logs), JSON.stringify(['bo', 'cy']));
});

test('postgres: compiles to Pool with $n placeholders', () => {
  const js = compileProgram(`postgres env("DATABASE_URL")
remember grownups as query
    SELECT * FROM people WHERE age > {minAge}
done
remember rows as grownups({ minAge: 18 })
show rows
`);
  assertIncludes(js, "connectionString");
  assertIncludes(js, '$1');
  assertIncludes(js, '.rows');
});

testAsync('postgres: fake driver receives connectionString and bound values', async () => {
  const seen = {};
  const fakePg = {
    Pool: function (config) {
      seen.config = config;
      this.query = async (sql, values) => {
        seen.sql = sql;
        seen.values = values;
        return { rows: [{ ok: true }] };
      };
    },
  };
  const logs = await runGeneratedAsync(compileProgram(`postgres "postgres://u:p@h/db"
remember minAge as 21
remember rows as query
    SELECT * FROM people WHERE age > {minAge}
done
show length(rows)
`), { pg: fakePg });
  assert(seen.config.connectionString, 'postgres://u:p@h/db');
  assert(seen.sql.includes('$1'), true);
  assert(JSON.stringify(seen.values), '[21]');
  assert(logs[0], '1');
});

// ── Email ────────────────────────────────────────────────────────────────────

testAsync('email: transport wraps credentials and send mail delivers fields', async () => {
  const sent = [];
  const transports = [];
  const nodemailer = {
    createTransport: (options) => {
      transports.push(options);
      return { sendMail: async (mail) => { sent.push(mail); return {}; } };
    },
  };
  runGenerated(compileProgram(`mail transport
host is "smtp.test.dev"
port is 587
user is "bot@x.dev"
pass is env("MAIL_PASS")
done
send mail
from is "bot@x.dev"
to is "you@example.com"
subject is "Welcome"
text is "Hello there"
done
`), { nodemailer }, { MAIL_PASS: 's3cret' });
  await waitFor(() => sent.length > 0);
  assert(transports[0].auth.user, 'bot@x.dev');
  assert(transports[0].auth.pass, 's3cret');
  assert(sent[0].subject, 'Welcome');
  assert(sent[0].to, 'you@example.com');
});

testAsync('email: send mail without a transport fails with a teaching error', async () => {
  const nodemailer = { createTransport: () => { throw new Error('should not be called'); } };
  let errored = null;
  try {
    await runGeneratedAsync(compileProgram(`send mail
from is "a@b.c"
to is "d@e.f"
subject is "Hi"
done
`), { nodemailer });
  } catch (e) {
    errored = e;
  }
  if (!errored || !String(errored.message).includes('no transport configured')) {
    throw new Error('Expected teaching error about missing transport, got: ' + (errored && errored.message));
  }
});

// ── Scheduling and background jobs ───────────────────────────────────────────

testAsync('every/schedule/run background register and execute', async () => {
  const events = [];
  const croner = {
    schedule: (expression, fn) => { events.push('cron:' + expression); global.__backendCronFn = fn; return { stop() {} }; },
  };
  global.__backendBg = () => { events.push('background-ran'); };
  const logs = [];
  const sandboxConsole = { log: (...a) => events.push('log:' + a.join(' ')), error: (...a) => events.push('[err] ' + a.join(' ')) };

  const js = compileProgram(`every 1 seconds
show "tick"
done
schedule "* * * * *"
show "minute"
done
run background __backendBg()
`);
  new Function('require', 'console', js)((name) => {
    if (name === 'croner') return croner;
    throw new Error('unexpected require ' + name);
  }, sandboxConsole);

  if (global.__backendCronFn) global.__backendCronFn();
  await waitFor(() => events.includes('log:tick'), 4000);
  assertIncludes(JSON.stringify(events), '"cron:* * * * *"');
  assertIncludes(JSON.stringify(events), '"background-ran"');
  delete global.__backendCronFn;
  delete global.__backendBg;
});

// ── WebSocket ────────────────────────────────────────────────────────────────

testAsync('websocket: connect handler greets, message handler echoes', async () => {
  const ws = require('ws');
  const js = compileProgram(`websocket server on 0
when socket connects
send socket "welcome"
done
when socket sends message
send socket message
done
when socket disconnects
done
done
`);
  new Function('require', js)((name) => {
    if (name === 'ws') return ws;
    throw new Error('unexpected require ' + name);
  });

  // Discover the ephemeral port from the running server via a probe client.
  // The generator binds port 0, so scan the process handles.
  await sleep(150);
  let port = null;
  for (const handle of process._getActiveHandles ? process._getActiveHandles() : []) {
    if (handle && typeof handle.address === 'function') {
      const addr = handle.address();
      if (addr && addr.port) { port = addr.port; break; }
    }
  }
  if (!port) throw new Error('websocket server did not open a port');

  const client = new ws.WebSocket(`ws://127.0.0.1:${port}`);
  const received = [];
  client.on('message', (raw) => {
    received.push(raw.toString());
    if (received.length < 2) client.send('echo-me');
    else client.close();
  });
  await waitFor(() => received.length >= 2, 3000);
  assert(JSON.stringify(received), '["welcome","echo-me"]');
});

testAsync('websocket: send to targets a specific connection', async () => {
  const ws = require('ws');
  const servers = [];
  const wrappedWs = {
    WebSocket: ws.WebSocket,
    WebSocketServer: class extends ws.WebSocketServer {
      constructor(options) {
        super(options);
        servers.push(this);
      }
    },
  };
  const js = compileProgram(`websocket server on 0
when socket connects
done
when socket sends message
send to socket "echo: " + message
done
when socket disconnects
done
done
`);
  new Function('require', js)((name) => {
    if (name === 'ws') return wrappedWs;
    throw new Error('unexpected require ' + name);
  });

  await sleep(150);
  const server = servers[servers.length - 1];
  if (!server) throw new Error('websocket server did not open');
  const port = server.address().port;

  const client = new ws.WebSocket(`ws://127.0.0.1:${port}`);
  const received = [];
  client.on('open', () => client.send('hello'));
  client.on('message', (raw) => {
    received.push(raw.toString());
    client.close();
  });
  await waitFor(() => received.length >= 1, 3000);
  server.close();
  assert(JSON.stringify(received), '["echo: hello"]');
});

test('websocket: broadcast consumes a string payload and targets the server', () => {
  const js = compileProgram(`websocket server on 8080
when socket connects
broadcast "Someone joined"
done
done
`);
  assertIncludes(js, '__wsBroadcast(__wsServer, "Someone joined")');
});

test('cache: url may be any expression, including env(...)', () => {
  const js = compileProgram(`cache env("REDIS_URL")
remember x as cacheGet("k")
`);
  assertIncludes(js, 'process.env["REDIS_URL"]');
});

test('websocket: unknown statements inside the block are rejected', () => {
  assertThrows(`websocket server on 8081
show "nope"
done
done
`, 'websocket block may only contain');
});

// ── Cache ────────────────────────────────────────────────────────────────────

testAsync('cache: url reaches the driver, get/set/delete roundtrip', async () => {
  const store = new Map([['token', 'abc']]);
  const calls = [];
  const redis = {
    createClient: (options) => ({
      on() {},
      connect: async () => calls.push('connect:' + options.url),
      get: async (k) => { calls.push('get:' + k); return store.get(k) ?? null; },
      set: async (k, v, opts) => { calls.push('set:' + k + ':' + JSON.stringify(opts)); store.set(k, v); },
      del: async (k) => { calls.push('del:' + k); store.delete(k); },
    }),
  };
  const logs = runGenerated(compileProgram(`cache "redis://localhost:6379"
remember token as cacheGet("token")
remember saved as cacheSet("greeting", "hi", 60)
remember gone as cacheDelete("greeting")
show token
`), { redis });
  await sleep(50);
  assertIncludes(JSON.stringify(calls), '"connect:redis://localhost:6379"');
  assertIncludes(JSON.stringify(calls), '"set:greeting:{\\"EX\\":60}"');
  assert(logs[0], 'abc');
});

testAsync('cache: accessors fall back to an in-memory store without configuration', async () => {
  // No "cache" statement: the runtime silently uses an in-memory Map, so a
  // missing key reads as null and set/delete round-trip in-process.
  let errored = null;
  let value = null;
  try {
    const logs = await runGeneratedAsync(compileProgram(`
cacheSet("k", "v")
remember x as cacheGet("k")
cacheDelete("k")
remember y as cacheGet("k")
show x
show y
`));
    value = logs.join('\n');
  } catch (e) {
    errored = e;
  }
  if (errored) {
    throw new Error('Expected in-memory cache fallback, got error: ' + errored.message);
  }
  assertIncludes(value, 'v');
  assertIncludes(value, 'null');
});

// ── Formatter ────────────────────────────────────────────────────────────────

test('formatter: v2.1 blocks indent their bodies', () => {
  const pretty = format(`websocket server on 8081
when socket sends message
send socket message
done
done
every 30 seconds
show "beat"
done
mail transport
host is "smtp.x.dev"
port is 587
done
`);
  assert(pretty, `websocket server on 8081
    when socket sends message
        send socket message
    done
done

every 30 seconds
    show "beat"
done

mail transport
    host is "smtp.x.dev"
    port is 587
done
`);
});

// ── Dependency detection ─────────────────────────────────────────────────────

test('dependencies: integration statements map to implementation packages', () => {
  const detect = require('../compiler/dependency-detector');
  const result = detect.detectDependencies(parse(tokenize(
    `postgres "postgres://x"
mail transport
host is "h"
done
schedule "* * * * *"
show "x"
done
websocket server on 1234
when socket connects
done
done
cache "redis://localhost"
`)));
  const packages = JSON.stringify(result.packages || result);
  for (const expected of ['pg', 'nodemailer', 'croner', 'ws', 'redis']) {
    assertIncludes(packages, `"${expected}"`);
  }
});

// ── Summary ──────────────────────────────────────────────────────────────────

Promise.all(pendingTests).then(() => {
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
});
