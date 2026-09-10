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
const asyncTests = [];

function test(name, fn) {
  try {
    // Async test callbacks (async lambdas, top-level await) resolve later;
    // they are tracked so the summary waits for them before printing.
    const result = fn();
    if (result && typeof result.then === 'function') {
      asyncTests.push(
        result
          .then(() => { console.log(`  PASS  ${name}`); passed++; })
          .catch((err) => { console.error(`  FAIL  ${name}`); console.error(`        ${err.message}`); failed++; })
      );
      return;
    }
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

// ── 2. Block-bodied lambdas: (params) do ... done ───────────────────────────

console.log('\n── Language Kernel: Block-Bodied Lambdas & Expression Booleans ──\n');

// Unlike the sync run(): wraps the whole generated program in an async arrow
// so a top-level `await` (which the CLI runtime supports) is legal here too.
function runAsync(src, ret) {
  const js = compile(src);
  return new Function(`return (async () => {\n${js}\nreturn ${ret};\n})();`)();
}

test('single-expression lambda form is unchanged', () => {
  const js = compile('remember d as (x) -> x * 2');
  if (js.indexOf('=> x * 2') === -1) throw new Error('expression lambda changed');
});

test('single-expression and block lambda forms coexist', () => {
  const js = compile('remember f as (x) -> x + 1\nremember g as (x) do\n  give x * 2\ndone');
  if (js.indexOf('=> x + 1') === -1) throw new Error('expression lambda missing');
  if (js.indexOf('=> {\n') === -1) throw new Error('block lambda missing');
});

test('multi-statement block lambda runs', () => {
  const src = [
    'remember f as (x) do',
    '  remember doubled as x * 2',
    '  show doubled',
    '  give doubled + 1',
    'done',
    'remember r as f(5)',
  ].join('\n');
  if (run(src, 'r') !== 11) throw new Error('expected 11');
});

test('block lambda with zero params', () => {
  const src = [
    'remember produce as () do',
    '  give 42',
    'done',
    'remember r as produce()',
  ].join('\n');
  if (run(src, 'r') !== 42) throw new Error('expected 42');
});

test('block lambda with nested conditionals', () => {
  const src = [
    'remember grade as (n) do',
    '  if n is above 90',
    '    give "A"',
    '  otherwise',
    '    if n is above 80',
    '      give "B"',
    '    otherwise',
    '      give "C"',
    '    done',
    '  done',
    'done',
    'remember g1 as grade(95)',
    'remember g2 as grade(85)',
    'remember g3 as grade(60)',
  ].join('\n');
  const r = run(src, '[g1, g2, g3].join("")');
  if (r !== 'ABC') throw new Error('nested conditionals failed: ' + r);
});

test('loop inside block lambda accumulates', () => {
  const src = [
    'remember sumOf as (xs) do',
    '  remember sum as 0',
    '  for each x in xs',
    '    sum becomes sum + x',
    '  done',
    '  give sum',
    'done',
    'remember s as sumOf([1, 2, 3, 4])',
  ].join('\n');
  if (run(src, 's') !== 10) throw new Error('expected 10');
});

test('early return inside block lambda', () => {
  const src = [
    'remember firstEven as (xs) do',
    '  for each x in xs',
    '    if x % 2 is 0',
    '      give x',
    '    done',
    '  done',
    '  give "none"',
    'done',
    'remember hit as firstEven([1, 3, 4, 7])',
    'remember miss as firstEven([1, 3, 5])',
  ].join('\n');
  if (run(src, 'hit + ":" + miss') !== '4:none') throw new Error('early return failed');
});

test('block lambdas close over and mutate shared state', () => {
  const src = [
    'remember makeCounter as (seed) do',
    '  remember count as seed',
    '  give () do',
    '    count becomes count + 1',
    '    give count',
    '  done',
    'done',
    'remember c as makeCounter(10)',
    'remember first as c()',
    'remember second as c()',
    'remember isolated as makeCounter(5)',
    'remember other as isolated()',
  ].join('\n');
  const r = run(src, '[first, second, other].join(",")');
  if (r !== '11,12,6') throw new Error('closure failed: ' + r);
});

test('block lambda passed to .map', () => {
  const src = [
    'remember nums as [1, 2, 3, 4]',
    'remember doubled as nums.map((x) do',
    '  remember e as x * 2',
    '  give e',
    'done)',
    'remember nums2 as nums.map((x) -> x + 100)',
  ].join('\n');
  const r = run(src, 'JSON.stringify({ a: doubled, b: nums2 })');
  if (r !== JSON.stringify({ a: [2, 4, 6, 8], b: [101, 102, 103, 104] })) throw new Error('map block lambda failed: ' + r);
});

test('block lambda passed to .filter', () => {
  const src = [
    'remember nums as [1, 2, 3, 4, 5]',
    'remember evens as nums.filter((x) do',
    '  give x % 2 is 0',
    'done)',
  ].join('\n');
  if (run(src, 'JSON.stringify(evens)') !== '[2,4]') throw new Error('filter failed');
});

test('block lambda passed to .find returns first match', () => {
  const src = [
    'remember nums as [1, 2, 3, 4]',
    'remember r as nums.find((x) do',
    '  give x is above 2',
    'done)',
  ].join('\n');
  if (run(src, 'r') !== 3) throw new Error('find failed');
});

test('block lambda passed to .forEach receives both args', () => {
  const src = [
    'remember keys as []',
    'remember values as []',
    'remember m as dictionary with "a" is 1 and "b" is 2',
    'm.forEach((value, key) do',
    '  keys.push(key)',
    '  values.push(value)',
    'done)',
    'remember sortedK as keys.sort().join("")',
    'remember sortedV as values.sort().join("")',
  ].join('\n');
  if (run(src, 'sortedK + ":" + sortedV') !== 'ab:12') throw new Error('forEach failed');
});

test('block lambda returned from a factory function', () => {
  const src = [
    'remember makeAdder as (n) do',
    '  give (x) -> x + n',
    'done',
    'remember plus5 as makeAdder(5)',
    'remember r as plus5(37)',
  ].join('\n');
  if (run(src, 'r') !== 42) throw new Error('factory failed');
});

test('chained arrow returns a block lambda', () => {
  const src = [
    'remember mul as (a) -> (b) do',
    '  give a * b',
    'done',
    'remember applied as mul(6)',
    'remember r as applied(7)',
  ].join('\n');
  if (run(src, 'r') !== 42) throw new Error('chained arrow->block failed');
});

test('block and expression lambdas stored in a list', () => {
  const src = [
    'remember fs as list with (x) -> x + 1, (y) do',
    '  give y * 2',
    'done',
    'remember f0 as fs[0]',
    'remember f1 as fs[1]',
    'remember r1 as f0(1)',
    'remember r2 as f1(10)',
  ].join('\n');
  if (run(src, 'JSON.stringify([r1, r2])') !== '[2,20]') throw new Error('stored lambdas failed');
});

test('try/recover inside a block lambda', () => {
  const src = [
    'remember safeDiv as (a, b) do',
    '  try',
    '    if b is 0',
    '      raise "div by zero"',
    '    done',
    '    give a / b',
    '  done',
    '  recover as e',
    '    give 0',
    '  done',
    'done',
    'remember normal as safeDiv(10, 2)',
    'remember bad as safeDiv(1, 0)',
  ].join('\n');
  if (run(src, 'JSON.stringify([normal, bad])') !== '[5,0]') throw new Error('recover inside lambda failed');
});

test('async block lambda emits async and awaits', () => {
  const js = compile([
    'remember get as (id) do',
    '  remember val as await fetch(id)',
    '  give val + 1',
    'done',
  ].join('\n'));
  if (js.indexOf('async (id) => {') === -1) throw new Error('async marker missing:\n' + js);
  if (js.indexOf('(await fetch(id))') === -1) throw new Error('await missing:\n' + js);
});

test('async block lambda runs via top-level await', async () => {
  const src = [
    'make fetch(id)',
    '  give Promise.resolve(id * 2)',
    'done',
    'remember get as (id) do',
    '  remember val as await fetch(id)',
    '  give val + 1',
    'done',
    'remember ans as await get(21)',
  ].join('\n');
  const v = await runAsync(src, 'ans');
  if (v !== 43) throw new Error('expected 43, got ' + v);
});

test('block lambda body may contain side effects via show', () => {
  const js = compile('remember f as (x) do\n  show x\n  give x\ndone');
  if (js.indexOf('console.log(x);') === -1) throw new Error('side effect missing:\n' + js);
});

test('block lambda errors without closing done', () => {
  const src = 'remember f as (x) do\n  give x';
  let threw = false;
  try {
    compile(src);
  } catch (e) {
    threw = e.message.indexOf('done') !== -1;
  }
  if (!threw) throw new Error('expected a teaching "done" error');
});

// ── 3. Expression-level boolean operators: and / or / not as values ─────────

console.log('\n── Expression-Level Boolean Operators ──\n');

test('and as a value', () => {
  const src = [
    'remember n as 7',
    'let ok is n is above 3 and n is below 10',
  ].join('\n');
  if (run(src, 'JSON.stringify(ok)') !== 'true') throw new Error('and value failed');
});

test('or as a value', () => {
  const src = [
    'remember n as 1',
    'let ok is n is above 3 or n is below 10',
  ].join('\n');
  if (run(src, 'JSON.stringify(ok)') !== 'true') throw new Error('or value failed');
});

test('not as a value', () => {
  const src = [
    'remember xs as []',
    'let ok is not (xs is empty)',
  ].join('\n');
  if (run(src, 'JSON.stringify(ok)') !== 'false') throw new Error('not value failed');
});

test('and binds tighter than or', () => {
  const src = [
    'remember n as 5',
    'let r is n is above 3 or n is below 10 and n is above 1',
  ].join('\n');
  if (run(src, 'JSON.stringify(r)') !== 'true') throw new Error('precedence failed');
});

test('parenthesized boolean groups', () => {
  const src = [
    'remember a as 4',
    'remember b as 8',
    'let ok is (a is above 3) and (b is below 10)',
  ].join('\n');
  if (run(src, 'JSON.stringify(ok)') !== 'true') throw new Error('group failed');
});

test('boolean expression as a function argument', () => {
  const src = [
    'remember classify as (ok) do',
    '  if ok is true',
    '    give "yes"',
    '  otherwise',
    '    give "no"',
    '  done',
    'done',
    'remember n as 7',
    'remember r as classify(n is above 3 and n is below 10)',
  ].join('\n');
  if (run(src, 'r') !== 'yes') throw new Error('boolean arg failed');
});

test('boolean expression inside an expression-lambda body (give)', () => {
  const src = [
    'remember f as (n) -> n is above 3 and n is below 10',
    'remember r as f(5)',
  ].join('\n');
  if (run(src, 'JSON.stringify(r)') !== 'true') throw new Error('give-embedded boolean failed');
});

test('boolean expression inside a block-lambda give', () => {
  const src = [
    'remember f as (n) do',
    '  give n is above 3 and n is below 10',
    'done',
    'remember r as f(99)',
  ].join('\n');
  if (run(src, 'JSON.stringify(r)') !== 'false') throw new Error('block-give boolean failed');
});

test('boolean combined in a choosing value', () => {
  const src = [
    'remember n as 7',
    'remember r as choosing n is above 3 and n is below 10 then "in" otherwise "out"',
  ].join('\n');
  if (run(src, 'r') !== 'in') throw new Error('choosing boolean failed');
});

test('condition-level if/while still combine comparisons', () => {
  const src = [
    'remember hits as []',
    'for each n in [1, 5, 9, 15]',
    '  if n is above 3 and n is below 10',
    '    hits.push(n)',
    '  done',
    'done',
    'remember acc as 0',
    'while acc is below 5 and acc is at least 0',
    '  acc becomes acc + 3',
    'done',
  ].join('\n');
  const r = run(src, 'JSON.stringify({ h: hits, t: acc })');
  if (r !== JSON.stringify({ h: [5, 9], t: 6 })) throw new Error('condition-level and/or failed: ' + r);
});

test('boolean value combined with non-comparison operands', () => {
  const src = [
    'remember n as 1',
    'let r is n and 1',
    'remember s as n or 100',
  ].join('\n');
  const out = run(src, '[r, s].map(x => typeof x).join(",")');
  if (out !== 'number,number') throw new Error('literal boolean operands failed: ' + out);
});

test('and/or do not consume dictionary/set/record separators', () => {
  const js = compile([
    'remember d as dictionary with "a" is 1 and "b" is 2 done',
    'remember s as set with 1, 2 and 3 done',
    'remember r as record with name "Ada" and age 30 done',
    'remember t as tuple with 1, 2 and 3 done',
  ].join('\n'));
  if (js.indexOf('new Map([["a", 1], ["b", 2]])') === -1) throw new Error('dictionary separator broken:\n' + js);
  if (js.indexOf('new Set([1, 2, 3])') === -1) throw new Error('set separator broken:\n' + js);
  if (js.indexOf('{ "name": "Ada", "age": 30 }') === -1) throw new Error('record separator broken:\n' + js);
});

test('boolean value in an array literal element', () => {
  const src = [
    'remember a as 4',
    'remember xs as [1, (a is above 3) and (a is below 10), 3]',
  ].join('\n');
  if (run(src, 'JSON.stringify(xs)') !== '[1,true,3]') throw new Error('array boolean failed');
});

Promise.all(asyncTests).then(() => {
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
});