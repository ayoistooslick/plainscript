# PlainScript engineering status

This file records the current verified state. Earlier per-defect logs are preserved in git
history and in `docs/AUDIT.md`; stale status claims are not kept here.

## Verified baseline

Run `npm test` from the repository root. The current suite covers the compiler, type
checker, contracts, database migrations, authentication, concurrency, WebSockets, LSP,
watch mode, CLI, declarations, packages, demos and runtime behavior. The exact count is
printed by the command; CI should treat any failure as a release blocker.

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
- **Type system additions.** Enum literal unions, tuples, `keyof`, `typeof`, generic
  constraints, improved callback return checking and cross-module variant metadata.
- **Concurrency.** Task groups, cancellation, timeouts, channels and worker handles with
  tests for ordering, failure cancellation and cleanup.
- **Tooling.** LSP diagnostics/completion/hover/definition/references/rename/symbols/
  formatting, workspace import handling, VS Code extension, watch mode, module cache
  invalidation and unchanged-output skipping.
- **Ecosystem.** HTTP/SSE (`std/http`), WebSockets (`std/ws`), SQLite (`std/db`), auth
  (`std/auth`), async/tasks (`std/task`), React/Next/Vite/Node interop and templates.

## Evidence

Focused files:

- `tests/contract-errors.test.js`, `tests/contract-demo.test.js`, `tests/db.test.js`
- `tests/task.test.js`, `tests/ws.test.js`
- `tests/lsp.test.js`, `tests/watch.test.js`
- `tests/advanced-types.test.js`, `tests/generics.test.js`
- `docs/BENCHMARKS.md`

## Remaining limitations

See the README limitation list and `docs/ROADMAP.md`. In particular, conditional/mapped
types, indexed-access types, user-defined type predicates, function overloads, arbitrary
TypeScript `.d.ts` parsing, non-SQLite database adapters, WebSocket fragmentation, and a
cross-language performance baseline are not implemented. No package has been published as
part of this work.
