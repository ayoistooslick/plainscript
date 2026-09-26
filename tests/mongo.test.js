// Tests for MongoDB runtime: INSERT, UPDATE, DELETE, and SELECT operations.
//
// Run with: node tests/mongo.test.js

const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate, createGenerationContext } = require('../compiler/generator');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

const pendingTests = [];
let lastTest = Promise.resolve();

function testAsync(name, fn) {
  const run = () => fn().then(
    () => { console.log(`  PASS  ${name}`); passed++; },
    (e) => { console.log(`  FAIL  ${name}`); console.log(`        ${e.message}`); failed++; },
  );
  lastTest = lastTest.then(run, run);
  pendingTests.push(lastTest);
}

function assert(actual, expected) {
  const a = String(actual).trim();
  const e = String(expected).trim();
  if (a !== e) throw new Error(`Expected:\n        ${e}\n        Got:\n        ${a}`);
}

function assertIncludes(actual, expected) {
  if (!String(actual).includes(expected)) {
    throw new Error(`Expected to include:\n        ${expected}\n        Got:\n        ${String(actual).trim()}`);
  }
}

function compileProgram(source) {
  const context = createGenerationContext();
  let js = generate(parse(tokenize(source)), context);
  if (context.needsAsync) js = (function wrapAsync(src) {
    return `(async () => {\n${src}\n})();`;
  })(js);
  return js;
}

async function runGeneratedAsync(js, stubs = {}) {
  const logs = [];
  const sandboxConsole = {
    log: (...args) => logs.push(args.map(String).join(' ')),
    error: (...args) => logs.push('[err] ' + args.map(String).join(' ')),
  };
  const match = js.match(/^\(async \(\) => \{\n([\s\S]*)\n\}\)\(\);$/);
  const body = match
    ? `return (async () => {\n${match[1]}\n})();`
    : `${js}\n;return undefined;`;
  const fn = new Function('require', 'console', 'process', body)((name) => {
    if (Object.prototype.hasOwnProperty.call(stubs, name)) return stubs[name];
    return require(name);
  }, sandboxConsole, { env: {} });
  await fn;
  return logs;
}

// ── MongoDB mock setup ─────────────────────────────────────────────────────

// Simple spy: wraps a function and records all calls.
function spy(fn) {
  const calls = [];
  const wrapped = function (...args) { calls.push(args); return fn(...args); };
  wrapped.calls = calls;
  return wrapped;
}

function makeCollectionMock() {
  return {
    insertOne: spy(async () => ({ insertedId: 'mock-id', acknowledged: true })),
    find: spy(() => ({
      project: spy(() => ({
        toArray: spy(async () => [{ _id: 'mock-id', name: 'test', age: 30 }]),
      })),
    })),
    updateMany: spy(async () => ({ modifiedCount: 2 })),
    deleteMany: spy(async () => ({ deletedCount: 3 })),
  };
}

let mockDb;
let mockCollection;
let lastClientUri;
let lastDbName;

function resetMocks() {
  mockCollection = makeCollectionMock();
  mockDb = { collection: spy(() => mockCollection) };
  lastClientUri = null;
  lastDbName = null;
}

function MockMongoClient(uri) {
  lastClientUri = uri;
  this.connect = spy(async () => {});
  this.db = spy((dbName) => { lastDbName = dbName; return mockDb; });
  this.close = spy(async () => {});
}

const mockMongo = { MongoClient: MockMongoClient };

resetMocks();

// ── Compilation tests ──────────────────────────────────────────────────────

console.log('\nMongoDB compilation');

test('insert compiles to __write with correct SQL and params', () => {
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
insert
    INSERT INTO users (name, age) VALUES ({name}, {age})
done
`);
  assertIncludes(js, '__write');
  assertIncludes(js, 'INSERT INTO users (name, age) VALUES (?, ?)');
});

test('update compiles to __update with correct SQL and params', () => {
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
update
    UPDATE users SET name = {name} WHERE id = {id}
done
`);
  assertIncludes(js, '__update');
  assertIncludes(js, 'UPDATE users SET name = ? WHERE id = ?');
});

test('delete compiles to __delete with correct SQL and params', () => {
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
delete
    DELETE FROM users WHERE id = {id}
done
`);
  assertIncludes(js, '__delete');
  assertIncludes(js, 'DELETE FROM users WHERE id = ?');
});

test('query compiles to __query with correct SQL and params', () => {
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
query
    SELECT * FROM users WHERE id = {id}
done
`);
  assertIncludes(js, '__query');
  assertIncludes(js, 'SELECT * FROM users WHERE id = ?');
});

test('remember update/delete compile to correct methods', () => {
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
remember n as "bo"
remember result as update
    UPDATE users SET name = {n} WHERE id = {n}
done
remember gone as delete
    DELETE FROM users WHERE name = {n}
done
`);
  assertIncludes(js, 'let result = await db.__update');
  assertIncludes(js, 'let gone = await db.__delete');
});

test('MongoDB runtime is included in generated code', () => {
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
query
    SELECT * FROM users
done
`);
  assertIncludes(js, 'async function __mongoOpen');
  assertIncludes(js, '__mongoDb.__write');
  assertIncludes(js, '__mongoDb.__update');
  assertIncludes(js, '__mongoDb.__delete');
  assertIncludes(js, '__mongoDb.__query');
  assertIncludes(js, '__mongoDb.__execute');
  assertIncludes(js, 'async function __mongoClose');
});

// ── Execution tests ────────────────────────────────────────────────────────

