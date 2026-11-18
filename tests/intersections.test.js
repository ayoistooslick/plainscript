'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runSource, runProject } = require('./helpers');

test('record intersections merge fields and indexed access selects them', () => {
  const result = runProject({
    'main.pln': `import { print } from "std/io"

type Named
    name: text
end

type Aged
    age: number
end

type Person = Named & Aged
type Name = Person["name"]
type Age = Person["age"]
type Pair = [number, text]
type First = Pair[0]

let person: Person = { name: "Ada", age: 36 }
let name: Name = person.name
let age: Age = person.age
let pair: Pair = [7, "seven"]
let first: First = pair[0]
print("{name}:{age}:{first}")
`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Ada:36:7\n');
});

test('intersections require every field and indexed access rejects an unknown field', () => {
  const missing = runSource(`type Named
    name: text
end
type Aged
    age: number
end
type Person = Named & Aged
let person: Person = { name: "Ada" }
`);
  assert.equal(missing.status, 1);
  assert.ok(missing.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3311'));

  const unknown = runSource(`type Named
    name: text
end
type Name = Named["email"]
`);
  assert.equal(unknown.status, 1);
  assert.ok(unknown.compiler.diagnostics.some((diagnostic) =>
    diagnostic.code === 'PS3207' && /no field "email"/.test(diagnostic.message)));

  const primitive = runSource('type Bad = text & number\n');
  assert.equal(primitive.status, 1);
  assert.ok(primitive.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3208'));
});
