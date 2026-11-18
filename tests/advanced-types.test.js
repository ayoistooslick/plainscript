'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runSource, runProject } = require('./helpers');

test('tuples, keyof queries and typeof function queries are checked and run', () => {
  const result = runProject({
    'main.pln': `import { print } from "std/io"

type User
    name: text
    age: number
end

type UserKey = keyof User
let key: UserKey = "name"
print(key)
let pair: [number, text] = [1, "one"]
print("{pair[0]}:{pair[1]}")
let (count, label): [number, text] = [2, "two"]
print("{count}:{label}")

function greet(name: text) -> text
    return "Hello, {name}"
end
type Greet = typeof greet
let greeting: Greet = greet
print(greeting("Ada"))
`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'name\n1:one\n2:two\nHello, Ada\n');
});

test('tuple length and keyof unions reject invalid assignments', () => {
  const result = runSource(`type User
    name: text
    age: number
end
type UserKey = keyof User
let key: UserKey = "email"
let pair: [number, text] = [1, 2]
`);
  assert.equal(result.status, 1);
  assert.ok(result.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3311'));
  assert.ok(result.compiler.diagnostics.some((diagnostic) => /\[number, text\]/.test(diagnostic.message)));
});

test('tuple indexes are precise and out-of-range indexes are rejected', () => {
  const result = runSource(`let pair: [number, text] = [1, "one"]
let value = pair[2]
`);
  assert.equal(result.status, 1);
  assert.ok(result.compiler.diagnostics.some((diagnostic) => /out of range/.test(diagnostic.message)));
});