console.log('\nMongoDB execution');

testAsync('insert calls insertOne with correct document', async () => {
  resetMocks();
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
remember name as "test"
remember age as 30
insert
    INSERT INTO users (name, age) VALUES ({name}, {age})
done
`);
  await runGeneratedAsync(js, { mongodb: mockMongo });
  assert(lastClientUri, 'mongodb://localhost:27017');
  assert(lastDbName, 'testdb');
  assert(mockCollection.insertOne.calls.length, 1);
  const doc = mockCollection.insertOne.calls[0][0];
  assert(doc.name, 'test');
  assert(doc.age, '30');
});

testAsync('update calls updateMany with filter and $set', async () => {
  resetMocks();
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
remember newName as "newName"
remember targetId as "targetId"
update
    UPDATE users SET name = {newName} WHERE id = {targetId}
done
`);
  await runGeneratedAsync(js, { mongodb: mockMongo });
  assert(mockCollection.updateMany.calls.length, 1);
  const call = mockCollection.updateMany.calls[0];
  assert(JSON.stringify(call[0]), '{"id":"targetId"}');
  assert(JSON.stringify(call[1]), '{"$set":{"name":"newName"}}');
});

testAsync('delete calls deleteMany with correct filter', async () => {
  resetMocks();
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
remember targetId as "targetId"
delete
    DELETE FROM users WHERE id = {targetId}
done
`);
  await runGeneratedAsync(js, { mongodb: mockMongo });
  assert(mockCollection.deleteMany.calls.length, 1);
  const filter = mockCollection.deleteMany.calls[0][0];
  assert(JSON.stringify(filter), '{"id":"targetId"}');
});

testAsync('query calls find with filter and returns results', async () => {
  resetMocks();
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
remember targetId as "targetId"
query
    SELECT name FROM users WHERE id = {targetId}
done
show "ok"
`);
  const logs = await runGeneratedAsync(js, { mongodb: mockMongo });
  assert(mockCollection.find.calls.length, 1);
  const filter = mockCollection.find.calls[0][0];
  assert(JSON.stringify(filter), '{"id":"targetId"}');
  assert(logs[0], 'ok');
});

testAsync('insert with variables passes correct param values', async () => {
  resetMocks();
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
remember userName as "alice"
remember userAge as 25
insert
    INSERT INTO users (name, age) VALUES ({userName}, {userAge})
done
`);
  await runGeneratedAsync(js, { mongodb: mockMongo });
  const doc = mockCollection.insertOne.calls[0][0];
  assert(doc.name, 'alice');
  assert(doc.age, '25');
});

testAsync('update with variables passes correct param values', async () => {
  resetMocks();
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
remember newName as "bob"
remember targetId as "abc123"
update
    UPDATE users SET name = {newName} WHERE id = {targetId}
done
`);
  await runGeneratedAsync(js, { mongodb: mockMongo });
  const call = mockCollection.updateMany.calls[0];
  assert(JSON.stringify(call[0]), '{"id":"abc123"}');
  assert(JSON.stringify(call[1]), '{"$set":{"name":"bob"}}');
});

testAsync('delete with variables passes correct param values', async () => {
  resetMocks();
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
remember targetId as "xyz789"
delete
    DELETE FROM users WHERE id = {targetId}
done
`);
  await runGeneratedAsync(js, { mongodb: mockMongo });
  const filter = mockCollection.deleteMany.calls[0][0];
  assert(JSON.stringify(filter), '{"id":"xyz789"}');
});

testAsync('remember update returns rowCount from modifiedCount', async () => {
  resetMocks();
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
remember newName as "newName"
remember id as "id"
remember result as update
    UPDATE users SET name = {newName} WHERE id = {id}
done
show result.rowCount
`);
  const logs = await runGeneratedAsync(js, { mongodb: mockMongo });
  assert(logs[0], '2');
});

testAsync('remember delete returns rowCount from deletedCount', async () => {
  resetMocks();
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
remember id as "id"
remember result as delete
    DELETE FROM users WHERE id = {id}
done
show result.rowCount
`);
  const logs = await runGeneratedAsync(js, { mongodb: mockMongo });
  assert(logs[0], '3');
});

testAsync('multiple operations in sequence work together', async () => {
  resetMocks();
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
remember name as "test"
remember age as 30
remember id as "id"
insert
    INSERT INTO users (name, age) VALUES ({name}, {age})
done
update
    UPDATE users SET name = {name} WHERE id = {id}
done
delete
    DELETE FROM users WHERE id = {id}
done
query
    SELECT * FROM users WHERE id = {id}
done
show "done"
`);
  const logs = await runGeneratedAsync(js, { mongodb: mockMongo });
  assert(mockCollection.insertOne.calls.length, 1);
  assert(mockCollection.updateMany.calls.length, 1);
  assert(mockCollection.deleteMany.calls.length, 1);
  assert(mockCollection.find.calls.length, 1);
  assert(logs[0], 'done');
});

testAsync('delete without WHERE clause works with empty filter', async () => {
  resetMocks();
  const js = compileProgram(`mongo "mongodb://localhost:27017" db "testdb"
delete
    DELETE FROM users
done
`);
  await runGeneratedAsync(js, { mongodb: mockMongo });
  assert(mockCollection.deleteMany.calls.length, 1);
  const filter = mockCollection.deleteMany.calls[0][0];
  assert(JSON.stringify(filter), '{}');
});

// ── Summary ────────────────────────────────────────────────────────────────

Promise.all(pendingTests).then(() => {
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
});
