# Changelog

All notable changes to PlainScript are documented here.

---

## [1.0.363]  -  2026-09-14

### Assignment

- **Compound assignment operators:** `+=`, `-=`, `*=`, `/=`, `%=` (the legacy
  `++=` spelling is still accepted as `+=`), with the word forms `or becomes`
  (`||=`), `and becomes` (`&&=`), and `nullish becomes` (`??=`).
- **`set` / `change` assignment:** prefix forms `set <expr> to <value>` and
  `change <expr> to <value>` compile to plain assignment, as do the postfix
  aliases `<expr> set to <value>` and `<expr> change to <value>`. A variable
  named `set` or `change` keeps its usual meaning unless a value and `to`
  follow; `set cookie` and `set ... with` keep their own meanings.
- **`end` is now a synonym for `done`** in every block-closing position
  (functions, loops, conditionals, kinds, SQL blocks, and so on), so `end`
  closes any block `done` can close.

### Interactive terminal primitives

- `confirm("...")` (y/n prompt returning a boolean), `choose("...", [...])`
  (numbered picker returning the chosen option), `clearTerminal()`,
  `terminalWidth()`, `terminalHeight()`, and `stderr(...)` (writes to
  `console.error`).
- Global CLI flags **`--quiet`** and **`--verbose`**: `--quiet` suppresses the
  banner, stage, and per-file `✓` chatter while still surfacing validation
  errors and non-zero exits; `--verbose` prints stage timing lines.

### Data & AI primitives

- Statistics over numeric arrays: `mean`, `median`, `variance`, `deviation`.
- Vector helpers: `dotProduct(a, b)`, `magnitude(v)`, `normalize(v)`.
- Randomness: `randomInteger(low, high)`, `randomChoice(list)`,
  `weightedChoice(items, weights)`, `shuffle(list)`, `sample(list, n)`.
- `memoize(fn)` (Map-backed caching by argument string), `parseBoolean(text)`
  (`true`/`yes`/`1`/`on`), and `characters(text)` (splits a string into an
  array of characters).

### Concurrency

- `run in parallel ... done as <name>` compiles each statement in the block to
  a concurrent async task and resolves `Promise.all`, collecting each
  statement's value into `name` in body order (`done` without `as <name>`
  still runs the block concurrently).

### Collections & regex

- `count of <collection>` returns `.count`, `.length`, or `.size` as
  available.
- Regex capture via `match pattern "..." in "..." as <name>` assigns the
  `String.match` result (full match plus capture groups).
- `all of [...]`, `any of [...]`, and `settled of [...]` spellings for the
  Promise combinators.

### Examples

- New runnable examples: `ai-memory-cli` (persistent-memory AI CLI built from
  general primitives), `todo-cli`, `file-manager-cli`, `terminal-cli`,
  `interactive-cli`, `stats-cli`, `random-cli`, `string-helpers`,
  `memoize-demo`, `compound-assignments`, `normalization-forms`, and
  `run-in-parallel`.

### New tests

- New suites `assignment.test.js`, `primitives.test.js`, `concurrency.test.js`,
  `terminal.test.js`, and `cli.test.js` add 95+ assertions covering compound
  assignment, the `set`/`change` aliases, statistics, randomness, memoization,
  parallel execution, terminal output, and the `--quiet`/`--verbose` flags.

### Fixed

- Property-of assignment inside `for each` loops no longer trips the
  numbered-item `X one from list` ambiguity, so `completed of todo`-style
  targets assign correctly.
- `set`/`change ... to` now compile in both prefix and postfix positions.
- `run in parallel` collects each statement's resulting value (expression
  statements contribute their return value) instead of only awaiting the block.
- A batch `--quiet build` no longer leaks per-file `✓` summary chatter.

---

## v2.4  -  Near-English Intent-Oriented Syntax

