// PostgreSQL adapter for the std/db Database interface.
//
// The "pg" package is loaded dynamically. Install it in the application; the
// compiler package intentionally has no runtime dependencies.
import { DatabaseError } from './db.js';
import { loadPostgres, postgresDatabase } from './db-adapter.js';

function clientOptions(connectionString, options) {
  return {
    ...(options.client || {}),
    ...(connectionString ? { connectionString } : {}),
  };
}

// A single dedicated client. Use openPool for request-serving applications.
export async function open(connectionString = '', options = {}) {
  const pg = await loadPostgres(options);
  const Client = pg.Client || pg.default?.Client;
  if (typeof Client !== 'function') throw new DatabaseError('pg does not expose a Client constructor');
  const client = new Client(clientOptions(connectionString, options));
  try {
    await client.connect();
  } catch (cause) {
    throw new DatabaseError('could not connect to PostgreSQL', cause);
  }
  return postgresDatabase(client, { file: connectionString || '<postgres>' });
}

// A pooled adapter. transaction() checks out one connection, so all statements
// in a transaction run on the same session.
export async function openPool(connectionString = '', options = {}) {
  const pg = await loadPostgres(options);
  const Pool = pg.Pool || pg.default?.Pool;
  if (typeof Pool !== 'function') throw new DatabaseError('pg does not expose a Pool constructor');
  const pool = new Pool(clientOptions(connectionString, options));
  const database = postgresDatabase(pool, { file: connectionString || '<postgres-pool>' });
  database.raw = pool;
  database.transaction = async (work) => {
    const client = await pool.connect();
    const scoped = postgresDatabase(client, { file: database.file });
    try {
      return await scoped.transaction(work);
    } finally {
      client.release();
    }
  };
  database.close = () => pool.end();
  return database;
}

export { postgresSql } from './db-adapter.js';
