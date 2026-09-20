const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate, createGenerationContext, wrapAsync } = require('../compiler/generator');
const { checkTypes } = require('../compiler/type-checker');

function compile(source) {
  return generate(parse(tokenize(source)), createGenerationContext());
}
function run(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-types-'));
  const file = path.join(dir, 'program.js');
  const context = createGenerationContext();
  const js = generate(parse(tokenize(source)), context);
  fs.writeFileSync(file, context.needsAsync ? wrapAsync(js) : js);
  return spawnSync(process.execPath, [file], { encoding: 'utf8' });
}
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (error) { console.log(`  FAIL  ${name}`); throw error; }
}

console.log('Typed contracts');
test('type declarations compile to runtime schemas', () => {
  const js = compile(`type User
  id is number
  name is text
  active is boolean
 done`);
  assert(js.includes('__plainTypes["User"]'));
  assert(js.includes('"id"'));
  assert(js.includes('"name"'));
});

test('typed function parameters accept valid records', () => {
  const result = run(`type User
  id is number
  name is text
 done
make greet(user as User)
  give "Hello " + user.name
 done
show greet({ id: 1, name: "Ada" })`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout.trim(), 'Hello Ada');
});

test('typed parameters reject missing and invalid fields', () => {
  const result = run(`type User
  id is number
  name is text
 done
make greet(user as User)
  give user.name
 done
show greet({ id: "not a number", name: "Ada" })`);
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /greet\.user|declared type|type User/i);
});

test('contracts support unions, optional fields, lists, and dictionaries', () => {
  const result = run(`type Payload
  id is number or null
  label is optional text
  scores is list of number
  metadata is dictionary of text
 done
make read(payload as Payload)
  give payload.scores[0]
 done
show read({ id: null, scores: [7, 8], metadata: { source: "test" } })`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout.trim(), '7');
});

test('unknown type syntax fails with a teaching error', () => {
  assert.throws(() => compile(`type User
  id is mystery
 done`), /type name|declared type/i);
});

test('return contracts accept matching values and infer typed calls', () => {
  const result = checkTypes(parse(tokenize(`make add(a as number, b as number) returns number
  give a + b
 done
remember total as add(2, 3)`)));
  assert.deepStrictEqual(result.diagnostics, []);
});

test('return contracts reject mismatched and missing values', () => {
  const result = checkTypes(parse(tokenize(`make bad() returns number
  give "not a number"
 done
make missing() returns text
 done`)));
  assert(result.diagnostics.some(item => item.code === 'PLN-TYPE-RETURN' && /bad/.test(item.message)));
  assert(result.diagnostics.some(item => item.code === 'PLN-TYPE-RETURN-MISSING' && /missing/.test(item.message)));
});

test('typed let validates every record in a list and preserves its element type', () => {
  const result = checkTypes(parse(tokenize(`type User
  id is number
  name is text
 done
let users as list of User is [{ id: 1, name: "David" }, { id: "wrong", name: "Samuel" }]
make first() returns User
  give users[0]
 done`)));
  assert(result.diagnostics.some(item => /element 2/.test(item.message) && /id/.test(item.message)));
  assert(!result.diagnostics.some(item => item.code === 'PLN-TYPE-RETURN'));
});

test('nested dictionaries and lists validate recursively', () => {
  const result = checkTypes(parse(tokenize(`type User
  id is number
 done
type Groups
  users is dictionary of list of User
 done
make load() returns Groups
  give { users: { admins: [{ id: 1 }], guests: [{ id: "bad" }] } }
 done`)));
  assert(result.diagnostics.some(item => /guests/.test(item.message) && /id/.test(item.message)));
});

test('optional and union collection elements accept valid alternatives', () => {
  const result = checkTypes(parse(tokenize(`let values as list of optional number is [1, null, 3]
let mixed as dictionary of number or text is { count: 2, label: "ok" }`)));
  assert.deepStrictEqual(result.diagnostics, []);
});

test('null checks narrow optional values within the non-null branch', () => {
  const result = checkTypes(parse(tokenize(`type User
  name is text
 done
make read(user as optional User) returns text
  if user is not null
    give user.name
  otherwise
    give "unknown"
  done
 done`)));
  assert.deepStrictEqual(result.diagnostics, []);
});

console.log('11 tests: passed');
