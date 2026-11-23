# Changelog

All notable changes to PlainScript are documented here.

## [2.3.1] — 2026-11-23

### Windows, macOS and live-database fixes

- Accept a CRLF first line in the `#syntax` pragma and tolerate a trailing
  `\r`, so a 2.1 file checked out with Windows endings still opts in to the
  dialect instead of reporting `PS3301`.
- Normalize source-map source names before matching: relative paths, absolute
  POSIX paths, Windows paths and `file:` URLs are compared with forward
  slashes, percent-decoded and a lower-case drive letter. `plainscript dap`
  now maps breakpoints and stack frames in a Windows checkout.
- Wrap MySQL connection creation and the initial ping in `DatabaseError` and
  close a half-open connection when the ping fails, so a refused or failing
  connection reports the adapter error rather than a raw driver exception.
- Add `scripts/run-tests.js`, the file-list test runner behind `npm test`. Node
  20 does not expand `tests/*.test.js` and Node 22 rejects a directory argument
  for `--test`; the runner works on both, on Linux, macOS and Windows.
- Compile documentation examples from Markdown normalized to LF, so a CRLF
  checkout does not fail the docs-example suite.
- Skip Node 22-only capabilities on Node 20 with an explicit reason
  (`node:sqlite` persistence, the debug adapter, the WebSocket test client) and
  keep them covered on Node 22.
- Pin the cross-language bindings CI job to `ubuntu-24.04`, the newest runner
  image with a Swift toolchain the setup action supports.

### Compatibility

No source or API change. 2.3.0 programs compile and run unchanged.

## [2.3.0] — 2026-11-22

### Classes and objects

- Parse and check `class`, `constructor`, `function` methods, `static` and
  `readonly` fields, `extends`, `super`, `this`, generic classes and `new`.
- Emit native JavaScript classes with prototype methods and static members.
- Infer generic class arguments from constructor calls, check definite field
  assignment and readonly assignment, and narrow with nominal `is` checks.
- Add class decorators and method/field decorators using the TypeScript legacy
  protocol: the decorated value is passed first and the returned value replaces
  the binding.
- Update the formatter, LSP symbols, semantic tokens and keyword completion.

### Generators and iteration

- Add `generator function`, `yield` and `Iterator of T`.
- Consume generator values with `for ... in`.
- Add `std/iter` with `range`, `map`, `filter`, `take`, `drop`, `chain`,
  `enumerate`, `zip`, `reduce`, `count`, `some`, `every`, `find` and `forEach`.

### Typed failures

- Add optional `throws Type` clauses to functions, methods and signatures.
  Subclasses are accepted nominally; `throws nothing` forbids throwing.
- Add `catch error: Type`, checked against the thrown contract and guarded at
  run time so a mismatched value is rethrown before the handler runs.

### Expressions and data

- Add ternary expressions with lazy branch evaluation.
- Add BigInt literals and a distinct `bigint` type with arithmetic and comparison.
- Add computed record keys and shorthand fields.
- Add nested block comments.
- Add runtime `typeof`.

### Compiler and tooling

- Add `plainscript bundle`, producing one ES module with external package and
  `std/*` imports and rejecting exported `let` bindings that cannot preserve
  ESM live bindings.
- Add a persistent `.plainscript/build-cache.json` cache keyed by source,
  compiler fingerprint, configuration and recursive dependency hashes.
  `--no-cache` bypasses it.
- Add HIR optimisations: constant folding, constant conditional selection and
  unreachable-statement removal that preserves hoisted declarations.
  `--no-optimize` disables them.
- Extend `.d.ts` import: real `declare class` output with constructors,
  parameter properties, statics, getters, methods, `this`, `bigint`, `Date`,
  `Error`, `RegExp`, `Function` and utility types.

### Standard library

- Add `std/iter`, `std/reflect`, `std/bigint`, `std/env`, `std/process`,
  `std/crypto`, `std/compress`, `std/stream`, `std/worker` and `std/net`, each
  with declarations and runtime coverage.
- Add a typed TypeScript bridge client; bindings now cover 14 targets.

### Verification and release

- Add `tests/language-2-3.test.js` covering every language feature, including
  runtime behaviour and negative diagnostics.
- Add `scripts/verify-bindings.js` to compile and execute generated clients
  where toolchains exist, and `scripts/benchmark-cache.js` for the cache.
- Replace CI with Linux/macOS/Windows on Node 20 and 22, an all-language bindings
  job and a live PostgreSQL/MySQL job.
