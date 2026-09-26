// Tests for the PlainScript v1.0.363 primitives
//   statistics: mean / median / variance / deviation
//   vectors:    dotProduct / magnitude / normalize
//   randomness: randomInteger / randomChoice / weightedChoice / shuffle / sample
//   helpers:    memoize / parseBoolean / characters
//   terminal:   confirm / choose / clearTerminal / terminalWidth /
//               terminalHeight / stderr (compile-only, except stderr)
//
// Follows tests/compiler.test.js harness conventions: plain Node script, local
// test(name, fn), assert(actual, expected), compile(source), plus a testAsync
// (runtime) variant and a runProgram helper that runs generated JS in a sandbox
// and captures console.log / console.error output.
//
// Run with: node tests/primitives.test.js

const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate } = require('../compiler/generator');

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
  if (a !== e) {
    throw new Error(`Expected:\n        ${e}\n        Got:\n        ${a}`);
  }
}

function compile(source) {
  return generate(parse(tokenize(source)));
}

// Run generated JS in a sandbox and capture console.log / console.error lines.
// Mirrors the runtime-capture pattern in tests/runtime.test.js.
async function runProgram(js) {
  const logs = [];
  const sandboxConsole = {
    log: (...args) => logs.push(args.map(String).join(' ')),
    error: (...args) => logs.push('[err] ' + args.map(String).join(' ')),
  };
  const sandboxProcess = { env: {}, stdout: { columns: 80, rows: 24 } };
  const fn = new Function('require', 'console', 'process', js + '\n;return undefined;')(
    (name) => require(name),
    sandboxConsole,
    sandboxProcess,
  );
  await Promise.resolve(fn);
  return logs;
}

// Compile a program and evaluate one remembered variable, returning the raw JS
// value. The source must contain only `remember` statements (no `show`) so no
// output leaks to the real console.
function evalProgram(source, ret) {
  const js = compile(source);
  return new Function(js + '\nreturn ' + ret + ';')();
}

function assertClose(actual, expected, tolerance) {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`Expected ${actual} to be within ${tolerance} of ${expected}`);
  }
}

// ── Statistics (pure, deterministic) ────────────────────────────────────────

console.log('\nStatistics primitives');

testAsync('mean prints the arithmetic average', async () => {
  const logs = await runProgram(compile('show mean([2, 4, 6, 8])'));
  assert(logs.join(','), '5');
});

testAsync('mean of a mismatched array is a float average', async () => {
  const logs = await runProgram(compile('show mean([1, 2])'));
  assert(logs.join(','), '1.5');
});

testAsync('median of an odd-length list prints the middle element', async () => {
  const logs = await runProgram(compile('show median([1, 3, 5])'));
  assert(logs.join(','), '3');
});

testAsync('median of an even-length list averages the middle two', async () => {
  const logs = await runProgram(compile('show median([1, 2, 3, 4])'));
  assert(logs.join(','), '2.5');
});

testAsync('variance uses sample variance (n-1)', async () => {
  const logs = await runProgram(compile('show variance([2, 3, 4])'));
  assert(logs.join(','), '1');
});

testAsync('deviation is the square root of the variance', async () => {
  const logs = await runProgram(compile('show deviation([2, 4, 6])'));
  assert(logs.join(','), '2');
});

test('statistics work as call expressions', () => {
  const js = compile('show mean([2, 4, 6, 8])\nshow median([1, 3, 5])');
  if (!js.includes('a.reduce((x, y) => x + y, 0) / a.length')) {
    throw new Error('missing mean implementation: ' + js);
  }
  if (!js.includes('s[m]')) throw new Error('missing median implementation: ' + js);
});

// ── Vectors (pure, deterministic) ───────────────────────────────────────────

console.log('\nVector primitives');

testAsync('dotProduct multiplies element-wise and sums', async () => {
  const logs = await runProgram(compile('show dotProduct([1, 2, 3], [4, 5, 6])'));
  assert(logs.join(','), '32');
});

