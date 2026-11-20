// Shared SQL adapter plumbing. Drivers are loaded dynamically so the compiler
// package keeps zero runtime dependencies; applications install pg/mysql2.
import { DatabaseError } from './db.js';

// Translate SQLite-style `?` placeholders into PostgreSQL `$1` parameters while
// leaving quoted text and comments untouched. Generated SQL only uses `?`, but
// this makes hand-written queries safer too.
export function postgresSql(sql) {
  let output = '';
  let index = 1;
  let quote = null;
  for (let position = 0; position < sql.length; position += 1) {
    const char = sql[position];
    if (quote) {
      output += char;
      if (char === quote && sql[position - 1] !== '\\') quote = null;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; output += char; continue; }
    if (char === '-' && sql[position + 1] === '-') {
      const end = sql.indexOf('\n', position);
      const stop = end === -1 ? sql.length : end;
      output += sql.slice(position, stop);
      position = stop - 1;
      continue;
    }
    if (char === '/' && sql[position + 1] === '*') {
      const end = sql.indexOf('*/', position + 2);
      const stop = end === -1 ? sql.length : end + 2;
      output += sql.slice(position, stop);
      position = stop - 1;
      continue;
    }
    if (char === '?') { output += `$${index++}`; continue; }
    output += char;
  }
  return output;
}

function requireDriver(driver, name) {
  if (!driver) throw new DatabaseError(`${name} driver is not installed; run npm install ${name}`);
  return driver.default || driver;
}

export function postgresDatabase(client, options = {}) {
  const dialect = 'postgres';
  const translate = (sql) => postgresSql(String(sql));
  return {
    raw: client,
    file: options.file || '<postgres>',
    dialect,
    booleanAsInteger: false,
    placeholder: (index) => `$${index + 1}`,
    exec(sql, params = []) {
      const normalized = String(sql).trim().toUpperCase() === 'BEGIN IMMEDIATE' ? 'BEGIN' : sql;
      const query = translate(normalized);
      if (Array.isArray(params) && params.length) return client.query(query, params);
      return client.query(query);
    },
    async query(sql, params = []) {
      const result = await client.query(translate(sql), params);
      return result.rows;
    },
    async run(sql, params = []) {
      const result = await client.query(translate(sql), params);
      return {
        changes: result.rowCount,
        lastInsertRowid: result.rows && result.rows.length ? result.rows[0] : null,
      };
    },
    async transaction(work) {
      await client.query('BEGIN');
      try {
        const result = await work(this);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* retain the application failure */ }
        throw error;
      }
    },
    async close() {
      if (typeof client.end === 'function') await client.end();
    },
  };
}

export function mysqlDatabase(connection, options = {}) {
  const dialect = 'mysql';
  return {
    raw: connection,
    file: options.file || '<mysql>',
    dialect,
    booleanAsInteger: false,
    placeholder: () => '?',
    exec(sql, params = []) {
      const normalized = String(sql).trim().toUpperCase() === 'BEGIN IMMEDIATE' ? 'START TRANSACTION' : sql;
      if (Array.isArray(params) && params.length) return connection.query(normalized, params);
      return connection.query(normalized);
    },
    async query(sql, params = []) {
      const [rows] = await connection.query(sql, params);
      return rows;
    },
    async run(sql, params = []) {
      const [result] = await connection.execute(sql, params);
      return { changes: result.affectedRows, lastInsertRowid: result.insertId || null };
    },
    async transaction(work) {
      await connection.beginTransaction();
      try {
        const result = await work(this);
        await connection.commit();
        return result;
      } catch (error) {
        try { await connection.rollback(); } catch { /* retain the application failure */ }
        throw error;
      }
    },
    async close() {
      if (typeof connection.end === 'function') await connection.end();
    },
  };
}

export async function loadPostgres(options = {}) {
  if (options.driver) return requireDriver(options.driver, 'pg');
  try { return requireDriver(await import('pg'), 'pg'); } catch (cause) {
    throw new DatabaseError('the PostgreSQL adapter requires the "pg" package', cause);
  }
}

export async function loadMysql(options = {}) {
  if (options.driver) return requireDriver(options.driver, 'mysql2');
  try {
    const module = await import('mysql2/promise');
    return module.default || module;
  } catch (cause) {
    throw new DatabaseError('the MySQL adapter requires the "mysql2" package', cause);
  }
}
