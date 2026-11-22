# Roadmap

This roadmap reports status; it is not a promise of dates.

## Available in 2.3

- Classes, inheritance, `super`, `this`, generics, static and readonly members,
  decorators and nominal `is` checks.
- Generators, `Iterator of T` and the lazy helpers in `std/iter`.
- Typed throws, typed catches with runtime rethrow, and `throws nothing`.
- Ternary expressions, BigInt, computed record keys, shorthand fields and nested
  block comments.
- Ten standard library additions: `std/iter`, `std/reflect`, `std/bigint`,
  `std/env`, `std/process`, `std/crypto`, `std/compress`, `std/stream`,
  `std/worker` and `std/net`.
- `plainscript bundle`, a dependency-aware persistent build cache and an HIR
  optimiser.
- A typed TypeScript bridge client and a 14-target binding generator verified by
  `scripts/verify-bindings.js`.
- TypeScript declaration import of classes, constructors, statics, accessors,
  methods, `Date`, `Error`, `RegExp`, `bigint`, `Function` and the common utility
  types.

## Available and verified now

- Compiler pipeline: lexer, parser, type checker, typed HIR, JavaScript emitter
  and source maps; deterministic ESM output and `.d.pln` declaration generation.
- Structural types, generics with constraints, inference, narrowing, variants,
  exhaustiveness, literal enum unions, fixed/variadic tuples, readonly fields,
  `keyof`, `typeof`, conditional/mapped types, function overloads, predicates and
  a documented variance model.
- Unified contracts, auth, concurrency, WebSockets, SSE, HTTP, jobs, migrations
  and SQLite/PostgreSQL/MySQL model mapping.
- LSP diagnostics/completion/hover/definitions/references/rename/symbols/
  formatting/semantic tokens/quick fixes, and a minimal DAP server over Node's
  inspector and source maps.
- Watch mode, incremental build cache, bundler, optimiser, benchmark script and
  end-to-end contract/database/auth/WebSocket/concurrency tests.
- `plainscript migrate`, `plainscript interop`, the JSON-RPC bridge and eight
  starters.

## Next engineering priorities

1. Execution tests for every generated binding on all supported toolchains.
   The dedicated CI job now covers them; keeping the images current is ongoing.
2. A cross-language benchmark fixture with pinned versions and published,
   reproducible numbers.
3. Deeper TypeScript declaration coverage: arbitrary declaration parsing, more
   conditional/mapped forms and third-party JSX component props.
4. A browser bundler that rewrites packages and `std/*` for the web. The current
   bundler targets Node/ESM and deliberately leaves packages external.
5. Network WebSocket extensions, a MongoDB adapter, distributed job leases and
   DAP UI automation.
6. Non-JavaScript migration adapters and generated service stubs.

## Explicit limitations

- Native FFI/shared-library embedding and WebAssembly are not implemented;
  cross-language integration is a JSON-RPC process boundary.
- Non-JavaScript source is not translated by the migration tool, and the tool
  does not execute a project's test command by itself.
- Third-party JSX component props remain `any` unless the package ships
  declarations the importer understands.
- There is no task syntax in the grammar, no optional tuple elements and no
  general conditional `infer`.
- The debug adapter is tested at the protocol level, not through a VS Code UI.
- Deeply nested deferred conditional/mapped combinations may remain deferred
  rather than produce an early diagnostic.
- `std/worker` and `std/net` are Node-only; browser builds cannot use them.
