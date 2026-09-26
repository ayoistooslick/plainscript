// PlainScript  -  language core capability suite.
//
// Verifies variables, functions, control flow (for each, for index, while,
// break, continue), object/array literals, and property access by compiling and
// RUNNING snippets, then asserting on runtime output.

const { test, assert, run } = require('./_util');

test('variables: remember/becomes read/reassign an identifier', () => {
  const out = run(`
remember name as "Ada"
show name
name becomes "Grace"
show name
`);
  assert(out.includes('Ada') && out.includes('Grace'), `expected both values, got:\n${out}`);
});

test('functions: make/give returns a value, calls accept args', () => {
  const out = run(`
make add(a, b)
    give a + b
done
show(add(2, 3))
show(multiply(4, 5))
make multiply(x, y)
    give x * y
done
`);
  assert(out.includes('5') && out.includes('20'), `expected 5 and 20, got:\n${out}`);
});

test('for index: counts from start to end inclusive', () => {
  const out = run(`
for index i from 1 to 4
    show i
done
`);
  for (const n of [1, 2, 3, 4]) {
    assert(out.includes(`\n${n}`) || out.includes(`${n}`), `expected ${n} in output:\n${out}`);
  }
});

test('for index: descends when start is above end', () => {
  const out = run(`
for index i from 3 to 1
    show i
done
`);
  assert(out.split('\n').map(l => l.trim()).join(',') === '3,2,1',
    `expected 3,2,1 got:\n${out}`);
});

test('for index: step via "by" changes the increment', () => {
  const out = run(`
for index i from 0 to 8 by 2
    show i
done
`);
  for (const n of [0, 2, 4, 6, 8]) {
    assert(out.includes(`${n}`), `expected ${n} in output:\n${out}`);
  }
});

test('for each: iterates collection elements', () => {
  const out = run(`
for each fruit in ["apple", "banana", "cherry"]
    show fruit
done
`);
  for (const f of ['apple', 'banana', 'cherry']) {
    assert(out.includes(f), `expected ${f} in output:\n${out}`);
  }
});

test('break: stops the loop immediately', () => {
  const out = run(`
for each n in [1, 2, 3, 4, 5]
    if n is 3
        break
    done
    show n
done
`);
  assert(out.includes('1') && out.includes('2'), `expected 1 and 2:\n${out}`);
  assert(!out.includes('4') && !out.includes('5'), `break leaked tail:\n${out}`);
});

test('continue: skips the current iteration', () => {
  const out = run(`
for each n in [1, 2, 3, 4, 5]
    if n is 3
        continue
    done
    show n
done
`);
  assert(out.includes('1') && out.includes('5'), `expected 1..5-ish:\n${out}`);
  assert(!out.includes('\n3'), `continue did not skip 3:\n${out}`);
});

test('while: loops until the condition fails', () => {
  const out = run(`
remember count as 0
while count is below 3
    count becomes count + 1
done
show count
`);
  assert(out.includes('3'), `expected count 3, got:\n${out}`);
});

test('objects: inline literal properties are readable and writable', () => {
  const out = run(`
remember user as { name: "Ada", age: 36 }
show(name of user)
show user.age
user.age becomes 37
show user.age
`);
  assert(out.includes('Ada') && out.includes('36') && out.includes('37'),
    `expected object round-trip:\n${out}`);
});

test('objects: multi-line literal uses "name is value"', () => {
  const out = run(`
remember point as
    x is 3
    y is 4
done
show x of point
show(point.y)
`);
  assert(out.includes('3') && out.includes('4'), `expected coords:\n${out}`);
});

test('arrays: literal, index access, and length', () => {
  const out = run(`
remember nums as [10, 20, 30]
show nums[1]
show length(nums)
`);
  assert(out.includes('20') && out.includes('3'), `expected index+length:\n${out}`);
});

test('records: done/total/keyword field names and special-form args', () => {
  const out = run(`
remember tasks as []
add(record with text "milk" and done true to tasks)
add(record with text "bread" and done false to tasks)
show length(tasks)
for each t in tasks
    show "[" + (choosing t.done then "x" otherwise " ") + "] " + text of t
end
remember rec as record with total 25 and names "abc" and status 200 and done false
show rec.total
show rec.status
show jsonEncode(rec)
remember quoted as record with "first name" "Ada"
show quoted["first name"]
let after be "next-statement"
show after
`);
  assert(out.includes('2') && out.includes('[x] milk') && out.includes('[ ] bread') &&
    out.includes('25') && out.includes('200') && out.includes('Ada') &&
    out.includes('next-statement') && out.includes('"done":false'),
    `expected record forms:\n${out}`);
});

test('records: ambiguous keywords never swallow following statements', () => {
  const out = run(`
remember r as record with a 1
show "line after record"
let s be record with b 2 done
show "ok"
show r.a
`);
  assert(out.includes('line after record') && out.includes('ok') && out.includes('1'),
    `expected no swallowing:\n${out}`);
});

test('strings: concatenation and template literals', () => {
  const out = run(`
remember who as "Ada"
show "hello " + who
show \`hi \${who}!\`
`);
  assert(out.includes('hello Ada') && out.includes('hi Ada!'), `expected strings:\n${out}`);
});

test('conditionals: if/otherwise branch on comparisons', () => {
  const out = run(`
remember age as 20
if age is at least 18
    show "adult"
otherwise
    show "minor"
done
`);
  assert(out.includes('adult'), `expected adult:\n${out}`);
});

test('conditionals: else and else-if are aliases for otherwise', () => {
  const out = run(`
if 1 is 2
    show "no"
else
    show "else-ok"
end
let x be 5
if x is 6
    show "six"
else if x is 5
    show "elseif-ok"
else
    show "neither"
end
show choosing 1 is 2 then "no" else "choosing-else-ok"
switch x against
    1 -> show "one"
    else -> show "switch-else-ok"
end
`);
  assert(out.includes('else-ok') && out.includes('elseif-ok') &&
    out.includes('choosing-else-ok') && out.includes('switch-else-ok') &&
    !out.includes('neither'),
    `expected else forms:\n${out}`);
});

test('conditionals: and/or/not combine comparisons', () => {  const out = run(`
remember a as true
remember b as false
if a is true and b is false
    show "and-ok"
done
if a is true or b is true
    show "or-ok"
done
if b is false and a is true
    show "not-ok"
done
`);
  assert(out.includes('and-ok') && out.includes('or-ok') && out.includes('not-ok'),
    `expected logical branches:\n${out}`);
});

test('conditionals: bare boolean values are conditions (if flag)', () => {
  const out = run(`
remember ok as true
remember missing as false
if ok
    show "flag-ok"
done
if not ok
    show "never"
done
if not fileExists("no-such-file-xyz")
    show "not-exists-ok"
done
remember n as 3
while n
    show "while-" + n
    n becomes n - 1
done
repeat until missing
    show "until-ok"
    missing becomes true
done
remember verdict as choosing ok then "chose-ok" otherwise "no"
show verdict
`);
  assert(out.includes('flag-ok') && out.includes('not-exists-ok') &&
    out.includes('while-3') && out.includes('until-ok') && out.includes('chose-ok') &&
    !out.includes('never'),
    `expected bare-value condition branches:\n${out}`);
});

test('conditionals: bare booleans compose with and/or', () => {
  const out = run(`
remember a as true
remember b as false
if a and not b
    show "compose-ok"
done
if b or a
    show "or-flag-ok"
done
`);
  assert(out.includes('compose-ok') && out.includes('or-flag-ok'),
    `expected composed bare conditions:\n${out}`);
});

const { summary } = require('./_util');
summary();