- Document the 2.3 surface in the README, specification, language reference,
  migration guide, capability audit, standard library page and roadmap.

### Compatibility

2.0, 2.1 and 2.2 source compiles unchanged. `class` and `throws` remain usable
as identifiers. One diagnostic is intentionally stricter: a declared `throws`
type is now checked nominally, so throwing an unrelated class with a similar
shape is rejected. Remove the `throws` clause to keep the old unchecked
behaviour.

## [2.2.0] — 2026-11-22

### Native JSX and React components

- Parse JSX natively in `.pln` files: elements, fragments, nested children, expression
  containers, text/entities, quoted and expression attributes, boolean attributes and
  `{...record}` spread attributes.
- Add classic and automatic runtimes. Classic lowers to a configurable
  `factory(type, props, ...children)` (default `createElement`); automatic lowers to
  `jsx`/`jsxs` imported from `${importSource}/jsx-runtime`.
- Add per-file `# @jsx`, `# @jsxFrag`, `# @jsxRuntime` and `# @jsxImportSource` pragmas,
  plus `jsx` and `compilerOptions.jsx` project configuration. Pragmas override project
  defaults per file.
- Add component prop checking for local components with record props: unknown prop
  (`PS3420`), wrong type (`PS3421`), missing required prop (`PS3422`) and missing classic
  factory (`PS3405`). JSX lexical errors use `PS1009`–`PS1014`.
- Add JSX AST nodes and HIR lowering with source-line preservation. Rewrite
  `integrations/react-vite/src/App.pln` to native JSX and render it through
  `react-dom/server` in the test suite.
- Fix spread attributes and spread children, which previously passed the leading `...`
  to the expression parser.

### Native regular expressions

- Add regex literals `/pattern/flags` as native expressions with expression-position
  disambiguation: `/` is division after a value and a regex start where an expression is
  expected.
- Add the `regex` primitive type, member typing (`test`, `source`, `flags`, `global`,
  `ignoreCase`, `multiline`, `dotAll`, `unicode`, `sticky`, `hasIndices`) and emitted
  native `RegExp` values.
- Validate patterns and flags at compile time: `PS1006` unterminated literal, `PS1007`
  invalid flags, `PS1008` invalid pattern.
- Add `std/text` helpers `matches`, `findMatch`, `findAllMatches`, `matchTexts`,
  `splitMatch`, `replaceMatch`, `replaceAllMatches`, `escapeRegex` and the `RegexMatch`
  record (full text, index, positional groups, named groups).
- Cover captures, named groups, flags, replacement, splitting, zero-length matches,
  Unicode and division disambiguation in the test suite.

### Cross-language interoperability

- Add `plainscript bridge`, serving a module's checked exports over newline-delimited
  JSON-RPC 2.0 on stdio or HTTP (`--http`, `--call`, `--args`, `--manifest`).
- Add manifests describing exported functions, params, return types, records, lists, maps
  and async status.
- Add `plainscript bindings`, generating clients for JavaScript, TypeScript, Python, C,
  C++, Java, Kotlin, Go, Rust, Ruby, PHP, C#, Swift and Dart.
- Add `std/bridge` (`open`, `call`, `close`, `Bridge`) and the reference Python server.
- Verify JavaScript and Python clients end to end and compile/run the C client. Document
  that JVM, Go, Rust, C#, Ruby, PHP, Swift and Dart clients are generated but not executed
  in this environment.
- Add support for JSON-RPC batches and notifications in the stdio transport.

### Migration tooling

- Rewrite `plainscript migrate` as a project analysis and incremental migration tool:
  language, framework, module-system, package-manager and marker detection; exports and
  imports; phased plan; safe conversion; boundary generation; Markdown/JSON reports.
- Add conservative JavaScript conversion for eligible modules. The converter refuses
  classes, JSX, CommonJS, default exports, wildcard re-exports, generators, decorators,
  dynamic import and `eval` rather than mistranslating them.
- Add boundary triplets for JSX/TS/TSX/CommonJS modules:
  `bridges/Name.pln`, `Name.runtime.js`, `Name.runtime.d.pln`. The original module stays
  authoritative.
- Add conservative export detection for Python, Rust, Go, Java, Kotlin, Ruby, PHP, C#,
  Swift and Dart modules; these stay native and are connected through the bridge.
