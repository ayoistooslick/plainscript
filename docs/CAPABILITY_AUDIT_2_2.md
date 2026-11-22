# PlainScript 2.2 capability audit

This audit records what was inspected for 2.2, what changed, and what remains
absent. It covers the language surface, compiler, runtime, standard library,
tooling, interoperability, migration and production readiness. It is a status
document, not a roadmap promise.

The audit was performed against this checkout with the full suite:

```bash
npm test
# 382 tests: 380 passed, 2 skipped, 0 failed
```

The two skipped tests require a live PostgreSQL/MySQL server; they are reported
as unverified here, not as passing.

## Method

- Read the lexer, parser, checker, HIR, code generator, module graph, CLI, LSP,
  formatter, standard library declarations, integrations, tests and docs.
- Ran the full suite before and after each change.
- Exercised JSX through React 19 server rendering and a real React + Vite
  integration.
- Exercised regex literals, captures, named groups, flags, replacement,
  splitting and diagnostics end to end.
- Exercised the JSON-RPC bridge over stdio and HTTP, Python in both directions,
  generated JavaScript/Python clients and a compiled C client.
- Exercised migration analysis, conversion, boundary generation and the CLI on
  fixture projects, including a generated boundary executed against a real
  JavaScript runtime.
- Audited the standard library surface and documented tooling limits from the
  implementation, not from README claims.

## What 2.2 resolves

### Native JSX

The lexer scans JSX structurally, the parser produces JSX AST nodes, the checker
validates component props, and the HIR lowers to a configurable runtime. Both
React runtimes are supported:

- classic `createElement` / custom factory;
- automatic `jsx`/`jsxs` from a configurable import source.

Fragments, attributes, spread attributes, expression children, text
normalisation, entities, custom factories and per-file pragmas are implemented.
Prop diagnostics `PS3420`–`PS3422` and missing-factory `PS3405` are reported.
The React + Vite integration is now written in PlainScript JSX and is rendered
through `react-dom/server` in the suite.

Status: **fixed**. Remaining limitation: third-party component types are `any`;
there is no TypeScript `JSX.IntrinsicElements` import.

### Native regular expressions

Regex literals are parsed by the lexer with expression-position
disambiguation, typed as a `regex` primitive, checked, and emitted as native
`RegExp` values. Flags and patterns are validated at compile time
(`PS1006`–`PS1008`). `std/text` supplies typed match, capture, replacement,
splitting and escaping helpers.

Status: **fixed**. The pattern engine is the host JavaScript engine, by design.

### Universal cross-language interoperability

The new JSON-RPC 2.0 bridge provides a process boundary in both directions:

- `plainscript bridge` serves a PlainScript module over stdio or HTTP;
- `plainscript bindings` generates clients for JavaScript, TypeScript, Python,
  C, C++, Java, Kotlin, Go, Rust, Ruby, PHP, C#, Swift and Dart;
- `std/bridge` calls a Python (or other JSON-RPC) service from PlainScript.

JavaScript and TypeScript remain the native path through ESM, npm, Node builtins
and translated declarations.

Status: **implemented and partially verified**. JavaScript, Python and C were
executed end to end. Other generated clients were generated but not compiled or
run because their toolchains are absent here. Native FFI, shared-library
embedding and WebAssembly are **not** implemented.

### Migration tooling

`plainscript migrate` now performs project analysis, framework and language
detection, phased planning, conservative conversion, boundary generation,
Markdown/JSON reporting and CI-friendly `--check`. Boundaries are generated for
ESM and CommonJS JavaScript/JSX/TS/TSX modules, and converted modules are
executable.

Status: **implemented for the JavaScript family**. Non-JavaScript modules are
analysed and classified as manual; they are connected through the bridge, not
source-translated. Automated execution of a project's test command is not part
of the tool.

### Module-system corrections found during the audit

These were not on the original roadmap but blocked real use:

- `export { name } from "./module"` was emitted but not resolved by the checker,
  so a re-export could not be imported. The module loader now loads re-export
  targets and the checker forwards their checked exports.
- Generated boundaries originally emitted a wrapper `.js` and copied a runtime
  `.js` with the same path, overwriting the runtime. Boundaries now use a
  distinct `.runtime.js` and matching `.runtime.d.pln`.
