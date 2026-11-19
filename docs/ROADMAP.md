# Roadmap

This roadmap reports status; it is not a promise of dates.

## Available and verified now

- Compiler pipeline: lexer, parser, type checker, typed HIR, JavaScript emitter and source
  maps; deterministic ESM output and `.d.pln` declaration generation.
- Structural types, generics with constraints, inference, narrowing, variants,
  exhaustiveness, literal enum unions, tuples, `keyof`, `typeof`, conditional/mapped types,
  deferred generic indexed access, function overloads, user predicates and a documented
  structural variance model.
- Unified contracts: schema-derived records, typed operation errors, validated fallible
  endpoints, client result decoding, operation router/HTTP transport, SQLite model mapping,
  versioned migrations/rollback and a scrypt/HS256 authentication flow.
- Structured concurrency through `std/task`; WebSockets through `std/ws`; SSE and HTTP in
  `std/http`; in-process background jobs in `std/jobs`; React/Vite/Next/Node/npm interop.
- Language server with diagnostics, completion, hover, definitions, workspace references,
  rename, symbols, formatting, semantic tokens and quick-fix code actions; VS Code
  extension under `editors/vscode`.
- Watch mode, module-cache invalidation, unchanged-output skipping, benchmark script, and
  end-to-end contract/database/auth/WebSocket/concurrency tests.
- Conservative `plainscript migrate` scanning for JavaScript/TypeScript blockers without
  rewriting user code, plus eight tested starters.

## Next engineering priorities

1. First-class adapters (or a dialect layer) for PostgreSQL, MySQL and MongoDB behind the
   `std/db` model/migration surface. Direct npm drivers are usable today; see
   [DATABASES](DATABASES.md).
2. Persisted/durable background jobs and a worker process story beyond the in-process
   `std/jobs` queue.
3. Debug Adapter Protocol support and broader refactors beyond symbol rename. Source maps
   and Node's inspector work today; see [DEBUGGING](DEBUGGING.md).
4. Generated API documentation/OpenAPI from operation descriptors and a production
   identity-provider adapter.
5. Cross-language benchmark fixture with a pinned TypeScript toolchain, published with
   reproducible results.

## Explicit limitations

WebSocket fragmentation/extensions, non-SQLite `std/db` drivers, OIDC/SAML, a built-in
browser bundler, task syntax in the grammar, variadic tuple types, and arbitrary TypeScript
`.d.ts` parsing are not implemented. Deeply nested deferred conditional/mapped combinations
may remain deferred rather than produce an early diagnostic. None of these is described as
available elsewhere in the documentation.
