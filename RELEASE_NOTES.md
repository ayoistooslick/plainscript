# PlainScript 2.3.1 — Windows, macOS and live-database fixes

PlainScript 2.3.1 is a patch release for the 2.3.0 compiler. It carries the
fixes made after 2.3.0 was published, so an install from npm now behaves the
same as the repository. There is no source or API change.

## Fixes

- **CRLF dialect pragma.** `#syntax 2.1` on the first line of a file checked
  out with CRLF endings is recognised again; previously the carriage return
  stopped the pragma from matching and the file fell back to the 2.0 dialect.
- **Windows source maps.** Source names are normalized before matching
  (separators, percent-encoding, `file:` URLs and drive-letter case), so the
  debug adapter resolves breakpoints and stack frames from a Windows checkout.
- **MySQL connection errors.** Connection creation and the initial ping are
  wrapped in `DatabaseError`, and a half-open connection is closed when the
  ping fails, instead of surfacing a raw driver exception.

## Tooling and CI

- `npm test` now runs through `scripts/run-tests.js`, a file-list runner that
  works on Node 20 and Node 22 on Linux, macOS and Windows. Node 20 does not
  expand `tests/*.test.js` and Node 22 rejects a directory argument for
  `--test`.
- Documentation examples are compiled from LF-normalized Markdown, so a CRLF
  checkout does not fail the docs suite.
- Node 22-only capabilities (`node:sqlite` persistence, the debug adapter and
  the WebSocket test client) are skipped on Node 20 with an explicit reason and
  stay covered on Node 22.
- The cross-language bindings job is pinned to `ubuntu-24.04`, the newest runner
  image with a Swift toolchain the setup action supports.

## Verification

- `npm test`: 401 tests, 399 passed, 2 live PostgreSQL/MySQL tests skipped in
  this checkout; the same suite passes on Node 20 (387 passed, 14 skipped) and
  Node 22 (399 passed, 2 skipped), and from a CRLF checkout.
- CI run #50 on `main` is green for Ubuntu, Windows and macOS on Node 20 and 22,
  for live PostgreSQL and MySQL, and for all 14 bindings targets.
- The published tarball was installed from the registry into a clean directory
  and reported `2.3.1`; `plainscript version` and a compile/run check were
  repeated against that install.

## Upgrading

Install `plainscript-lang@2.3.1`. No source change is required from 2.3.0.

# PlainScript 2.3.0 — classes, generators, typed errors and a faster toolchain

PlainScript 2.3 is a language and tooling release. The language gains an object
model, lazy iteration, checked failures and the expression conveniences that
were missing from 2.2. The compiler gains a bundler, an incremental cache and an
optimiser, and the standard library gains ten modules.

There is no intentional source break from 2.0, 2.1 or 2.2. `class` and `throws`
are contextual keywords, so existing identifiers keep working. The one stricter
check is deliberate: a declared `throws` type is checked nominally.

## Language

### Classes

```plainscript
class HttpError extends Error
    status: number
    readonly retryable: boolean

    constructor(message: text, status: number)
        super(message)
        this.status = status
        this.retryable = status >= 500
    end

    function describe() -> text
        return "{this.status}: {this.message}"
    end

    static function badRequest(message: text) -> HttpError
        return new HttpError(message, 400)
    end
end
```

Classes support inheritance, `super`, `this`, generics, static and readonly
members and decorators. They lower to native JavaScript classes. `x is C` is a
nominal `instanceof` check. Generic class arguments are inferred from
`new Box(3)`.

### Generators

```plainscript
generator function pages(first: number, last: number) -> number
    let page = first
    while page <= last
        yield page
        page += 1
    end
end

for page in pages(1, 3)
    print(page)
end
```

A generator's annotation is its yielded element type; its call type is
`Iterator of T`. `std/iter` adds lazy and eager helpers over iterators.

### Typed errors

`function load(id: text) throws NotFoundError` makes throwing part of the
signature. A `throw` of an unrelated class is rejected. `throws nothing`
forbids throwing entirely. `catch error: NotFoundError` narrows the binding and
is guarded at run time, so a mismatched value is rethrown rather than passed to
a handler that assumes the wrong type.

One catch clause per `try` remains the rule, matching JavaScript; nest `try`
blocks for multiple typed handlers.

### Everything else in the language

- Ternary expressions with lazy branches.
- BigInt literals (`123n`, `0xffn`, `0b1010n`) and a distinct `bigint` type.
- Computed record keys (`{ [key]: value }`) and shorthand fields (`{ name }`).
- Nested block comments.
- Runtime `typeof`.
- Decorators on classes, methods and fields.

## Tooling

- **Bundler.** `plainscript bundle src/main.pln --out=dist/app.js` emits one ES
  module. Packages and `std/*` stay external. Exported `let` is rejected
  (`PS4010`) because a bundle cannot preserve ESM live bindings.
- **Incremental build.** `plainscript build` caches each emitted module in
  `.plainscript/build-cache.json`. A hit requires the source hash, compiler
  fingerprint, configuration and all local/declaration dependency hashes to
  match, so editing a dependency invalidates its importers. `--no-cache` forces
  a cold build.
