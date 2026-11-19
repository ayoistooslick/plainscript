'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runSource, runProject } = require('./helpers');

test('conditional types evaluate structural checks and preserve generic arguments', () => {
  const result = runProject({
    'main.pln': `import { print } from "std/io"

type Named
    name: text
end

type Person = { name: text, age: number }
type HasName<T> = T extends Named ? "yes" : "no"
type Label<T> = T extends text ? "word" : "other"

let a: HasName<Person> = "yes"
let b: HasName<number> = "no"
let c: Label<text> = "word"
print("{a}:{b}:{c}")
`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'yes:no:word\n');
});

test('mapped types derive records through keyof and deferred indexed access', () => {
  const result = runProject({
    'main.pln': `import { print } from "std/io"

type Person = { name: text, age: number }
type Copy<T> = { [K in keyof T]: T[K] }
type OptionalCopy<T> = { [K in keyof T]?: T[K] }
type First<T> = T[0]

let person: Copy<Person> = { name: "Ada", age: 36 }
let maybe: OptionalCopy<Person> = { name: "Grace" }
type Pair = [number, text]
let first: First<Pair> = 7
print("{person.name}:{person.age}:{maybe.name}:{first}")
`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Ada:36:Grace:7\n');
});

test('conditional and mapped types reject incompatible branches and missing fields', () => {
  const conditional = runSource(`type Named
    name: text
end
type HasName<T> = T extends Named ? "yes" : "no"
let wrong: HasName<number> = "yes"
`);
  assert.equal(conditional.status, 1);
  assert.ok(conditional.compiler.diagnostics.some((diagnostic) =>
    diagnostic.code === 'PS3311' && /"no"/.test(diagnostic.message)));

  const mapped = runSource(`type Person = { name: text, age: number }
type Copy<T> = { [K in keyof T]: T[K] }
let person: Copy<Person> = { name: "Ada" }
`);
  assert.equal(mapped.status, 1);
  assert.ok(mapped.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3311'));

  const index = runSource(`type First<T> = T[0]
type Pair = [number, text]
let value: First<Pair> = "not a number"
`);
  assert.equal(index.status, 1);
  assert.ok(index.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3311'));
});
