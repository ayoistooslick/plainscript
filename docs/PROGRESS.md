# PlainScript 2.0 — Engineering Progress

Status vocabulary used below (no issue is "fixed" without every step):

- **Verified working** — exercised by an automated test or a recorded command.
- **Reproduced defect** — a failing case exists and is described.
- **Fix implemented** — code changed and the case passes.
- **Regression tested** — a test covers the case and the whole suite passes.
- **Integration verified** — a real program (template/demo) compiles and runs.
- **Still unresolved** — known, not done.
- **Intentionally unsupported** — design decision, documented in `docs/SPEC.md`.

Last verified: full suite `npm test` → **167 tests, 167 pass, 0 fail**; all 13 active `.pln` files in
`demos/` and `templates/` pass `plainscript check`.

---

## 1. Symbolic `&&` / `||` were accepted but undefined, producing false `PS3347`

**Class:** parser/lexer defect (undocumented surface) + checker hole.

**Reproduction:**

```plainscript
when true && false
    print("x")
end
```

Before the fix this parsed (operator `&&`) and the checker reported
`PS3347 Unknown operator "&&"` — a false diagnostic for syntax the parser accepted.

**Root cause:** `src/lexer.js` listed `'&&'`/`'||'` in `OPERATORS`, and
`Parser.orExpression`/`andExpression` accepted both the keyword and punctuation
spellings. `Checker.binaryType` only implemented `'and'`/`'or'`, so the punctuation
form fell through to the `default` branch. `docs/SPEC.md` defines exactly two logical
operators (`and`, `or`) and deliberately has one spelling per concept
(`docs/DECISIONS.md` §2).

**Decision:** remove the undocumented spelling rather than teach a second spelling to
the checker/hir/codegen. Symbolic forms now fail in the lexer with `PS1001 Unexpected
character`, which is honest: the syntax is not part of the language.

**Changed:** `src/lexer.js` (`OPERATORS`), `src/parser.js`
(`orExpression`, `andExpression`).

**Tests:** `tests/grammar-matrix.test.js` →
`symbolic logical operators are rejected: and/or are the only spellings`.

**Status:** Fix implemented, regression tested.

---

## 2. `PS3327 "await needs a Promise"` — contract confirmed, nothing to fix there

**Class:** expected behaviour (not a defect).

`docs/SPEC.md` §"Async" states: *`await` requires a `Promise` operand (`PS3327`)*.
`Checker.typeOf` case `Await` implements exactly that: a `promise` yields its value,
`any` yields `any`, anything else reports `PS3327`.

The earlier report of "async type checking is broken" came from probes that awaited a
literal (`await 1`), which the language intentionally rejects, and from a genuine but
different defect (issue 3).

**Verified behaviours (all covered):**

| Case | Result |
| --- | --- |
| `await` an async function call | `Promise of number` → `number`, no diagnostic |
| `await` a declared `Promise of text` | `text`, no diagnostic |
| `await` a non-Promise inside `async` | `PS3327` |
| `await` outside any async function | `PS3406` |
| async function call type | `Promise of` the declared/inferred result |
| top-level `await` | allowed (output is an ES module) |

**Tests:** `tests/grammar-matrix.test.js` → the four `await`/Promise tests.

**Status:** Verified working; intentional rejection documented.

---

## 3. Async lambdas were typed as non-async and returned the awaited value

**Class:** checker defect (HIR/codegen were already correct).

**Reproduction (spec §4.3 promises this works):**

```plainscript
let later = async (value: number) => await work(value)
```

Before the fix:

1. `Checker.functionExpressionType` pushed a frame with `async: false` regardless of
   `node.async`, so `await` inside an `async` lambda reported `PS3406`.
2. The lambda's result type was the awaited value, not `Promise of` it, so the value
   did not satisfy `Promise of number` and did not type as a promise at call sites.
3. An expression-bodied lambda pushed no frame at all, so `await` inside it was checked
   against the *enclosing* function.

**Fix:** `functionExpressionType` now always pushes its own frame with
`async: Boolean(node.async)`, maintains `asyncDepth`, and wraps a non-`promise` result
in `T.promiseOf` for async lambdas. `hir.js` already emitted `async` for lambdas
containing `await`, so no codegen change was needed.

**Tests:** `tests/grammar-matrix.test.js` →
`async lambdas may await, and their type is a Promise of the result`,
`await inside a non-async lambda belongs to the lambda`, plus the runtime test that
executes an async lambda and prints the awaited value.

