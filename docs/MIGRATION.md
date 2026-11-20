# Migration from PlainScript v1 to v2

PlainScript 2.0 is a ground-up rebuild. This guide documents the changes from v1 to v2 and what you need to update in your v1 code to make it work with v2.

## Conditional syntax update after the 2.0.0 snapshot

The current source grammar replaces the earlier 2.0.0 conditional spellings with one
canonical form. This is a breaking source change; it is not an alias period and must not be
published as a patch-compatible release. A release number for it has not been selected.

| Earlier form | Current form |
| --- | --- |
| `when condition … end` | `if condition … end` |
| `otherwise when condition …` | `else if condition …` |
| `otherwise …` | `else …` |
| `case pattern when guard …` | `case pattern if guard …` |
| match catch-all `otherwise` (shown in an old spec example, not implemented) | `case _` |

The checker, narrowing rules, scope behavior, and generated JavaScript do not change. The
compiler no longer accepts the old forms as branch syntax. `when` and `otherwise` remain
reserved only so old source is rejected clearly instead of reinterpreted as identifiers.
Archived `legacy/v1/` material remains unchanged. See
[`SYNTAX_DESIGN.md`](SYNTAX_DESIGN.md) for rationale and examples.

## Core Language Changes

### Keyword aliases removed
All v1 keyword synonyms have been removed. Use the one correct spelling:

| v1 alias | v2 spelling |
| --- | --- |
| `remember` | (no longer needed) |
| `show` | `print` from `std/io` |
| `display` | `print` from `std/io` |
| `log` | `print` from `std/io` |
| `make` | use literal syntax |
| `give` | (no longer needed) |
| `intend` | (no longer needed) |
| `ask` | (no longer needed) |
| `bot` | removed (service construct) |
| `ocr` | removed (service construct) |
| `try` | use `try`/`catch` (same spelling, different semantics) |
| `recover` | `else` |
| `retry` | (no longer needed) |
| `done` | `end` |
| `together` | `end` |

### Block closers
- `done` → `end`
- `together` → `end`
- `end` remains `end` (only closer in v2)

### Service constructs removed
The following v1 service-related constructs are removed and must be replaced with JavaScript packages or external services:

- SQL queries → use a database driver (e.g., `pg`, `mysql2`) directly
- WhatsApp integration → use the Twilio API or WhatsApp Business API
- OCR integration → use an OCR service like Tesseract via an HTTP wrapper
- Telegram integration → use the `node-telegram-bot-api` package
- Sessions/OAuth → use standard auth libraries (e.g., `passport`, `next-auth`)

### Type system changes
- The type checker is now fully enforcing; previously accepted programs may now reject
- `std/text.format` removed: use `"{expr}"` string interpolation instead
- `ListPattern` no longer uses `.length`; use `count` instead
- `Json` values need explicit casting or map member access
- Variant unit names compile to their name; variants with fields compile to `{ $kind: "Name", fields }`
- `nothing` is now a proper type; `return nothing` exits early

### Module resolution
- `std/<name>` now resolves to bundled `.d.pln` declarations
- Relative imports use `.js` extension
- No implicit global builtins; import what you need from `std/`

### `render`/`element` blocks
- Lower to `createElement` calls from module scope (no JSX transform)
- No custom runtime plugin
- Import React (or another library) if you use render blocks

## Standard Library Changes

The v2 standard library is organized as explicit modules with `.d.pln` declarations:

| Module | Purpose |
| --- | --- |
| `std/io` | `print`, `read`, `args`, file helpers |
| `std/text` | String operations, interpolation `"{expr}"` |
| `std/list` | List operations: `cons`, `count`, `append`, `filter`, `map`, `reduce` |
| `std/map` | Map operations: `get`, `set`, `has`, `keys`, `values`, `delete` |
| `std/math` | `min`, `max`, `abs`, `clamp`, `lerp`, `deg2rad`, `rad2deg` |
| `std/json` | `parse`, `stringify` |
| `std/time` | `now`, `format`, `parse`, `add`, `diff` |
| `std/fs` | `mkdir`, `mkDir`, `readDir`, `readFile`, `writeFile`, `appendFile`, `exists` |
| `std/http` | Fetch-style server, JSON/text responses, SSE, request helpers |
| `std/ws` | WebSocket server with fragmentation and authorization-before-upgrade |
| `std/task` | Structured concurrency: groups, cancellation, channels, workers |
| `std/jobs` | Bounded job queue with retries, timeouts, drain and optional durable stores |
| `std/db` | SQLite tables and versioned migrations (Node 22) |
| `std/db-postgres` / `std/db-mysql` | Async PostgreSQL/MySQL adapters over application-installed drivers |
| `std/auth` | scrypt passwords, HS256 tokens, policies |
| `std/oidc` / `std/saml` | Optional OIDC and SAML service-provider helpers |
| `std/contract` | Runtime schemas, operations, typed results, router/transport |
| `std/test` | Test declarations and assertions |
| `std/dom` | DOM utilities for browser environments |

