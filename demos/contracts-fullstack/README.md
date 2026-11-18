# PlainScript unified-contracts full-stack demo

A small end-to-end proof for the schema-derived contract path: one shared PlainScript module declares runtime schemas and operations; the checker derives each operation's input/output types; a SQLite-backed server validates requests and responses; a React UI consumes the same typed client contracts.

## Run locally

Requires Node.js 22 or newer (for built-in `node:sqlite`). In two terminals, from this directory:

```sh
npm install
DB_PATH=./tasks.db npm run api
```

```sh
npm run dev
```

Open `http://localhost:5173`. The Vite development server proxies `/api` requests to the PlainScript API on port 4410. The API has three operations: list, create, and toggle. Input validation runs in the browser client and again at the server boundary; output validation runs before the client or server handler result is accepted. The API uses a demo bearer credential (`plainscript-demo`): it illustrates the authorization hook, not production secret management. Set `PORT` and `DB_PATH` to change the API port/database file.

For a production bundle, run `npm run build`. The static Vite bundle is in `dist/`; run the API separately. The demo intentionally keeps migrations simple (`CREATE TABLE IF NOT EXISTS`) and does not claim a migration framework, typed error union, or generated transport.

## What the compiler proves

`src/shared.pln` is the single input/output schema and operation definition. `src/server.pln` implements the operation handlers and `src/App.pln` consumes operation clients without maintaining parallel model declarations. Editing a schema changes the derived operation types; incompatible handler/caller code should fail `plainscript check` before runtime. SQLite driver values cross an explicit `any` boundary and are normalized in `rowTask` before the operation output validator runs.

From the repository root, verify the sources with:

```sh
node src/cli.js check demos/contracts-fullstack/src/shared.pln
node src/cli.js check demos/contracts-fullstack/src/server.pln
node src/cli.js check demos/contracts-fullstack/src/App.pln
```
