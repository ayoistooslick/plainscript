# Changelog

All notable changes to PlainScript are documented here.

## [Unreleased]

### `val` alias

- `val` is accepted as an alias for `value` in 2.1 files: `val Messi is 3` declares the same
  immutable binding, including destructuring and `export val … is …` forms. Like `value`,
  `val` is contextual and remains usable as an identifier elsewhere.
- Remove the 3D hero stage and the three-plate art strip (Figs. 02, 04, 05 and 06) from the
  generated documentation homepage.

### Diagnostics

- `PS3301` on a 2.1 declaration word (`value`, `val`, `set`, `change`, `define`, `returns`,
  `each`) now hints that the file looks like 2.1 code and names the fixes: `#syntax 2.1` on
  the first line, or `"syntax": "2.1"` in `plainscript.config.json`.

## [2.1.0] — 2026-11-20

### English-oriented dialect, real integrations and a documentation overhaul

- Add the opt-in 2.1 dialect (`#syntax 2.1`, first line): `value`/`set`/`change` bindings,
  `define … returns`, `when`/`otherwise when`/`otherwise`, `for each`, `for … from … to`,
  `otherwise` as a `match` fallback, and six comparison phrases (`is equal to`, `is not
  equal to`, `is greater than`, `is less than`, `is at least`, `is at most`).
- The dialect is a surface over the existing AST: normalisation runs before parsing, so the
  checker, HIR and emitter are unchanged and 2.0/2.1 modules import one another.
- 2.1 enforces one spelling per concept inside an opted-in file (`PS2030` names the 2.1
  word); `for x in xs` is rejected in favour of `for each`/`for … from`.
- Declaration words are contextual, not reserved, so `value`, `set`, `change`, `define`,
  `returns` and `each` remain valid identifiers. `for each in xs` binds a loop variable named
  `each`; the marker is recognised only when a binding pattern follows it.
- Add a project-wide default dialect: `compilerOptions.syntax` (or a top-level `syntax`) in
  `plainscript.config.json`, plus a `--syntax` flag. Precedence is file pragma, flag,
  configuration, then 2.0; the language server and formatter read the same setting.
- `plainscript fmt` understands 2.1 blocks and preserves the pragma; hover, completion,
  diagnostics and the CLI report dialect errors with source spans.
- Add eight real integration projects under `integrations/`: Express 5 JSON API, React 19 +
  Vite, Next.js 15 App Router server component, async `std/http` server+client, SQLite via
  `node:sqlite`, a typed CLI (arguments, JSON persistence, exit codes), a three-module
  program built with `--declarations`, and a full-stack Express + SQLite + React app.
  Express, React SSR, SQLite, HTTP, the CLI, the multi-module build and the full-stack
  session (HTTP CRUD, restart persistence, SSR) execute in `npm test`; the Vite and Next
  production builds are checked by `npm run verify:integrations`.
- Add `docs/GETTING_STARTED.md`, `docs/LANGUAGE_REFERENCE.md`, `docs/COMPILER.md`,
  `docs/INTEGRATIONS.md` and `docs/MIGRATION_2_1.md`; make the 2.1 dialect the primary
  presentation in the README, homepage and docs navigation, while documenting every 2.0
  spelling. Add section 15 (the 2.1 dialect grammar) to `docs/SPEC.md`.
- Every fenced PlainScript example in the compile-tested documents is compiled by
  `tests/docs-examples.test.js`.
- The compiler suite grows to 303+ tests; no 2.0 test was removed or weakened.
- No npm package has been published for this change.

## Unreleased — V2 completion (breaking; release version TBD)

- Replace conditional `when`/`otherwise` with `if`/`else if`/`else`, and use `if` for
  match guards. Retired words remain reserved so old branch syntax fails clearly.
- Keep `end` block terminators and existing type-checking/runtime semantics.
- Add conditional types, mapped types, generic/deferred indexed access, function overloads
  (including imported and declaration-only `.d.pln` overloads), user-defined type predicates,
  variadic tuples, readonly record fields, distributive conditionals over a naked type
  parameter, recursive type tests and a documented structural variance model.
- Add `std/jobs` (bounded in-process queue, retries/backoff, timeouts, cancellation, drain),
  optional `memoryStore`/`sqliteStore` persistence with startup recovery, SSE responses in
  `std/http`, WebSocket fragmentation/control-frame handling and authorization before the
  upgrade handshake, and buffered-close/nested-group semantics in `std/task`.
- Add dependency-injected PostgreSQL and MySQL adapters (`std/db-postgres`,
  `std/db-mysql`) with dialect-aware DDL, placeholder translation, transactions and the
  shared `std/db` table/migration surface. Drivers remain application dependencies.
