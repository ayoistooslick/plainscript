// Tests for the PlainScript interactive/terminal primitives:
//   ask, confirm, choose, clearTerminal, terminalWidth, terminalHeight, stderr

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
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

function assert(actual, expected) {
  const a = actual.trim();
  const e = expected.trim();
  if (a !== e) {
    throw new Error(`Expected:\n        ${e}\n        Got:\n        ${a}`);
  }
}

function compile(source) {
  const context = createGenerationContext();
  let js = generate(parse(tokenize(source)), context);
  if (context.needsAsync) js = wrapAsync(js);
  return js;
}

function compileFixture(name) {
  return compile(fs.readFileSync(path.join(__dirname, '..', 'examples', name), 'utf8'));
}

// Evaluate generated JS under a sandboxed console. Follows the runGenerated
// pattern from tests/packaging.test.js: async-wrapped programs are awaited,
// console.error is captured with an "[err]" prefix. Never feeds stdin here.
async function runGenerated(js, processStub = { stdout: { columns: 120, rows: 40 } }) {
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
    require, sandboxConsole, processStub
  );
  await fn;
  return logs;
}

// ── Compile-time / generated-JS assertions ──────────────────────────────────

console.log('\nGenerated-JS assertions');

test('confirm() compiles to valid JS containing __confirm and readline', () => {
  const js = compile('confirm("Delete this?")');
  new vm.Script(js);
  if (!js.includes('__confirm')) throw new Error('Missing __confirm: ' + js);
  if (!js.includes('readline')) throw new Error('Missing readline: ' + js);
});

test('choose() with a list compiles and emits __choose', () => {
  const js = compile('choose("Pick one", ["a", "b"])');
  new vm.Script(js);
  if (!js.includes('__choose')) throw new Error('Missing __choose: ' + js);
});

test('choose with "list with" expression compiles (list-with form)', () => {
  const js = compile('show choose("Pick one", list with "a", "b")');
  new vm.Script(js);
  if (!js.includes('__choose')) throw new Error('Missing __choose: ' + js);
});

test('ask() compiles and emits __ask', () => {
  const js = compile('ask "Name? " as guest');
  new vm.Script(js);
  if (!js.includes('__ask')) throw new Error('Missing __ask: ' + js);
});

test('clearTerminal() compiles to escape clear + process.stdout.write', () => {
  const js = compile('clearTerminal()');
  new vm.Script(js);
  if (!js.includes('\\x1b[2J')) throw new Error('Missing ESC[2J: ' + js);
  if (!js.includes('process.stdout.write')) throw new Error('Missing process.stdout.write: ' + js);
});

test('terminalWidth() compiles to process.stdout.columns', () => {
  const js = compile('terminalWidth()');
  new vm.Script(js);
  if (!js.includes('process.stdout.columns')) throw new Error('Missing process.stdout.columns: ' + js);
});

test('terminalHeight() compiles to process.stdout.rows', () => {
  const js = compile('terminalHeight()');
  new vm.Script(js);
  if (!js.includes('process.stdout.rows')) throw new Error('Missing process.stdout.rows: ' + js);
});

test('stderr() compiles to console.error', () => {
  const js = compile('stderr("oops")');
  new vm.Script(js);
  if (!js.includes('console.error')) throw new Error('Missing console.error: ' + js);
});

// ── Runtime: stderr only (never reads stdin) ────────────────────────────────

console.log('\nRuntime (stderr / terminal dimensions)');

test('stderr() at runtime prints "oops" via console.error', async () => {
  const logs = await runGenerated(compile('stderr("oops")'));
  assert(JSON.stringify(logs), '["[err] oops"]');
});

test('terminalWidth()/terminalHeight() at runtime return non-negative numbers', async () => {
  const logs = await runGenerated(
    compile('show "columns=" + terminalWidth()\nshow "rows=" + terminalHeight()')
  );
  if (logs.length !== 2) throw new Error('Expected 2 lines, got: ' + JSON.stringify(logs));
  for (const line of logs) {
    const n = Number(line.split('=')[1]);
    if (!Number.isFinite(n) || n < 0) throw new Error('Not a non-negative number: ' + line);
  }
});

// ── PLAINTEXT mirror-compiles of the shipped examples ───────────────────────

console.log('\nExample mirror-compiles (must keep compiling)');

test('examples/interactive-cli.pln compiles (ask + confirm + choose)', () => {
  const js = compileFixture('interactive-cli.pln');
  new vm.Script(js);
  if (!js.includes('__ask')) throw new Error('Missing __ask: ' + js);
  if (!js.includes('__confirm')) throw new Error('Missing __confirm: ' + js);
  if (!js.includes('__choose')) throw new Error('Missing __choose: ' + js);
});

test('examples/interactive-cli.pln compiles (inline source mirror)', () => {
  const src = [
    'make main()',
    '    ask "What is your name? " as guest',
    '    show "hello, " + guest',
    '    remember ok as confirm("Shall we continue")',
    '    if ok is true',
    '        show "choice: " + choose("Drink?", ["tea", "coffee", "juice"])',
    '    done',
    'done',
    'main()',
  ].join('\n');
  const js = compile(src);
  new vm.Script(js);
  for (const needle of ['__ask', '__confirm', '__choose']) {
    if (!js.includes(needle)) throw new Error('Missing ' + needle + ': ' + js);
  }
});

test('examples/terminal-cli.pln compiles (read from disk)', () => {
  const js = compileFixture('terminal-cli.pln');
  new vm.Script(js);
  for (const needle of ['process.stdout.write', 'process.stdout.columns', 'process.stdout.rows', 'console.error']) {
    if (!js.includes(needle)) throw new Error('Missing ' + needle + ': ' + js);
  }
});

test('examples/terminal-cli.pln compiles (inline source mirror)', () => {
  const src = [
    'stderr("starting terminal census")',
    'show "width: " + terminalWidth()',
    'show "height: " + terminalHeight()',
    'stderr("clearing screen")',
    'clearTerminal()',
    'show "screen cleared"',
    'stderr("done")',
  ].join('\n');
  const js = compile(src);
  new vm.Script(js);
  for (const needle of ['\\x1b[2J', 'process.stdout.write', 'process.stdout.columns', 'process.stdout.rows', 'console.error']) {
    if (!js.includes(needle)) throw new Error('Missing ' + needle + ': ' + js);
  }
});

// ── ensureBuiltin chaining: show + confirm pulls in ask ─────────────────────

console.log('\nensureBuiltin chain');

test('show + confirm inside a conditional yields __ask AND __confirm', () => {
  const js = compile([
    'remember ok as confirm("Delete?")',
    'if ok is true',
    '  show "deleted"',
    'done',
  ].join('\n'));
  new vm.Script(js);
  if (!js.includes('__ask')) throw new Error('Missing __ask: ' + js);
  if (!js.includes('__confirm')) throw new Error('Missing __confirm: ' + js);
});

// ── Summary ─────────────────────────────────────────────────────────────────

Promise.resolve().then(() => {
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});