testAsync('magnitude returns the Euclidean length', async () => {
  const logs = await runProgram(compile('show magnitude([3, 4])'));
  assert(logs.join(','), '5');
});

test('normalize produces a unit vector within float tolerance', () => {
  const v = evalProgram('remember v as normalize([3, 4])', 'v');
  if (v.length !== 2) throw new Error('normalize returned ' + v.length + ' elements');
  assertClose(v[0], 0.6, 1e-9);
  assertClose(v[1], 0.8, 1e-9);
});

test('normalize of zero vector maps to zeros, never NaN', () => {
  const z = evalProgram('remember z as normalize([0, 0])', 'z');
  if (z.length !== 2) throw new Error('normalize returned ' + z.length + ' elements');
  if (z[0] !== 0 || z[1] !== 0) throw new Error(`expected zeros, got [${z}]`);
  if (Number.isNaN(z[0]) || Number.isNaN(z[1])) throw new Error('normalize leaked NaN');
});

// ── Randomness (seeded only by Math.random, shape + range checks) ───────────

console.log('\nRandomness primitives');

testAsync('randomInteger(a, b) is always an integer in [a, b]', async () => {
  const src = 'remember i as 0\n' +
    'while i is less than 200\n' +
    '  show randomInteger(1, 10)\n' +
    '  i becomes i + 1\n' +
    'done';
  const logs = await runProgram(compile(src));
  if (logs.length !== 200) throw new Error('expected 200 draws, got ' + logs.length);
  const ok = logs.every((x) => Number.isInteger(Number(x)) && Number(x) >= 1 && Number(x) <= 10);
  if (!ok) throw new Error('out-of-range or non-integer draws: ' + logs.slice(0, 10));
});

testAsync('randomChoice always returns a member of the list', async () => {
  const src = 'remember i as 0\n' +
    'remember list as ["a", "b", "c"]\n' +
    'while i is less than 200\n' +
    '  show randomChoice(list)\n' +
    '  i becomes i + 1\n' +
    'done';
  const logs = await runProgram(compile(src));
  if (logs.length !== 200) throw new Error('expected 200 draws, got ' + logs.length);
  if (!logs.every((x) => ['a', 'b', 'c'].includes(x))) {
    throw new Error('randomChoice returned something outside the list: ' + logs.slice(0, 10));
  }
});

testAsync('weightedChoice always returns a member of the items', async () => {
  const src = 'remember i as 0\n' +
    'remember items as ["x", "y", "z"]\n' +
    'remember weights as [1, 2, 3]\n' +
    'while i is less than 200\n' +
    '  show weightedChoice(items, weights)\n' +
    '  i becomes i + 1\n' +
    'done';
  const logs = await runProgram(compile(src));
  if (logs.length !== 200) throw new Error('expected 200 draws, got ' + logs.length);
  if (!logs.every((x) => ['x', 'y', 'z'].includes(x))) {
    throw new Error('weightedChoice returned something outside the items: ' + logs.slice(0, 10));
  }
});

test('randomness programs compile to valid JS (new Function)', () => {
  const js = compile('remember i as 0\n' +
    'remember list as ["a", "b", "c"]\n' +
    'while i is less than 10\n' +
    '  show randomInteger(1, 10)\n' +
    '  show randomChoice(list)\n' +
    '  i becomes i + 1\n' +
    'done');
  new Function('require', 'console', 'process', js);
});

// ── shuffle / sample ───────────────────────────────────────────────────────

console.log('\nshuffle and sample');

test('shuffle returns the same elements rearranged', () => {
  const input = [3, 1, 2, 5, 4];
  const s = evalProgram('remember s as shuffle([3, 1, 2, 5, 4])', 's');
  if (s.length !== input.length) throw new Error('shuffle changed the length');
  const sorted = s.slice().sort((a, b) => a - b);
  const expected = input.slice().sort((a, b) => a - b);
  if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
    throw new Error(`shuffle dropped/replaced elements: got [${s}]`);
  }
});