**Status:** Fix implemented, regression tested, integration verified.

---

## 4. Parameter annotations — the earlier regression had a single, boring cause

**Class:** not a language defect; an editing defect in the previous session, plus a
diagnostic-quality observation.

The previous session repeatedly tried to make parameter annotations optional and broke
the suite. Root cause of *that* regression: the replacement removed
`this.expectPunct(':')` but still called `this.typeExpression()` while positioned **on**
the colon, so every typed parameter (`f(a: number)`) failed with
`PS2008 Expected a type but found ":"`. It was never a deep design conflict.

**Design answer (from the spec, not from TypeScript):**

- Function **declarations** require a parameter type (`docs/SPEC.md` §4.2, every example).
  There is no contextual type at a declaration, so an omitted annotation would silently
  become `any` and weaken the checker's contract.
- **Lambdas** may omit annotations when an expected function type supplies them
  (`docs/SPEC.md` §4.3). `tryLambda` already parsed this, and
  `functionExpressionType` already applied contextual typing.

Therefore the language was not changed. The requirement is now stated explicitly in
`docs/SPEC.md`, and both sides of the rule are covered by tests:

- `function identity(value) -> number ... end` → `PS2001` (requires annotation).
- `apply((value) => value * 2)` against `(number) -> number` → no diagnostics.

**Tests:** `tests/grammar-matrix.test.js` →
`function declaration parameters require a type annotation`,
`lambda parameters may omit annotations when the expected type supplies them`.

**Status:** Verified working; intentionally unsupported case documented.

---

## 5. Nested blocks and `end` counts — parser is correct; earlier failures were unbalanced files

**Class:** no defect found (after first-principles investigation).

The parser rule is simple and was verified by reading `tryStatement`, `conditional`,
`forLoop`, `matchStatement` and `blockBody`: every construct consumes exactly its own
terminator, and `statementsUntil` stops **without** consuming the stopper. A top-level
`end` is not a file terminator, so an extra `end` is correctly `PS2022`.

The previous session's "try/catch needs two `end`s" and "11 vs 2 ends" reports were
unbalanced samples: they contained one `end` more than constructs. The same mistake was
present in the hand-written template client (`getCookie` had one `end` for a nested
`when` **and** its `for`), which produced a cascading `PS2010 Unterminated function`.
That was my file's bug, not the compiler's — the parser pointed at the right construct.

**Regression matrix added (`tests/grammar-matrix.test.js`):**

- a function containing nested `when`, `otherwise when`, `otherwise`, `for`, nested
  `for`, nested function, `match` with list patterns and a guard-free catch-all;
- `try/catch/finally` inside a function, with an early `throw`;
- two sibling `try/catch` blocks followed by code that must still be checked;
- the composed program's runtime output.

**Status:** Verified working (constructs compose); no parser change required.

---

## 6. Template files were written against syntax the language never had

**Class:** documentation/template defect (not compiler).

`the former auth template/src/shared.pln` and `client.pln` contained invented syntax:
`?User` (prefix optional), `createElement "div" with ...` (JSX-ish calls), backtick
template literals, `element` used as a variable name (reserved keyword), `{ ... }` arrow
bodies, and calls without parentheses. Result: 40+ parse errors; the module never
compiled.

**Fix:** rewritten against the real grammar and the real stdlib declarations
(`std/dom` exports only `createElement`/`mount`; text helpers live in `std/text`;
`std/http` exports `fetch`). `shared.pln` now exports `PublicUser`/`AuthStatus` plus
input/session types and uses postfix optional (`PublicUser?`).

**Verified:** `plainscript check` on `shared.pln`, `app.pln`, `client.pln` → all exit 0;
`plainscript build` emits `client.js` with the type-only `./shared` import erased and no
`passwordHash`/`salt`/`scrypt` identifiers.

**Status:** Fix implemented, integration verified (type-check + build; see limitation 3).

---

## 7. Authentication backend completed and exercised end-to-end

**Class:** application work (the stress test).

`the former auth template/src/app.pln` now implements:

- `POST /api/auth/register` — validation (required fields, password ≥ 8), duplicate
  username/email → `409`, scrypt hash with a 16-byte random salt, session issued, `201`.
- `POST /api/auth/login` — constant-time hash comparison (`timingSafeEqual`), generic
  `401 invalid credentials` on either unknown user or wrong password.
