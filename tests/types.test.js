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

test('known standard-library calls propagate their return types', () => {
  const valid = checkTypes(parse(tokenize(`make read() returns text
  give lowercase("ADA")
done
make count() returns number
  give length([1, 2, 3])
done`)));
  assert.deepStrictEqual(valid.diagnostics, []);

  const invalid = checkTypes(parse(tokenize(`make bad() returns number
  give lowercase("ADA")
done`)));
  assert(invalid.diagnostics.some(item => item.code === 'PLN-TYPE-RETURN' && /text/.test(item.message)));
});

test('member methods propagate text, boolean, and collection result types', () => {
  const result = checkTypes(parse(tokenize(`make textValue() returns text
  give " Ada ".trim().toLowerCase()
done
make found() returns boolean
  give "Ada".includes("d")
done
make items() returns list of text
  give "a,b".split(",")
done`)));
  assert.deepStrictEqual(result.diagnostics, []);
});

test('async function calls require wait for when a resolved value is expected', () => {
  const result = checkTypes(parse(tokenize(`make verify() returns text
  wait for sleep(1)
  give "verified"
done
remember result as verify()`)));
  assert(result.diagnostics.some(item => item.code === 'PLN-ASYNC-MISSING-AWAIT' && /verify/.test(item.message)));
});

test('wait for unwraps async calls and propagates the resolved return type', () => {
  const result = checkTypes(parse(tokenize(`make verify() returns text
  wait for sleep(1)
  give "verified"
done
make consume(value as text) returns text
  give value
done
remember result as wait for verify()
remember copied as consume(wait for verify())`)));
  assert.deepStrictEqual(result.diagnostics, []);
});

test('async return contracts are represented as Promise of T', () => {
  const ast = parse(tokenize(`make verify() returns Promise of text
  give "verified"
done`));
  const result = checkTypes(ast);
  assert.deepStrictEqual(result.diagnostics, []);
  assert.strictEqual(ast.body[0].returnType.kind, 'promise');
  assert.strictEqual(ast.body[0].returnType.value.name, 'text');
});

test('Promise values cannot be passed to synchronous typed parameters', () => {
  const result = checkTypes(parse(tokenize(`make verify() returns text
  wait for sleep(1)
  give "verified"
done
make consume(value as text) returns text
  give value
done
remember result as consume(verify())`)));
  assert(result.diagnostics.some(item => item.code === 'PLN-ASYNC-MISSING-AWAIT'));
});

test('reserved words can be escaped as identifiers with backticks', () => {
  const ast = parse(tokenize('remember `now` as 1\nshow `now`'));
  assert.strictEqual(ast.body[0].name, 'now');
  assert.strictEqual(ast.body[1].value.name, 'now');
});

test('ambiguous standard-library names produce namespace-aware diagnostics', () => {
  const result = checkTypes(parse(tokenize('remember value as lower("Ada")')));
  const diagnostic = result.diagnostics.find(item => item.code === 'PLN-NAMESPACE-UNKNOWN');
  assert(diagnostic);
  assert.strictEqual(diagnostic.category, 'namespace');
  assert.strictEqual(diagnostic.suggestion, 'lowercase');
});

test('heterogeneous inferred lists do not satisfy a homogeneous collection contract', () => {
  const result = checkTypes(parse(tokenize(`make consume(values as list of number) returns number
  give values[0]
done
remember result as consume([1, "wrong"])`)));
  assert(result.diagnostics.some(item => item.code === 'PLN-TYPE-COLLECTION' || item.code === 'PLN-TYPE-ARG'));
});

test('index expressions validate list and dictionary index types', () => {
  const result = checkTypes(parse(tokenize(`let numbers as list of number is [1, 2]
remember badListValue as numbers["first"]
let names as dictionary of text is { first: "Ada" }
remember badDictionaryValue as names[1]`)));
  assert.strictEqual(result.diagnostics.filter(item => item.code === 'PLN-TYPE-INDEX').length, 2);
});

test('declared bindings retain their contract after assignment', () => {
  const result = checkTypes(parse(tokenize(`let count as number is 1
count becomes 2
count becomes "wrong"
make read() returns number
  give count
	done`)));
  assert(result.diagnostics.some(item => item.code === 'PLN-TYPE-ASSIGN'));
  assert(!result.diagnostics.some(item => item.code === 'PLN-TYPE-RETURN'));
});

test('return contracts are checked inside loop bodies', () => {
  const result = checkTypes(parse(tokenize(`make read() returns number
  while true
    give "wrong"
  done
done`)));
  assert(result.diagnostics.some(item => item.code === 'PLN-TYPE-RETURN'));
});

console.log('21 tests: passed');