- Add optional OIDC and SAML service-provider helpers (`std/oidc`, `std/saml`) built on
  application-installed `openid-client` and `@node-saml/node-saml`.
- LSP: semantic tokens and quick-fix code actions in addition to diagnostics, completion,
  hover, navigation, rename, symbols and formatting; add a minimal stdio DAP debug adapter
  and VS Code debugger contribution.
- CLI: conservative `plainscript migrate` scanner (`--check`, `--json`),
  `plainscript interop` for the supported TypeScript `.d.ts` subset, `plainscript dap`, and
  five new starters (`react-vite`, `next`, `express`, `cli`, `library`).
- HTTP handler exceptions are no longer echoed to clients unless `exposeErrors` is set.
- Add database, jobs, security and debugging documentation; synchronize SPEC, type-system,
  CLI, templates, roadmap and progress docs with the implementation.
- No npm package has been published for this change.

## [2.0.0]  -  2026-11-14

### Language Revival — PlainScript 2.0.0

- Ground-up rebuild of the language, compiler, runtime interface and standard library
- Breaking major release; incompatible with v1.x constructs
- Removed all keyword aliases (`remember`, `show`, `display`, `log`, `make`, `give`, `intend`, `ask`, `bot`, `ocr`, `try`, `recover`, `retry`, etc.); one spelling per concept
- Replaced `done`/`end`/`together` block closers with `end` only
- Removed service constructs from grammar (SQL, WhatsApp, OCR, Telegram, sessions/OAuth)
- Replaced shallow type-spec checker with complete assignability, generics, narrowing, exhaustiveness and `nothing` safety
- Introduced typed HIR (typed Intermediate Representation) consumed by the emitter
- Standard library: 11 explicit modules (`std/io`, `std/text`, `std/list`, `std/map`, `std/math`, `std/json`, `std/time`, `std/fs`, `std/http`, `std/test`, `std/dom`) with `.d.pln` declaration files; `std/text.format` removed (interpolation is the formatting mechanism)
- `render`/`element` blocks lower to `createElement` from module scope (no JSX runtime, no plugin)
- JavaScript ecosystem interoperability: React, Next.js, Vite, Express, Node.js, browser APIs
- One ES module per source file; no bundling; source maps emitted
- `plainscript run`, `build`, `check`, `fmt`, `test`, `new`, `ir`, `version` CLI commands
- 127 tests across lexer, parser, checker, compiler, runtime, CLI, interop, formatter, packaging
- Documentation: `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/AUDIT.md`, `docs/CLI.md`, `docs/INTEROP.md`, `docs/MIGRATION.md`, `docs/DECISIONS.md`
- Zero runtime dependencies; Node.js >= 20

## [1.1.5]  -  2026-09-26

### Trustworthiness foundation

- The v1.1.5 plan is explicitly a completeness milestone: mainstream language
  capabilities are part of this release, not deferred to v1.2.x.
- Added the v1.1.5 gap analysis and implementation contract.
- Hardened inferred collection assignability, collection index checking,
  declared-binding reassignment, nested-loop return checking, and duplicate
  diagnostic suppression.
- Synchronized the compiler, LSP, grammar, package, and VS Code release
  metadata to `1.1.5`.
- Normal compile/build now performs graph-wide static checking before code
  generation, with deterministic collision diagnostics for flattened modules.
- `any of` now uses first-fulfillment semantics (`Promise.any`) and reports
  aggregate failure when every task rejects.
- Formatter branch and cleanup clauses (`else`, `otherwise`, `recover`, and
  `finally`) now preserve valid block indentation.
- Recursive aliases are cycle-safe during assignability checks, aliases that
  resolve to structural unions expose their member fields, and branch-local
  environments retain narrowed union members for safe access.
- Date construction now treats the documented month argument as 1-based;
  formatting supports millisecond tokens and deterministic UTC helpers.
- The VS Code package now starts the real stdio language client with lifecycle
  and shutdown handling, and CI gates the compiler matrix, docs, release
  metadata, tarball consumer, and VSIX packaging.

## [1.1.2]  -  2026-09-25

### Expression type propagation

- Known standard-library calls now contribute stable return types to static
  checking, including numeric helpers, text operations, collection helpers,
  and path/file helpers.

## [1.1.1]  -  2026-09-23

## [1.1.0]  -  2026-09-20

### Expression type propagation

- Known standard-library calls now contribute stable return types to static
  checking, including numeric helpers, text operations, collection helpers,
  and path/file helpers.

## [1.0.363]  -  2026-09-14

### Initial release

- PlainScript v1.0.363 initial release with core compiler infrastructure.

## [1.0.2]  -  2026

### Internal version bump

- Internal version adjustment for publishing workflow.