- `POST /api/auth/logout` — invalidates the session server-side.
- `GET /api/auth/me` — resolves the session from the `session` cookie, `401` otherwise.
- `GET /api/users` — public projection only (`id`, `username`, `email`).
- `GET /health`, unknown routes `404`.

Passwords are never stored or returned in plaintext; `StoredUser` is local to the server
and the response projection is a separate `PublicUser` type.

**Recorded curl run (server on port 3999):**

| Request | Result |
| --- | --- |
| `GET /health` | `200 {"status":"ok","users":0}` |
| `POST /api/auth/register` (ada) | `201`, 48-hex session id, public user |
| `GET /api/auth/me` + cookie | `200`, user object |
| login, wrong password | `401 invalid credentials` |
| login, correct password | `200`, new session |
| register duplicate username | `409 username is already taken` |
| register 5-char password | `400 password must be at least 8 characters` |
| `GET /api/users` | `200`, no hash/salt fields |
| `POST /api/auth/logout` + cookie | `200 {"ok":true}` |
| `GET /api/auth/me` with the old cookie | `401 not authenticated` |
| unknown path | `404` |

**Status:** Fix implemented, integration verified (HTTP flows).

---

## 8. `plainscript new --template` integration

`src/cli.js` now accepts `--template <id>` / `--template=<id>`, copies the bundled
template tree (skipping `node_modules`, `dist`, `.plainscript`), rewrites `package.json`
name/private/devDependency, and writes `.gitignore`. Unknown ids list what is available
and exit `2`. `package.json` ships `templates/`; `docs/CLI.md` documents the flag.

**Tests:** `tests/cli.test.js` →
`new --template scaffolds the bundled the former auth template project` (scaffolds, then runs
`plainscript check` inside the new project), `new rejects an unknown template`.

**Status:** Fix implemented, regression tested.

---

## 9. `export default function` did not parse

Every JavaScript framework expects a default-exported function, and the language could not
write one:

```plainscript
export default function handler(request: any) -> any
    ...
end
```

It failed with `PS2001 Expected "(" but found "handler"`, because `exportDeclaration`
parsed everything after `default` with `expression()`, where `function` is not an
expression.

**Fix:** `exportDeclaration` routes `default function` and `default async function` to
`functionDeclaration({ defaultExport: true })`. A default-exported function may omit its
name; every other declaration still requires one (`PS2002`). The checker hoists the name
when present, records the signature as `defaultExportType`, and exposes it through the
import surface, so a PlainScript default import is fully typed. HIR carries
`defaultExport`; codegen emits `export default function name(params) {}` (or
`export default function (params) {}`), a real declaration rather than a lambda.

**Verified:** named default export imported from a second module, anonymous default
export, and self-recursion (`sumTo(4)` → `10`).

## 10. `new` was missing, so class-based APIs were unreachable

`new Date()`, `new DatabaseSync(path)` and `new Response(stream, ...)` are how most npm
APIs are constructed. `new` was not a reserved word: `new URL(...)` parsed as a call to an
undefined name.

**Fix:** `new` is reserved; `unaryExpression` parses `new <postfix expression>` so the
call and its arguments are kept, HIR has a `New` node, and codegen writes
`new Callee(args)` / `new Callee()`. The checker checks the callee and types the result
`any`, because constructor signatures belong to the JavaScript side.

**Verified:** `new URL(...).pathname`, `new DatabaseSync(":memory:")`,
`new ReadableStream({ start: ... })`, `new Response(stream, { headers: ... })`.

## 11. `std/http` buffered every response, so streaming was impossible

The real-time application found a library defect rather than a language one: `serve` ran
`await webResponse.arrayBuffer()` before `response.end(...)`. A response whose body stays
open (Server-Sent Events) therefore never delivered a byte, and large responses were held
entirely in memory.

**Fix:** `serve` writes and flushes the status/headers, then pumps
`webResponse.body.getReader()` into the socket, finishing on `done`, on client disconnect
(`response.on('close')` → `reader.cancel()`), or on a stream error. `HEAD` and bodyless
responses still end immediately.

**Verified:** `curl -N /events` receives `hello`, `presence`, one `tick` per second, and a
published `notice`. `tests/integration-apps.test.js` reports `TIMEOUT` if the stream is
buffered again, so the fix cannot silently regress.

## 12. Two new stress applications