- **Optimiser.** Constant folding, constant ternary selection and
  unreachable-statement removal run by default; `--no-optimize` keeps the raw
  HIR.
- **TypeScript declarations.** `.d.ts` import now emits real `declare class`
  declarations with constructors, parameter properties, statics, getters,
  methods, `this`, `Date`, `Error`, `RegExp`, `Function` and common utility
  types. Unsupported utility types widen with an explicit warning.
- **Editor support.** The formatter indents classes and constructors; the LSP
  reports class symbols and completes the 2.3 keywords.

## Standard library

New modules: `std/iter`, `std/reflect`, `std/bigint`, `std/env`, `std/process`,
`std/crypto`, `std/compress`, `std/stream`, `std/worker` and `std/net`. Each has
a `.d.pln` declaration and runtime coverage. `std/worker` and `std/net` require
Node; browser builds should stay on the portable modules.

## Verification

- `tests/language-2-3.test.js` covers classes, inheritance, generics, statics,
  readonly fields, decorators, generators, typed throws and catches, ternary,
  BigInt, computed keys, shorthand, block comments and `typeof`, including
  negative diagnostics and runtime output.
- `tests/declaration-interop-hardening.test.js` covers class declarations and
  constructor mismatch diagnostics.
- `scripts/verify-bindings.js` generates, compiles and executes clients where
  the toolchain exists. JavaScript, TypeScript, Python, C and C++ run in the
  local environment; the all-language CI job installs Go, Rust, Ruby, PHP, C#,
  Java, Kotlin, Swift and Dart.
- CI runs on Ubuntu, macOS and Windows with Node 20 and 22, plus live
  PostgreSQL and MySQL services.
- `scripts/benchmark-cache.js` measured a 100-module synthetic project on Linux
  x64 with Node 26.13.1: 200.48 ms cold, 88.73 ms warm median for five runs, and
  136.16 ms with `--no-cache`; all 101 modules were reused. These are synthetic
  numbers and include CLI startup.
- `node scripts/build-docs-site.js` and `node scripts/check-docs-links.js` build
  and check this documentation site.

## Compatibility and upgrade

Existing source compiles unchanged. If a 2.2 program declared `throws` and threw
a value from an unrelated class, remove the clause or throw a subclass of the
declared type. See [Migrating to 2.3](docs/MIGRATION_2_3.md).

## Known boundaries

No native FFI, WebAssembly target or browser bundler. MongoDB, WebSocket
extensions, distributed job leases, arbitrary `.d.ts` parsing and a reproducible
cross-language benchmark are not implemented. The debug adapter is
protocol-tested, not automated through a VS Code UI. See
[docs/CAPABILITY_AUDIT_2_3.md](docs/CAPABILITY_AUDIT_2_3.md) and
[docs/ROADMAP.md](docs/ROADMAP.md).

# PlainScript 2.2.0 — native JSX, native regex, cross-language bridges and migration

PlainScript 2.2 is an interoperability and adoption release. It closes the two
blockers found during the real-world 2.1 migration — no native JSX and no regex
literals — and adds a process boundary for projects written in other languages
and a migration tool for introducing PlainScript incrementally.

There is no source break from 2.1. Existing 2.0 and 2.1 programs compile and run
unchanged.

## Highlights

### Native JSX and React

JSX is now part of PlainScript itself. A `.pln` file can hold React components,
fragments, spread attributes, expression children and custom factories without a
separate JavaScript layer, Babel plugin or JSX runtime wrapper.

- Classic runtime lowers to `createElement(type, props, ...children)`; the
  automatic runtime imports `jsx`/`jsxs` from a configurable import source.
- Per-file pragmas (`# @jsx`, `# @jsxFrag`, `# @jsxRuntime`,
  `# @jsxImportSource`) override project configuration.
- Local components with record props are checked: unknown prop (`PS3420`), wrong
  type (`PS3421`), missing required prop (`PS3422`), missing factory (`PS3405`).
- Diagnostics `PS1009`–`PS1014` cover malformed JSX.
- The React 19 + Vite integration now uses native PlainScript JSX and is rendered
  through `react-dom/server` in the suite. Vite consumes the emitted ES module as
  before.

See [docs/JSX.md](docs/JSX.md).

### Native regular expressions

Regex literals are values typed as `regex` and emitted as native `RegExp`.

- `/pattern/flags`, with the slash disambiguated by expression position; division
  after a value still behaves as division.
- Patterns and flags validated at compile time (`PS1006`–`PS1008`).
- Captures, named groups, flags, Unicode, replacement and splitting.
- Typed `std/text` helpers: `matches`, `findMatch`, `findAllMatches`,
  `matchTexts`, `splitMatch`, `replaceMatch`, `replaceAllMatches`, `escapeRegex`,
  plus the `RegexMatch` record.
- Native semantics: the host JavaScript engine is the pattern engine.

See [docs/REGEX.md](docs/REGEX.md).

### Cross-language interoperability

A new JSON-RPC 2.0 bridge lets PlainScript module boundaries be consumed from
other runtimes, and lets PlainScript call them.

