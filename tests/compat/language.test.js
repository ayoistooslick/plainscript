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

test('conditionals: and/or/not combine comparisons', () => {
  const out = run(`
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

const { summary } = require('./_util');
summary();