### `demos/database` — SQLite-backed JSON API

`node:sqlite` through `new DatabaseSync`, schema creation at startup, one prepared
statement per operation with bound parameters (`?`) — there is no SQL string interpolation
anywhere — and rows shaped into a `Task` record by `toTask` instead of leaking driver rows
into the API.

Observed with `curl` (port `4401`, `DB_PATH=/tmp/tasks.db`):

| Request | Observed |
| --- | --- |
| `GET /health` | `{"status":"ok","tasks":0}` `200` |
| `POST /tasks {"title":"first"}` | `{"id":1,"title":"first","done":false}` `201` |
| `POST /tasks {"title":"second","done":true}` | `{"id":2,...,"done":true}` `201` |
| `GET /tasks` | both rows, ordered by id, `200` |
| `GET /tasks/1` | `{"id":1,"title":"first","done":false}` `200` |
| `PUT /tasks/1` | `{"id":1,"title":"first edited","done":true}` `200` |
| `POST /tasks {}` | `{"error":"title is required"}` `400` |
| `GET /tasks/99` | `{"error":"task not found"}` `404` |
| restart, `GET /tasks` | both rows, including the edit — data persisted in the file |
| `DELETE /tasks/1` | `{"deleted":true}` `200`; health count → `1` |

Filtering and pagination use the same prepared-statement path: the WHERE/`limit`/`offset`
shape is assembled, every value stays a bound parameter, and the parameters are spread into
`statement.all(...params)` (second run, fresh file):

| Request | Observed |
| --- | --- |
| `GET /tasks` | `alpha` (false), `beta` (true), `gamma` (false) |
| `GET /tasks?done=true` | `[{"id":2,"title":"beta","done":true}]` |
| `GET /tasks?done=false` | `alpha`, `gamma` |
| `GET /tasks?limit=2&offset=2` | `[{"id":3,"title":"gamma","done":false}]` |
| `GET /tasks?done=false&limit=1&offset=1` | `[{"id":3,"title":"gamma","done":false}]` |

### `demos/realtime` — Server-Sent Events broadcast

A `ReadableStream` subscriber list, an `event: …\ndata: …\n\n` framing function, a
per-second `setInterval` heartbeat, and `POST /publish?event=…&data=…` to push to every
open connection. Broadcasts survive closed connections: `enqueue` failures are caught and
the dead controller is dropped instead of breaking the loop.

Observed capture (3s subscription, one publish in the middle):

```
event: hello
data: connected

event: presence
data: {"subscribers":1}

event: tick
data: {"tick":1,"uptime":1002,"subscribers":1}

event: notice
data: hello

event: tick
data: {"tick":2,"uptime":2002,"subscribers":1}
```

## 13. Probe matrix — what else was checked this pass

Compiled **and executed** successfully: generic declarations and calls, `map` iteration,
destructuring `for { id, title } in rows`, record/list spread, `?.` + `??`, match guards,
union narrowing with `is`, `while`/`break`/`continue`, re-exports, `Promise.all`, async
functions returning unions, `try`/`catch`, nested generics, function-type parameters,
index assignment on maps, optional list elements, boolean `match`, recursive variant types
(`type Tree = Leaf(value: number) or Node(left: Tree, right: Tree)` with recursive
`total`), and per-iteration closure capture in `for` loops (`10, 11, 12`).

Still unsupported, and now documented as deliberate in `docs/SPEC.md`: computed record keys
`{ [k]: v }`, tuple types `(number, text)`, `readonly` field modifiers, `keyof`/`typeof`
type queries.

---

## 14. `plainscript run` leaked the program it started

Found while running the framework demo: stopping the CLI (`kill <pid>`, Ctrl+C, a
supervisor restart) left the compiled server child alive, still holding its port. Repeated
test runs accumulated orphaned listeners on ports `4401`, `4403` and `4501`.

**Cause:** `commandRun` used `spawnSync`, which blocks the event loop, so no handler could
forward a signal, and the runtime child is not in the CLI's process group.

**Fix:** `run` now starts the program with `spawn` and forwards `SIGINT`/`SIGTERM` to it,
resolving with the child's exit status and removing the handlers afterwards. `test` awaits
`run`, and the CLI entry point resolves a promise from `main` so asynchronous commands set
`process.exitCode` correctly.

**Verified:** `tests/cli.test.js` — `run forwards termination to the program it started`
starts a long-lived program through the CLI, sends `SIGTERM` to the CLI, and fails unless
the program PID is gone.