- Declared JavaScript runtimes are copied into build/run output so boundaries
  execute, but installed package files under `node_modules` are no longer
  partially copied; the host resolves complete packages.
- JSX spread attributes and spread children included the leading `...` in the
  parsed expression. Both are now parsed correctly.

## Capability matrix

### Language fundamentals

| Area | Status | Notes |
| --- | --- | --- |
| Bindings, mutability, assignment | Available | 2.0 and 2.1 spellings, per-file dialect |
| Functions, closures, lambdas, async/await | Available | Typed parameters, inferred returns, top-level await |
| Records, variants, unions, optionals | Available | Structural, erased |
| Generics, constraints, predicates | Available | Including deferred indexed access |
| Destructuring | Available | Bindings and parameters |
| Pattern matching | Available | `match`, guards, exhaustiveness |
| Modules and re-exports | Available | Local, std, packages, declarations; re-exports fixed in 2.2 |
| Classes / `this` | **Absent** | JS boundary or records and functions |
| Ternary conditional expression | **Absent** | Use `when`; no `a ? b : c` |
| Generators / `yield` | **Absent** | Async and callbacks are available |
| Decorators / metadata / reflection | **Absent** | No runtime type reflection |
| Operator overloading | **Absent** | Deliberate; no user-defined operators |
| Exceptions typing | Partial | `catch` binds `any`; typed results exist for operations |

### Runtime and execution

| Area | Status | Notes |
| --- | --- | --- |
| Execution semantics | Available | Emitted ESM, no VM or runtime library |
| Memory / GC | Host | JavaScript engine |
| Async | Available | Promises and top-level await |
| Parallelism | Partial | Cooperative `std/task`; no threads or processes API beyond host interop |
| Error propagation and stack traces | Available | Source maps emitted |
| Debugging | Partial | DAP bridge tested at protocol level, not through a VS Code UI |
| Performance | Unmeasured cross-language | PlainScript-only benchmark script; no claim of speed parity |

### Standard library

| Area | Status |
| --- | --- |
| Collections (`std/list`, `std/map`) | Available |
| Text, Unicode helpers, regex helpers | Available; regex helpers added in 2.2 |
| Dates and time (`std/time`) | Available |
| Filesystem (`std/fs`) | Available |
| Networking (`std/http`, `std/ws`) | Available |
| Streams | Partial; Node streams usable through declarations |
| Cryptography (`std/auth` scrypt, HS256) | Available |
| Serialization (`std/json`) | Available |
| Math (`std/math`) | Available |
| Process and environment | Host APIs through declarations; no dedicated process module |
| Database (`std/db`, adapters) | SQLite available; PostgreSQL/MySQL adapters require installed drivers and live-server tests are skipped here |

### Interoperability

| Area | Status |
| --- | --- |
| JavaScript ESM and npm | Available and tested |
| CommonJS | Through Node interop and generated boundaries |
| TypeScript declarations | Supported subset via `plainscript interop` |
| React and JSX | Available and tested |
| Python | Two-way bridge tested |
| C / C++ | Generated C executed; C++ compiles |
| JVM, Go, Rust, C#, Ruby, PHP, Swift, Dart | Clients generated; not executed here |
| Native FFI / shared libraries | **Absent** |
| WebAssembly | **Absent** |
| LSP | Available; completion, hover, definitions, references, rename, symbols, tokens, actions |

### Tooling and developer experience

| Area | Status | Notes |
| --- | --- | --- |
| CLI | Available | `run`, `build`, `check`, `fmt`, `test`, `new`, `ir`, `watch`, `lsp`, `dap`, `bridge`, `bindings`, `migrate`, `interop` |
| Diagnostics and source frames | Available | Stable codes, hints, JSX/regex-specific codes |
| Source maps | Available | Emitted beside every JavaScript module |
| Incremental compilation | Partial | Module cache and watch skip unchanged output; no persistent incremental cache |
| Package management | npm via Node | No PlainScript registry or lockfile |
| Bundling | External | Vite/Next via emitted ESM; no built-in browser bundler |
| Templates | Available | CLI, API, Express, React + Vite, Next.js, library, full-stack starters |
| Migration assistance | Available for JavaScript family | Non-JS modules stay native and use the bridge |
| Editors | VS Code grammar and LSP client | Extension UI automation not tested |

### Production readiness

