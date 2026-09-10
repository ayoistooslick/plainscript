# PlainScript v0.1.7  -  Release Notes

**Release date:** 2026

---

## What is PlainScript 0.1.7?

PlainScript is an Intent-Oriented Programming Language (IOPL). You describe
**what** you want in plain sentences; the deterministic compiler decides
**how** to implement it in JavaScript. This is the first release: the whole
language, the production build model, the backend capabilities, and the
editor tooling ship together.

## Highlights

### The `plainscript` npm package

- Install per project: `npm install --save-dev plainscript`. No global install.
- CLI commands: `plainscript build | run | start | init | new | install | add |
  remove | update | check | fmt | doctor | version | help`.
- Everything runs through npm scripts and `npx`.

### Production builds (`plainscript build`)

- Sources compile to `dist/` preserving names and structure:
  `src/messi.pln` → `dist/messi.js`, nested folders included.
- Imports are bundled into each output, so every file in `dist/` runs
  standalone under Node.
- Deterministic output: rebuilds are byte-identical  -  safe to commit,
  diff, and cache.

- `plainscript build` discovers all `.pln` files under `src/` and compiles each to
  `dist/`, preserving file names and folder structure. No configuration file needed.
- Source discovery skips `node_modules`, hidden directories, and the output
  directory itself.

### npm-package building

- A project is a normal npm package: point `main` at the built entry and
  publish. Consumers `require()` the generated `dist/` output like any
  Node package  -  no custom registry, no custom format.
- The `prepare` script hooks straight into the compiler:
  `"prepare": "plainscript build"`.

## The language

- Variables, conditions, functions, arrays, objects, and loops read as
  sentences: `let age is 16`, `if age is at least 18`, `define add(a, b)`,
  `for each player in players`.
- String templates preserve whitespace and interpolate with `${expression}`,
  compiling directly to JavaScript template literals.
- PlainScript Expressions: `print first player from players`, `add("X" to items)`,
  `print city of address of customer`, `let data is read("users.txt")`.
- Multi-file projects bundle imports per entry; every source file gets its
  own standalone output under `dist/`.
- JavaScript Gateway: raw JavaScript inside `javascript ... end` blocks
  with full async support; any npm package joins via `use <package>`.

## Backend capabilities

Everything below is compiled by the same deterministic compiler  -  no rules
engine, no AI, no hidden codegen:

- Web apps and routing with groups, CORS, params, and custom 404s.
- SQLite databases (native `better-sqlite3` or WebAssembly `sql.js`) and
  PostgreSQL, with parameter binding and transactions.
- Sessions signed with HMAC cookies, scrypt password hashing, HMAC tokens,
  Google OAuth login, file uploads with size/type limits, OCR, cookies,
  per-IP rate limiting, email via SMTP, cron schedules and background jobs,
  WebSocket servers, and Redis-backed caching.

## AI / ML and data / storage

- **AI (builtin `ai`):** `chat(model, messages, options)` for OpenAI-compatible LLM
  chat completions, `embedText(model, text, options)` for text embeddings, and
  `similarity(a, b)` returning cosine vector similarity (-1..1). Conveniences
  `ai_tags(text)` and `ai_post(subject, ideas, options)` compose the same runtime.
  Auth reads `OPENAI_API_KEY`/`OPENAI_BASE_URL`, overridable per-call via options.
- **Data / storage:** `paginate(list, page, perPage)` returns
  `{ items, count, page, pages, perPage, hasNext, hasPrev }`; the `cache` builtin
  falls back to an in-memory Map store with TTL when no Redis is configured.
- **Web / full-stack:** route-scoped `body()` / `body("field")` accessor and a
  `redirect to "<url>"` statement inside route handlers.

## Collections & string primitives

- `range`, `clamp`, `first`, `last`, `flatten`, `includes`, `pick`, `omit`,
  `groupBy`, `startsWith`, `endsWith`, `truncate`, `padStart`, `padEnd`.
- Record kinds (classes), concurrency combinators (`all of`/`any of`/`settled of`),
  generators (`yield`), reflection, binary data, YAML, CLI/process helpers,
  Map/Set wrappers, and the JS Gateway escape hatch.

## WhatsApp bots

- QR or pairing-code linking with compile-time pairing-number validation;
  pairing values may be prompted at runtime with `ask`.
- Normalized message records, group support, own-message filtering, and
  automatic reconnection after transient disconnects.

## Editor support

- `plainscript-vscode/`: syntax highlighting, snippets, folding, and a file icon
  for `.pln` sources.
- `editors/mt-manager/`: MT Manager syntax highlighting (`.mtsx`) for Android.

## Verification

The repository ships a complete test suite covering the lexer, parser,
generator, formatter, CLI, build model, backend runtimes, WhatsApp runtime,
and live acceptance boots of the example projects:

```bash
npm test
```
