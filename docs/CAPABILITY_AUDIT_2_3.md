# Capability audit 2.3

This audit answers the 2.2 adoption review item by item. Every "verified" row
names the check that exercises it in this repository; a row that cannot be
verified here says so instead of claiming success.

## Language surface

| Capability | Status | Evidence |
| --- | --- | --- |
| Classes, inheritance, `this`, `super` | Implemented | `tests/language-2-3.test.js`, runtime subclass test |
| Static fields and methods | Implemented | static counter test |
| Generic classes and constructor inference | Implemented | `Box<T>` test |
| Ternary expressions | Implemented | lazy value-position test |
| Generators and `yield` | Implemented | lazy `for ... in` generator test |
| Typed throws and catch narrowing | Implemented | compile-time throw check and runtime mismatch rethrow test |
| Decorators | Implemented | method decorator runtime replacement test |
| BigInt type and literals | Implemented | decimal, hex, binary and arithmetic tests |
| Computed keys and shorthand | Implemented | record literal runtime test |
| Nested block comments | Implemented | nested comment test |
| Runtime reflection | Implemented | `std/reflect` type/class/field test |

## Type system and ecosystem

| Capability | Status | Evidence |
| --- | --- | --- |
| TypeScript class declarations | Implemented | `tests/declaration-interop-hardening.test.js` and constructor-check test |
| Constructor signatures from `.d.ts` | Implemented | `new Widget(42)` is rejected with `PS3539` |
| Static, getter and generic method signatures | Implemented | emitted `declare class` assertions |
| Utility types | Partial by design | `Partial`, `Required`, `Readonly`, `Pick` and `Record` map to mapped types; `Omit`, `Exclude`, `Extract`, `NonNullable`, `ReturnType`, `Parameters` and `Awaited` widen with an explicit `PS7005` warning |
| Built-in `Error` subclasses and `Date` | Implemented | checker built-in classes; TS `Date` property test |
| JSX prop checking | Implemented | 2.2 JSX suite |
| Untyped JavaScript values | Still `any` | This is intentional: there is no declaration to check against |

## Standard library

`std/iter`, `std/reflect`, `std/bigint`, `std/env`, `std/process`, `std/crypto`,
`std/compress`, `std/stream`, `std/worker` and `std/net` exist as Node-backed
modules with `.d.pln` declarations. The integration check runs every module:

```bash
node src/cli.js run .plainscript/stdcheck/main.pln
iter 0,20,40,60
reflect list bigint Error true
big 6
env 42 true 0
process true true
run 0 ok
crypto 64 hello secret true
compress hello hello
stream stream!
```

## Compiler and tooling

| Capability | Status | Evidence |
| --- | --- | --- |
| Persistent per-file build cache | Implemented | cache test: unchanged build does no compilation; a changed dependency invalidates the importer |
| Bundler | Implemented | bundle test imports and runs the generated single file |
| Optimisation | Implemented | literal folding and unreachable-statement removal test |
| Formatter | Implemented | class/constructor indentation test |
| Language server | Updated | class symbols and 2.3 keyword completions |
| Debug adapter | Source-map based | protocol tests; a full VS Code session is still not automatable in this environment |
| Cross-platform CI | Configured | Ubuntu, Windows and macOS on Node 20 and 22 |

## Interoperability and verification

- Generated clients exist for 14 targets, including a typed TypeScript client.
- CI compiles every target and executes JavaScript, TypeScript, Python, Ruby,
  PHP, C and C++. Targets whose toolchains are unavailable locally are compiled
  by the dedicated CI job; local verification is limited to the toolchains
  listed in the release notes.
- PostgreSQL and MySQL live adapters run in a CI job with real services.
- The JSON-RPC bridge remains a process boundary, not native FFI. There is no
  WebAssembly target, independent runtime or native threading; those are
  documented product boundaries, not hidden gaps.
