# Roadmap

This roadmap reports status; it is not a promise of dates.

## Available and verified now

- Compiler pipeline: lexer, parser, type checker, typed HIR, JavaScript emitter and source
  maps; deterministic ESM output and `.d.pln` declaration generation.
- Structural types, generics with constraints, inference, narrowing, variants,
  exhaustiveness, literal enum unions, tuples, `keyof` and `typeof`.
- Unified contracts: schema-derived records, typed operation errors, validated fallible
  endpoints, client result decoding, operation router/HTTP transport, SQLite model mapping,
  versioned migrations/rollback and a scrypt/HS256 authentication flow.
- Structured concurrency through `std/task`; WebSockets through `std/ws`; SSE and HTTP in
  `std/http`; React/Vite/Next/Node/npm interop.
- Language server with diagnostics, completion, hover, definitions, workspace references,
  rename, symbols and formatting; VS Code extension under `editors/vscode`.
- Watch mode, module-cache invalidation, unchanged-output skipping, benchmark script, and
  end-to-end contract/database/auth/WebSocket/concurrency tests.

## Next engineering priorities

1. Conditional/mapped types, generic deferred indexed access, user-defined type
   predicates and function overloads, with a full variance model.
2. Additional database drivers behind the `std/db` surface and persisted background jobs.
3. Debug Adapter Protocol support and richer code actions/refactors in the LSP.
4. Generated API documentation/OpenAPI from operation descriptors and a production
   identity-provider adapter.
5. Cross-language benchmark fixture with a pinned TypeScript toolchain, published with
   reproducible results.

## Explicit limitations

WebSocket fragmentation/extensions, non-SQLite drivers, OIDC/SAML, a built-in browser
bundler, task syntax in the grammar, and arbitrary TypeScript `.d.ts` parsing are not
implemented. None of these is described as available elsewhere in the documentation.
