# Roadmap

This roadmap reports status; it is not a promise of dates.

## Available and verified now

- Compiler pipeline: lexer, parser, type checker, typed HIR, JavaScript emitter and source
  maps; deterministic ESM output and `.d.pln` declaration generation.
- Structural types, generics with constraints, inference, narrowing, variants,
  exhaustiveness, literal enum unions, fixed/variadic tuples, readonly fields, `keyof`,
  `typeof`, conditional/mapped types, distributive checks over naked type parameters,
  deferred generic indexed access, function overloads, user predicates and a documented
  structural variance model.
- Unified contracts: schema-derived records, typed operation errors, validated fallible
  endpoints, client result decoding, operation router/HTTP transport, SQLite/PostgreSQL/MySQL
  model mapping, versioned migrations/rollback and a scrypt/HS256 authentication flow.
- Optional OIDC and SAML service-provider wrappers (`std/oidc`, `std/saml`) over
  application-installed libraries.
- Structured concurrency through `std/task`; WebSockets with fragmentation and
  authorization-before-upgrade through `std/ws`; SSE and HTTP in `std/http`; in-process jobs
  with optional memory/SQLite durable stores in `std/jobs`; React/Vite/Next/Node/npm interop.
- Language server with diagnostics, completion, hover, definitions, workspace references,
  rename, symbols, formatting, semantic tokens and quick-fix code actions; a minimal Debug
  Adapter Protocol server (`plainscript dap`) and VS Code extension under
  `editors/vscode`.
- Watch mode, module-cache invalidation, unchanged-output skipping, benchmark script, and
  end-to-end contract/database/auth/WebSocket/concurrency tests.
- Conservative `plainscript migrate` scanning plus `plainscript interop` for the supported
  TypeScript `.d.ts` subset, and eight tested starters.

## Next engineering priorities

1. A MongoDB adapter (or explicitly document remaining direct-driver use) and live
   PostgreSQL/MySQL integration suites. The current adapters are tested with driver-shaped
   fakes because no database server is available in CI; see [DATABASES](DATABASES.md).
2. A distributed worker/lease story beyond the durable in-process job queue, including
   multi-process exactly-once/idempotency guidance.
3. Broader refactors beyond symbol rename, VS Code UI automation for the debug adapter, and
   protocol-conformance testing against real identity providers.
4. Generated API documentation/OpenAPI from operation descriptors.
5. Cross-language benchmark fixture with a pinned TypeScript toolchain, published with
   reproducible results.

## Explicit limitations

WebSocket extensions, a MongoDB `std/db` adapter, arbitrary TypeScript `.d.ts` parsing, a
built-in browser bundler, task syntax in the grammar, optional tuple elements and general
conditional `infer` are not implemented. The debug adapter is a minimal DAP/CDP bridge and
is tested at the protocol level, not through a VS Code UI. The PostgreSQL/MySQL adapters are
not tested against live servers in this repository. Deeply nested deferred conditional/mapped
combinations may remain deferred rather than produce an early diagnostic. None of these is
described as available elsewhere in the documentation.
