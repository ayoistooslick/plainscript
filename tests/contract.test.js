'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runSource } = require('./helpers');
let contract;
test('load contract runtime', async () => {
  contract = await import('../stdlib/contract.js');
});

test('contract schemas validate primitives, constraints, arrays and nested object paths', () => {
  const user = contract.object({
    name: contract.text({ minLength: 2 }),
    age: contract.number({ min: 0 }),
    nickname: contract.optional(contract.text()),
    tags: contract.array(contract.text()),
  }, { unknownKeys: 'strict' });
  assert.deepEqual(contract.parse(user, { name: 'Ada', age: 37, tags: ['math'] }), { name: 'Ada', age: 37, tags: ['math'] });
  assert.throws(() => contract.parse(user, { name: 'A', age: 37, tags: ['math'] }), (error) => error instanceof contract.ContractError && error.path === 'value.name');
  assert.throws(() => contract.parse(user, { name: 'Ada', age: 37, tags: [2] }), (error) => error.path === 'value.tags[0]');
  assert.throws(() => contract.parse(user, { name: 'Ada', age: 37, tags: [], admin: true }), (error) => error.path === 'value.admin');
});

test('safeParse returns structured failures and enum schemas reject invalid values', () => {
  const status = contract.enumeration(['open', 'closed']);
  const valid = contract.safeParse(status, 'open');
  assert.equal(valid.success, true);
  assert.equal(valid.data, 'open');
  const invalid = contract.safeParse(status, 'pending');
  assert.equal(invalid.success, false);
  assert.equal(invalid.error.path, 'value');
});

test('PlainScript can import and use runtime contract validators', () => {
  const result = runSource(`import { object, text, number, parse } from "std/contract"
import { print } from "std/io"
type User
    name: text
    age: number
end
let userSchema = object({ name: text(), age: number({ min: 0 }) }, { unknownKeys: "strict" })
let user: User = parse(userSchema, { name: "Ada", age: 37 })
print("{user.name}:{user.age}")
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Ada:37\n');
});

test('operations validate both sides, run authorization and expose a typed transport client', async () => {
  const input = contract.object({ id: contract.number({ min: 1 }) }, { unknownKeys: 'strict' });
  const output = contract.object({ title: contract.text({ minLength: 1 }) }, { unknownKeys: 'strict' });
  const getTask = contract.operation('tasks.get', input, output);
  const endpoint = contract.implement(getTask, async ({ id }) => ({ title: `task-${id}` }), {
    authorize: async (context) => Boolean(context && context.userId),
  });
  assert.deepEqual(await endpoint({ id: 7 }, { userId: 'u1' }), { title: 'task-7' });
  await assert.rejects(endpoint({ id: 0 }, { userId: 'u1' }), (error) => error.stage === 'input validation');
  await assert.rejects(endpoint({ id: 7 }, {}), (error) => error.stage === 'authorization');
  const client = contract.createClient(getTask, async (name, value) => {
    assert.equal(name, 'tasks.get');
    assert.deepEqual(value, { id: 8 });
    return { title: 'task-8' };
  });
  assert.deepEqual(await client({ id: 8 }), { title: 'task-8' });
  const unsafeClient = contract.createClient(getTask, async () => ({ title: 2 }));
  await assert.rejects(unsafeClient({ id: 8 }), (error) => error.stage === 'client output validation');
});

test('PlainScript enforces imported generic operation input/output types end to end', () => {
  const valid = runSource(`import { object, text, number, operation, implement, createClient, Schema } from "std/contract"
import { print } from "std/io"
type Input
    id: number
end
type Output
    title: text
end
let inputSchema: Schema<Input> = object({ id: number() })
let outputSchema: Schema<Output> = object({ title: text() })
let getTask = operation("tasks.get", inputSchema, outputSchema)
async function lookup(input: Input) -> Output
    return { title: "task-{input.id}" }
end
let endpoint = implement(getTask, lookup)
let client = createClient(getTask, async (name: text, input: any) => do
    return await endpoint(input)
end)
let result = await client({ id: 4 })
print(result.title)
`);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout, 'task-4\n');

  const invalid = runSource(`import { object, text, number, operation, createClient, Schema } from "std/contract"
type Input
    id: number
end
type Output
    title: text
end
let inputSchema: Schema<Input> = object({ id: number() })
let outputSchema: Schema<Output> = object({ title: text() })
let spec = operation("tasks.get", inputSchema, outputSchema)
let client = createClient(spec, async (name: text, input: any) => do
    return { title: "ok" }
end)
let response = await client({ id: "wrong" })
`);
  assert.ok(invalid.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3343'),
    'a text input must not satisfy an operation requiring a numeric id');
});
