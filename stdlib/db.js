// SQLite persistence and versioned migrations for PlainScript contracts.
//
// The runtime is deliberately small and explicit: it does not generate SQL
// during compilation, but it derives table columns from the same
// std/contract object schema used by the operation and client, so a model
// change has one source of truth. Queries always use bound parameters.
//
// Supported today: Node 22's built-in node:sqlite. Other drivers can implement
// the same small Database surface in application code.

import { parse, optional as optionalSchema } from './contract.js';

export class MigrationError extends Error {
  constructor(version, name, cause) {
    super(`migration ${version} (${name}) failed: ${cause && cause.message ? cause.message : cause}`);
    this.name = 'MigrationError';
    this.version = version;
    this.migration = name;
    this.cause = cause;
  }
}

export class DatabaseError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'DatabaseError';
    this.cause = cause;
  }
}

function identifier(value, kind) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new DatabaseError(`invalid ${kind} identifier ${JSON.stringify(value)}`);
  }
  return value;
}

export async function open(file = ':memory:', options = {}) {
  let sqlite;
  try {
    sqlite = await import('node:sqlite');
  } catch (cause) {
    throw new DatabaseError('std/db currently requires Node 22+ with node:sqlite', cause);
  }
  const { DatabaseSync } = sqlite;
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON');
  if (options.pragmas) raw.exec(String(options.pragmas));
  const database = {
    raw,
    file,
    exec(sql, params = []) {
      if (Array.isArray(params) && params.length) return raw.prepare(sql).run(...params);
      return raw.exec(sql);
    },
    query(sql, params = []) {
      return raw.prepare(sql).all(...params);
    },
    run(sql, params = []) {
      return raw.prepare(sql).run(...params);
    },
    async transaction(work) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const result = await work(database);
        raw.exec('COMMIT');
        return result;
      } catch (error) {
        try { raw.exec('ROLLBACK'); } catch { /* the original failure is more useful */ }
        throw error;
      }
    },
    close() { raw.close(); },
  };
  return database;
}

function unwrap(schema) {
  let current = schema;
  while (current && current.kind === 'optional') current = current.inner;
  return current;
}

function isOptional(schema) {
  return schema && schema.kind === 'optional';
}

function sqlType(schema) {
  const inner = unwrap(schema);
  if (!inner) return 'TEXT';
  if (inner.kind === 'number') return 'REAL';
  if (inner.kind === 'boolean') return 'INTEGER';
  if (inner.kind === 'enum') {
    return inner.values.length && inner.values.every((value) => typeof value === 'number') ? 'REAL' : 'TEXT';
  }
  if (inner.kind === 'array' || inner.kind === 'object' || inner.kind === 'oneOf') return 'TEXT';
  return 'TEXT';
}

function columnsOf(schema) {
  if (!schema || schema.kind !== 'object') throw new DatabaseError('table() expects a std/contract object schema');
  const columns = [];
  for (const [name, fieldSchema] of Object.entries(schema.shape)) {
    identifier(name, 'column');
    columns.push({
      name,
      schema: fieldSchema,
      optional: isOptional(fieldSchema),
      sqlType: sqlType(fieldSchema),
    });
  }
  return columns;
}

function encodeColumn(schema, value) {
  if (value === undefined || value === null) return null;
  const inner = unwrap(schema);
  if (inner.kind === 'boolean') return value ? 1 : 0;
  if (inner.kind === 'array' || inner.kind === 'object' || inner.kind === 'oneOf') return JSON.stringify(value);
  return value;
}

