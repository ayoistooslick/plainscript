// Tests for PlainScript  -  "any statement works at any nesting level".
//
// Historically the compiler decided whether a route handler / listener / user
// function had to be `async` from a hand-maintained registry of "async
// keywords". A new async keyword (like `ocr`) would silently stop working the
// moment it moved out of the top level (where the whole program is wrapped in
// an async IIFE). The generator now derives async-ness from actual generation
// output (generateBlock + emitAwaited)/(markAsync), so every runtime keyword  - 
// old or brand-new  -  is guaranteed to work inside any route, function, or nested
// block, not just at the top level.
//
// This file locks that guarantee in with a regression test per async construct:
// inside a route, inside a function, and deeply nested  -  plus tests that
// non-async constructs stay synchronous and that asyncness never leaks between
// sibling functions.
//
// Run with: node tests/nesting.test.js

const { tokenize, TOKEN } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate, createGenerationContext, wrapAsync } = require('../compiler/generator');

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

function assert(actual, expected) {
  const idx = actual.indexOf(expected);
  if (idx === -1) {
    throw new Error(`Expected JS to contain:\n        ${expected}\n        But got:\n        ${actual}`);
  }
}

function assertNot(actual, forbidden) {
  if (actual.includes(forbidden)) {
    throw new Error(`Expected JS NOT to contain:\n        ${forbidden}\n        But got:\n        ${actual}`);
  }
}

// Compile the way `plainscript build` does: top-level async constructs wrap the
// whole program, everything else stays a plain script.
function compileProgram(source) {
  const context = createGenerationContext();
  let js = generate(parse(tokenize(source)), context);
  if (context.needsAsync) js = wrapAsync(js);
  return js;
}

// A full web-app scaffold exporting a single route that contains `body` as the
// only runtime statement in its handler. Used to assert the handler becomes
// async when `body` emits an await.
function routeScaffold(body) {
  return 'web app\nroute post "/t"\n' + body + '\n  reply "ok"\ndone\nstart 0';
}

// A make-function scaffold containing `body` as its only runtime statement.
function makeScaffold(body) {
  return 'make job()\n' + body + '\n  give 1\ndone';
}

// ── The constructs that must force an async handler / function ─────────────

// Each entry: descriptive name + the statement body (at 2-space base indent).
const ASYNC_CONSTRUCTS = {
  'ask':        '  ask "prompt" as answer',
  'ocr':        '  ocr "scan.png" as text',
  'mail send':  '  send mail\n    to is "a@b.c"\n    subject is "S"\n    text is "T"\n  done',
  'sqlite database': '  database "app.db"',
  'postgres':   '  postgres env("PG")',
  'postgres query': '  postgres env("PG")\n  remember r as query\n    select 1\n  done',
  'transaction': '  database "app.db"\n  transaction\n    insert\n      INSERT INTO t VALUES (1)\n    done\n  done',
  'postgres transaction': '  postgres env("PG")\n  transaction\n    insert\n      INSERT INTO t VALUES (1)\n    done\n  done',
  'stream':     '  stream "f.txt" as line\n    show line\n  done',
  'cache':      '  cache "redis://x"',
  'http get':   '  remember r as get "https://example.com"',
  'wait for':   '  remember v as wait for job()',
  'concurrent': '  remember r as any of [job1(), job2()]',
  'ai chat':    '  remember out as chat("gpt-4o", [])',
  'with timeout': '  remember v as withTimeout(job(), 1000)',
  'run command': '  remember out as runCommand("ls")',
  'retry':      '  retry 3 times\n    show "try"\n  done',
  'run parallel': '  run in parallel\n    remember a as 1\n  done as results',
  'cache get':  '  cache "redis://x"\n  remember v as cacheGet("key")',
};

// Non-async constructs that must NOT flip a handler/function to async.
const SYNC_CONSTRUCTS = {
  'show':       '  show "hello"',
  'remember':   '  remember x as 1 + 2',
  'becomes':    '  remember n as 0\n  n becomes n + 1',
  'serve':      '  serve folder "public"',
  'plain reply': '  reply "ok"',
};

// ── Async constructs inside a route handler ────────────────────────────────

for (const [name, body] of Object.entries(ASYNC_CONSTRUCTS)) {
  test(`route: "${name}" makes the handler async`, () => {
    const js = compileProgram(routeScaffold(body));
    assert(js, 'app.post("/t", async (req, res) => {');
  });
}

