// MySQL/MariaDB adapter for the std/db Database interface.
//
// The "mysql2/promise" package is loaded dynamically; install it in the
// application. Queries use ordinary `?` placeholders.
import { DatabaseError } from './db.js';
import { loadMysql, mysqlDatabase } from './db-adapter.js';

function mysqlOptions(connectionString, options = {}) {
  const client = { ...(options.client || {}) };
  if (!connectionString) return client;
  let url;
  try { url = new URL(connectionString); } catch (cause) {
    throw new DatabaseError('the MySQL connection string must be a valid URL', cause);
  }
  if (url.protocol !== 'mysql:' && url.protocol !== 'mariadb:') {
    throw new DatabaseError('the MySQL connection string must use mysql:// or mariadb://');
  }
  const parsed = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ...(url.pathname && url.pathname !== '/' ? { database: decodeURIComponent(url.pathname.slice(1)) } : {}),
  };
  for (const [name, value] of url.searchParams) parsed[name] = value;
  // Explicit client options win, but the URI remains the convenient default.
  return { ...parsed, ...client };
}

export async function open(connectionString = '', options = {}) {
  const mysql = await loadMysql(options);
  const create = mysql.createConnection || mysql.default?.createConnection;
  if (typeof create !== 'function') throw new DatabaseError('mysql2 does not expose createConnection');
  let connection;
  try {
    connection = await create(mysqlOptions(connectionString, options));
    await connection.ping();
  } catch (cause) {
    if (connection) {
      try { await connection.end(); } catch { /* preserve the connection error */ }
    }
    throw new DatabaseError('could not connect to MySQL', cause);
  }
  return mysqlDatabase(connection, { file: connectionString || '<mysql>' });
}

export async function openPool(connectionString = '', options = {}) {
  const mysql = await loadMysql(options);
  const create = mysql.createPool || mysql.default?.createPool;
  if (typeof create !== 'function') throw new DatabaseError('mysql2 does not expose createPool');
  const pool = create(mysqlOptions(connectionString, options));
  const database = mysqlDatabase(pool, { file: connectionString || '<mysql-pool>' });
  database.raw = pool;
  database.transaction = async (work) => {
    const connection = await pool.getConnection();
    const scoped = mysqlDatabase(connection, { file: database.file });
    try {
      return await scoped.transaction(work);
    } finally {
      connection.release();
    }
  };
  database.close = () => pool.end();
  return database;
}
