// Tests for PlainScript concurrency constructs:
//   run in parallel … done as <name>
//   count of
//   match pattern "regex" in text as <name>
//   all of / any of / settled of
//   retry / try … recover … finally
//   wait for / await
//
// Follows the harness conventions of tests/compiler.test.js (plain Node,
// local test/assert helpers, async test queue, summary + exit code) and the
// compileProgram/runGenerated runtime harness of tests/packaging.test.js
// (async IIFE wrapper, captured console output).
//
// Run with: node tests/concurrency.test.js

const { tokenize } = require('../compiler/lexer');
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

// Async tests are queued and joined before the summary (packaging.test.js
// pattern).
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

function assertIncludes(actual, expected, label) {
  if (!String(actual).includes(expected)) {
    throw new Error(
      `${label || 'Expected'} to include:\n        ${expected}\n        Got:\n        ${String(actual).trim()}`
    );
  }
}

function assertEqual(actual, expected) {
  const a = String(actual);
  const e = String(expected);
  if (a !== e) {
    throw new Error(`Expected:\n        ${e}\n        Got:\n        ${a}`);
  }
}

// Compile PlainScript the way `plainscript build` does (async runtime wrapper).
function compileProgram(source) {
  const context = createGenerationContext();
  let js = generate(parse(tokenize(source)), context);
  if (context.needsAsync) js = wrapAsync(js);
  return js;
}

// Evaluate generated JS; async-wrapped programs are awaited. Returns captured
// console lines; throws on program errors.
async function runGenerated(js) {
  const logs = [];
  const sandboxConsole = {
    log: (...args) => logs.push(args.map(String).join(' ')),
    error: (...args) => logs.push('[err] ' + args.map(String).join(' ')),
  };
  const match = js.match(/^\(async \(\) => \{\n([\s\S]*)\n\}\)\(\);$/);
  const body = match
    ? `return (async () => {\n${match[1]}\n})();`
    : `${js}\n;return undefined;`;
  const fn = new Function('require', 'console', 'process', body)(
    (name) => require(name), sandboxConsole, { env: {} }
  );
  await fn;
  return logs;
}

async function runProgram(source) {
  return runGenerated(compileProgram(source));
}

// ── run in parallel … done as <name> ───────────────────────────────────────

testAsync('run in parallel: each statement is one concurrent task; results in order', async () => {
  const logs = await runProgram(
    'make square(n)\n  give n * n\ndone\n' +
    'run in parallel\n  square(2)\n  square(3)\n  square(4)\ndone as r\n' +
    'show join(r, ",")'
  );
  assertEqual(logs.join(' | '), '4,9,16');
});

testAsync('run in parallel: a sync statement contributes undefined but the array keeps its length', async () => {
  const logs = await runProgram(
    'make square(n)\n  give n * n\ndone\n' +
    'run in parallel\n  remember a as 1\n  square(5)\n  square(6)\ndone as r\n' +
    'show count of r'
  );
  assertEqual(logs.join(' | '), '3');
});

test('run in parallel: generated JS uses Promise.all and async tasks', () => {
  const js = compileProgram(
    'make square(n)\n  give n * n\ndone\n' +
    'run in parallel\n  square(2)\n  square(3)\ndone as r\n' +
    'show r'
  );
  assertIncludes(js, 'Promise.all([', 'generated JS');
  assertIncludes(js, 'async () =>', 'generated JS');
});

test('run in parallel: works inside an async route handler', () => {
  const js = compileProgram(
    'web app\nroute get "/t"\n  run in parallel\n    square(2)\n    square(3)\n  done as rr\n' +
    '  reply join(rr, "-")\ndone\nstart 0'
  );
  assertIncludes(js, 'app.get("/t", async (req, res) => {', 'generated JS');
  assertIncludes(js, 'Promise.all([', 'generated JS');
});

// ── count of ────────────────────────────────────────────────────────────────

testAsync('count of: array, string, and empty array', async () => {
  const logs = await runProgram('show count of [1,2,3]\nshow count of "hello"\nshow count of []');
  assertEqual(logs.join(' | '), '3 | 5 | 0');
});

// ── match pattern "regex" in <text> as <name> ───────────────────────────────

testAsync('match pattern: captures matching digits', async () => {
  const logs = await runProgram('match pattern "^\\\\d+$" in "4061" as digits\nshow digits');
  assertEqual(logs.join(' | '), '4061');
});