- `plainscript bridge <file>` serves exports over stdio or HTTP.
- `plainscript bindings <file>` generates clients for JavaScript, TypeScript,
  Python, C, C++, Java, Kotlin, Go, Rust, Ruby, PHP, C#, Swift and Dart.
- `std/bridge` opens a child process and performs requests from PlainScript.
- Manifests describe params, returns, records, lists, maps and async functions.
- Verified end to end: JavaScript and Python clients, a compiled C client, and a
  PlainScript → Python service round trip. The JVM, Go, Rust, C#, Ruby, PHP, Swift
  and Dart clients are generated but were not executed here because their
  toolchains are absent.

This is a process boundary, not native FFI. It keeps memory and crashes apart and
needs no compiler plugin per language, at the cost of JSON serialisation. Native
FFI and WebAssembly are not claimed.

See [docs/CROSS_LANGUAGE.md](docs/CROSS_LANGUAGE.md).

### Migration tooling

`plainscript migrate` is now an analysis and incremental migration tool:

- detects languages, frameworks, package manager, module system and markers;
- classifies files into leaf, public-API, UI and entrypoint phases;
- safely converts eligible JavaScript modules to `.pln`;
- refuses classes, JSX, CommonJS, default exports, wildcard re-exports,
  generators, decorators, dynamic import and `eval` instead of mistranslating;
- generates boundary triplets for JSX/TS/TSX/CommonJS:
  `bridges/Name.pln`, `Name.runtime.js`, `Name.runtime.d.pln`;
- reports Markdown and JSON, with a `--check` ratchet and `--write` output;
- detects public declarations in nine non-JavaScript ecosystems and marks them
  for the bridge rather than pretending to translate their semantics.

A mixed project is a supported end state.

See [docs/MIGRATION_2_2.md](docs/MIGRATION_2_2.md).

### Compiler and module fixes

- `export { name } from "./module"` is now resolved by the checker and module
  loader; previously it was emitted but not importable.
- Generated boundaries execute: project-local declared JavaScript runtimes are
  copied into build/run output.
- Installed packages are no longer partially copied into output; the host
  resolves complete packages.
- Boundary wrappers use a distinct runtime filename so a build cannot overwrite
  the adapter.
- JSON-RPC stdio transports accept batches.

## Compatibility and upgrade

1. Install or update to `plainscript-lang@2.2.0`.
2. Run `plainscript check` and the project's tests. No source change is required
   from 2.1.
3. Optionally add regex literals where string workarounds existed and native JSX
   where a separate JSX layer existed.
4. Run `plainscript migrate .` to plan incremental adoption of remaining
   JavaScript modules; use `--write` to create conversions and boundaries.
5. Keep the existing build and tests green after each phase.

Classic JSX needs the factory in scope, exactly like classic JavaScript JSX. Use
`# @jsxRuntime automatic` with `# @jsxImportSource react` if you do not want to
import `createElement`.

## Known limitations

- No ternary expression, classes/`this`, generators, decorators or runtime
  reflection.
- Third-party JSX component prop types are `any`; local declared props are
  checked.
- Cross-language integration is a JSON-RPC process boundary. No native FFI,
  shared-library embedding or WebAssembly.
- Only JavaScript, Python and C bindings were executed end to end here; other
  generated clients are generation-tested.
- Migration source conversion is limited to the JavaScript family. Non-JavaScript
  modules stay native and are bridged. The tool does not run a project's test
  command.
- PostgreSQL/MySQL live suites require server URLs and are skipped without them.
- No built-in bundler or PlainScript package registry; use Vite/Next/npm.
- Benchmarking is PlainScript-only; no cross-language performance claim is made.
- The full capability audit is in
  [docs/CAPABILITY_AUDIT_2_2.md](docs/CAPABILITY_AUDIT_2_2.md).

## Verification

`npm test` passes: **382 tests, 380 passed, 2 skipped, 0 failed**. The two
skipped tests are live PostgreSQL/MySQL tests that need external servers.

Coverage added in this release includes JSX lexing/parsing/lowering and React
server rendering, regex semantics and diagnostics, module re-exports, bridge
protocol/stdio/HTTP, Python and JavaScript clients, a compiled C client,
migration analysis/conversion/boundaries and a boundary executed against a real
JavaScript runtime. Documentation examples for all new guides are compiled by
the suite.

## Publication status

As of 2026-11-22:

- **GitHub:** the `v2.2.0` release is published at
  <https://github.com/ayoistooslick/plainscript/releases/tag/v2.2.0>; the tag
  points at `8711da9`. The documentation workflow deployed the 2.2 manual to
  <https://ayoistooslick.github.io/plainscript/>.
- **npm:** `plainscript-lang@2.2.0` is published and is the `latest` dist-tag
  (registry timestamp `2026-11-22T21:26:05.522Z`). The publish workflow's
  `npm publish` step succeeded with a 201-file, 1.2 MB tarball; the run was
  afterwards marked failed only because its redundant tag step tried to create
  the already-existing `v2.2.0` tag. Publication itself is complete.