### New English syntax forms
- `name at position N`  -  array indexing (alternative to `name[N]`)
- `obj has field "name"`  -  property check (alternative to `"name" in obj`)
- `name starts as "x"`  -  string startsWith (alternative to `name.startsWith("x")`)
- `name ends as "x"`  -  string endsWith (alternative to `name.endsWith("x")`)
- `name made of "x"`  -  string includes (alternative to `name.includes("x")`)
- `a more than b`  -  greater than (alternative to `a > b`)
- `a fewer than b`  -  less than (alternative to `a < b`)
- `a same as b`  -  strict equality (alternative to `a === b`)
- `a different from b`  -  strict inequality (alternative to `a !== b`)
- `name uses arg1, arg2 together`  -  function call (alternative to `name(arg1, arg2)`)
- `fill name with arg1, arg2 together`  -  function call (alternative)
- `raise expr`  -  throw error (alternative to `throw expr`)
- `handled by`  -  error recovery (alternative to `recover as`)
- `choosing cond then a otherwise b`  -  ternary (alternative to `cond ? a : b`)

### Improvements
- All documentation updated to prefer English syntax
- All examples and samples rewritten in English syntax
- VSCode extension updated with new syntax highlighting and snippets

---

## [1.0.2]  -  2026

### Fixed

- **Async keywords now work inside routes, listeners, and functions.** `ocr`,
  `ask`, HTTP calls, cache, mail, and every other await-producing construct used
  to rely on a hand-maintained list of statement types to decide whether an
  enclosing handler should be `async`. That made some keywords work only at the
  top level of a program while silently breaking inside a route. The compiler now
  decides a handler's `async`-ness by observing what it actually emits, so any
  keyword  -  existing or future  -  works anywhere a statement is allowed.
- **Package identity.** The npm library is `plainscript-lang`; docs, templates,
  and examples now use `plainscript-lang` for `devDependencies` and install
  commands (previously spelled as `plainscript`).

### Changed

- Version bumped to **v1.0.2** across the compiler, package metadata, templates,
  fixtures, examples, samples, and documentation.

---

## [2.2.0]  -  2026

### AI / ML and data / storage & web additions

Broadens the intent-oriented surface with AI/ML, data/storage and web features.

- **AI / ML (builtin `ai`):** `chat(model, messages, options)`  -  OpenAI-compatible
  LLM chat completion (async); `embedText(model, text, options)`  -  text embeddings;
  `similarity(a, b)`  -  cosine vector similarity (-1..1); plus `ai_tags(text)` and
  `ai_post(subject, ideas, options)` conveniences. Reads `OPENAI_API_KEY`/
  `OPENAI_BASE_URL`, overridable via options.
- **Data / storage:** `paginate(list, page, perPage)` returns
  `{ items, count, page, pages, perPage, hasNext, hasPrev }`; the `cache` builtin
  now falls back to an in-memory Map store with TTL (`__cacheGet/__cacheSet/__cacheDelete`)
  when no Redis is configured, so naive caching works out of the box.
- **Web / full-stack:** route-scoped `body(...)` accessor (`body()` raw,
  `body("field")` field) with route-guarded teaching errors; `redirect to "<url>"`
  statement maps to `res.redirect(...)`.
- **Collections & strings (`coll`):** `range`, `clamp`, `first`, `last`, `flatten`,
  `includes`, `pick`, `omit`, `groupBy`, `startsWith`, `endsWith`, `truncate`,
  `padStart`, `padEnd`. (`contains` is a reserved lexer keyword, so the membership
  helper is `includes`.)

---

### Capability-gap audit vs. TypeScript + Node.js

This release closes a systematic audit of TypeScript/Node.js capabilities from an
**Intent-Oriented** point of view  -  every gap is addressed *in PlainScript's own
grammar* or explicitly documented as unnecessary. The full audit, with per-area
status and rationale, lives in `docs/CAPABILITY_GAP_AUDIT.md`.

### New IOPL-native capabilities

- **Record kinds (classes, IOPL-style):** `define a kind called "Person" with name is "" end`
  declares a compile-checked record schema; `create a Person with name "Ada" and age 17`
  builds instances. Unknown fields fail at runtime; records stay plain objects
  (JSON, DB, mail, etc. work unchanged). Composition via `merge` replaces inheritance.
- **Concurrency combinators:** `all of [... ]`, `any of [...]`, `settled of [...]`
  over Promise-combinators, plus `withTimeout(promise, ms)`.
- **Generators:** `yield <expr>` turns a `define ... end` into a generator
  (`function*`); `for each` and `spread of` consume them lazily.