---

## 15. Frontend and framework integrations re-verified

After `export default function`, `new` and the CLI signal fix landed, the existing
integration demos were rebuilt from clean dependency installs:

| Demo | Command | Result |
| --- | --- | --- |
| `demos/react` (React 19 + Vite 6) | `npm ci && npm run build` | `plainscript build` emitted `src/generated/App.js`; Vite transformed 25 modules into `dist/` (224 kB JS, 0.49 kB CSS). |
| `demos/next` (Next.js 15 App Router) | `npm ci && npm run build` | `Compiled successfully in 4.9s`; `/` prerendered as static content (123 B page, 103 kB first load). |
| `demos/express` (Express 4) | `npm ci && plainscript run src/main.pln` | `/` → `{"ok":true,"hits":2,"framework":"express"}` `200` (counter increments per request), `/users/42` → `{"id":"42"}` `200`, unknown path `404`. |
| `plainscript run` shutdown | `kill <cli pid>` with the Express demo running | port `4501` released and the program process gone, confirming the signal fix live. |

Not exercised this pass: browser rendering of `demos/react` and `demos/fullstack` (no
headless browser run), so the `render` output is verified by build and prerender, not by
DOM assertions.

---

## 16. Libraries could not describe their types: `build --declarations`

A PlainScript library could be compiled, but a consumer had no way to use it without the
sources: `.d.pln` files existed only as hand-written stubs under `stdlib/`.

**Fix:** `plainscript build --declarations` now emits `<name>.d.pln` beside every
`<name>.js` (`src/declarations.js`). The file is generated from the checked module, not
from source text:

- exported type declarations keep their written form (`export type Task` with fields,
  `export type Status = Draft or Published(views: number)`);
- every type declaration is emitted, but only exported ones carry `export`, so a private
type used by a public signature (`type Entry = { task: Task }`) stays in scope without
becoming API;
- exported functions become `export declare function name(params) -> R`; the return type
  comes from the written annotation when there is one, otherwise from the checker's
  inferred type;
- exported values become `export declare const NAME: T`;
- re-exports and `export { local as public }` are preserved;
- only imports actually named by the emitted signatures are kept, so the declaration is
  self-contained.

The resolver now understands the other half: a relative `./lib/x.js` import reads
`./lib/x.d.pln` for its types and keeps the runtime specifier unchanged
(`src/modules.js`, `PS4005` when a `.js` import has no declaration). Declaration modules
are checked for their exports but never emitted or written.

**Verified:** `tests/declarations.test.js` builds a two-module library into `dist/`, then a
consumer imports `./dist/store.js` and `./dist/models.js`, type-checks, and runs with
output `published 3` / `draft` / `published 7` / `published 9`. A wrong argument or result
type is rejected through the declaration (`PS3343`, `PS3311`), and `build` without the flag
writes no `.d.pln`.

## 17. Type declarations could not name imported types

The first declaration build failed on `type Entry = { task: Task }` with `PS3201 Unknown
type "Task"`, even though `Task` was imported. `run()` resolved type declarations before
`hoist()` registered imports, so only local types were visible during type resolution.

**Fix:** `collectTypes → hoist → resolveAllTypes → checkStatements`. Imports and function
signatures are hoisted first; every other phase is unchanged, and the existing suite passes
without modification.

**Verified:** `tests/declarations.test.js` — `type declarations may name types imported
from another module`.

## 18. Imported variant constructors were unknown, and matching them was wrong

The round-trip consumer exposed two runtime defects at once: `describe(publish(3))`
returned `"draft"`.

Emitted code showed why:

```js
if (true) { const Draft = $match1; return "draft"; }        // unit arm matched everything
const views = $match1["field0"];                            // positional, not the field name
```

Variant metadata (unit vs fields, field names) lived only in the declaring module's
`variantCtors`, so a module that imported the *type* matched it structurally and
positionally.

**Fix:** importing a type that resolves to variants now registers those constructors in the
importing module (`registerImportedVariants`). Construction (`Published(3)`), unit values
(`Draft`), pattern field names (`views`) and unit-arm discrimination all use the same
metadata as the declaring module, so the runtime representation is consistent across the
boundary.

**Verified:** the consumer test calls `describe(publish(3))`, `describe(draft())` and
`describe(Published(7))`; the last one constructs the variant in the consumer, not the
library. Before the fix the first printed `draft` and the third did not compile.