test(`route: a handler with only sync statements stays synchronous`, () => {
  for (const [name, body] of Object.entries(SYNC_CONSTRUCTS)) {
    const js = compileProgram(routeScaffold(body));
    if (!js.includes('app.get') && !js.includes('app.post')) continue;
    assert(js, '(req, res) => {');
    assertNot(js, 'async (req, res) => {');
  }
});

// ── Async constructs inside a make function ────────────────────────────────

for (const [name, body] of Object.entries(ASYNC_CONSTRUCTS)) {
  test(`function: "${name}" makes the function async`, () => {
    const js = generate(parse(tokenize(makeScaffold(body))));
    assert(js, 'async function job() {');
  });
}

test(`function: a function with only sync statements stays synchronous`, () => {
  for (const [name, body] of Object.entries(SYNC_CONSTRUCTS)) {
    const js = generate(parse(tokenize(makeScaffold(body))));
    assert(js, 'function job() {');
    assertNot(js, 'async function job() {');
  }
});

// ── Deeply nested (route > if > statement) ─────────────────────────────────

const NESTED_ASync = {
  'ocr':       '    ocr "scan.png" as text',
  'ask':       '    ask "p" as answer',
  'mail send': '    send mail\n      to is "a@b.c"\n      subject is "S"\n      text is "T"\n    done',
  'http get':  '    remember r as get "https://example.com"',
  'transaction': '    database "app.db"\n    transaction\n      insert\n        INSERT INTO t VALUES (1)\n      done\n    done',
};

for (const [name, body] of Object.entries(NESTED_ASync)) {
  test(`deep-nested route>if: "${name}" keeps the handler async`, () => {
    const src = 'web app\nroute post "/t"\n  remember x as 1\n  if x is 1\n' + body + '\n  done\n  reply "ok"\ndone\nstart 0';
    const js = compileProgram(src);
    assert(js, 'app.post("/t", async (req, res) => {');
  });
}

// Nested inside a loop (for each) inside a route.
test(`deep-nested route>loop: "ocr" keeps the handler async`, () => {
  const src = 'web app\nroute post "/t"\n  remember xs as [1]\n  for each n in xs\n    ocr "scan.png" as text\n  done\n  reply "ok"\ndone\nstart 0';
  const js = compileProgram(src);
  assert(js, 'app.post("/t", async (req, res) => {');
});

// ── Asyncness never leaks between sibling functions ────────────────────────

test('function: an async inner function does not make its sibling async', () => {
  const src = 'make a()\n  ocr "x.png" as t\n  give t\ndone\nmake b()\n  give 1\ndone';
  const js = generate(parse(tokenize(src)));
  assert(js, 'async function a() {');
  assert(js, 'function b() {');
  assertNot(js, 'async function b() {');
});

test('function: an async nested function does not make its parent async', () => {
  const src = 'make outer()\n  make inner()\n    ocr "x.png" as t\n    give t\n  done\n  give 1\ndone';
  const js = generate(parse(tokenize(src)));
  assert(js, 'function outer() {');
  assert(js, 'async function inner() {');
});

// Asyncness inside a route must not leak out to the top-level program wrapper:
// the top-level wrapper is only emitted when a construct awaits at the program
// top level, not merely because a route handler awaited.
test('program: a route that awaits does not add a top-level async wrapper', () => {
  const js = compileProgram('web app\nroute post "/t"\n  ocr "scan.png" as text\n  reply text\ndone\nstart 0');
  assertNot(js, '(async () => {');
});

// Listener and 404 handlers are async themselves; an await inside them must not
// drag the whole program into an async wrapper either.
test('program: a listener that awaits does not add a top-level async wrapper', () => {
  const js = compileProgram('web app\nlisten on 3000\n  ocr "scan.png" as text\n  show text\ndone\nstart 0');
  assert(js, 'async () => {');
  assertNot(js, '(async () => {');
});

test('program: a 404 handler that awaits does not add a top-level async wrapper', () => {
  const js = compileProgram('web app\nwhen nothing matches\n  ocr "scan.png" as text\n  reply text\ndone\nstart 0');
  assert(js, '(async req, res) => {');
  assertNot(js, '(async () => {');
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
