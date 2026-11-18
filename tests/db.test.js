'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const supported = Number(process.versions.node.split('.')[0]) >= 22;

async function modules() {
  const db = await import(pathToFileURL(path.join(ROOT, 'stdlib', 'db.js')).toString());
  const contract = await import(pathToFileURL(path.join(ROOT, 'stdlib', 'contract.js')).toString());
  return { db, contract };
}

test('schema-derived tables round-trip records and survive reopening', async (t) => {
  if (!supported) return t.skip('node:sqlite requires Node 22');
  const { db, contract } = await modules();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-db-'));
  const file = path.join(directory, 'tasks.sqlite');
  const Task = contract.object({
    id: contract.number(),
    title: contract.text(),
    done: contract.boolean(),
    labels: contract.array(contract.text()),
  });
  let database = await db.open(file);
  await db.migrate(database, [{
    version: 1,
    name: 'tasks',
    up: async (handle) => {
      handle.exec('CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, done INTEGER NOT NULL, labels TEXT NOT NULL)');
    },
  }]);
  const tasks = db.table(database, 'tasks', Task);
  assert.deepEqual(tasks.columns.map((column) => [column.name, column.sqlType]), [
    ['id', 'REAL'], ['title', 'TEXT'], ['done', 'INTEGER'], ['labels', 'TEXT'],
  ]);
  const created = tasks.insert({ id: 0, title: 'ship it', done: false, labels: ['release'] });
  assert.equal(typeof created.id, 'number');
  assert.ok(created.id > 0);
  assert.equal(created.done, false);
  assert.deepEqual(created.labels, ['release']);
  database.close();

  database = await db.open(file);
  const reopened = db.table(database, 'tasks', Task);
  assert.equal(reopened.list().length, 1);
  assert.equal(reopened.list()[0].title, 'ship it');
  const updated = reopened.update(created.id, { id: created.id, title: 'shipped', done: true, labels: ['done'] });
  assert.equal(updated.done, true);
  assert.equal(updated.title, 'shipped');
  database.close();
});

test('an invalid migration rolls back its schema and leaves prior history intact', async (t) => {
  if (!supported) return t.skip('node:sqlite requires Node 22');
  const { db } = await modules();
  const database = await db.open(':memory:');
  await db.migrate(database, [{
    version: 1,
    name: 'base',
    up: async (handle) => handle.exec('CREATE TABLE base (id INTEGER PRIMARY KEY)'),
  }]);
  await assert.rejects(
    db.migrate(database, [
      { version: 1, name: 'base', up: async (handle) => handle.exec('CREATE TABLE base (id INTEGER PRIMARY KEY)') },
      {
        version: 2,
        name: 'broken',
        up: async (handle) => {
          handle.exec('CREATE TABLE half_done (id INTEGER PRIMARY KEY)');
          throw new Error('boom');
        },
      },
    ]),
    /migration 2 \(broken\) failed: boom/,
  );
  assert.equal(database.query('SELECT name FROM sqlite_master WHERE type = ? AND name = ?', ['table', 'half_done']).length, 0);
  assert.deepEqual(database.query('SELECT version FROM plainscript_migrations ORDER BY version').map((row) => row.version), [1]);
  database.close();
});

test('migrations reject duplicate versions and rollback requires a down function', async (t) => {
  if (!supported) return t.skip('node:sqlite requires Node 22');
  const { db } = await modules();
  const database = await db.open(':memory:');
  await assert.rejects(
    db.migrate(database, [
      { version: 1, name: 'one', up: async () => {} },
      { version: 1, name: 'again', up: async () => {} },
    ]),
    /duplicate migration version/,
  );
  await db.migrate(database, [{ version: 1, name: 'one', up: async (handle) => handle.exec('CREATE TABLE one (id INTEGER PRIMARY KEY)') }]);
  await assert.rejects(db.rollback(database, [{ version: 1, name: 'one' }], 0), /no down function/);
  const rolled = await db.rollback(database, [{
    version: 1,
    name: 'one',
    up: async () => {},
    down: async (handle) => handle.exec('DROP TABLE one'),
  }], 0);
  assert.deepEqual(rolled, [1]);
  assert.equal(database.query('SELECT version FROM plainscript_migrations').length, 0);
  database.close();
});

test('invalid table identifiers and invalid rows are rejected', async (t) => {
  if (!supported) return t.skip('node:sqlite requires Node 22');
  const { db, contract } = await modules();
  const database = await db.open(':memory:');
  const schema = contract.object({ id: contract.number(), title: contract.text() });
  assert.throws(() => db.table(database, 'tasks; DROP TABLE tasks', schema), /invalid table identifier/);
  database.exec('CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
  const table = db.table(database, 'tasks', schema);
  assert.throws(() => table.insert({ id: 1, title: 42 }), /expected text/);
  database.close();
});