v1 modules like `std/date` are consolidated into `std/time`.

## CLI Changes

| v1 command | v2 equivalent |
| --- | --- |
| `plainscript` | same (rebranded) |
| `plainscript run` | same |
| `plainscript check` | same |
| `plainscript build` | same |
| `plainscript fmt` | same |
| `plainscript new` | same |
| `plainscript ir` | same |
| `plainscript watch` | new: rebuild on `.pln` changes |
| `plainscript lsp` | new: stdio language server |
| `plainscript dap` | new: stdio debug adapter |
| `plainscript migrate` | new: scan JS/TS for migration blockers |
| `plainscript interop` | new: translate supported `.d.ts` declarations |
| `plainscript version` | same |
| `plainscript help` | same |

Options updated: `--quiet/--verbose/--check/--std-base/--declarations/--template/--json`.
See [CLI](CLI.md).

## JavaScript and TypeScript migration

`plainscript migrate [paths…]` is a conservative scanner, not a transpiler. It reports:

- CommonJS `require`/`module.exports`;
- TypeScript `interface`, `enum` and `namespace` declarations;
- class declarations (move them to a JavaScript boundary or rewrite as records/functions);
- JSX/TSX syntax and files;
- `//` comments (PlainScript uses `#`).

```bash
plainscript migrate src --check
plainscript migrate src --json
```

A finding is a review item, not an automatic error in the old file. Recommended incremental
path:

1. Keep the existing JavaScript application running.
2. Add PlainScript modules for new, self-contained logic; import them from JavaScript or
   compile them and import the emitted `.js`.
3. Move a file at a time, starting with pure functions and types. Keep React/JSX components,
   Express middleware and third-party class-shaped APIs in `.js` modules at the boundary.
4. Declare the JavaScript surfaces you call with `declare function`/`declare const` or a
   `.d.pln` wrapper.
5. Run `plainscript check` after each move and keep the existing test suite green.
6. Only then replace entry points/build scripts.

There is no automatic TypeScript **source** conversion. `plainscript interop` translates a
conservative subset of `.d.ts` declarations to `.d.pln` and reports unsupported constructs;
imported definitions must be checked after translation. Type annotations otherwise cross
the boundary as hand-written `.d.pln` declarations or explicit `any`/`declare` shapes. A
mixed project is supported: `.pln` modules compile to ESM and `.js` modules remain ordinary
JavaScript consumed through interop. See [INTEROP](INTEROP.md).

## Migration Checklist

- [ ] Remove all keyword alias usage; use the one correct spelling
- [ ] Replace `done`/`together` with `end` to close blocks
- [ ] Replace `show`/`display`/`log` with `print` from `std/io`
- [ ] Replace service constructs (SQL, WhatsApp, OCR, Telegram) with JS packages
- [ ] Update type annotations; the v2 checker is more strict
- [ ] Replace `std/text.format(...)` with `"{expr}"` interpolation
- [ ] Update `ListPattern` to use `count` instead of `.length`
- [ ] Update `render`/`element` blocks to lower to `createElement` calls
- [ ] Update module imports: `std/<name>` resolves to declarations
- [ ] Run `plainscript migrate src --check` and review every finding
- [ ] Run `plainscript interop` for the `.d.ts` files you depend on and review warnings
- [ ] Run `npm test` to verify no regressions
- [ ] Consult `docs/SPEC.md` for the complete v2 language specification

## Where to find help

- `docs/SPEC.md` — complete language specification
- `docs/ARCHITECTURE.md` — compiler architecture and design decisions
- `docs/AUDIT.md` — audit of v1 that motivated the rebuild
- `docs/CLI.md` — CLI reference
- `docs/INTEROP.md` — JavaScript ecosystem interop guide
- Run `plainscript check path/to/file.pln` to diagnose specific issues