---

## 19. Installed packages were untyped: bare imports now resolve declarations

Declarations worked for relative imports of built JavaScript, but an installed library was
reached through a bare specifier (`import { Task } from "my-lib"`), which went straight to
the runtime and left every import `any`.

**Fix:** `Compiler.resolvePackageImport` finds the package the way Node does (walking up to
`node_modules`, including scoped names and subpaths) and then locates the declaration:

1. the `types` condition of the matching `exports` entry for that subpath;
2. otherwise the package's `types` or `typings` field;
3. otherwise `.d.pln` next to the resolved runtime entry (`main`, `module`, `exports.import`
   or `index.js`).

When a declaration is found, the module is checked from it and the emitted import keeps the
bare specifier unchanged, so the host resolves the runtime exactly as before. A package of
plain JavaScript with no declaration still imports untyped (no `PS4005`), which is what
keeps `express` and friends working.

**Verified:** `tests/packages.test.js` — `exports` conditions with `types`, a package-level
`types` field with `main`, a subpath export (`kit/extra`), a scoped package
(`@acme/tools`), and an undeclared JavaScript package. The typed cases run and reject a
wrong argument (`PS3343`); the untyped case runs but is not checked.

---

## 20. Publishing still needed hand-written package metadata

Declarations and runtime were written, but an installed package would only resolve its
`./dist/index.js` entry; `types` and an `exports` map had to be added by hand before
`import { Task } from "my-lib"` was typed.

**Fix:** `build --declarations` now wires the package entry in `src/cli.js`
(`wirePackageTypes`). It picks the entry the manifest already names, otherwise
`dist/index.js`, otherwise the single module nothing else in the build imports, and sets:

```json
"types": "./dist/index.d.pln",
"exports": { ".": { "types": "./dist/index.d.pln", "import": "./dist/index.js" } }
```

Existing `exports` entries and conditions are preserved (`."` is updated in place, other
subpaths are copied through, a declared runtime path is kept). A build with several
independent entry modules, or a project with no `package.json`, is left untouched instead
of being guessed at.

**Verified:** `tests/package-wiring.test.js` — fresh manifest wiring, preservation of
`./extra` and `./package.json` subpaths, an existing `"."` entry keeping its runtime and
`default` condition while gaining `types`, an ambiguous two-root build leaving
`package.json` byte-identical, no manifest created for a plain directory, and an
end-to-end consumer that installs the wired package through a `node_modules` symlink:
`makeTask("wired")` runs and `makeTask(1)` is rejected with `PS3343`.

---

## Test inventory

| Area | File | Count |
| --- | --- | --- |
| Lexer | `tests/lexer.test.js` | existing |
| Parser | `tests/parser.test.js` | existing |
| Checker | `tests/checker.test.js` | existing |
| Compiler/emitter/modules | `tests/compiler.test.js` | existing |
| Runtime | `tests/runtime.test.js` | existing |
| Formatter | `tests/formatter.test.js` | existing |
| Interop | `tests/interop.test.js` | existing |
| CLI | `tests/cli.test.js` | existing + 3 new |
| Grammar matrix (new) | `tests/grammar-matrix.test.js` | 17 new |
| Application integration (new) | `tests/integration-apps.test.js` | 2 new |
| Declarations (new) | `tests/declarations.test.js` | 5 new |
| Packages (new) | `tests/packages.test.js` | 5 new |
| Package wiring (new) | `tests/package-wiring.test.js` | 6 new |
| Package | `tests/package.test.js` | existing |
| **Total** | | **165, all passing** |

No existing test was modified, skipped, or weakened.

---

## Files changed in this pass

- `src/lexer.js` — removed `&&`/`||` from `OPERATORS`; `new` is a keyword.
- `src/parser.js` — `orExpression`/`andExpression` accept only `or`/`and`;
  `export default function`; `new` expressions.
- `src/hir.js` — `New` node; `defaultExport` on function declarations.
- `src/codegen.js` — `new Callee(...)`; `export default function` declarations.
- `stdlib/http.js` — stream response bodies instead of buffering them.
- `src/cli.js` — `run` forwards `SIGINT`/`SIGTERM`; async plumbing; `build --declarations`
  and package entry wiring.
- `src/declarations.js` — `.d.pln` emitter (new).
- `src/modules.js` — resolves `.d.pln` beside built `.js` and inside installed packages;
  never emits declaration modules.
