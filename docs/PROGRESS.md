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
  router/HTTP transport, SQLite/PostgreSQL/MySQL table mapping, versioned migrations with
  rollback.
- **Authentication.** scrypt password hashing, constant-time verification, HS256 bearer
  tokens with claims validation, policies, and the demo's login/token flow.
- **Type system.** Enum literal unions, fixed and variadic tuples, readonly record
  fields, `keyof`, `typeof`, generic constraints, record intersections, concrete and
  deferred indexed access, conditional types (including distribution over a naked type
  parameter), mapped types, function overloads (including imported/declaration overloads),
  user-defined type predicates, recursive types and documented function/container variance.
- **Concurrency.** Task groups (including nested parent groups), cancellation, timeouts,
  channels with buffered-close delivery, worker handles, and cleanup/failure tests.
- **Jobs.** Bounded-concurrency in-process queue with retries/backoff, timeouts,
  cooperative cancellation, drain, close, event hooks, memory/SQLite stores, startup
  recovery, persisted attempt records and missing-handler failure reporting.
- **Tooling.** LSP diagnostics/completion/hover/definition/references/rename/symbols/
  formatting, semantic tokens, quick-fix code actions, workspace import handling, a minimal
  stdio DAP server backed by Node's inspector/source maps, VS Code LSP/debugger integration,
  watch mode, module cache invalidation and unchanged-output skipping.
- **Ecosystem.** HTTP/SSE (`std/http`), WebSockets with fragmentation/control frames
  (`std/ws`), SQLite (`std/db`), PostgreSQL/MySQL adapters (`std/db-postgres`,
  `std/db-mysql`), auth (`std/auth`), OIDC/SAML helpers (`std/oidc`, `std/saml`),
  async/tasks (`std/task`), jobs (`std/jobs`), React/Next/Vite/Node interop and eight
  starters.
- **Adoption.** `plainscript migrate` analysis/conversion/boundaries, JSON-RPC bridge and
  generated clients for fourteen ecosystems, `plainscript interop` for a supported
  `.d.ts` subset, JavaScript/npm interop and incremental migration guidance.
- **2.2 language work.** Native JSX with classic/automatic React runtimes and prop
  checking; native regex literals with typed `std/text` helpers; resolved re-exports;
  executable declared runtimes and generated boundaries; React + Vite integration
  rewritten in PlainScript JSX.
- **2.3 language work.** Classes, inheritance, `super`, `this`, static/readonly
  members, generic classes and decorators; generators and `Iterator of T`; typed
  throws and catches with runtime checking; ternary, BigInt, computed keys,
  shorthand fields and nested block comments.
- **2.3 tooling.** `plainscript bundle`, a persistent per-file build cache with
  dependency invalidation, HIR constant folding/dead-code removal, ten new
  standard library modules and a typed TypeScript bridge client.
- **2.3 verification.** `tests/language-2-3.test.js` covers each language
  feature; `scripts/verify-bindings.js` compiles and executes generated clients;
  CI runs Linux, macOS and Windows on Node 20 and 22 plus a live
  PostgreSQL/MySQL job.

## Evidence

Focused files:

- `tests/contract-errors.test.js`, `tests/contract-demo.test.js`, `tests/db.test.js`
- `tests/task.test.js`, `tests/jobs.test.js`, `tests/durable-jobs.test.js`,
  `tests/http.test.js`, `tests/ws.test.js`, `tests/ws-protocol.test.js`
- `tests/db.test.js`, `tests/db-adapters.test.js`, `tests/auth-interop.test.js`
- `tests/lsp.test.js`, `tests/dap.test.js`, `tests/watch.test.js`, `tests/cli.test.js`,
  `tests/typescript-interop.test.js`
- `tests/type-level.test.js`, `tests/overloads.test.js`, `tests/predicates.test.js`,
  `tests/variance.test.js`, `tests/recursive-types.test.js`, `tests/declarations.test.js`,
  `tests/advanced-v2-types.test.js`
- `docs/BENCHMARKS.md`

## Remaining limitations

See `docs/ROADMAP.md` and `docs/CAPABILITY_AUDIT_2_3.md`. A MongoDB adapter,
arbitrary TypeScript `.d.ts` parsing, WebSocket extensions, distributed job
leases, VS Code UI automation for DAP, a browser bundler and a reproducible
cross-language performance baseline are not implemented. `std/worker` and
`std/net` are Node-only. The debug adapter is protocol-tested, not clicked
through in an editor. Live PostgreSQL/MySQL tests run in CI; locally they require
the service environment described in the workflow.

## 2.3.0 publication

- npm: `plainscript-lang@2.3.0` is the `latest` tag; a clean install was
  verified to report `2.3.0` and execute a class program.
- GitHub: release and tag `v2.3.0` point at the 2.3.0 release commit.
- Documentation: <https://ayoistooslick.github.io/plainscript/> serves Vol. 2.3,
  including the restored Fig. 01–05 captions, the migration guide and the
  standard library page. The deployed pages were fetched and checked after the
  deployment.
