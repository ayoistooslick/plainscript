'use strict';

// Live PostgreSQL/MySQL adapter verification.
//
// These tests run against a real server and the real driver, not a fake. They
// are opt-in because CI has no database service:
//
//   PLAINSCRIPT_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/plainscript_test \
//   PLAINSCRIPT_TEST_MYSQL_URL=mysql://user:pass@127.0.0.1:3306/plainscript_test \
//   npm test
//
// When a URL is absent (or the driver is not installed) the corresponding
// cases are skipped with an explicit reason. See docs/DATABASES.md for a
// disposable docker-based setup.

const { test } = require('node:test');
const assert = require('node:assert/strict');

async function loadAdapter(name) {
  return import(`../stdlib/${name}`);
}

function driverAvailable(packageName) {
  try {
    require.resolve(packageName);
    return true;
  } catch {
    return false;
  }
}

async function exercise(database, id) {
  const table = `ps_adapter_${id}`;
  await database.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL)`);
  try {
    const inserted = await database.run(`INSERT INTO ${table} (id, title, done) VALUES (?, ?, ?)`, [1, 'live row', 0]);
    assert.equal(inserted.changes, 1);

    // Parameterised lookup, including a value that looks like SQL.
    const rows = await database.query(`SELECT id, title, done FROM ${table} WHERE title = ?`, ["live row'; DROP TABLE users; --"]);
    assert.deepEqual(rows, [{ id: 1, title: 'live row', done: 0 }]);

    await assert.rejects(
      () => database.query(`SELECT * FROM ${table} WHERE missing = ?`, [1]),
      (error) => /missing|unknown|does not exist/i.test(String(error.message)),
    );

    // A rolled-back transaction leaves no row behind.
    await assert.rejects(() => database.transaction(async (tx) => {
      await tx.run(`INSERT INTO ${table} (id, title, done) VALUES (?, ?, ?)`, [2, 'rolled back', 0]);
      throw new Error('rollback on purpose');
    }), /rollback on purpose/);
    assert.deepEqual(await database.query(`SELECT id FROM ${table} ORDER BY id`), [{ id: 1 }]);

    const committed = await database.transaction(async (tx) => tx.run(
      `INSERT INTO ${table} (id, title, done) VALUES (?, ?, ?)`,
      [3, 'committed', 1],
    ));
    assert.equal(committed.changes, 1);
    assert.deepEqual(await database.query(`SELECT id FROM ${table} ORDER BY id`), [{ id: 1 }, { id: 3 }]);
  } finally {
    await database.exec(`DROP TABLE ${table}`);
  }
}

const postgresUrl = process.env.PLAINSCRIPT_TEST_POSTGRES_URL || '';
const mysqlUrl = process.env.PLAINSCRIPT_TEST_MYSQL_URL || '';
const hasPostgresDriver = driverAvailable('pg');
const hasMysqlDriver = driverAvailable('mysql2');

const skipPostgres = !postgresUrl
  ? 'PLAINSCRIPT_TEST_POSTGRES_URL is not set'
  : (!hasPostgresDriver ? 'the "pg" package is not installed' : false);
const skipMysql = !mysqlUrl
  ? 'PLAINSCRIPT_TEST_MYSQL_URL is not set'
  : (!hasMysqlDriver ? 'the "mysql2" package is not installed' : false);

test('PostgreSQL adapter works against a live server', { skip: skipPostgres, timeout: 30000 }, async () => {
  const postgres = await loadAdapter('db-postgres.js');

  // A connection failure must surface as a DatabaseError, not hang.
  const unreachable = new URL(postgresUrl);
  unreachable.port = '1';
  await assert.rejects(() => postgres.open(unreachable.toString()), /could not connect to PostgreSQL/);

  const database = await postgres.open(postgresUrl);
  try {
    assert.equal(database.dialect, 'postgres');
    await exercise(database, `pg_${process.pid}`);
  } finally {
    await database.close();
  }
});

test('MySQL adapter works against a live server', { skip: skipMysql, timeout: 30000 }, async () => {
  const mysql = await loadAdapter('db-mysql.js');

  const unreachable = new URL(mysqlUrl);
  unreachable.port = '1';
  await assert.rejects(() => mysql.open(unreachable.toString()), /could not connect to MySQL/);

  const database = await mysql.open(mysqlUrl);
  try {
    assert.equal(database.dialect, 'mysql');
    await exercise(database, `my_${process.pid}`);
  } finally {
    await database.close();
  }
});

test('postgres placeholder translation ignores doubled quotes', async () => {
  const { postgresSql } = await loadAdapter('db-adapter.js');
  assert.equal(postgresSql("SELECT 'it''s ?' AS literal, ? AS value"), "SELECT 'it''s ?' AS literal, $1 AS value");
  assert.equal(postgresSql('SELECT $$?$$ AS dollar, ?'), 'SELECT $$?$$ AS dollar, $1');
});
