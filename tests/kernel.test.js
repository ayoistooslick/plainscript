// tests/kernel.test.js
// Regression tests for the language-kernel completeness work:
// first-class function values (-> lambdas), comparisons as expressions,
// the "to ... together" function form, symbol compound assignments, and the
// collection/runtime dispatch fixes (typeof/void/delete, remove, contains,
// keys/values, is empty).

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
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

function compile(src) {
  return generate(parse(tokenize(src)));
}

// Run a PlainScript program and evaluate `ret` inside it.
function run(src, ret) {
  const js = compile(src);
  return new Function(js + '\nreturn ' + ret + ';')();
}

console.log('\n── Language Kernel: Function Values & Comparison Expressions ──\n');

// ── 1. First-class function values (-> lambdas) ────────────────────────────

test('lambda assigned with let and called', () => {
  const src = [
    'let double is (x) -> x * 2',
    'remember d as double(21)',
  ].join('\n');
  if (run(src, 'd') !== 42) throw new Error('expected 42');
});

test('lambda assigned with remember (const) and called', () => {
  const src = [
    'remember square as (n) -> n * n',
    'remember s as square(9)',
  ].join('\n');
  if (run(src, 's') !== 81) throw new Error('expected 81');
});

test('multi-parameter lambda', () => {
  const src = [
    'remember add3 as (a, b, c) -> a + b + c',
    'remember total as add3(1, 2, 3)',
  ].join('\n');
  if (run(src, 'total') !== 6) throw new Error('expected 6');
});

test('lambda used with map/filter higher-order calls', () => {
  const src = [
    'remember nums as [1, 2, 3, 4]',
    'remember doubled as nums.map((x) -> x * 2)',
    'remember even as nums.filter((x) -> x % 2 is 0)',
    'remember found as nums.find((x) -> x is above 2)',
  ].join('\n');
  const r = run(src, 'JSON.stringify({ doubled, even, found })');
  const expected = JSON.stringify({ doubled: [2, 4, 6, 8], even: [2, 4], found: 3 });
  if (r !== expected) throw new Error(`expected ${expected}, got ${r}`);
});

test('lambda captures enclosing variables (closure)', () => {
  const src = [
    'remember factor as 3',
    'remember scale as (x) -> x * factor',
    'remember r as scale(5)',
  ].join('\n');
  if (run(src, 'r') !== 15) throw new Error('closure capture failed');
});

test('function can return a lambda (factory closure)', () => {
  const src = [
    'make adder(n)',
    '  give (x) -> x + n',
    'done',
    'remember add5 as adder(5)',
    'remember r1 as add5(3)',
    'remember add10 as adder(10)',
    'remember r2 as add10(1)',
  ].join('\n');
  const r = run(src, 'JSON.stringify([r1, r2])');
  if (r !== JSON.stringify([8, 11])) throw new Error(`expected [8,11], got ${r}`);
});

test('named function passed as a value (composition)', () => {
  const src = [
    'make double(x)',
    '  give x * 2',
    'done',
    'remember nums as [1, 2, 3]',
    'remember result as nums.map(double)',
  ].join('\n');
  const r = run(src, 'JSON.stringify(result)');
  if (r !== JSON.stringify([2, 4, 6])) throw new Error(`expected [2,4,6], got ${r}`);
});

// ── 2. Comparisons as expressions ──────────────────────────────────────────

test('comparison folds inside remember value', () => {
  const src = [
    'remember score as 90',
    'remember flag as score is above 80',
  ].join('\n');
  if (run(src, 'flag') !== true) throw new Error('expected true');
});

test('comparison folds inside let value', () => {
  const src = [
    'let count is 7',
    'let flag is count is more than 3',
  ].join('\n');
  if (run(src, 'flag') !== true) throw new Error('expected true');
});

test('grouped comparison is an expression value', () => {
  const src = [
    'remember a as 5',
    'remember b as 5',
    'let same is (a is b)',
  ].join('\n');
  if (run(src, 'same') !== true) throw new Error('grouped comparison failed');
});

test('comparison inside array literal elements', () => {
  const src = [
    'remember score as 60',
    'let flags is [score is above 80, score is above 50]',
  ].join('\n');
  const r = run(src, 'JSON.stringify(flags)');
  if (r !== JSON.stringify([false, true])) throw new Error(`expected [false,true], got ${r}`);
});