- Add CLI flags `--write`, `--report`, `--json` and `--check`, retaining the 2.1
  `files`/`findings` JSON fields and scan codes.
- Add migration tests covering analysis, conversion, refusal, boundaries, a boundary
  executed against a real JS runtime and the CLI workflow.

### Module system and compiler output

- Resolve value re-exports (`export { name } from "./module"`) in the checker and module
  loader. Previously they were emitted but not importable.
- Copy project-local declared JavaScript runtimes into build/run output so generated
  boundaries execute.
- Do not copy installed package files under `node_modules`; the host resolves complete
  packages. This fixes a regression where only one package runtime file was emitted.
- Give generated boundary runtimes distinct names so compiling the wrapper cannot
  overwrite its runtime adapter.
- Keep JSX options per module when compiling graphs.

### Tooling, documentation and tests

- Add `docs/JSX.md`, `docs/REGEX.md`, `docs/CROSS_LANGUAGE.md`,
  `docs/MIGRATION_2_2.md` and `docs/CAPABILITY_AUDIT_2_2.md`; add them to the generated
  documentation site navigation and search.
- Update the README, language reference, specification, CLI, architecture, integration,
  getting-started, interop, progress, roadmap, audit index and AI field guide for 2.2.
- Add compile-tested examples for the new guides and update language-reference examples.
- Add `tests/jsx.test.js`, `tests/regex.test.js`, `tests/interop.test.js` and
  `tests/migration.test.js`. The suite is now 382 tests (380 pass, 2 live-database tests
  skipped without server URLs).
- Update the React + Vite integration to native PlainScript JSX.

### Compatibility

- No source migration is required from 2.1. 2.0 and 2.1 files compile unchanged.
- Classic JSX requires a factory in scope, matching JavaScript's classic runtime. Use the
  automatic runtime pragmas if a `createElement` import is undesirable.
- Regex semantics are the host JavaScript engine's semantics; the compiler validates
  literals but does not replace the engine.
- Non-JavaScript interop is a JSON-RPC process boundary, not native FFI. See
  `docs/CAPABILITY_AUDIT_2_2.md` for remaining limitations.

### `val` alias

- `val` is accepted as an alias for `value` in 2.1 files: `val Messi is 3` declares the same
  immutable binding, including destructuring and `export val … is …` forms. Like `value`,
  `val` is contextual and remains usable as an identifier elsewhere.
- Remove the 3D hero stage and the three-plate art strip (Figs. 02, 04, 05 and 06) from the
  generated documentation homepage.

### Rendering

- `for each`, `for … from … to`, `while`, `when` and `match` are now valid children of a
  `render`/`element` block and contribute the children their executed path creates. A
  dynamic keyed list no longer needs a helper function, and the previous internal crash
  (“Lowering does not support expression ForEach”) is gone.
- A `return`, `throw`, `break` or `continue` directly inside a render block reports
  `PS3410` instead of failing during lowering.
- `element Fragment` renders sibling children without a wrapper element and works with
  explicit keys; this is now documented and covered by a server-render test.

### Type checking

- `Promise` exposes typed `then`, `catch` and `finally` methods, so rejection handlers are
  checked and `p.then((n: text) => …)` is rejected when `p` resolves a `number`.
- A recursive generic alias such as `type Box<T>` with a `Box<T>?` field no longer
  overflows the stack; the recursion point becomes a named reference.

### TypeScript declaration interop

- `declare class` declarations translate to an instance record plus a `declare const`
  binding (readonly fields, methods, optional members), with private/protected members
  skipped and static members omitted with one `PS7005` warning.
- Template-literal types expand to a literal union when every substitution is finite;
  open patterns widen to `text` with `PS7005`.
- Repeated interfaces merge instead of producing a duplicate type declaration, and a
  generic method widens to its constraint with `PS7005` rather than dropping the whole
  declaration.

### Database adapters

- `tests/db-live.test.js` runs the PostgreSQL/MySQL adapters against real servers when
  `PLAINSCRIPT_TEST_POSTGRES_URL`/`PLAINSCRIPT_TEST_MYSQL_URL` and `pg`/`mysql2` are
  present, covering connection failure, binding, invalid queries, rollback and commit.
- PostgreSQL placeholder translation now leaves `'it''s ?'` and `$$ … ? … $$` untouched.

### Release engineering

- The publish workflow no longer defaults to `2.0.0`; it defaults to `2.1.0` and refuses a
  target older than `package.json`'s version.

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
