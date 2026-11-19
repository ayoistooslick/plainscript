# PlainScript 2.0.0 — release notes

PlainScript 2.0 is a ground-up rebuild of the language, compiler and standard library. It
remains an independent statically typed language that compiles to ordinary ES modules.

## Highlights

- Structural type system with generics and constraints, recursive records/variants, tuples,
  literal unions, intersections, `keyof`/`typeof`, narrowing, exhaustiveness, conditional
  and mapped types, deferred generic indexed access, function overloads and user-defined
  type predicates. Function variance is structural and documented.
- Unified full-stack contracts: schema-derived record types, typed success/error results,
  validation on both sides, operation routers, HTTP transport, SQLite table mapping,
  versioned migrations/rollback and scrypt/HS256 authentication.
- Structured concurrency (`std/task`), an in-process background job queue (`std/jobs`),
  WebSockets with authorization before upgrade (`std/ws`), and HTTP/SSE (`std/http`).
- LSP over stdio with diagnostics, completion, hover, navigation, references, rename,
  symbols, formatting, semantic tokens and quick fixes; VS Code extension in
  `editors/vscode`.
- `plainscript migrate` for conservative JavaScript/TypeScript blocker scanning and eight
  tested starters: project-management, ecommerce, realtime-chat, react-vite, next, express,
  cli and library.
- Zero runtime dependencies; Node.js 20+ for the compiler and core runtime. `std/db` uses
  Node 22's built-in `node:sqlite`.

## Upgrade path

This is a breaking release from v1. Read `docs/MIGRATION.md` for the v1-to-v2 language and
CLI changes. For JavaScript/TypeScript projects, keep the existing application running,
move pure modules first, keep JSX/class-shaped framework code at the JavaScript boundary,
and run `plainscript migrate <path> --check` before renaming files.

The npm package is not published by these release notes. Publishing is a separate,
explicit release action. Check `CHANGELOG.md`, `docs/PROGRESS.md` and `docs/ROADMAP.md` for
verified scope and remaining limitations.