| Area | Status |
| --- | --- |
| Security model | Type and module checks; bridge is local by default; no sandbox beyond host |
| Backward compatibility | 2.0 and 2.1 sources compile unchanged; 382-test suite |
| Reproducible builds | Deterministic emission; no lockfile for PlainScript itself |
| Cross-platform | Node 20+ on the host platform; test suite run on Linux |
| Dependency compatibility | No runtime dependencies; npm and Node interop tested |
| Production debugging | Source maps and DAP; minimal adapter |
| Deployment | Node, Vite, Next and Express integrations; no PlainScript-specific deploy target |

## Discovered gaps and dispositions

| Gap | Classification | Disposition in 2.2 |
| --- | --- | --- |
| JSX could not be parsed | Language / compiler | Fixed: native JSX |
| No regex literals | Language / compiler | Fixed: native regex and `std/text` |
| Re-export targets unresolved | Compiler / module graph | Fixed |
| Boundary runtime collision | Tooling / compiler output | Fixed |
| Declared JS runtimes missing from output | Compiler / module graph | Fixed |
| Installed package partially copied | Compiler / module graph | Fixed |
| JSX spread parsed `...` as an expression | Compiler | Fixed |
| JSX summary not populated in migration reports | Tooling | Fixed |
| Non-JS export detection absent | Tooling | Improved: conservative declarations for nine ecosystems |
| Migration only produced findings | Tooling | Fixed: analysis, conversion, boundaries, reports |
| No non-JavaScript source conversion | Tooling / language semantics | Deferred; bridge is the supported route |
| No automated migration test execution | Tooling | Deferred; report lists checks, CI runs them |
| No ternary expression | Language | Deferred; `when` covers statements |
| No classes / `this` | Language | Deferred; JS boundary or records |
| No generators | Language | Deferred |
| No decorators or reflection | Language | Deferred |
| No native FFI / WASM | Interoperability | Deferred; JSON-RPC process boundary |
| Third-party JSX prop types are `any` | Type system / interop | Deferred; local props checked |
| No persistent incremental cache | Compiler / DX | Deferred |
| No built-in bundler or registry | Ecosystem | Deferred; Node/Vite/Next/npm |

## Verification limitations

- npm publication was not performed in this environment; registry state is
  reported separately from source state.
- The generated JVM, Go, Rust, C#, Ruby, PHP, Swift and Dart clients were not
  compiled here. They are generation-tested, not execution-tested.
- PostgreSQL/MySQL live suites are skipped without server URLs.
- The DAP server is tested at the protocol level, not through a VS Code UI.
- No benchmark compares PlainScript with another language; no performance claim
  is made.
- Cross-platform testing was performed on this Linux checkout only.
- Deyra was the motivating real-world project for JSX and regex, but its
  repository was not cloned or modified here. The release is validated against
  a real React 19 + Vite integration and a Deyra-shaped Express/React/SQLite
  application rather than against Deyra's production branch.

## Recommended next work

1. Ternary expressions and a small class/interop story, or an explicit
   decision that both stay out.
2. Execution-tested bindings for JVM, Go, Rust and C# toolchains.
3. Native FFI or WebAssembly adapter for hot-path native libraries.
4. Non-JavaScript migration adapters that emit bridge service stubs and tests.
5. JSX declarations for third-party component packages.
6. A persistent incremental build cache and published cross-language benchmark.
7. Live database and identity-provider conformance runs.

## Resolution in 2.3

| Recommendation | Result |
| --- | --- |
| 1. Ternary and a class/interop story | Ternary, classes, inheritance, generics, decorators and `this` are implemented and runtime-tested. |
| 2. Execution-tested bindings | `scripts/verify-bindings.js` and the all-language CI job compile and execute the generated clients; TypeScript is now a separate typed client. |
| 3. Native FFI or WebAssembly | Not implemented; the documented JSON-RPC process boundary remains. This is an explicit product boundary, not a hidden gap. |
| 4. Non-JavaScript migration adapters | Not implemented; only JavaScript conversion and boundary generation exist. |
| 5. Third-party JSX props | Still `any` unless a declaration the importer understands exists. |
| 6. Incremental cache and cross-language benchmark | The persistent dependency-aware build cache is implemented and tested. The benchmark remains Node-only; no cross-language fixture is published. |
| 7. Live database and identity conformance | A PostgreSQL/MySQL CI job with real services exists. Identity-provider conformance is still not automated. |