- `src/checker.js` — imports hoisted before type resolution; imported variant constructors;
  `export default name` takes the named value's type.
- `tests/declarations.test.js` — five declaration/round-trip tests (new).
- `tests/packages.test.js` — five package-resolution tests (new).
- `tests/package-wiring.test.js` — six wiring tests, including a symlinked consumer (new).
- `demos/database/` — SQLite-backed CRUD API (new).
- `demos/realtime/` — Server-Sent Events broadcast (new).
- `tests/integration-apps.test.js` — SQLite and SSE regression tests (new).
- `src/checker.js` — async lambda frame and `Promise of` result type.
- `src/cli.js` — `--template` scaffolding, `copyTemplate`, help text.
- `package.json` — `files` includes `templates`.
- `the former auth template/src/app.pln` — real auth API.
- `the former auth template/src/client.pln` — rewritten to valid PlainScript.
- `the former auth template/src/shared.pln` — valid optional types, public projection.
- `the former auth template/package.json` — publishable script/name shape.
- `tests/grammar-matrix.test.js` — new matrix.
- `tests/cli.test.js` — two template tests.
- `docs/SPEC.md` — parameter annotations, async lambda type, `and`/`or` only,
  `export default function`, `new`, reserved words, deliberate type omissions.
- `docs/CLI.md` — `--template` documentation.
- `docs/PROGRESS.md` — this file.

---

## Remaining work (known, not claimed done)

1. **Declaration documentation.** Generated `.d.pln` files drop source comments, so a
   package's API documentation does not travel with its types. Multi-entry libraries also
   need their `exports` subpaths wired by hand; only the `"."` entry is inferred.
2. **Browser rendering not re-exercised.** `demos/react` and `demos/next` build (and Next
   prerenders `/`), and `demos/express` answers real requests, but no headless browser ran
   against the rendered DOM this pass, and `demos/fullstack`'s client flow was not re-run.
3. **Advanced type system.** Generic constraints, default type parameters,
   conditional/mapped types, `keyof`/`typeof` queries, and distinct tuple types are
   absent. The checker supports structural records, unions, generics with inference,
   narrowing and exhaustiveness only. Spec documents the current subset.
4. **Browser client is type-checked and compiled, not executed.** No headless browser
   run was performed against `client.pln`; only `check`/`build` and inspection of the
   emitted module. A DOM harness test is outstanding.
5. **Auth template persistence.** The store is in memory (documented in the file header);
   restarting the server drops users and sessions. `Session.expiresAt` exists as a type
   but session expiry is not enforced yet.
6. **Language server / editor tooling.** No LSP, go-to-definition, rename or hover. The
   VS Code package workflow was updated for v2 but there is no server implementation.
7. **Compiler performance.** No incremental compilation or module-graph cache; no
   measurement of large-project build time.
8. **Documentation website** still needs to mirror the SPEC/CLI changes above.

---

## 21. Conditional vocabulary aligned with familiar control flow

**Design:** Adopt `if` / `else if` / `else` for conditionals and `if` for match guards.
Keep `end` as the explicit block terminator. This is a hard source-syntax change, not a
dual-keyword alias period; the reasons and comparison examples are in
[`docs/SYNTAX_DESIGN.md`](SYNTAX_DESIGN.md).

**Implementation:** `src/lexer.js` reserves the new words and keeps retired `when` and
`otherwise` reserved solely so stale source fails as syntax. `src/parser.js` maps new
conditional and match-guard spellings to the existing AST nodes, so checker narrowing,
scope, return analysis, HIR and generated JavaScript retain their prior semantics.
`src/formatter.js`, tests, active demos/templates, README, SPEC, migration guide and
decision notes were updated. The stale `match ... otherwise` spec example was replaced
with the implemented wildcard arm `case _`.

**Verified:** `npm test` → **167/167 pass**. Every active `.pln` file in `demos/` and
`templates/` → `plainscript check` passed (13 files). Tests cover new keyword tokens,
nested `else if` formatting, match guards, old-syntax rejection, checker behavior and
runtime execution. `npm pack --dry-run` includes the design document and completes without
publishing.

**Compatibility/release note:** Existing programs using `when` / `otherwise` as branches
must be migrated. The package version remains `2.0.0`; selecting a release number for this
breaking syntax update is still required before any npm release. No package was published.
