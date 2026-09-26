<div align="center">

<img src="https://raw.githubusercontent.com/ayoistooslick/plainscript/main/docs/logo-pln.jpg" alt="PlainScript logo" width="220" />

# PlainScript

**An Intent-Oriented Programming Language (IOPL).**
Describe *what* you want. The compiler decides *how* to implement it in JavaScript.

[![CI](https://github.com/ayoistooslick/plainscript/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/ayoistooslick/plainscript/actions/workflows/npm-publish.yml)
[![npm version](https://img.shields.io/npm/v/plainscript-lang.svg)](https://www.npmjs.com/package/plainscript-lang)
[![Downloads](https://img.shields.io/npm/dm/plainscript-lang.svg)](https://www.npmjs.com/package/plainscript-lang)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[Quick Start](#quick-start) ·
[Language Tour](#language-tour) ·
[Backend Services](#backend-services) ·
[CLI Reference](#cli-reference) ·
[Contributing](#contributing)

</div>

---

## Table of Contents

- [Why PlainScript](#why-plainscript)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [Building &amp; Configuration](#building--configuration)
- [Language Tour](#language-tour)
  - [Closing blocks with `end`](#closing-blocks-with-end)
  - [Variables](#variables)
  - [String Templates](#string-templates)
  - [Conditions](#conditions)
  - [Conditional expressions](#conditional-expressions)
  - [Functions](#functions)
  - [Lambdas](#lambdas)
  - [Arrays &amp; Objects](#arrays--objects)
  - [Dictionaries, Sets &amp; Tuples](#dictionaries-sets--tuples)
  - [Loops](#loops)
  - [Natural-Language Expressions](#natural-language-expressions)
  - [Logical Assignment](#logical-assignment)
  - [Compound Assignment](#compound-assignment)
  - [Assignment aliases](#assignment-aliases)
  - [Error handling, async, and events](#error-handling-async-and-events)
  - [Record Kinds, Concurrency &amp; More](#record-kinds-concurrency--more)
  - [Concurrency: `run in parallel`](#concurrency-run-in-parallel)
- [Backend Services](#backend-services)
  - [Databases](#databases)
  - [HTTP Client](#http-client)
  - [Authentication](#authentication)
  - [Sessions &amp; Cookies](#sessions--cookies)
  - [File Uploads](#file-uploads)
  - [Rate Limiting](#rate-limiting)
  - [Google OAuth](#google-oauth)
  - [Error Handling &amp; Retries](#error-handling--retries)
- [Runtime Standard Library](#runtime-standard-library)
- [Interactive Terminal &amp; CLI Primitives](#interactive-terminal--cli-primitives)
- [Statistics &amp; Vectors](#statistics--vectors)
- [Randomness](#randomness)
- [Memoization &amp; Parsing Helpers](#memoization--parsing-helpers)
- [Web Applications](#web-applications)
- [Browser games and interactive apps](#browser-games-and-interactive-apps)
- [Additional Backend Capabilities](#additional-backend-capabilities)
  - [HTTP Routing](#http-routing)
  - [Transactions](#transactions)
  - [Email](#email)
  - [Cron &amp; Background Jobs](#cron--background-jobs)
  - [WebSockets](#websockets)
  - [Cache](#cache)
  - [AI / ML](#ai--ml)
  - [Pagination](#pagination)
- [AI-Readiness: On-Device Intelligence](#ai-readiness-on-device-intelligence)
- [Multi-File Projects](#multi-file-projects)
- [Express Integration](#express-integration)
- [WhatsApp Bots](#whatsapp-bots)
- [Supported Packages](#supported-packages)
- [Project Structure](#project-structure)
- [Running the Tests](#running-the-tests)
- [Contributing](#contributing)
- [License](#license)

---

## Why PlainScript

Most languages ask you to describe *how* a computation happens: loop constructs, control flow, boilerplate. PlainScript inverts that. You write source that reads like an instruction to a competent engineer, and a deterministic compiler  -  no rules engine, no AI, no hidden codegen  -  turns it into JavaScript.

| | |
|---|---|
| **Deterministic** | Rebuilds are byte-identical. Safe to commit, diff, and cache. |
| **Zero configuration** | `plainscript build` discovers sources and compiles them with no setup. |
| **Standard packaging** | Ships as normal `npm` packages; consumers `require()` the output like any Node module. |
| **Batteries included** | HTTP, SQLite/Postgres, sessions, auth, cron, WebSockets, and WhatsApp bots are language features, not add-on libraries. |

A short comparison of the same logic in JavaScript and PlainScript:

<table>
<tr>
<th>JavaScript</th>
<th>PlainScript</th>
</tr>
<tr>
<td>

```js
function classify(age) {
  if (age >= 18) {
    return "Adult";
  } else {
    return "Teenager";
  }
}
```

</td>
<td>

```
to classify age
    when age is at least 18
        give back "Adult"
    otherwise
        give back "Teenager"
    done
done
```

</td>
</tr>
</table>

**Current version:** `v1.1.5`  -  the `plainscript-lang` npm package, with a TypeScript-style production build (`plainscript build` → `dist/`, source names and structure preserved).

---

## Quick Start

```bash
npx plainscript new myapp     # scaffolds src/app.pln and package.json
cd myapp
npm install                   # installs the compiler and runtime packages
npm run build                 # compiles src/ -> dist/ (plainscript build)
node dist/app.js              # or: npm start
```

Adding PlainScript to an existing project:

```bash
npm install --save-dev plainscript-lang
# start writing src/*.pln files  -  plainscript build auto-discovers them
```

No global install is required. Everything runs through `npm` scripts and `npx`.

### Supported Node.js and dependency policy

The compiler and its checked-in dependency tree support **Node.js 18 or newer**.
Use the lockfile for reproducible installs:

```bash
npm ci
```

The compiler package intentionally does not install the optional WhatsApp
adapter. This keeps a normal `npm ci` independent of Baileys' native/GitHub
transitives and lets projects that do not use WhatsApp install cleanly on the
Node 18 floor. The SQLite, MongoDB, and Redis versions in `package.json` are
the last compatible major lines for that floor.

WhatsApp projects have a separate adapter requirement. `plainscript install`
uses the pinned default `@whiskeysockets/baileys@6.7.24` (Node.js 20 or newer)
and `qrcode-terminal`. If a package firewall or registry cannot provide that
adapter, install a Baileys-compatible package or local fork yourself and select
it in the bot block:

```plainscript
whatsapp bot
    use baileys "./vendor/baileys"
    auth "session"
    login qr
done
```plainscript

For a local adapter, install it from the project directory (for example,
`npm install ./vendor/baileys`) and ensure it exposes the Baileys default
socket export plus `useMultiFileAuthState`, `makeCacheableSignalKeyStore`, and
`DisconnectReason`. Local adapter paths are not passed to `npm install` by
`plainscript install`.

---

## CLI Reference

| Command | Description |
|---|---|
| `plainscript run <file.pln>` | Installs missing dependencies, compiles, and executes. Runs from a scratch directory  -  nothing is written into your project. |
| `plainscript test [target]` | Runs a PlainScript test file or all `*.test.pln` / `*.spec.pln` files under `tests/` (or `test/`). |
| `plainscript ir <file.pln>` | Emits the stable, backend-neutral compiler IR as JSON for tooling and diagnostics. |
| `plainscript-lsp` | Runs the stdio Language Server Protocol service for editor diagnostics, hover, completion, definitions, and symbols. |
| `plainscript build [file.pln]` | Compiles to `dist/`. With no argument, builds every `.pln` file under the source root, preserving names and folder structure. |
| `plainscript check <file.pln>` | Resolves imports, runs static contract/type checking, validates generated JavaScript, and reports a per-file `✓` line (or an error). Never executes your program. |
| `plainscript fmt <file.pln>` | Formats a PlainScript file in place. |
| `plainscript new [name]` | Creates a new PlainScript project, npm-ready. |
| `plainscript install` | Installs dependencies detected across the project's sources. |
| `plainscript start` | Builds `src/app.pln` and runs its `dist/` output. |
| `plainscript doctor` | Checks the PlainScript project environment. |
| `plainscript add <package>` | Installs a package into the project. |
| `plainscript remove <package>` | Uninstalls a package from the project. |
| `plainscript update` | Updates all installed npm packages. |
| `plainscript version` | Prints the compiler version. |
| `plainscript help` | Prints help text. |
| `--quiet` | Global flag for `run` / `build` / `check`: suppresses progress banners and per-file summary lines, printing only errors and output. |
| `--verbose` | Global flag for `run` / `build` / `check`: prints each compile stage with its timing detail. |

`--quiet` and `--verbose` are recognized anywhere in the argument list and
apply to `run`, `build`, and `check`, e.g. `plainscript build --quiet` or
`plainscript check src/app.pln --verbose`.

`run` keeps project-local `node_modules` first. Because generated JavaScript is
executed from a temporary directory, the CLI then falls back to the
PlainScript installation's own dependencies (for example, `sql.js` or a
usable `better-sqlite3`) rather than requiring generated files to be written
into the project.

---

## Building &amp; Configuration

`plainscript build` is a deterministic production build  -  TypeScript-style, but for `.pln` sources  -  with zero configuration required.

- Run with no argument and it discovers every `.pln` file under `src/`, compiling each to `dist/` while **preserving source file names and folder structure**: `src/messi.pln` → `dist/messi.js`, `src/helpers/math.pln` → `dist/helpers/math.js`.
- `plainscript build <file.pln>` compiles a single file into `dist/`.
- Imports are bundled into each output, so every file in `dist/` runs standalone under Node.
- Rebuilds are byte-identical, making them safe to commit, diff, and cache.

Source discovery skips `node_modules`, hidden directories, and the output directory itself. When no `src/` directory exists, the project root is scanned instead.

### Optional `plainscript.config.json`

For projects that need custom output or source directories, add a `plainscript.config.json` with a `compilerOptions` block, similar to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "outDir": "./build",
    "rootDir": "./lib",
    "exclude": ["vendor"]
  }
}
```

### Publishing a Library Written in PlainScript

```json
{
  "name": "my-plainscript-library",
  "main": "dist/index.js",
  "scripts": {
    "build": "plainscript build",
    "prepare": "plainscript build"
  },
  "devDependencies": { "plainscript-lang": "^1.1.5" }
}
```

`src/index.pln` builds to `dist/index.js`; consumers install and `require()` it like any Node package. There is no PlainScript-specific registry or format  -  standard `package.json` semantics apply.

---

## Language Tour

PlainScript is a fixed vocabulary of English verbs compiled to JavaScript. Every
construct follows the same rhythm: a word opens a block, `done` — or its synonym
`end` — closes it, and `give` returns a value  -  a sentence you could say to a
colleague ("if the score is at least 80, show accepted, otherwise review") is
valid source. The sections below keep the code first, with a short note on what
each construct is *for* and the constraint that matters when you use it.

### Closing blocks with `end`

Every block can be closed with either `done` or its synonym `end`; the compiler
treats them identically, so the two spellings mix freely in one file:

```plainscript
to greet name together
    show "hello, " + name
end
greet("Ada")

when 1 is 1
    show "math still works"
end
```

`end` is accepted wherever `done` is  -  functions, `if` / `when` /
`otherwise`, loops, `list with` / `record with`, and every other block.

### Variables

```plainscript
let name be "Ayokunle"
let age be 16
set age to 17
```

`remember name as "Ada"` and `let name be "Ada"` are two spellings of the same
declaration; `set name to ...`, `change name to ...`, `name becomes ...`, and
`name is now ...` all reassign it (the full family of assignment aliases is
listed below). Numbers, strings, and booleans behave like JavaScript primitives;
lists, records, dictionaries, and sets are *references*, so pointing two names
at the same list means they see the same data.

### String Templates

Backtick-delimited strings preserve whitespace and support `${expression}` interpolation:

```plainscript
let name be "World"
let greeting be `Hello ${name}!`
show greeting

let email be `Dear ${customer},

Thank you for your order #${orderId}.

Best regards,
The Team`
```

Interpolation compiles directly to JavaScript template literals  -  it is not evaluated at compile time. Literal dollar signs without `{` are preserved as-is.

### Conditions

`if <condition> ... done` runs its block when the condition is true, and the
optional `otherwise` block runs when it is false (`when ... done` is the same
statement used in web and event contexts). Conditions read like English, and a
comparison is itself a value: `score is at least 80` is `true` or `false`, so it
can be stored, printed, passed to a function, or joined with `and` / `or` /
`not`. When you need a *value* rather than a block, use `choosing` (below).

```plainscript
if age is at least 18
    show "Adult"
otherwise
    show "Teenager"
done

when name contains "PlainScript"
    show "Found it"
done

when score between 90 and 100
    show "A grade"
done
```

All comparison operators:

| PlainScript | JavaScript |
|---|---|
| `is` / `is equal to` | `===` |
| `same as` | `===` |
| `is not` | `!==` |
| `different from` | `!==` |
| `is greater than` / `is above` | `>` |
| `more than` / `is more than` | `>` |
| `is less than` / `is below` | `<` |
| `fewer than` / `is fewer than` | `<` |
| `greater than or equal to` / `is more than or equal to` | `>=` |
| `less than or equal to` | `<=` |
| `is at least` | `>=` |
| `is at most` | `<=` |
| `is empty` | `.length === 0` |
| `is not empty` | `.length > 0` |
| `contains "x"` | `.includes("x")` |
| `made of "x"` | `.includes("x")` |
| `starts with "x"` / `starts as "x"` | `.startsWith("x")` |
| `ends with "x"` / `ends as "x"` | `.endsWith("x")` |
| `between A and B` | `>= A &amp;&amp; <= B` |
| `has field "x"` | `"x" in obj` |
| `at position key` | `obj[key]` |

### Conditional expressions

`choosing` is the value form of `if`: pick between two expressions and keep the
whole thing inline  -  in an argument, a `give`, or a list element.

```plainscript
remember verdict as choosing score is at least 90 then "A" otherwise "B"
show choosing score is below 60 then "low" otherwise "ok"
```

`choosing <condition> then <a> otherwise <b>` evaluates to `<a>` when the
condition is true and `<b>` otherwise.

### Functions

```plainscript
to add a and b together
    give back a + b
done
show add(5, 7)

to multiply x and y together
    give back x * y
done
```

`make name(args)` and its `to ... together` spelling define a function; `done`
closes it  -  the PlainScript form of JavaScript's `function`. `give <value>` (or
`give back <value>`) returns; `give` alone simply ends the function. A `make`
function is a value like any other, so it can be stored with `remember`, passed
as an argument, or returned from another function. Arguments are optional with
defaults: `make label(name as "guest")`.

### Typed data contracts

PlainScript supports contextual `type` declarations for records and typed
function parameters. The compiler records the contract in the AST and emitted
programs validate typed arguments at runtime with clear field-level errors.
Primitive types are `number`, `text`, `boolean`, `object`, and `null`; contracts
also support `optional`, `list of`, `dictionary of`, and `or` unions.

```plainscript
type User
    id is number
    name is text
    active is optional boolean
done

make greet(user as User)
    give `Hello ${user.name}`
done

show greet({ id: 1, name: "Ada" })
```

Missing required fields and incompatible values fail before the function body
runs. Functions and intents can declare return contracts with `returns` or
`returning`; the checker validates returned values and reports missing returns.
Collection contracts can be used on mutable bindings:

```text
let users as list of User is [{ id: 1, name: "Ada" }]
let usersById as dictionary of User is { first: { id: 1, name: "Ada" } }
```

List elements, dictionary values, and nested record fields are checked
recursively. Optional and union element types are supported. The v1.1.5
checker also propagates known expression results through canonical standard
library calls and common text/list methods:

```plainscript
make normalized() returns text
    give " Ada ".trim().toLowerCase()
done

make words() returns list of text
    give "ada,grace".split(",")
done
```

Known math helpers, text conversions, collection operations, and member methods
now contribute their return types to argument and return-contract checking.
Unknown JavaScript/npm calls remain `any` rather than being guessed. The static
checker reports unknown fields, missing required fields, incompatible literal
values, unknown contract names, arity errors, invalid assignments, unsafe
optional member access, and invalid member access to editor tooling.
### Generic functions and aliases

Generic function parameters use angle brackets. The checker infers a concrete
type from each call and validates the result; generic parameters are erased
from runtime assertions because JavaScript cannot observe them directly.

```plainscript
type UserId is number

make id<T>(value as T) returns T
    give value
done

let userId as UserId is id(42)
show userId
```

Aliases are checked wherever the aliased type is used, including across local
imports. Runtime checks still validate the underlying concrete type.

The checker narrows nullable values after guards such as `if value is not null`
and `if value is null`; optional member access remains available when a value
has not been narrowed. Structural pattern exhaustiveness is not yet enforced.

### Cancellation and disposal

The standard library provides explicit cancellation tokens and deterministic
cleanup helpers:

```plainscript
let token is cancellationToken()
remember ignored as cancel(token)
if isCancelled(token)
    show "cancelled"
done
```

`dispose(resource)` can be used by a `using` scope to clean up resources. These
semantics are cooperative: an operation must inspect its token or call a
standard-library operation that accepts one.

### Language-server tooling

The compiler IR and static checker are available through a stdio LSP server:

```bash
plainscript-lsp
```

The server implements `initialize`, document open/change/close notifications,
`textDocument/publishDiagnostics`, type-rich hover, completion, definition,
references, rename, signature help, and document-symbol requests. Editors
should launch it as a standard LSP process and send JSON-RPC messages using the
normal `Content-Length` framing.

### Intent declarations

`intend` declares a callable function while preserving the author's semantic
intent in the AST and compiler IR. It currently has the same execution rules
as `make`, making it safe to use today while leaving room for contract,
documentation, and semantic-analysis tooling.

```plainscript
intend greet(name)
    give `Hello ${name}`
done

show greet("Ada")
```

### Lambdas

A lambda is a function without a name, written where a value is expected  - 
`(a, b) -> a + b` is JavaScript's `(a, b) => a + b`. Use the arrow form for a
one-expression body and the `do ... done` form when the body has several
statements:

```plainscript
remember add as (a, b) -> a + b
show add(2, 3)

remember grade as (score) do
    if score is at least 90
        give "excellent"
    otherwise
        give "keep practicing"
    done
done

remember doubled as numbers.map((n) -> n * 2)
```

Lambdas are ordinary values: store them, put them in lists and records, pass
them to `.map` / `.filter` / `.find` / `.forEach`, and return or chain them
(`mul(2)(3)(5)`) to build factories and curried helpers.

### Arrays &amp; Objects

`list with ...` is PlainScript's spelling of an array; `record with ... done`
is a plain object. Both are ordinary values, so lists hold records, records
hold lists, and lambdas can live anywhere a value can. Read and write them with
`.name`, `[index]`, or the natural-language forms later in this tour.

```plainscript
let players be list with "Haaland", "Foden", "Rodri"
show players[0]
set players[1] to "Palmer"

let user be record with
    name "Ayokunle"
    age 17
done
show user.name
```

### Dictionaries, Sets & Tuples

JavaScript's `Map` and `Set` have direct spellings, and tuples are fixed-size
arrays you usually unpack all at once:

```plainscript
remember lookup as dictionary with "alpha" is 1 and "beta" is 2 done
show lookup.get("beta")                       // 2

remember tags as set with "admin", "editor", "admin" done  // duplicates collapse

remember point as tuple with 10, 20 and 30 done
unpack point into x, y and z                  // x=10, y=20, z=30
show x + y + z
```

Dictionary and set entries are joined with `and`; a tuple separates its members
with commas and `and` before the final member. `show <value>` accepts any value,
and JSON data arrives as nested lists and records.

### Loops

`for each item in <collection> ... done` visits every element, and `while
<condition> ... done` repeats until the condition is false. Counted loops come
in sentence form too:

```plainscript
repeat 5 times
    show "tick"
done

remember energy as 9
repeat while energy is above 0
    energy becomes energy - 1
done
```

`for every item in basket` is an alias for `for each`, `repeat until <condition>`
flips the `while` sense, and `for index i from 0 to 9` gives a zero-based
counter when you need positions.

```plainscript
for each player in players
    show player
done

for every item in basket    // alias for "for each"
    show item
done

while age is less than 18
    set age to age + 1
done
```

### Natural-Language Expressions

Collections, properties, and files read like sentences.

**Items**

```plainscript
let players be list with "Haaland", "Foden", "Rodri"

show first player from players   // players[0]
show last player from players    // players[players.length - 1]
show player two from players     // players[1]
first player from players is now "Haaland"  // players[0] = "Haaland"
```

Number words from `one` to `twenty` map to one-based positions  -  `player one` is the first item.

**Collections**

```plainscript
show players length              // players.length
add("Palmer" to players)         // players.push("Palmer")
remove("Rodri" from players)     // players.splice(players.indexOf("Rodri"), 1)

when players contains "Foden"      // players.includes("Foden")
    show "Found"
done
```

**Properties**

```plainscript
show name of user                // user.name
show city of address of customer // customer.address.city
name of user is now "Ayo"        // user.name = "Ayo"
```

`of` chains right-to-left: `city of address of customer` reads as the city of the address of the customer.

**Files**

```plainscript
let data be read("users.txt")   // fs.readFileSync("users.txt", 'utf8')
write(data to "users.txt")      // fs.writeFileSync(data, "users.txt", 'utf8')
```

The older `readFile()` / `writeFile()` forms still work and are unchanged.

### Logical Assignment

The word-style assignment operators keep the common "fill the empty value"
pattern on one line  -  PlainScript for `flag = flag || true` and
`val = val ?? "default"`:

```plainscript
let flag be false
flag or becomes true
show flag

let val be null
val nullish becomes "default"
show val
```

### Compound Assignment

The arithmetic compound operators map straight to their JavaScript
counterparts. `+=`, `-=`, `*=`, `/=`, and `%=` all work, and the legacy `++=`
spelling is still accepted as `+=`:

```plainscript
let score be 10
score += 5        // 15
score -= 3        // 12
score *= 2        // 24
score /= 4        // 6
score %= 7        // 6
show score

let counter be 0
counter ++= 1     // legacy spelling of +=
show counter
```

The word-style logical forms join them and compile to the same JavaScript as
their symbols: `or becomes` is `||=`, `and becomes` is `&&=`, and `nullish
becomes` is `??=` (the symbolic spellings work too):

```plainscript
let flag be false
flag or becomes true         // flag = flag || true
show flag

let tally be 5
tally and becomes 2          // tally = tally && 2
show tally

let val be null
val nullish becomes "default"  // val = val ?? "default"
show val
```

### Assignment aliases

`becomes` has a full family of synonyms in both orders. The prefix forms
`set name to 17` and `change name to 17`, the postfix forms `name set to 17` and
`name change to 17`, plus the existing `name is now 17` all compile to the same
reassignment as `name becomes 17`:

```plainscript
let name be "Ada"
change name to "Ada Lovelace"
name set to "A. L."
name change to "AL"
set name to "Ada"
show name
```

### Error handling, async, and events

Programs that fail should say so. `raise <value>` throws an error, `try` /
`recover as err` / `finally` catch it, and `retry N times every Mms` re-runs a
block that may fail transiently:

```
raise "not implemented"

try
    remember data as jsonDecode(raw)
recover as err
    show "bad json: " + message of err
finally
    show "request complete"
done

retry 3 times every 2 seconds
    show "fetching..."
done
```

Asynchronous work uses `wait for <promise>` (or `await <promise>`). A `make`
function or lambda that `wait for`s a promise becomes async automatically, and
`all of [...]`, `any of [...]`, and `settled of [...]` run several promises at
once. Events bind with `when <target> "<event>" happens [as <name>] ... done`  - 
the DOM equivalent of `addEventListener`  -  and server/websocket forms follow
the same `when ... done` pattern.

### Record Kinds, Concurrency &amp; More

For the shapes that repeat in a program  -  a user, a message, an order  -  declare
a **record kind** and construct instances with `create`. Kinds behave like
plain objects with a known field list: setting an unknown field throws, which
catches typos early.

```
define a kind called "Player" with
    name is ""
    goals is 0
done

remember player as create a Player with name "Ada" and goals 4
player.goals becomes player.goals + 1
show player.goals
```

PlainScript 1.0.2 closes most of the gap with TypeScript-class languages using its own grammar. The full audit lives in [`docs/CAPABILITY_GAP_AUDIT.md`](./docs/CAPABILITY_GAP_AUDIT.md).

<details>
<summary>Expand full feature list</summary>

| Category | Features |
|---|---|
| Record kinds (classes) | `define a kind called "Person" with name "" and age 0 done`, then `create a Person with name "Ada" and age 17`. Plain-object instances; unknown fields throw. |
| Concurrency | `all of [...]`, `any of [...]`, `settled of [...]`, `withTimeout(promise, ms)`, `run in parallel ... done as <name>` |
| Compound assignment | `+= -= *= /= %=` plus legacy `++=`, and the word forms `or becomes` (||=), `and becomes` (&&=), `nullish becomes` (??=) |
| Assignment aliases | prefix `set name to` / `change name to`, postfix `name set to` / `name change to`, plus `name becomes` / `name is now` |
| Interactive CLI | `ask`, `confirm`, `choose`, `clearTerminal`, `terminalWidth`, `terminalHeight`, `stderr` |
| Statistics &amp; vectors | `mean`, `median`, `variance`, `deviation`, `dotProduct`, `magnitude`, `normalize` |
| Randomness | `randomInteger`, `randomChoice`, `weightedChoice`, `shuffle`, `sample` |
| Memoization &amp; parsing | `memoize`, `parseBoolean`, `characters` |
| Generators | `yield` inside `make name(...) ... done`; consumed with `for each` or `spread of` |
| Reflection | `typeOf`, `fieldsOf`, `valueOf`, `hasField`, `sizeOf` |
| Binary | `base64Encode/Decode`, `textToBytes/bytesToText`, `sha256/sha1/md5` |
| Config | `yamlDecode/yamlEncode`, `load env file ".env"` |
| CLI &amp; processes | `args()`, `runCommand(cmd, [args])` |
| Filesystem &amp; paths | `fileSize`, `fileType`, `lastModified`, `walkFolder`, `joinPath`, `baseName`, `folderOf`, `extensionOf` |
| Streams | `writeLine`, `appendLine` |
| Collections | `keyMap/mapSet/mapGet/mapHas/mapDelete`, `newSet/addToSet` |
| Dynamic modules | `loadModule("./m")` |
| Native tests | `test "name" ... end` with `check a equals b`, `check a contains b`, `check a is b`, `check object has field "name"`, and `check <expr> raises "msg"`; run files with `plainscript test` |
| Exports | `export <name>` |

</details>

### Concurrency: `run in parallel`

`run in parallel ... done as <name>` runs the block's statements concurrently
and collects each statement's value in order into the named list  -  the
statement-level equivalent of `all of [...]`:

```plainscript
make square(n)
    give n * n
end

run in parallel
    square(3)
    square(4)
done as results

show join(results, ", ")   // 9, 4
```

Each statement in the block becomes one concurrent task; the collected list has
one entry per statement in body order, so expression statements (typically
calls) contribute their return values. This is a single-process, promise-based
concurrency feature (implemented with `Promise.all`)  -  it runs concurrent
tasks, not worker threads.

**How the pieces fit together.** PlainScript is deliberately small: a handful
of verbs (`remember`, `give`, `if` / `otherwise`, `done`) plus the collections
and functions you just met. Everything is a value  -  numbers and strings,
comparisons, collections, lambdas, whole functions  -  so pieces nest instead of
needing new syntax: a lambda inside a list, a comparison handed to a filter, a
`make` function stored in a record. When a pattern repeats, extract it into a
`make` function (or a lambda), group related names into a module, and call the
abstraction the same way you call `show` or `jsonDecode`. The standard library
and the backend capabilities that follow are exactly this: vocabulary built on
the primitives above, available to every program.

---

## Backend Services

Everything in this section is compiled by the deterministic compiler  -  no rules, no AI, no hidden codegen.

### Databases

Portable databases (SQLite native or WebAssembly):

```plainscript
database "app.db"                  // probes better-sqlite3, falls back to sql.js
```

`plainscript install` verifies that `better-sqlite3` actually loads. The native engine ships as an **optional dependency**: installing `plainscript-lang` can never fail because a native binary is missing for the platform (e.g. Android/Termux), and programs that never open a database start without it. If the native module cannot be used, PlainScript warns and continues on the pure-JavaScript WebAssembly engine (`sql.js`)  -  the same program runs unchanged. An engine can be forced explicitly:

```plainscript
database "app.db" using "native"   // hard requirement: better-sqlite3
database "app.db" using "wasm"     // hard requirement: sql.js
```

The WebAssembly engine persists the whole database to disk after every write, so data survives restarts either way.

SQL blocks use bound PlainScript value placeholders. `{name}` or
`{imageHash(image)}` becomes a prepared statement parameter; the resulting value
is never concatenated into SQL text:

```plainscript
remember email as request.body.email
remember rows as query
    SELECT receipt_id FROM receipts WHERE email = {email}
done
```

Placeholders are parsed as PlainScript expressions, while raw statement text or
malformed expressions are rejected at compile time. For complex expressions,
bind the expression first:

```plainscript
remember receiptHash as imageHash(image)
remember rows as query
    SELECT receipt_id FROM receipts WHERE hash = {receiptHash}
done
```

### HTTP Client

```plainscript
let r be get "https://api.example.com/users"
when ok of r
    show status of r
    show data of r
done

let created be post url with body
    headers record with accept "application/json" done
    timeout 5000
```

Methods: `get`, `post … with <body>`, `put`, `patch`, `delete "<url>"`. Responses are records: `ok`, `status`, `headers`, `data` (JSON is parsed automatically). The default timeout is 30 seconds; `wait for fetch(...)` awaits raw promises when needed.

### Authentication

```plainscript
let hash be hashPassword("correct horse")
when checkPassword(password of body of request, hash)
    let token be createToken(user, env("TOKEN_SECRET"), 3600)
done

let payload be readToken(token, env("TOKEN_SECRET"))
```

`hashPassword` / `checkPassword` use scrypt; tokens are HMAC-signed with an expiry and fail closed on tampering or timeout.

### Sessions &amp; Cookies

```plainscript
web app
enable sessions "a-long-random-secret"

route post "/login"
    user of session of request becomes username of body of request
    show "welcome"
done

route get "/me"
    show user of session of request
done

route post "/logout"
    destroy session
    show "bye"
done
```

Sessions ride an HMAC-signed `HttpOnly` cookie (`plainscript.sid`). The store is in-memory: restarting the server signs everyone out.

```plainscript
web app
route get "/theme"
    set cookie "theme" to "dark" expires in 7 days
    show cookie("theme")
    clear cookie "theme"
done
```

### File Uploads

```plainscript
accept uploads limit "5 MB" allow list with "image/png", "image/jpeg" folder "uploads"

route post "/scan"
    let file be upload("doc")
    ocr path of file as text
    show "scanned: " + text
done
```

Files arrive as records with `name`, `type`, `size`, `data` (buffer), and `path` (string, when a folder is set). Oversized files return HTTP 413; wrong types return 415. `uploads("docs")` returns every file under a field name.

### Rate Limiting

```plainscript
limit requests to 100 per minute
```

Sliding window per client IP; the quota-exceeded response is HTTP 429.

### Google OAuth

```plainscript
google oauth
    id is env("GOOGLE_ID")
    secret is env("GOOGLE_SECRET")
    callback is "https://myapp.dev/auth/google/callback"
    landing is "/dashboard"
done
```

Registers `/auth/google` (redirect) and `/auth/google/callback` (code-for-token exchange plus profile fetch). After login, the session holds the user and the browser lands on `landing`.

### Error Handling &amp; Retries

```plainscript
try
    let data be jsonDecode(raw)
recover as err
    show "bad json: " + message of err
done

retry 3 times every 5 seconds
    wait for fetch("https://flaky.api")
done
```

Custom 404 handling:

```plainscript
when nothing matches
    status 404
    reply json
        error is "No such road"
    done
done
```

---

## Runtime Standard Library

No imports needed  -  these functions are built into the compiler. They are the
standard vocabulary of everyday work  -  JSON, files, time, strings  -  so the
first version of a program usually needs no dependency at all:

| PlainScript | Description |
|---|---|
| `show(x)` | Print a value (`console.log`) |
| `readFile("path")` | Read a file as UTF-8 text |
| `writeFile("path", data)` | Write text to a file |
| `read("path")` | Read a file as UTF-8 text |
| `fileExists("path")` | Check if a file exists |
| `sleep(ms)` | Pause asynchronously; awaited when used as a bare statement, and composes concurrently inside `all of [...]` / `wait for sleep(...)` |
| `time()` | Current Unix timestamp (`Date.now()`) |
| `date()` | ISO date string |
| `jsonEncode(value)` | `JSON.stringify` |
| `jsonDecode(string)` | `JSON.parse` |
| `env("KEY")` | Read environment variable |
| `exit(code)` | Exit the process |
| `uuid()` | Generate a UUID v4 |
| `length(x)` | Length of array/string |
| `uppercase(x)` | Convert to uppercase |
| `lowercase(x)` | Convert to lowercase |
| `random()` | Random number 0–1 |
| `round(x)` | Round to nearest integer |

---

## Interactive Terminal &amp; CLI Primitives

PlainScript programs are first-class CLI citizens. `ask` reads a line, `confirm`
asks a yes/no question, and `choose` offers an option list  -  each takes an
optional prompt. `confirm` returns a boolean and `choose` returns the selected
option; both are async prompts, so a program that uses them compiles to async
JavaScript and can be driven non-interactively when answers are piped in:

```plainscript
ask "What is your name? " as guest
show "hello, " + guest

remember ok as confirm("Shall we continue")
if ok is true
    show "choice: " + choose("Drink?", list with "tea", "coffee", "juice")
end
```

`clearTerminal()` clears the screen, `terminalWidth()` and `terminalHeight()`
report the terminal size, and `stderr(...)` prints to standard error so a
program's real output on stdout stays clean:

```plainscript
stderr("starting terminal census")
show "width: " + terminalWidth()
show "height: " + terminalHeight()
clearTerminal()
show "screen cleared"
```

---

## Statistics &amp; Vectors

Numeric arrays get the usual statistical summaries, and equal-length numeric
arrays become vectors for the linear-algebra primitives behind the AI-style
helpers (see [AI-Readiness](#ai-readiness-on-device-intelligence)):

```plainscript
remember data as [2, 4, 4, 4, 5, 5, 7, 9]
show "mean:      " + mean(data)
show "median:    " + median(data)
show "variance:  " + round(variance(data) * 100) / 100
show "deviation: " + round(deviation(data) * 100) / 100
```

`mean`, `median`, `variance`, and `deviation` each take one list. The vector
helpers are `dotProduct(a, b)` (how aligned two lists are), `magnitude(v)` (the
Euclidean length), and `normalize(v)` (scales a list to unit length):

```plainscript
remember a as [1, 2, 3]
remember b as [4, 5, 6]
show dotProduct(a, b)           // 32
show magnitude(a)               // 3.7416573867739413
show join(normalize(a), ", ")
```

---

## Randomness

Deterministic programs are the default, but games, simulations, and sampling
reach for the random family when they need variety:

```plainscript
show randomInteger(1, 6)                        // a die roll
let suits be list with "hearts", "spades", "clubs", "diamonds"
show randomChoice(suits)                        // one random suit
show weightedChoice(["common", "rare", "legendary"], [0.7, 0.25, 0.05])
show join(shuffle(suits), " ")                  // shuffled copy
show join(sample(suits, 2), " ")                // two random suits, no repeats
```

`randomInteger(min, max)` is inclusive on both ends; `randomChoice(list)` picks
one element; `weightedChoice(items, weights)` picks according to a parallel
list of weights; `shuffle(list)` returns a shuffled copy; and `sample(list, n)`
returns `n` distinct elements.

---

## Memoization &amp; Parsing Helpers

`memoize` wraps a function so repeated calls with the same arguments hit a
cache  -  handy for expensive pure functions and for memoized inference in the
AI-style patterns below:

```plainscript
make slowSquare(n)
    give n * n
end

remember fastSquare as memoize(slowSquare)
show fastSquare(9)
show fastSquare(9)     // served from the cache
```

`parseBoolean` normalizes `"true"`, `"yes"`, `"1"`, and `"on"` (case- and
whitespace-insensitive) to `true` and everything else to `false`, and
`characters` splits a string into its individual characters:

```plainscript
show parseBoolean("yes")          // true
show parseBoolean("off")          // false
show join(characters("abc"), "-") // a-b-c
```

---

## Web Applications

`web app` starts the HTTP stack available to every program. `route <method>
"<path>" ... done` registers an endpoint; `reply` (or `show`) sends a response,
`reply json ... done` sends JSON with `is`-style fields, and `start <port>`
serves it. `status <n>` sets the response code and `when nothing matches`
handles otherwise-unmatched requests.

```
web app

route "/"
    show "Hello from PlainScript!"
done

route "/api/status"
    reply json
        status is "ok"
        version is "2.0"
    done
done

start 3000
```

---

## Browser games and interactive apps

The same `.pln` you run on Node compiles to a browser script. Drive a canvas,
handle keyboard, pointer, touch, and gamepad input, run `requestAnimationFrame`
loops with delta time, load images and audio, and call any JavaScript library
(Three.js, WebGL, WebGPU, Matter.js) through plain interop  -  no bundler needed:

```plainscript
web app
serve folder "public"
route get "/"
    reply file "public/index.html"
done
start 8000
```

```plainscript
remember canvas as document.getElementById("game")
remember ctx as canvas.getContext("2d")
remember keys as {}

when document "keydown" happens as ke
    keys[ke.key] becomes true
done

if keys["ArrowLeft"] is true
    ctx.fillStyle becomes "#40c463"
    ctx.fillRect(20, 20, 40, 40)
done
```

`when <target> "<event>" happens` maps to `addEventListener`. Browser builtins
(`select`, `selectAll`, `parseHTML`, `loadImage`, `loadAudio`, `fetchJson`,
`fetchBytes`, `readDataUrl`, `audioContext`/`playTone`, `localPoint`,
`gamepads`, `droppedFiles`, `webSocketSend`, and the WebGL helpers
`webglContext`/`glShader`/`glProgram`/`glBuffer`) make canvas apps, games, and
DOM UI direct. The full browser
and game development guide  -  input, loops, assets, audio, state, collision,
networking, persistence, and interop  -  is [docs/GAME-PROMPT.md](docs/GAME-PROMPT.md).

## Additional Backend Capabilities

### HTTP Routing

```
web app
allow cors

group "/api"

    route get "/users"
        let users be query
            SELECT * FROM users
        done
        show users
    done

    route post "/users"
        let missing be validate(body of request, list with "name", "email")
        when length of missing is greater than 0
            status 400
            show missing
        otherwise
            show "created"
        done
    done

done

start env("PORT")
```

`param("id")`, `query("page")`, and `header("x-token")` read request data; `body()` / `body("field")` read the JSON request body; `group` composes path prefixes; `status <n>` sets the response code and `redirect to "<url>"` issues a redirect.

### Transactions

```
database "app.db"                    // or: postgres env("DATABASE_URL")

transaction
    insert
        INSERT INTO users (name) VALUES ({who})
    done
done
```

Placeholders `{likeThis}` bind to PlainScript variables. `postgres "..."` switches every SQL statement to node-postgres pool queries (`$n`, awaited).

### Email

```
mail transport
    host is "smtp.gmail.com"
    port is 587
    user is env("EMAIL_USER")
    pass is env("EMAIL_PASS")
done

send mail
    from is "hello@plainscript.dev"
    to is "you@example.com"
    subject is "Hello from PlainScript"
    text is "Sent from a PlainScript program."
done
```

### Cron &amp; Background Jobs

```
every 5 minutes
    show "heartbeat"
done

schedule "0 2 * * *"
    show "nightly cleanup"
done

to resize name
    show `resizing ${name}`
done

run background resize("photo.png")
```

### WebSockets

```
websocket server on 8080
    when socket connects
        send socket "Welcome!"
    done
    when socket sends message
        broadcast message
    done
done
```

### Cache

Redis-backed, with an in-memory fallback:

```
cache env("REDIS_URL")          // omit for an in-memory Map store with TTL
let token be cacheGet("token")
cacheSet("greeting", "hi", 60)
cacheDelete("greeting")
```

Without a configured Redis instance, `cacheGet` / `cacheSet` / `cacheDelete` transparently fall back to an in-memory store, so naive caching works out of the box.

### AI / ML

```
let reply be chat("gpt-4o-mini", list with
    record with role "user" and content "Say hello in two words"
done)

let vec be embedText("text-embedding-3-small", "PlainScript rocks")
let score be similarity(vec, embedText("text-embedding-3-small", "I love PlainScript"))

let tags be ai_tags("PlainScript is an intent-oriented language")
let article be ai_post("Welcome to PlainScript", list with "why IOPL", "quick start")
```

`chat` and `embedText` are async, OpenAI-compatible calls (from `OPENAI_API_KEY`, overridable with `options.apiKey` / `options.baseURL`); `similarity` returns a value in the range -1 to 1.

### Pagination

```
let page be paginate(allUsers, 2, 10)
show page.items          # second page of 10
show page.hasNext        # true if another page exists
```

`paginate(list, page, perPage)` returns `record with items, count, page, pages, perPage, hasNext, hasPrev done`.

---

## AI-Readiness: On-Device Intelligence

The statistics, vector, randomness, memoization, and persistent-JSON primitives
in this release compose into AI-style systems  -  retrieval scoring, ranking,
weighted sampling, memoized inference, and durable memory  -  built entirely
with the deterministic compiler and **no external AI provider, no API key, and
no network call**. `examples/ai-memory-cli.pln` is a walking example: it stores
"facts" as a JSON file, vectorizes a query with `dotProduct` / `magnitude` /
`normalize`, and retrieves the best-matching fact by cosine similarity.
`examples/stats-cli.pln` exercises the statistical side over an arbitrary
sample from the command line:

```plainscript
let a be [1, 0, 1]                 // bag-of-words vector for a stored fact
let b be [1, 1, 0]                 // bag-of-words vector for the query
show "raw overlap: " + dotProduct(a, b)
let unit be normalize(a)           // unit vector: magnitude becomes 1
show "unit norm:   " + round(magnitude(unit) * 100) / 100
```

The CLI helpers keep these tools scriptable  -  for example, storing and
querying the memory file:

```bash
plainscript run examples/ai-memory-cli.pln remember "Ada loves math and jazz"
plainscript run examples/ai-memory-cli.pln query "who likes math"
plainscript run examples/ai-memory-cli.pln list
```

---

## Multi-File Projects

Programs grow into files. `import "./math.pln"` pulls a whole file into the
current one, `import { circleArea } from "./math.pln"` and `bring circleArea
from "./math.pln"` import specific names, and `export <name>` (or
`export <name> and <name>`) makes names available to other files:

```
import "./math.pln"
import "./utils.pln"
import { circleArea } from "./math.pln"
bring circleArea from "./math.pln"

show PI

show double(5)
```

```
remember PI as 3.14159
make circleArea(r)
    give PI * r * r
done
export circleArea
```

Imports are bundled per entry: `plainscript build` gives every source file its own standalone output under `dist/`, with imported code inlined. Functions, lambdas, records, and modules together are how you build your own vocabulary on top of the core verbs  -  a new reader puzzle (`validate(body, fields)`) is a one-line call, not a loop.

### npm and JavaScript imports

Named package exports may be given an explicit PlainScript local name:

```plainscript
import { createHash as hash, randomUUID } from "crypto"
show hash
```

The compiler emits a CommonJS `require` followed by destructuring, so
`createHash as hash` becomes the JavaScript binding `{ createHash: hash }`.
Unaliased named imports retain their exported name. The same brace syntax is
accepted for local PlainScript modules; aliased names become local bindings in
the bundled output.

---

## Express Integration

```
use express

let app be express()

serve folder "public"

when someone visits "/"
    show "Hello from PlainScript!"
done

when someone visits "/api/status"
    reply json
        status is "ok"
        version is "0.3"
    done
done

listen on 3000
    show "Server running at http://localhost:3000"
done
```

---

## WhatsApp Bots

Full WhatsApp connectivity through Baileys  -  the implementation package is installed automatically and never appears in source:

```
whatsapp bot
    auth "session"                          // credential folder, persists
                                            // across restarts
    login qr                                // or: login pairing "2348012345678"

    on message
        log message                         // print the normalized record

        when message.text is "/start"
            show "Welcome!"
        done

        when message.text is "/help"
            show `Available commands:
/start /help`
        done
    done
done
```

- `login qr` prints a scannable QR code; `login pairing "<number>"` prints an enter-on-phone code instead. Pairing numbers are validated at compile time (digits only after normalization, 8–15 characters).
- `login pairing` also accepts a variable  -  prompt for the number at runtime instead of hard-coding it:

```
ask "WhatsApp number: " as phone

whatsapp bot
    auth "session"
    login pairing phone
done
```

- Inside `on message`, `message` holds `record with text, chat, sender, name, id, time, isGroup done`; `print` answers the current chat.
- The bot ignores its own messages and status broadcasts and keeps working in groups; transient disconnects reconnect after 3 seconds.

See [`examples/whatsapp-bot/`](./examples/whatsapp-bot/) for ready-to-link programs.

---

## Supported Packages

| PlainScript | Compiles to |
|---|---|
| `use express` | `const express = require('express');` |
| `use sqlite` | `let Database; … require('better-sqlite3')` (lazily loaded - the native engine is an optional backend) |
| `use fs` | `const fs = require('fs');` |
| `use path` | `const path = require('path');` |

Any npm package can be used, including hyphenated names like `node-fetch` and scoped packages like `@scope/package-name`.

---

## Project Structure

```
plainscript/
├── compiler/
│   ├── lexer.js               tokenises PlainScript source into tokens
│   ├── parser.js               builds an AST from tokens
│   ├── generator.js            generates JavaScript from the AST
│   ├── bundler.js               resolves imports and bundles files
│   ├── formatter.js            normalises PlainScript source style
│   ├── dependency-detector.js  detects npm packages from source
│   ├── version.js              single compiler version constant
│   └── cli.js                  command-line entry point
│
├── examples/
│   ├── hello.pln
│   ├── day2.pln
│   ├── day3.pln
│   ├── arrays.pln
│   ├── objects.pln
│   ├── loops.pln
│   ├── expressions.pln
│   ├── stdlib.pln
│   ├── server.pln
│   ├── web-app.pln
│   ├── start.pln
│   ├── database.pln
│   ├── deployment.pln
│   ├── football-backend/      acceptance example (SQLite + auth + sessions)
│   │   └── app.pln
│   ├── id-verification/       acceptance example (uploads + OCR matching)
│   │   ├── app.pln
│   │   └── make-sample-id.js
│   └── whatsapp-bot/          WhatsApp bots (QR and pairing linking)
│       ├── qr.pln
│       └── pairing.pln
│
├── tests/
│   ├── compiler.test.js        language, CLI, and formatter coverage
│   ├── build.test.js           build model, config, and packaging coverage
│   ├── backend.test.js         web/database/email/cache runtime tests
│   ├── telegram.test.js        Telegram bot runtime tests
│   ├── ocr.test.js             OCR statement tests
│   ├── runtime.test.js         uploads, database, and bot feature suite
│   ├── whatsapp.test.js        WhatsApp bot runtime tests
│   └── acceptance.test.js      boots the example projects over live HTTP
│
├── docs/
│   ├── PLAINSCRIPT-SPEC.md
│   └── index.html
│
├── editors/
│   └── mt-manager/
│       └── plainscript.mtsx    MT Manager syntax highlighting
│
├── package.json
└── README.md
```

---

## Running the Tests

```bash
npm test
```

---

## Contributing

Contributions are welcome. Please read [`CONTRIBUTION.md`](./CONTRIBUTION.md) before opening a pull request, and check [`CHANGELOG.md`](./CHANGELOG.md) / [`RELEASE_NOTES.md`](./RELEASE_NOTES.md) for context on recent changes.

1. Fork the repository and create a branch from `main`.
2. Make your changes, with tests where applicable (`npm test`).
3. Open a pull request describing the change and its motivation.

---

## License

Released under the [MIT License](./LICENSE).

<div align="center">

<sub>"When even a simple sentence can be code."</sub>

</div>
