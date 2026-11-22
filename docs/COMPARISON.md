# Comparison with TypeScript stacks

This is an engineering comparison, not a marketing claim. PlainScript is younger and has a
much smaller ecosystem. The useful question is narrower: **for a schema-first full-stack
application, how much duplication and unchecked boundary code does each approach require?**

## Compared stacks

- PlainScript + `std/contract` + `std/db` + React (this repository's flagship demo).
- TypeScript + Zod (runtime schemas and inferred types) + tRPC (typed procedures/client).
- TypeScript + Prisma or Drizzle (database schema, generated client, migrations) + Zod.

## Actual evidence from this repository

The flagship demo's shared contract is one 16-line module:
`demos/contracts-fullstack/src/shared.pln`. It declares one record schema, one error schema
and four operations. The server and React client import those values; neither declares a
parallel task model. `tests/contract-errors.test.js` proves that an unknown enum literal, a
wrong command output and an undeclared error code are rejected before execution.
`tests/contract-demo.test.js` runs the compiled server, logs in, creates/toggles/reads a
task through validated operations, gets a typed 404 failure, restarts the process and
verifies persistence. `tests/db.test.js` proves schema-derived tables, migration rollback
and invalid-row rejection. These are executable checks, not API-shape claims.

## Capability comparison

| Concern | PlainScript today | Typical TypeScript stack | Verdict |
| --- | --- | --- | --- |
| One definition drives model, validation, DB columns, server, client | `std/contract.object` schemas; `std/db.table`; operation descriptors | Zod schema + `z.infer`; Prisma/Drizzle has a **separate** schema and generated types; tRPC router connects procedures | PlainScript avoids the second schema; Prisma/Drizzle still have stronger migration tooling and database breadth |
| Compile-time input/output/error checking | Checker derives operation types; negative tests cover input, output and error codes | tRPC infers router input/output; error shape is usually not a closed union unless hand-modelled; Zod schema/type drift is possible with manually written interfaces | PlainScript is more closed by default; TypeScript has a richer type system |
| Runtime validation | Same schema validates client input, server input and both outcomes | Zod at chosen boundaries; tRPC does not validate unless the procedure does; Prisma validates DB types, not HTTP payloads | Equivalent when a TS team wires every boundary; PlainScript makes it the default |
| Database mapping and migrations | Schema-derived columns, versioned SQL migrations, transactional rollback; SQLite, plus pg/MySQL adapters driven by application-installed packages | Prisma/Drizzle: mature schema DSL, multiple databases, migration tooling, introspection | **TypeScript stack wins** on database breadth, live integration testing and operations; PlainScript's PostgreSQL/MySQL adapters are not server-tested in this repository |
| Typed client transport | Built-in runtime client + JSON HTTP transport + operation router | tRPC: mature generated client, batching, subscriptions, React Query integration | tRPC wins on client ecosystem; PlainScript's is deliberately small |
| Authentication | scrypt/HS256 primitives and policies in `std/auth`; optional OIDC/SAML wrapper modules over application-installed libraries | Auth.js/Clerk/Passport or custom; far more providers, conformance testing and production integrations | **TypeScript ecosystem wins** on provider breadth and operational maturity |
| Editor/tooling | LSP diagnostics, completion, hover, definitions, workspace references, rename, symbols, format, semantic tokens and quick fixes; minimal DAP source-map debug adapter; VS Code extension | TypeScript LSP is decades more mature, with refactors, inlay hints, debugging and framework plugins | **TypeScript wins decisively** |
| Language type system | Structural records, nominal classes/inheritance, generics/constraints, narrowing, variants, literal unions, fixed/variadic tuples, readonly fields, intersections, conditional/mapped types with naked-parameter distribution, deferred indexed access, overloads, predicates, recursive types and documented variance | Enormous declaration ecosystem, more mature inference, conditional `infer`, optional tuple elements, decorator metadata | **TypeScript wins on breadth and ecosystem**; core structural and object features are comparable |
| Ecosystem and hiring | npm interop, but a new language and small library/tooling ecosystem | Enormous ecosystem, frameworks, hosting support, community | **TypeScript wins** |
| Build performance | Synthetic PlainScript-only benchmark: 40 modules, median cold compile 19.74 ms on Node 26.13.1; 100-module warm build 88.73 ms with the cache | No pinned cross-language benchmark in this repository | **Unproven**; no speed claim |
| JSX/React | Native JSX with classic and automatic React runtimes, fragments, spreads, per-file pragmas and local component prop checking | First-class JSX and the entire React tooling ecosystem | **TypeScript wins on ecosystem and third-party prop typing** |
| Operational maturity | Small compiler/runtime; SQLite/PostgreSQL/MySQL focus; Node-targeted bundler and persistent build cache; partial LSP and minimal DAP | Mature compilers, debuggers, profilers, deployment tooling | **TypeScript wins** |

## What PlainScript genuinely offers

1. A schema change propagates to types, runtime validation, SQLite columns, handler
   contracts and the browser client in one edit. The demo is 16 shared lines, with zero
   duplicated frontend model declarations.
2. Typed error unions are first-class operation results, not an afterthought; the compiler
   rejects an undeclared failure code and matching is exhaustive.
3. Runtime validation is not optional glue: input and both outcomes are validated by the
   same schema at both trust boundaries.
4. The language is small enough to audit and emits ordinary ESM, so React, Node and npm
   packages remain usable without a custom bundler.

## What it does not offer

Prisma-level multi-database operations, a MongoDB adapter, distributed workers, a mature
auth provider integration, a browser-targeted bundler, a large ecosystem, or a measured
speed advantage over TypeScript. PostgreSQL/MySQL run against live CI services but are not
as broadly tested as Prisma. The DAP debugger is minimal and the VS Code integration is not
UI-automated; arbitrary TypeScript `.d.ts` parsing is not supported. Any claim that
PlainScript is universally better would be false.

## Reproduce the checks

```bash
npm test
cd demos/contracts-fullstack && npm install && npm run build
node ../../src/cli.js check src/shared.pln src/server.pln src/App.pln
```

The TypeScript alternatives are described at the level of their documented workflows; this
repository does not contain an equivalent TypeScript implementation or a cross-language
benchmark. That limitation is intentional and is tracked in [ROADMAP](ROADMAP.md).
