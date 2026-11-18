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
