# Changelog

All notable changes to PlainScript are documented here.

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
