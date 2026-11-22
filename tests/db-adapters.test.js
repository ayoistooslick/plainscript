'use strict';

// Deterministic adapter tests. Real PostgreSQL/MySQL servers are not available
// in this repository's environment, so these use driver-shaped fakes and assert
// the SQL, parameter binding and lifecycle the adapters produce.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { compileProject } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const load = (name) => import(pathToFileURL(path.join(ROOT, 'stdlib', name)).toString());

function taskSchema(contract) {
  return contract.object({
    id: contract.number(),
    title: contract.text(),
    done: contract.boolean(),
    labels: contract.array(contract.text()),
  });
}

class FakePostgresClient {
  constructor() {
    this.calls = [];
    this.ended = false;
    this.transactionState = [];
  }
  async connect() {}
  async query(sql, params = []) {
    this.calls.push({ sql, params });
    if (sql.startsWith('SELECT version')) return { rows: [], rowCount: 0 };
    if (/^SELECT \* FROM tasks/.test(sql)) {
      return { rows: [{ id: 7, title: 'shipped', done: true, labels: '["release"]' }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO tasks')) return { rows: [{ id: 7 }], rowCount: 1 };
    if (sql.startsWith('INSERT INTO plainscript_migrations')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
  async end() { this.ended = true; }
}

class FakeMysqlConnection {
  constructor() {
    this.calls = [];
    this.ended = false;
  }
  async ping() {}
  async query(sql, params = []) {
    this.calls.push({ kind: 'query', sql, params });
    if (sql.startsWith('SELECT version')) return [[]];
    if (sql.startsWith('SELECT * FROM tasks')) {
      return [[{ id: 3, title: 'db task', done: 1, labels: '["one"]' }]];
    }
    return [[]];
  }
  async execute(sql, params = []) {
    this.calls.push({ kind: 'execute', sql, params });
    if (sql.startsWith('INSERT INTO tasks')) return [{ affectedRows: 1, insertId: 3 }];
    return [{ affectedRows: 1, insertId: 0 }];
  }
  async beginTransaction() { this.calls.push({ kind: 'begin' }); }
  async commit() { this.calls.push({ kind: 'commit' }); }
  async rollback() { this.calls.push({ kind: 'rollback' }); }
  async end() { this.ended = true; }
}

test('postgres placeholders are translated outside quoted strings', async () => {
  const { postgresSql } = await load('db-postgres.js');
  assert.equal(postgresSql('SELECT * FROM tasks WHERE title = ? AND done = ?'), 'SELECT * FROM tasks WHERE title = $1 AND done = $2');
  assert.equal(postgresSql("SELECT '?' AS literal, ? AS value -- ?\n"), "SELECT '?' AS literal, $1 AS value -- ?\n");
  assert.equal(postgresSql('SELECT "?" AS quoted, ?'), 'SELECT "?" AS quoted, $1');
});

test('postgres adapter binds queries, maps table types and closes its client', async () => {
  const postgres = await load('db-postgres.js');
  const db = await load('db.js');
  const contract = await load('contract.js');
  const client = new FakePostgresClient();
  const database = await postgres.open('postgres://example', { driver: { Client: function Client() { return client; } } });
  assert.equal(database.dialect, 'postgres');
  const tasks = db.table(database, 'tasks', taskSchema(contract));
  assert.match(tasks.createSql(), /id BIGSERIAL PRIMARY KEY/);
  assert.match(tasks.createSql(), /done BOOLEAN/);
  assert.match(tasks.createSql(), /labels JSONB/);
  const inserted = await tasks.insert({ id: 0, title: 'ship', done: false, labels: ['release'] });
  assert.equal(inserted.id, 7);
  assert.equal(inserted.done, true);
  assert.deepEqual(inserted.labels, ['release']);
  assert.ok(client.calls.some((call) => call.sql.includes('WHERE id = $1') && call.params[0] === 7));
  await database.close();
  assert.equal(client.ended, true);
});

test('mysql adapter parses a connection URI into mysql2 options', async () => {
  const mysql = await load('db-mysql.js');
  const connection = new FakeMysqlConnection();
  let received = null;
  await mysql.open('mysql://app:secret@db.example:3307/inventory?charset=utf8mb4', {
    driver: { createConnection: async (options) => { received = options; return connection; } },
  });
  assert.equal(received.host, 'db.example');
  assert.equal(received.port, 3307);
  assert.equal(received.user, 'app');
  assert.equal(received.password, 'secret');
  assert.equal(received.database, 'inventory');
  assert.equal(received.charset, 'utf8mb4');
});

test('mysql adapter wraps a connection failure at creation time', async () => {
  const mysql = await load('db-mysql.js');
  await assert.rejects(
    () => mysql.open('mysql://example', {
      driver: { createConnection: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:1'); } },
    }),
    (error) => /could not connect to MySQL/.test(error.message),
  );
});

test('mysql adapter uses execute for writes, maps affected rows and closes', async () => {
  const mysql = await load('db-mysql.js');
  const db = await load('db.js');
  const contract = await load('contract.js');
  const connection = new FakeMysqlConnection();
  const database = await mysql.open('mysql://example', { driver: { createConnection: async () => connection } });
  const tasks = db.table(database, 'tasks', taskSchema(contract));
  assert.match(tasks.createSql(), /id BIGINT PRIMARY KEY AUTO_INCREMENT/);
  assert.match(tasks.createSql(), /done TINYINT\(1\)/);
  const result = await database.run('INSERT INTO tasks (title) VALUES (?)', ['new']);
  assert.deepEqual(result, { changes: 1, lastInsertRowid: 3 });
  assert.deepEqual(connection.calls.at(-1).params, ['new']);
  await database.close();
  assert.equal(connection.ended, true);
});

test('adapters run migrations with their transaction dialect', async () => {
  const postgres = await load('db-postgres.js');
  const db = await load('db.js');
  const client = new FakePostgresClient();
  const database = await postgres.open('postgres://example', { driver: { Client: function Client() { return client; } } });
  const applied = await db.migrate(database, [{ version: 1, name: 'base', up: async (handle) => handle.exec('CREATE TABLE base (id INTEGER PRIMARY KEY)') }]);
  assert.deepEqual(applied, [1]);
  const statements = client.calls.map((call) => call.sql.trim().toUpperCase());
  assert.ok(statements.includes('BEGIN'));
  assert.ok(statements.includes('COMMIT'));
  assert.ok(client.calls.some((call) => call.sql.includes('INSERT INTO plainscript_migrations') && call.params.length === 3));
});

test('mysql transaction delegates commit and rollback to the driver', async () => {
  const mysql = await load('db-mysql.js');
  const connection = new FakeMysqlConnection();
  const database = await mysql.open('mysql://example', { driver: { createConnection: async () => connection } });
  await database.transaction(async () => 42);
  assert.deepEqual(connection.calls.slice(-2).map((call) => call.kind), ['begin', 'commit']);
  await assert.rejects(database.transaction(async () => { throw new Error('rollback me'); }), /rollback me/);
  assert.equal(connection.calls.at(-1).kind, 'rollback');
});

test('adapter declarations are present and valid PlainScript', () => {
  const packageRoot = ROOT;
  for (const name of ['db-postgres', 'db-mysql']) {
    const file = path.join(packageRoot, 'stdlib', `${name}.d.pln`);
    assert.ok(fs.existsSync(file), `${name} declaration`);
    assert.ok(fs.readFileSync(file, 'utf8').includes('export declare function open'));
  }
});

test('adapter declarations expose asynchronous table methods', () => {
  const project = compileProject({
    'main.pln': `import { openPool } from "std/db-postgres"
import { table } from "std/db"
import { object, number, text } from "std/contract"

let TaskSchema = object({ id: number(), title: text() })

async function titles() -> list of any
    let database = await openPool("postgres://localhost/app")
    let tasks = table(database, "tasks", TaskSchema)
    let pending: Promise of list of any = tasks.list()
    let rows = await pending
    return rows
end
`,
  });
  assert.deepEqual(project.compiler.diagnostics, []);
});