test('comparison as a function argument', () => {
  const src = [
    'remember score as 70',
    'log(score is at least 70)',
  ].join('\n');
  const js = compile(src);
  if (!js.includes('console.log(score >= 70)')) throw new Error('comparison did not fold in argument position');
});

test('lambda predicate: is not', () => {
  const src = [
    'remember nums as [1, 2, 3, 4]',
    'remember odds as nums.filter((x) -> x % 2 is not 0)',
  ].join('\n');
  const r = run(src, 'JSON.stringify(odds)');
  if (r !== JSON.stringify([1, 3])) throw new Error(`expected [1,3], got ${r}`);
});

test('lambda predicate: between and is at least', () => {
  const src = [
    'remember scores as [72, 55, 91, 84]',
    'remember good as scores.filter((s) -> s between 70 and 90)',
    'remember honors as scores.filter((s) -> s is at least 85)',
  ].join('\n');
  const r = run(src, 'JSON.stringify({ good, honors })');
  const expected = JSON.stringify({ good: [72, 84], honors: [91] });
  if (r !== expected) throw new Error(`expected ${expected}, got ${r}`);
});

test('lambda predicate: is in a collection', () => {
  const src = [
    'remember allowed as ["admin", "editor"]',
    'remember roles as ["editor", "user"]',
    'remember picked as roles.filter((r) -> r is in allowed)',
  ].join('\n');
  const r = run(src, 'JSON.stringify(picked)');
  if (r !== JSON.stringify(['editor'])) throw new Error(`expected ["editor"], got ${r}`);
});

test('lambda predicate: contains', () => {
  const src = [
    'remember words as ["hello", "helpful", "world"]',
    'remember hels as words.filter((w) -> w contains "hel")',
  ].join('\n');
  const r = run(src, 'JSON.stringify(hels)');
  if (r !== JSON.stringify(['hello', 'helpful'])) throw new Error(`expected hello/helpful, got ${r}`);
});

test('lambda predicate: combined boolean via choosing (and/or)', () => {
  const src = [
    'remember nums as [3, 7, 15, 22]',
    'remember mid as nums.filter((n) -> choosing n is above 5 and n is below 20 then true otherwise false)',
  ].join('\n');
  const r = run(src, 'JSON.stringify(mid)');
  if (r !== JSON.stringify([7, 15])) throw new Error(`expected [7,15], got ${r}`);
});

test('lambda predicate: empty check inside filter', () => {
  const src = [
    'remember rows as ["", "abc", "", "de"]',
    'remember blanks as rows.filter((r) -> r is empty)',
  ].join('\n');
  const r = run(src, 'rows.length - blanks.length');
  if (r !== 2) throw new Error('empty predicate failed');
});

// ── 3. "to ... together" function form ─────────────────────────────────────

test('to function with and param list compiles and runs', () => {
  const src = [
    'to add a and b together',
    '  give a + b',
    'together',
    'remember total as add(20, 22)',
  ].join('\n');
  if (run(src, 'total') !== 42) throw new Error('expected 42');
});

test('to function closed with done', () => {
  const src = [
    'to double n together',
    '  give n * 2',
    'done',
    'remember d as double(21)',
  ].join('\n');
  if (run(src, 'd') !== 42) throw new Error('expected 42');
});

test('to function with no parameters', () => {
  const src = [
    'to greet together',
    '  give "hello"',
    'together',
    'remember g as greet()',
  ].join('\n');
  if (run(src, 'g') !== 'hello') throw new Error('expected "hello"');
});

test('to function terminator no longer swallows the body', () => {
  const js = compile([
    'to add a and b together',
    '  give a + b',
    'together',
    'remember total as add(1, 2)',
  ].join('\n'));
  if (!js.includes('function add(a, b)')) throw new Error('function not emitted');
  if (js.indexOf('function add') > js.indexOf('add(1, 2)')) throw new Error('body was swallowed to top level');
});

// ── 4. Symbol compound assignments ─────────────────────────────────────────

