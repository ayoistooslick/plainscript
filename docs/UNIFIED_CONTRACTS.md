# Unified full-stack contracts

**Status: implemented through schemas, typed operations, typed errors, dispatch, SQLite
models/migrations, PostgreSQL/MySQL adapter surfaces and a real authentication flow.** The verified application is
[`demos/contracts-fullstack`](../demos/contracts-fullstack); its integration test logs in,
validates, mutates, restarts the process and checks persistence.

## One schema path

`std/contract.object` derives a structural record type from its schema shape. Enum and
literal fields derive literal unions, optional schema fields become optional record fields,
and arrays/nested objects retain their element and field types. The compiler does not
require a parallel `type Task` or a frontend model declaration.

```plainscript
import { object, text, number, boolean, enumeration, oneOf, literal, fallibleOperation } from "std/contract"

export const TaskSchema = object({
    id: number(),
    title: text({ minLength: 1 }),
    done: boolean(),
    status: enumeration(["open", "done"]),
})
export const TaskError = oneOf([
    object({ code: literal("NOT_FOUND"), message: text() }),
    object({ code: literal("FORBIDDEN"), message: text() }),
])
export const GetTask = fallibleOperation("tasks.get", object({ id: number() }), TaskSchema, TaskError)
```

`TaskSchema` is used by the server, the React client and `std/db.table`; a field change is
one edit. `object` strips unknown keys by default, `strict` rejects them, and `passthrough`
retains them. Runtime parsing is still mandatory at every trust boundary.

## Server and client

```plainscript
import { implementFallible, success, failure, router, resultToWire, createFallibleClient } from "std/contract"

let endpoint = implementFallible(GetTask, async (input) => do
    let task = tasks.get(input.id)
    if task == nothing
        return failure({ code: "NOT_FOUND", message: "missing" })
    end
    return success(task as any)
end, { authorize: authorize })

let routes = router({ "tasks.get": endpoint })
let wire = resultToWire(await routes.handle("tasks.get", { id: 1 }, context))
let client = createFallibleClient(GetTask, httpTransport("/api"))
```

`implementFallible` validates the input, calls the authorization callback, validates either
the success payload or the declared error against `TaskError`, and returns an
`OperationResult`. `createFallibleClient` validates the local input, decodes
`{ok, value}`/`{ok, error}` (or runtime results), and validates both outcomes.
`router` rejects unknown operation names with a routing `OperationError`.
`httpTransport` is the built-in JSON transport; applications can supply any transport
function with the same `(name, input) -> Promise` shape.

The normal `operation`/`implement`/`createClient` API remains for handlers that throw
errors. It is not a substitute for the typed result path.

## Database model mapping and migrations

```plainscript
import { open, table, migrate, Database } from "std/db"

let database = await open("./app.db")
await migrate(database, [{
    version: 1,
    name: "tasks",
    up: async (db: Database) => do
        db.exec("create table tasks (id integer primary key autoincrement, title text not null, done integer not null)")
    end,
}])
let tasks = table(database, "tasks", TaskSchema)
```

`table` derives columns from `TaskSchema` (text, number, boolean, JSON arrays/objects,
optional fields and primary-key options), validates rows through the same schema, and uses
bound parameters for every value. The PostgreSQL and MySQL adapters expose the same
`table`/`migrate` helpers over application-installed drivers; their table methods are
asynchronous, while SQLite stays synchronous. `migrate` keeps a `plainscript_migrations`
history, applies versions in order in `BEGIN IMMEDIATE` transactions (translated to the
adapter's dialect), rolls back the whole migration on failure, rejects duplicate versions
and refuses to apply around a history gap. `rollback` runs declared `down` migrations; a
migration without `down` cannot be rolled back. The schema itself remains a contract, not a
replacement for database design review. See [DATABASES](DATABASES.md).

## Authentication and authorization

`std/auth` supplies scrypt password hashing with random salts and constant-time
verification, HS256 bearer tokens with `exp`/`nbf`/`iss`/`aud` validation, `bearer`
extraction from plain or `Headers` requests, and reusable policies. `std/oidc` and
`std/saml` provide optional service-provider flows over `openid-client` and
`@node-saml/node-saml`; they do not include a user store or session manager. The flagship demo:

- creates `tasks` and `users` through a versioned migration;
- seeds a development user with a scrypt hash;
- exposes `POST /api/auth/login` and signs a one-hour token;
- verifies tokens on every task route and passes the user through the authorization
  callback;
- returns a typed `NOT_FOUND` failure from `/api/tasks/get` with status 404.

`AUTH_SECRET` should be set in production. The checked-in fallback exists only so the demo
can start immediately; it is clearly a development credential.

## Compile-time behavior

The module graph shares the schema-derived operation types. Incompatible client inputs,
handler outputs and typed error codes are rejected before runtime (`PS3343`/`PS3404`). The
negative tests include a wrong enum literal, an incompatible backend result and a
`failure({ code: "INVALID" })` that is not in the declared error union. Enum literal
unions also drive exhaustive `match` checking.

## Evidence and limitations

Verified by:

- `tests/contract-demo.test.js` — compiled sources; login, 401/403, invalid input, create,
  toggle, typed 404 failure, API restart and persistence;
- `tests/contract-errors.test.js` — enum inference, exhaustiveness, typed results, router,
  negative error union, authorization failure validation;
- `tests/contract-typecheck.test.js` and `tests/shared-contract-modules.test.js` — existing
  cross-module contract enforcement;
- `tests/db.test.js` — schema-derived tables, persistence, invalid migration rollback,
  duplicate versions, rollback requirements and identifier/row rejection.

Not implemented: compiler-owned operation syntax, generated OpenAPI/docs, automatic
frontend code generation beyond the typed runtime client, a MongoDB adapter, live
PostgreSQL/MySQL integration testing in this repository, and full identity-provider
account/session management. OIDC/SAML wrappers are tested with library-shaped fakes, not a
live provider; `std/auth` is real cryptography, not a full identity product. See
[ROADMAP](ROADMAP.md).
