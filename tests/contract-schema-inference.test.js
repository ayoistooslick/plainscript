'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runSource } = require('./helpers');

const source = `import { object, text, number, array, optional, parse } from "std/contract"
import { print } from "std/io"
let userSchema = object({
    name: text(),
    age: number(),
    tags: array(text()),
    profile: object({ nickname: optional(text()) }),
})
let user = parse(userSchema, { name: "Ada", age: 37, tags: ["math"], profile: {} })
print("{user.name}:{user.age}:{user.tags[0]}")
`;

test('contract object schema derives nested record, array and primitive fields without a model annotation', () => {
  const result = runSource(source);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Ada:37:math\n');
});

test('contract object schema preserves optional nested fields and rejects unknown inferred fields', () => {
  const optionalRead = runSource(source.replace('print("{user.name}:{user.age}:{user.tags[0]}")', `if user.profile.nickname is text
    print(user.profile.nickname)
end`));
  assert.equal(optionalRead.status, 0, optionalRead.stderr);
  const unknownField = runSource(source.replace('print("{user.name}:{user.age}:{user.tags[0]}")', 'print(user.notAField)'));
  assert.ok(unknownField.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3333'));
});

test('inferred schemas type a backend operation and frontend client without parallel model types', () => {
  const project = runSource(`import { object, text, number, operation, implement, createClient } from "std/contract"
import { print } from "std/io"
let input = object({ id: number() })
let output = object({ title: text() })
let spec = operation("tasks.get", input, output)
let endpoint = implement(spec, async (request) => ({ title: "task-{request.id}" }))
let client = createClient(spec, async (name: text, request: any) => await endpoint(request))
let result = await client({ id: 9 })
print(result.title)
`);
  assert.equal(project.status, 0, project.stderr);
  assert.equal(project.stdout, 'task-9\n');

  const mismatch = runSource(`import { object, text, number, operation, createClient } from "std/contract"
let input = object({ id: number() })
let output = object({ title: text() })
let spec = operation("tasks.get", input, output)
let client = createClient(spec, async (name: text, request: any) => ({ title: "ok" }))
let result = await client({ id: "wrong" })
`);
  assert.ok(mismatch.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3343'),
    'schema-derived operation input must reject a text id');
});

test('inferred operation schema rejects an incompatible unannotated backend handler output', () => {
  const result = runSource(`import { object, text, number, operation, implement } from "std/contract"
let input = object({ id: number() })
let output = object({ title: text() })
let spec = operation("tasks.get", input, output)
let endpoint = implement(spec, async (request) => ({ title: 42 }))
`);
  assert.ok(result.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3343' || diagnostic.code === 'PS3404'),
    `expected inferred handler output mismatch, got ${result.compiler.diagnostics.map((item) => item.code).join(', ')}`);
});
