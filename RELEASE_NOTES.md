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
