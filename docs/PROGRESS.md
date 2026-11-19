# PlainScript engineering status

This file records the current verified state. Earlier per-defect logs are preserved in git
history and in `docs/AUDIT.md`; stale status claims are not kept here.

## Verified baseline

Run `npm test` from the repository root. The current suite covers the compiler, type
checker, contracts, database migrations, authentication, concurrency, jobs, WebSockets,
SSE, LSP, watch mode, CLI, declarations, packages, templates, demos and runtime behavior.
The exact count is printed by the command; CI should treat any failure as a release blocker.

Additional checks:

```bash
node scripts/benchmark.js 40 7   # reproducible compiler timing
plainscript check demos/contracts-fullstack/src/shared.pln
plainscript check demos/contracts-fullstack/src/server.pln
plainscript check demos/contracts-fullstack/src/App.pln
```

## What is complete

- **Contracts through every layer.** Runtime schemas, schema-derived checker types, typed
  success/error results, validation on both sides, authorization callbacks, operation
  router/HTTP transport, SQLite table mapping, versioned migrations with rollback.
- **Authentication.** scrypt password hashing, constant-time verification, HS256 bearer
  tokens with claims validation, policies, and the demo's login/token flow.
- **Type system.** Enum literal unions, tuples, `keyof`, `typeof`, generic constraints,
  record intersections, concrete and deferred indexed access, conditional types, mapped
  types, function overloads (including imported/declaration overloads), user-defined type
  predicates, recursive types and documented function/container variance.
- **Concurrency.** Task groups (including nested parent groups), cancellation, timeouts,
  channels with buffered-close delivery, worker handles, and cleanup/failure tests.
- **Jobs.** Bounded-concurrency in-process queue with retries/backoff, timeouts,
  cooperative cancellation, drain, close and event hooks.
- **Tooling.** LSP diagnostics/completion/hover/definition/references/rename/symbols/
  formatting, semantic tokens, quick-fix code actions, workspace import handling, VS Code
  extension, watch mode, module cache invalidation and unchanged-output skipping.
- **Ecosystem.** HTTP/SSE (`std/http`), WebSockets (`std/ws`), SQLite (`std/db`), auth
  (`std/auth`), async/tasks (`std/task`), jobs (`std/jobs`), React/Next/Vite/Node interop
  and eight starters.
- **Adoption.** Conservative `plainscript migrate` reporting, JavaScript/npm interop and
  incremental migration guidance.

## Evidence

Focused files:

- `tests/contract-errors.test.js`, `tests/contract-demo.test.js`, `tests/db.test.js`
- `tests/task.test.js`, `tests/jobs.test.js`, `tests/http.test.js`, `tests/ws.test.js`
- `tests/lsp.test.js`, `tests/watch.test.js`, `tests/cli.test.js`
- `tests/type-level.test.js`, `tests/overloads.test.js`, `tests/predicates.test.js`,
  `tests/variance.test.js`, `tests/recursive-types.test.js`, `tests/declarations.test.js`
- `docs/BENCHMARKS.md`

## Remaining limitations

See the README limitation list and `docs/ROADMAP.md`. In particular, non-SQLite `std/db`
adapters, arbitrary TypeScript `.d.ts` parsing, WebSocket fragmentation, variadic tuple
types, durable background jobs, a debug adapter and a cross-language performance baseline
are not implemented. Direct npm database drivers are documented in [DATABASES](DATABASES.md).
No package has been published as part of this work.
