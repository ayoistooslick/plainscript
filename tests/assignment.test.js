// Tests for assignment: compound operators, set/change aliases, `end` blocks,
// property-of assignment inside for-each, and `count of`.

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

function assert(actual, expected) {
  const a = actual.trim();
  const e = expected.trim();
  if (a !== e) {
    throw new Error(`Expected:\n        ${e}\n        Got:\n        ${a}`);
  }
}

function assertContains(actual, expectedSubstr) {
  if (!actual.includes(expectedSubstr)) {
    throw new Error(`Expected output to include "${expectedSubstr}" but got:\n        ${actual}`);
  }
}

function assertThrows(fn, expectedSubstr) {
  try {
    fn();
    throw new Error('Expected an error but none was thrown');
  } catch (e) {
    if (!e.message.includes(expectedSubstr)) {
      throw new Error(`Expected error to include "${expectedSubstr}" but got: ${e.message}`);
    }
  }
}

function compile(source) {
  return generate(parse(tokenize(source)));
}

// Run compiled JS and return the value of `expr` (referencing program vars).
function runWith(js, expr) {
  const fn = new Function(js + `\nreturn ${expr};`);
  return fn();
}

// Run compiled JS capturing every console.log line; returns the lines.
function runShow(js) {
  const captured = [];
  new Function('console', js)({ log: (...args) => captured.push(args.join(' ')) });
  return captured;
}

console.log('\n── Compound assignment operators ──\n');

test('`score += 2` compiles to JS `score += 2`', () => {
  assert(compile('let score be 5\nscore += 2'), 'let score = 5;\nscore += 2;');
});

test('`score += 2` runs to 7', () => {
  const js = compile('let score be 5\nscore += 2');
  assert(String(runWith(js, 'score')), '7');
});

test('`score -= 1` compiles and runs', () => {
  const js = compile('let score be 5\nscore -= 1');
  assertContains(js, 'score -= 1;');
  assert(String(runWith(js, 'score')), '4');
});

test('`score *= 3` compiles and runs', () => {
  const js = compile('let score be 5\nscore *= 3');
  assertContains(js, 'score *= 3;');
  assert(String(runWith(js, 'score')), '15');
});

test('`score /= 2` compiles and runs', () => {
  const js = compile('let score be 5\nscore /= 2');
  assertContains(js, 'score /= 2;');
  assert(String(runWith(js, 'score')), '2.5');
});

test('`score %= 4` compiles and runs', () => {
  const js = compile('let score be 5\nscore %= 4');
  assertContains(js, 'score %= 4;');
  assert(String(runWith(js, 'score')), '1');
});

test('legacy `score ++= 1` still works identically to `+=`', () => {
  const js = compile('let score be 5\nscore ++= 1');
  const modern = compile('let score be 5\nscore += 1');
  assert(js, modern);
  assert(String(runWith(js, 'score')), '6');
});

test('compound assignment on an index target `arr[0] += 5`', () => {
  const js = compile('remember arr as [10, 20]\narr[0] += 5');
  assertContains(js, 'arr[0] += 5;');
  assert(String(runWith(js, 'arr[0]')), '15');
});

test('compound assignment on a property path `name of user += "x"`', () => {
  const js = compile('remember user as { name: "ada" }\nname of user += "x"');
  assertContains(js, 'user.name += "x";');
  assert(String(runWith(js, 'user.name')), 'adax');
});

test('word form `x or becomes 5` compiles to `||=` semantics and runs', () => {
  const js = compile('let x be 0\nx or becomes 5');
  assertContains(js, 'x || (x = 5);');
  assert(String(runWith(js, 'x')), '5');
});

test('word form `x and becomes 5` compiles to `&&=` semantics and runs', () => {
  const js = compile('let x be 1\nx and becomes 5');
  assertContains(js, 'x && (x = 5);');
  assert(String(runWith(js, 'x')), '5');
});

test('word form `x nullish becomes 5` compiles to `??=` semantics and runs', () => {
  const js = compile('let x be null\nx nullish becomes 5');
  assertContains(js, 'x ?? (x = 5);');
  assert(String(runWith(js, 'x')), '5');
});

console.log('\n── `set` / `change` assignment aliases ──\n');

test('prefix `set age to 17` compiles to an assignment and runs', () => {
  const js = compile('remember age as 10\nset age to 17');
  assertContains(js, 'age = 17;');
  assert(String(runWith(js, 'age')), '17');
});