function decodeColumn(schema, value) {
  if (value === undefined || value === null) return value;
  const inner = unwrap(schema);
  if (inner.kind === 'boolean') return value === 1 || value === true;
  if (inner.kind === 'array' || inner.kind === 'object' || inner.kind === 'oneOf') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

export function table(database, name, schema, options = {}) {
  if (!database || typeof database.query !== 'function') throw new DatabaseError('table() expects a database from open()');
  const tableName = identifier(name, 'table');
  const columns = columnsOf(schema);
  const primaryKey = options.primaryKey || 'id';
  if (primaryKey && !columns.some((column) => column.name === primaryKey)) {
    throw new DatabaseError(`primary key ${primaryKey} is not a field in the ${tableName} schema`);
  }
  const primary = columns.find((column) => column.name === primaryKey);
  const auto = options.autoIncrement !== false && primary && primary.sqlType === 'REAL';

  function definition(column) {
    let text = `${column.name} ${column.sqlType}`;
    if (column.name === primaryKey) text += ' PRIMARY KEY';
    if (column.name === primaryKey && auto) text += ' AUTOINCREMENT';
    if (!column.optional && column.name !== primaryKey) text += ' NOT NULL';
    return text;
  }

  function rowValue(value) {
    const parsed = parse(schema, value);
    const row = {};
    for (const column of columns) {
      if (!Object.hasOwn(parsed, column.name)) continue;
      row[column.name] = encodeColumn(column.schema, parsed[column.name]);
    }
    return row;
  }

  const storage = {
    name: tableName,
    schema,
    columns: columns.map((column) => ({ name: column.name, sqlType: column.sqlType, optional: column.optional })),
    primaryKey,
    autoIncrement: Boolean(auto),
    createSql() {
      return `CREATE TABLE IF NOT EXISTS ${tableName} (${columns.map(definition).join(', ')})`;
    },
    create() {
      database.exec(storage.createSql());
      return storage;
    },
    list() {
      return database.query(`SELECT * FROM ${tableName} ORDER BY ${primaryKey} ASC`)
        .map((row) => parse(schema, fromRow(row)));
    },
    get(id) {
      const row = database.query(`SELECT * FROM ${tableName} WHERE ${primaryKey} = ?`, [id])[0];
      return row ? parse(schema, fromRow(row)) : null;
    },
    insert(value) {
      const row = rowValue(value);
      // An explicit zero is the conventional placeholder for an auto-increment
      // primary key in a create input; omitting it lets SQLite assign the id.
      if (auto && (row[primaryKey] === 0 || row[primaryKey] === null)) delete row[primaryKey];
      const names = Object.keys(row);
      const placeholders = names.map(() => '?').join(', ');
      const result = database.run(`INSERT INTO ${tableName} (${names.join(', ')}) VALUES (${placeholders})`, names.map((key) => row[key]));
      const insertedId = row[primaryKey] !== undefined && row[primaryKey] !== null ? row[primaryKey] : result.lastInsertRowid;
      return storage.get(insertedId);
    },
    update(id, value) {
      const row = rowValue(value);
      const names = Object.keys(row).filter((key) => key !== primaryKey);
      if (!names.length) return storage.get(id);
      const assignments = names.map((key) => `${key} = ?`).join(', ');
      database.run(`UPDATE ${tableName} SET ${assignments} WHERE ${primaryKey} = ?`, [...names.map((key) => row[key]), id]);
      return storage.get(id);
    },
    remove(id) {
      database.run(`DELETE FROM ${tableName} WHERE ${primaryKey} = ?`, [id]);
    },
  };

  function fromRow(row) {
    const output = {};
    for (const column of columns) {
      output[column.name] = decodeColumn(column.schema, row[column.name]);
    }
    return output;
  }

  return storage;
}

export function tableFor(database, name, schema, options = {}) {
  return table(database, name, schema, options);
}

export async function migrate(database, migrations, options = {}) {
  if (!database || typeof database.exec !== 'function') throw new DatabaseError('migrate() expects a database from open()');
  if (!Array.isArray(migrations)) throw new MigrationError(0, '<list>', new TypeError('migrations must be a list'));
  const versionTable = options.versionTable || 'plainscript_migrations';
  identifier(versionTable, 'version table');
  database.exec(`CREATE TABLE IF NOT EXISTS ${versionTable} (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = database.query(`SELECT version FROM ${versionTable} ORDER BY version ASC`).map((row) => row.version);
  const seen = new Set();
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  for (const migration of ordered) {
    if (!migration || !Number.isInteger(migration.version) || migration.version <= 0) {
      throw new MigrationError(migration && migration.version, migration && migration.name, new TypeError('migration version must be a positive integer'));
    }
    if (!migration.name || typeof migration.name !== 'string') {
      throw new MigrationError(migration.version, '<unnamed>', new TypeError('migration name must be non-empty text'));
    }
    if (typeof migration.up !== 'function') {
      throw new MigrationError(migration.version, migration.name, new TypeError('migration up must be a function'));
    }
    if (seen.has(migration.version)) {
      throw new MigrationError(migration.version, migration.name, new TypeError('duplicate migration version'));
    }
    seen.add(migration.version);
  }
  if (applied.length && ordered.some((migration) => migration.version < Math.max(...applied) && !applied.includes(migration.version))) {
    throw new MigrationError(0, '<history>', new TypeError('migration history has a gap; refusing to apply out of order'));
  }

  let current = applied.length ? Math.max(...applied) : 0;
  const newlyApplied = [];
  for (const migration of ordered) {
    if (migration.version <= current) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      await migration.up(database);
      database.run(`INSERT INTO ${versionTable} (version, name, applied_at) VALUES (?, ?, ?)`, [
        migration.version,
        migration.name,
        new Date().toISOString(),
      ]);
      database.exec('COMMIT');
      newlyApplied.push(migration.version);
      current = migration.version;
    } catch (cause) {
      try { database.exec('ROLLBACK'); } catch { /* keep the migration failure */ }
      throw new MigrationError(migration.version, migration.name, cause);
    }
  }
  return newlyApplied;
}

export async function rollback(database, migrations, targetVersion = 0, options = {}) {
  if (!database || typeof database.exec !== 'function') throw new DatabaseError('rollback() expects a database from open()');
  const versionTable = options.versionTable || 'plainscript_migrations';
  identifier(versionTable, 'version table');
  database.exec(`CREATE TABLE IF NOT EXISTS ${versionTable} (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = database.query(`SELECT version, name FROM ${versionTable} ORDER BY version DESC`);
  const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  const rolledBack = [];
  for (const row of applied) {
    if (row.version <= targetVersion) break;
    const migration = byVersion.get(row.version);
    if (!migration) throw new MigrationError(row.version, row.name, new TypeError('no local migration matches an applied version'));
    if (typeof migration.down !== 'function') throw new MigrationError(row.version, row.name, new TypeError('migration has no down function'));
    database.exec('BEGIN IMMEDIATE');
    try {
      await migration.down(database);
      database.run(`DELETE FROM ${versionTable} WHERE version = ?`, [row.version]);
      database.exec('COMMIT');
      rolledBack.push(row.version);
    } catch (cause) {
      try { database.exec('ROLLBACK'); } catch { /* keep the rollback failure */ }
      throw new MigrationError(row.version, row.name, cause);
    }
  }
  return rolledBack;
}

export function columns(schema) {
  return columnsOf(schema).map((column) => ({ name: column.name, sqlType: column.sqlType, optional: column.optional }));
}

export { optionalSchema };