test('++= compiles to += and updates the variable', () => {
  const src = [
    'let x is 5',
    'x ++= 3',
  ].join('\n');
  if (run(src, 'x') !== 8) throw new Error('expected 8');
});

test('&&= short-circuits on a falsy target', () => {
  const src = [
    'let x is 0',
    'x &&= 5',
  ].join('\n');
  if (run(src, 'x') !== 0) throw new Error('expected 0');
});

test('||= assigns when the target is falsy', () => {
  const src = [
    'let x is null',
    'x ||= 7',
  ].join('\n');
  if (run(src, 'x') !== 7) throw new Error('expected 7');
});

test('??= assigns only for nullish target', () => {
  const src = [
    'let x is null',
    'x ??= 9',
    'x ??= 1',
  ].join('\n');
  if (run(src, 'x') !== 9) throw new Error('expected 9 (second ??= is a no-op)');
});

// ── 5. Unary operators emit correctly (typeof / void / delete) ─────────────

test('typeof compiles with a space (no token collision)', () => {
  const src = [
    'remember a as "text"',
    'let t is typeof a',
  ].join('\n');
  const js = compile(src);
  if (!js.includes('let t = typeof a;')) throw new Error(`expected "typeof a", got: ${js}`);
  if (run(src, 't') !== 'string') throw new Error('typeof runtime failed');
});

test('void compiles as an operand-expression', () => {
  const src = [
    'remember a as 10',
    'let v is void a',
  ].join('\n');
  const js = compile(src);
  if (!js.includes('let v = void a;')) throw new Error(`expected "void a", got: ${js}`);
  if (run(src, 'v') !== undefined) throw new Error('void runtime failed');
});

// NOTE: separate JS-style `delete` is intentionally absent — `delete` is the
// HTTP verb keyword (e.g. `delete http://...`), so the remove() helper and
// object reassignment cover property removal instead.

// ── 6. Collection runtime dispatch fixes ───────────────────────────────────

test('remove dispatches Map/Set to delete, Array to splice', () => {
  const js = compile('remove(player from players)');
  if (!js.includes('players instanceof Map || players instanceof Set ? players.delete(player) : players.splice(players.indexOf(player), 1)')) {
    throw new Error('remove dispatch not emitted');
  }
});

test('remove runtime: Set uses delete', () => {
  const src = [
    'remember s as set with 1, 2, 3 done',
    'remove(2 from s)',
  ].join('\n');
  const r = run(src, 'JSON.stringify(Array.from(s).sort())');
  if (r !== JSON.stringify([1, 3])) throw new Error(`expected [1,3], got ${r}`);
});

test('remove runtime: Map uses delete by key', () => {
  const src = [
    'remember m as dictionary with "a" is 1 and "b" is 2 done',
    'remove("a" from m)',
  ].join('\n');
  const r = run(src, 'JSON.stringify(Array.from(m.keys()))');
  if (r !== JSON.stringify(['b'])) throw new Error(`expected ["b"], got ${r}`);
});

test('contains on a Set uses has', () => {
  const js = compile('if team contains player show "in" done');
  if (!js.includes('team instanceof Set ? team.has(player)')) throw new Error('Set contains did not use has');
  const src = [
    'remember s as set with 10, 20 done',
    'remember c as s contains 10',
  ].join('\n');
  if (run(src, 'c') !== true) throw new Error('Set contains runtime failed');
});

test('keys/values dispatch object vs Map/Set', () => {
  const src = [
    'remember o as { a: 1, b: 2 }',
    'remember m as dictionary with "x" is 9 done',
    'remember ko as keys of o',
    'remember km as keys of m',
  ].join('\n');
  const r = run(src, 'JSON.stringify({ ko, km })');
  if (r !== JSON.stringify({ ko: ['a', 'b'], km: ['x'] })) throw new Error('keys/values dispatch failed');
});

test('is empty on Map, object, and array', () => {
  const src = [
    'remember em as empty map',
    'remember eo as {}',
    'remember ea as []',
    'let ce is em is empty',
    'let oe is eo is empty',
    'let ae is ea is empty',
  ].join('\n');
  const r = run(src, 'JSON.stringify({ ce, oe, ae })');
  if (r !== JSON.stringify({ ce: true, oe: true, ae: true })) throw new Error('is empty dispatch failed');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);