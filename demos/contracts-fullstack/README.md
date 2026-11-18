# PlainScript unified-contracts full-stack demo

One shared PlainScript module declares runtime schemas, typed error unions and operations.
The checker derives each operation's input/output types; a SQLite-backed server validates
requests, authorization and typed outcomes; a React UI consumes the same typed client
contracts. No frontend model declarations duplicate the shared schema.

## Run locally

Requires Node.js 22 or newer (for built-in `node:sqlite`). From this directory:

```sh
npm install
DB_PATH=./tasks.db AUTH_SECRET=dev-only-change-me npm run api
```

In a second terminal:

```sh
npm run dev
```

Open `http://localhost:5173`. The Vite development server proxies `/api` requests to the
PlainScript API on port 4410. Log in with the seeded development account:

```text
username: demo
password: plainscript-demo
```

The API runs versioned migrations on startup, seeds that account with a scrypt hash, signs
an HS256 bearer token, verifies it on every task route and passes the user to the
authorization callback. The fallback `AUTH_SECRET` is a development credential only;
`DB_PATH` selects the SQLite file and `PORT` changes the API port.

Operations are `tasks.list`, `tasks.create`, `tasks.toggle` and fallible `tasks.get`.
Input validation runs in the browser client and again at the server boundary. Output
validation runs before a handler result or client response is accepted. A missing task
returns a typed `NOT_FOUND` `OperationFailure`, which the server maps to HTTP 404 and the
client matches exhaustively.

For a production bundle, run `npm run build`. The static Vite bundle is in `dist/`; run the
API separately.

## What the compiler proves

`src/shared.pln` is the single schema/operation definition. `src/server.pln` implements
handlers through `implement`/`implementFallible`, `router` dispatches by operation name, and
`src/App.pln` consumes `createClient`/`createFallibleClient`. Editing a schema changes the
derived operation types; an incompatible caller, handler result or error code fails
`plainscript check` before runtime. SQLite driver rows cross an explicit `any` boundary and
are validated by the same schema.

From the repository root:

```sh
node src/cli.js check demos/contracts-fullstack/src/shared.pln
node src/cli.js check demos/contracts-fullstack/src/server.pln
node src/cli.js check demos/contracts-fullstack/src/App.pln
node --test tests/contract-demo.test.js
```

The integration test logs in, exercises typed success and failure paths, restarts the API
against the same database file and verifies persistence.