- **Reflection:** `typeOf`, `fieldsOf`, `valueOf`, `hasField`, `sizeOf`.
- **Binary data:** `base64Encode`/`base64Decode`, `textToBytes`/`bytesToText`,
  and `sha256`/`sha1`/`md5` digests.
- **Serialization & config:** dependency-free `yamlDecode`/`yamlEncode` (mappings,
  sequences, scalars) and `load env file ".env"` (applies `KEY=VALUE` to `process.env`).
- **CLI & processes:** `args()` returns `process.argv.slice(2)`; `runCommand(cmd, args)`
  captures `{ ok, code, stdout, stderr }`.
- **Filesystem & path:** `fileSize`, `fileType`, `lastModified`, `walkFolder`,
  `joinPath`, `baseName`, `folderOf`, `extensionOf`.
- **Streams:** `writeLine`/`appendLine` for line-oriented appends.
- **Collections:** `keyMap`/`mapSet`/`mapGet`/`mapHas`/`mapDelete` and
  `newSet`/`addToSet`/`removeFromSet`/`setHas` wrapping JS `Map`/`Set`.
- **Dynamic modules:** `loadModule("./m")` requires a module at runtime.
- **Native test DSL:** `test "name" ... end` with `check a equals b`,
  `check a contains b`, `check a is b`, `check <expr> raises "msg"`; a built-in
  runner prints `PASS/FAIL` and exits non-zero on failure.
- **Exports:** `export <name>` marks a top-level symbol for `module.exports`.

### Fixed

- Lexer keyword lookup no longer leaks `Object.prototype` members (`valueOf`,
  `constructor`, `toString`, ...) as tokens  -  a latent prototype-pollution bug.

### New tests

- `tests/audit.test.js` exercises every new capability via compile-time and
  runtime assertions (75 tests). Total suite remains green (457 compiler + 75 audit).

---

## [0.1.7]  -  2026

### First release of PlainScript

PlainScript is an Intent-Oriented Programming Language (IOPL): you describe **what**
you want, and the deterministic compiler decides **how** to implement it in
JavaScript. The `.pln` extension and the whole language ship complete in this
release.

- **npm package `plainscript`.** Installs per project as a devDependency:

  ```bash
  npm install --save-dev plainscript
  ```

  No global install is required anywhere in the deployment story. Projects
  use it through npm scripts:

  ```json
  {
    "scripts": { "build": "plainscript build", "start": "node dist/index.js" },
    "devDependencies": { "plainscript": "^0.1.7" }
  }
  ```

- **`plainscript build` compiles a real production build.** Sources compile into
  `dist/`, preserving source file names and directory structure relative to
  the source root (`src/messi.pln` → `dist/messi.js`,
  `src/a/b.pln` → `dist/a/b.js`). Every entry is bundled with its imports,
  so each file in `dist/` runs standalone. Compilation is deterministic:
  identical sources produce byte-identical output.
- **Zero-config production build**  -  `plainscript build` auto-discovers `.pln` files
  under `src/` and compiles each to `dist/`, preserving file names and directory
  structure (`src/messi.pln` → `dist/messi.js`, `src/a/b.pln` → `dist/a/b.js`).
  Every entry is bundled with its imports, so each file in `dist/` runs standalone.
  Compilation is deterministic: identical sources produce byte-identical output.
- **Full CLI:** `plainscript build | run | start | new | install | add | remove |
  remove | update | check | fmt | doctor | version | help`.
- **Complete language:** variables, conditions, functions, arrays, objects,
  loops, string templates with `${...}` interpolation, PlainScript Expressions,
  multi-file projects, and a JavaScript Gateway with full async support.
- **Deterministic backend capabilities** compiled by the same compiler  -  web
  apps and routing, SQLite (native or WebAssembly) and PostgreSQL databases
  with transactions, sessions with signed cookies, password hashing and HMAC
  tokens, Google OAuth, file uploads, OCR, cookies, rate limiting, email,
  cron and background jobs, WebSocket servers, and Redis-backed caching.
- **WhatsApp bots** through Baileys with QR or pairing-code linking,
  compile-time pairing-number validation, and automatic reconnection.
- **Editor support:** a VS Code extension (`plainscript-vscode/`) and an
  MT Manager syntax file (`editors/mt-manager/`) for Android editing.