test('sample(list, 3) returns 3 elements all taken from the input', () => {
  const s = evalProgram('remember s as sample([1, 2, 3, 4, 5], 3)', 's');
  if (s.length !== 3) throw new Error('sample returned ' + s.length + ' elements');
  if (!s.every((x) => [1, 2, 3, 4, 5].includes(x))) {
    throw new Error('sample returned an element outside the input: [' + s + ']');
  }
});

test('sample never returns more elements than the list holds', () => {
  const s = evalProgram('remember s as sample([7, 8], 5)', 's');
  if (s.length !== 2) throw new Error('sample returned ' + s.length + ' elements');
});

// ── memoize ────────────────────────────────────────────────────────────────

console.log('\nmemoize');

testAsync('memoize returns the same computed value on repeat calls', async () => {
  const src = 'make add(a, b)\n' +
    '  give a + b\n' +
    'done\n' +
    'remember m as memoize(add)\n' +
    'show m(2, 3)\n' +
    'show m(2, 3)';
  const logs = await runProgram(compile(src));
  assert(logs.join(','), '5,5');
});

testAsync('memoize caches results so the function body runs once', async () => {
  const src = 'remember calls as 0\n' +
    'make slow(x)\n' +
    '  calls becomes calls + 1\n' +
    '  give x * 2\n' +
    'done\n' +
    'remember m as memoize(slow)\n' +
    'show m(3)\n' +
    'show m(3)\n' +
    'show calls';
  const logs = await runProgram(compile(src));
  assert(logs.join(','), '6,6,1');
});

// ── parseBoolean ───────────────────────────────────────────────────────────

console.log('\nparseBoolean');

testAsync('parseBoolean recognizes common true spellings', async () => {
  const src = 'show parseBoolean("true")\n' +
    'show parseBoolean("no")\n' +
    'show parseBoolean("1")\n' +
    'show parseBoolean("YES")';
  const logs = await runProgram(compile(src));
  assert(logs.join(','), 'true,false,true,true');
});

test('parseBoolean trims and lowercases before matching', () => {
  const js = compile('show parseBoolean(" on ")');
  if (!js.includes("includes(String(")) throw new Error('unexpected parseBoolean output: ' + js);
});

// ── characters ─────────────────────────────────────────────────────────────

console.log('\ncharacters');

testAsync('characters splits a string into its characters', async () => {
  const logs = await runProgram(compile('show characters("abc")'));
  assert(logs.join(','), 'a,b,c');
});

testAsync('count of characters("hello") is 5', async () => {
  const logs = await runProgram(compile('show length(characters("hello"))'));
  assert(logs.join(','), '5');
});

// ── confirm / choose / terminal (compile-and-generate only) ────────────────

console.log('\nInteractive and terminal primitives');

test('confirm and choose compile to the ask runtime helpers', () => {
  const js = compile('remember ok as confirm("Delete this file?")\nremember pick as choose("Pick one", ["a", "b"])');
  if (!js.includes('__confirm')) throw new Error('missing __confirm helper');
  if (!js.includes('__choose')) throw new Error('missing __choose helper');
  if (!js.includes('readline')) throw new Error('missing readline import');
});

test('clearTerminal / terminalWidth / terminalHeight compile to runtime calls', () => {
  const js = compile('clearTerminal()\nshow terminalWidth()\nshow terminalHeight()');
  if (!js.includes("process.stdout.write('\\x1b[2J\\x1b[H')")) throw new Error('missing clear sequence');
  if (!js.includes('process.stdout.columns')) throw new Error('missing width column access');
  if (!js.includes('process.stdout.rows')) throw new Error('missing height row access');
});

testAsync('stderr writes to console.error', async () => {
  const logs = await runProgram(compile('stderr("hi")'));
  assert(logs.join(','), '[err] hi');
});

// ── Summary ────────────────────────────────────────────────────────────────

Promise.all(pendingTests).then(() => {
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});