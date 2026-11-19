# Databases

PlainScript has no database runtime of its own. Application code imports the same npm
driver it would use from JavaScript, passes values as bound parameters, and keeps contract
validation at the boundary.

## Supported through `std/db` today

`std/db` implements schema-derived tables and versioned migrations on Node 22's built-in
`node:sqlite`. It is the only driver with a bundled adapter.

```plainscript
import { open, table, migrate, Database } from "std/db"

let database = await open(process.env.DB_PATH ?? ":memory:")
await migrate(database, [{
    version: 1,
    name: "tasks",
    up: async (db: Database) => do
        db.exec("create table tasks (id integer primary key autoincrement, title text not null, done integer not null)")
    end,
}])
let tasks = table(database, "tasks", TaskSchema)
```

`table` derives columns from the same schema used by `std/contract`, validates every row
through that schema and binds every value. `migrate` records versions in
`plainscript_migrations`, uses `BEGIN IMMEDIATE`, rolls back a failed migration and refuses
duplicate versions or history gaps. `rollback` requires a `down` function.

Node's `node:sqlite` is marked experimental by Node 22. The checked-in tests cover it; a
production service should verify the exact Node version it deploys.

## PostgreSQL

Use the `pg` package directly. This is ordinary JavaScript interop, not a wrapper:

```plainscript
import pg from "pg"

declare const process: any

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 })

async function findTask(id: number) -> any
    let result = await pool.query("select * from tasks where id = $1", [id])
    return result.rows[0]
end

async function createTask(title: text) -> any
    let result = await pool.query(
        "insert into tasks (title) values ($1) returning *",
        [title],
    )
    return result.rows[0]
end

async function withTransaction(work: (client: any) -> Promise of any) -> any
    let client = await pool.connect()
    try
        await client.query("begin")
        let value = await work(client)
        await client.query("commit")
        return value
    catch error
        await client.query("rollback")
        throw error
    finally
        client.release()
    end
end
```

PostgreSQL uses `$1` placeholders. The built-in `std/db.table` generates SQLite `?`
placeholders and SQLite type names, so do not combine it with `pg`; write the table and
migration SQL explicitly or add an adapter.

## MySQL and MariaDB

Use `mysql2/promise`:

```plainscript
import mysql from "mysql2/promise"

const pool = mysql.createPool({
    host: "127.0.0.1",
    user: "app",
    password: process.env.MYSQL_PASSWORD,
    database: "app",
    connectionLimit: 10,
})

async function findTask(id: number) -> any
    let [rows] = await pool.query("select * from tasks where id = ?", [id])
    return rows[0]
end
```

Both `?` placeholders and `execute` are supported by `mysql2`. Use `execute` for prepared
statements when the driver advises it. Transactions follow the same acquire/begin/commit/
rollback/release shape as PostgreSQL.

## MongoDB

Use the official driver:

```plainscript
import { MongoClient } from "mongodb"

let client = new MongoClient(process.env.MONGODB_URL ?? "mongodb://127.0.0.1:27017")
await client.connect()
let tasks = client.db("app").collection("tasks")

async function findTask(id: any) -> any
    return await tasks.findOne({ _id: id })
end

async function addTask(document: any) -> any
    let result = await tasks.insertOne(document)
    return result.insertedId
end
```

MongoDB has no SQL parameterization; validate and shape documents through `std/contract`
before writing, and never interpolate untrusted text into a query object. Driver methods are
`any` at the boundary, so declare thin typed wrappers for your own API.

## Validation and serialization

Validate at the trust boundary with the same schema the contract uses:

```plainscript
import { parse } from "std/contract"

let input = parse(CreateTaskInput, await requestJson(request))
```

`std/contract` strips unknown keys for `object` schemas, rejects them with
`unknownKeys: "strict"`, and parses nested arrays/objects. Store only validated values.
JSON columns are text at the SQLite layer and are encoded/decoded by `std/db.table`; SQL
drivers with native JSON types should receive ordinary objects/arrays.

## Connection lifecycle

- Create one pool/client at process startup; do not open a connection per request.
- Release/clients in `finally`; roll back before releasing.
- Set pool limits and connect/statement timeouts for the deployment.
- Close the pool on `SIGTERM` after draining HTTP and jobs.
- Use TLS and a least-privilege database user in production; keep credentials in the
  deployment's secret store, never in `.pln` source.

## Verified scope

`tests/db.test.js` verifies SQLite tables, persistence, parameter binding, migrations,
rollback and failure behavior. PostgreSQL, MySQL and MongoDB examples are integration
recipes, not bundled adapters; no live server for those drivers is available in the
repository's test environment, so they are not claimed as automatically tested. Install the
driver in the application's own `package.json` and run your integration suite against a real
instance before deployment.