testAsync('match pattern: a capture group exposes the full match in the array', async () => {
  const logs = await runProgram(
    'match pattern "^(\\\\d+)$" in "4061" as digits\n' +
    'show first of digits'
  );
  assertEqual(logs.join(' | '), '4061');
});

testAsync('match pattern: a non-matching pattern leaves the variable set to null', async () => {
  const logs = await runProgram('match pattern "^\\\\d+$" in "4061abc" as digits\nshow digits');
  assertEqual(logs.join(' | '), 'null');
});

// ── all of / any of / settled of ─────────────────────────────────────────────

testAsync('all of: awaits every job and preserves input order', async () => {
  const logs = await runProgram(
    'make jobA()\n  wait for sleepAsync(10)\n  give 40\ndone\n' +
    'make jobB()\n  wait for sleepAsync(2)\n  give 50\ndone\n' +
    'remember r as all of [jobA(), jobB()]\nshow r'
  );
  assertEqual(logs.join(' | '), '40,50');
});

testAsync('any of: resolves with the first settling job', async () => {
  const logs = await runProgram(
    'make jobA()\n  wait for sleepAsync(50)\n  give 40\ndone\n' +
    'make jobB()\n  wait for sleepAsync(2)\n  give 50\ndone\n' +
    'remember r as any of [jobA(), jobB()]\nshow r'
  );
  assertEqual(logs.join(' | '), '50');
});

testAsync('settled of: returns status records in input order', async () => {
  const logs = await runProgram(
    'make jobA()\n  wait for sleepAsync(5)\n  give 40\ndone\n' +
    'make jobB()\n  wait for sleepAsync(2)\n  give 50\ndone\n' +
    'remember r as settled of [jobB(), jobA()]\n' +
    'show status of r[0]\nshow value of r[0]\n' +
    'show status of r[1]\nshow value of r[1]'
  );
  assertEqual(logs.join(' | '), 'fulfilled | 50 | fulfilled | 40');
});

// ── try / recover / finally, retry ───────────────────────────────────────────

testAsync('try / recover as e / finally: every section runs', async () => {
  const logs = await runProgram(
    'try\n  throw new Error("boom")\nrecover as e\n  show "caught"\nfinally\n  show "cleanup"\ndone\n' +
    'show "after"'
  );
  assertEqual(logs.join(' | '), 'caught | cleanup | after');
});

testAsync('try inside a function: recover give yields a resolved value', async () => {
  const logs = await runProgram(
    'make safe()\n  try\n    throw new Error("boom")\n    give 1\n  recover as e\n    give 2\n  done\ndone\n' +
    'remember v as safe()\nshow v'
  );
  assertEqual(logs.join(' | '), '2');
});

testAsync('retry: a failing attempt retries until the body succeeds', async () => {
  const logs = await runProgram(
    'remember tries as 0\n' +
    'retry 3 times every 0 seconds\n' +
    '  tries becomes tries + 1\n' +
    '  if tries is 1\n    throw new Error("flaky")\n  done\n' +
    '  show "ok"\n' +
    'done\nshow "finished"'
  );
  assertEqual(logs.join(' | '), 'ok | finished');
});

// ── wait for / await ────────────────────────────────────────────────────────

test('wait for: remember v as wait for job() compiles to async', () => {
  const js = compileProgram(
    'make job()\n  wait for sleepAsync(1)\n  give 42\ndone\n' +
    'remember v as wait for job()\nshow v'
  );
  assertIncludes(js, 'async function job() {', 'generated JS');
  assertIncludes(js, '(await job())', 'generated JS');
});

testAsync('wait for: the awaited function\'s returned value is resolved', async () => {
  const logs = await runProgram(
    'make job()\n  wait for sleepAsync(5)\n  give 42\ndone\n' +
    'remember v as wait for job()\nshow v'
  );
  assertEqual(logs.join(' | '), '42');
});

testAsync('await: works in expression position', async () => {
  const logs = await runProgram(
    'make job()\n  wait for sleepAsync(5)\n  give 42\ndone\n' +
    'remember v as await job()\nshow v'
  );
  assertEqual(logs.join(' | '), '42');
});

// ── Summary ─────────────────────────────────────────────────────────────────

Promise.all(pendingTests).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
});