test('prefix `change age to 17` compiles to an assignment and runs', () => {
  const js = compile('remember age as 10\nchange age to 17');
  assertContains(js, 'age = 17;');
  assert(String(runWith(js, 'age')), '17');
});

test('postfix `age set to 20` compiles to an assignment and runs', () => {
  const js = compile('remember age as 10\nage set to 20');
  assertContains(js, 'age = 20;');
  assert(String(runWith(js, 'age')), '20');
});

test('postfix `name change to "Ada Lovelace"` matches `becomes`', () => {
  const alias = compile('remember name as "bob"\nname change to "Ada Lovelace"');
  const becomes = compile('remember name as "bob"\nname becomes "Ada Lovelace"');
  assert(alias, becomes);
  assert(String(runWith(alias, 'name')), 'Ada Lovelace');
});

test('`set arr[0] to "hi"` targets an index and runs', () => {
  const js = compile('remember arr as ["a", "b"]\nset arr[0] to "hi"');
  assertContains(js, 'arr[0] = "hi";');
  assert(String(runWith(js, 'JSON.stringify(arr)')), '["hi","b"]');
});

test('`set cookie ... expires in ...` compiles without erroring inside a route handler', () => {
  const js = compile('route get "/"\n  set cookie "theme" to "dark" expires in 7 days\n  reply "ok"\ndone');
  assertContains(js, 'res.cookie("theme", "dark"');
  assertContains(js, '604800000');
});

test('a missing "to" produces a useful error mentioning `Expected "to"`', () => {
  assertThrows(() => compile('set age 17'), 'Expected "to"');
  assertThrows(() => compile('change age 17'), 'Expected "to"');
});

console.log('\n── `end` as a synonym for `done` ──\n');

test('`if` closed with `end` compiles to the same JS as `done`', () => {
  const a = compile('let x be 1\nif x is 1\n  show "yes"\nend');
  const b = compile('let x be 1\nif x is 1\n  show "yes"\ndone');
  assert(a, b);
  const out = runShow(a);
  assert(out.join('\n'), 'yes');
});

test('`make f() ... end` compiles like `done` and the function runs', () => {
  const a = compile('make f()\n  give 5\nend');
  const b = compile('make f()\n  give 5\ndone');
  assert(a, b);
  assert(String(runWith(a, 'f()')), '5');
});

test('`for each ... end` compiles like `done` and runs', () => {
  const a = compile('remember xs as [1, 2, 3]\nremember sum as 0\nfor each x in xs\n  sum += x\nend');
  const b = compile('remember xs as [1, 2, 3]\nremember sum as 0\nfor each x in xs\n  sum += x\ndone');
  assert(a, b);
  assert(String(runWith(a, 'sum')), '6');
});

test('`while ... end` compiles like `done` and runs', () => {
  const a = compile('let i be 0\nwhile i is below 3\n  i += 1\nend');
  const b = compile('let i be 0\nwhile i is below 3\n  i += 1\ndone');
  assert(a, b);
  assert(String(runWith(a, 'i')), '3');
});

test('`query` SQL block terminated by `end` compiles to db.prepare().all()', () => {
  assert(compile('query\n  SELECT 1\nend'), 'db.prepare(`  SELECT 1`).all();');
});

console.log('\n── Property-of assignment inside `for each` ──\n');

test('`x of todo becomes 2` inside a loop compiles to `todo.x = 2;` and mutates', () => {
  const js = compile([
    'remember todos as [{ x: 1 }]',
    'for each todo in todos',
    '  x of todo becomes 2',
    'done',
  ].join('\n'));
  assertContains(js, 'todo.x = 2;');
  assert(String(runWith(js, 'JSON.stringify(todos[0])')), '{"x":2}');
});

test('numbered-item teaching error still fires for `show player banana from players`', () => {
  assertThrows(
    () => compile('show player banana from players'),
    'Expected a number word after "player" before "from"'
  );
});

console.log('\n── `count of` ──\n');

test('`show count of [1,2,3]` prints 3 at runtime', () => {
  const out = runShow(compile('show count of [1,2,3]'));
  assert(out.join('\n'), '3');
});

test('`show count of "hello"` prints 5 at runtime', () => {
  const out = runShow(compile('show count of "hello"'));
  assert(out.join('\n'), '5');
});

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}