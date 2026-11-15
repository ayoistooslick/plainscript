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

The v2 standard library has 11 explicit modules:

| Module | Replaces v1 equivalent |
| --- | --- |
| `std/io` | `print`, `read`, `readFile`, `write`, `writeFile` |
| `std/text` | String operations, interpolation `"{expr}"` |
| `std/list` | List operations: `cons`, `count`, `append`, `filter`, `map`, `reduce` |
| `std/map` | Map operations: `get`, `set`, `has`, `keys`, `values`, `delete` |
| `std/math` | Math operations: `min`, `max`, `abs`, `clamp`, `lerp`, `deg2rad`, `rad2deg` |
| `std/json` | `parse`, `stringify` |
| `std/time` | `now`, `format`, `parse`, `add`, `diff` |
| `std/fs` | `mkdir`, `mkDir`, `readDir`, `readFile`, `writeFile`, `appendFile`, `exists` |
| `std/http` | Server creation, routing, request/response helpers |
| `std/test` | `assert`, `describe`, `it`, `beforeEach`, `afterEach` |
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
| `plainscript version` | same |
| `plainscript help` | same |

Options updated: `--quiet/--verbose/--check/--std-base`.

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
- [ ] Run `npm test` to verify no regressions
- [ ] Consult `docs/SPEC.md` for the complete v2 language specification

## Where to find help

- `docs/SPEC.md` — complete language specification
- `docs/ARCHITECTURE.md` — compiler architecture and design decisions
- `docs/AUDIT.md` — audit of v1 that motivated the rebuild
- `docs/CLI.md` — CLI reference
- `docs/INTEROP.md` — JavaScript ecosystem interop guide
- Run `plainscript check path/to/file.pln` to diagnose specific issues
