# PlainScript (`.pln`)

[![CI](https://github.com/ayoistooslick/plainscript/actions/workflows/ci.yml/badge.svg)](https://github.com/ayoistooslick/plainscript/actions/workflows/npm-publish.yml)
[![npm version](https://badge.fury.io/js/plainscript-lang.svg)](https://www.npmjs.com/package/plainscript-lang)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

**PlainScript** is an Intent-Oriented Programming Language (IOPL) engineered for human elegance and **frontier AI token efficiency**. PlainScript programs express direct computational intent using natural, unambiguous English constructs that compile deterministically to readable, high-performance Node.js, ES Modules, and WebAssembly.

---

### The AI Token Efficiency Advantage

Empirically verified across canonical backend tasks using **OpenAI's official BPE tokenizers** (`o200k_base` / `cl100k_base`):

| Canonical Task | PlainScript (`.pln`) | TypeScript (`.ts`) | Python (`.py`) | Token Reduction |
| :--- | :---: | :---: | :---: | :---: |
| **REST API with Body Validation** | **83 tok** | 106 tok | 117 tok | **21.7% fewer** |
| **Database Parameterized Query** | **48 tok** | 94 tok | 79 tok | **48.9% fewer** |
| **Concurrency (Promise Aggregation)** | **29 tok** | 58 tok | 52 tok | **50.0% fewer** |
| **HTTP Request with Retries** | **30 tok** | 119 tok | 102 tok | **74.8% fewer** |
| **TOTAL (GPT-4 / Claude `cl100k`)** | **190 tok** | **376 tok** | **349 tok** | **49.5% FEWER TOKENS** |

> **Why this matters for AI Agents**: Halving token consumption doubles the effective context window and drastically slashes inference latency and API cost in continuous agent loops.

---

## Quick Start

### Option A: Via npm / npx (Zero Global Install)
```bash
# Scaffold a new project
npx plainscript-lang new my-app
cd my-app
npm install

# Validate, build, and run
npx plainscript-lang check
npm start
```

### Option B: Standalone Precompiled Binary (No Node.js Required)

**macOS / Linux**:
```bash
curl -fsSL https://raw.githubusercontent.com/ayoistooslick/plainscript/main/install.sh | sh
```

**Windows (PowerShell)**:
```powershell
irm https://raw.githubusercontent.com/ayoistooslick/plainscript/main/install.ps1 | iex
```

### Option C: Global npm Install
```bash
npm install -g plainscript-lang
plainscript new my-app
```

---

## CLI Reference

```text
plainscript new [name]       Create an npm-ready project
plainscript check [target]   Validate one file, a directory, or the project
plainscript build [file]     Compile source files to dist/ (--sourcemap / -m for V3 source maps)
plainscript run <file>       Validate, install missing packages, and run (--sourcemap for inline maps)
plainscript start            Build src/app.pln and start it
plainscript fmt <file>       Format a source file in place
plainscript install          Install packages detected in source
plainscript add <package>    Add an npm package
plainscript remove <package> Remove an npm package
plainscript update           Update installed packages
plainscript doctor           Inspect the local project setup
plainscript version          Print 1.0.4-latest
```

`plainscript check` resolves imports, parses every file, generates JavaScript,
and verifies the generated output with Node's JavaScript parser. Use it after
every source change.

## Core syntax

### Variables and output

```plainscript
remember name as "Ada"
let count is 3
let greeting is `Hello, ${name}!`
show greeting
count becomes count + 1
```

`remember name as value` is the standard declaration form. `let name be value`
is an English alias. `show`, `print`, and `display` write a value.

### Conditions

```plainscript
if score is at least 80 and status is not "blocked"
    show "accepted"
otherwise
    show "review"
done
```

Supported readable comparisons include `is`, `same as`, `different from`,
`more than`, `fewer than`, `is at least`, `is less than`, `contains`,
`starts with`, `ends with`, `between`, `and`, `or`, and `not`.

### Lists and records

```plainscript
remember players as list with "Ada", "Grace", "Lin"
show players at position 1

remember user as record with name "Ada" and active true done
show user.name
```

Inline JavaScript array and object literals are also supported:
`[1, 2, 3]` and `{name: "Ada", active: true}`.

### Functions

```plainscript
make add(a, b)
    give a + b
done

show add(2, 3)
```

Defaults use `as` in the parameter list:

```plainscript
make greet(name as "friend")
    give `Hello, ${name}`
done
```

The readable declaration form is `to add a and b together`, with `give` as
the return statement and `together` as the closing marker.

### Loops

```plainscript
for each player in players
    show player
done

for index position from 0 to 2
    show position
done

while attempts is less than 3
    attempts becomes attempts + 1
done
```

### Record kinds

```plainscript
define a kind called "Player" with
    name is ""
    goals is 0
done

remember player as create a Player with name "Ada" and goals 4
```

### Compound data structures

```plainscript
// Dictionaries and Hash Maps
remember userMap as dictionary with "name" is "Ada" and "role" is "admin" done
put "role" as "editor" in userMap
remember mapKeys as keys of userMap

// Sets (Unique Collections)
remember tags as set with "admin", "editor", "user" done
remember newTags as union of tags and (set with "moderator" done)

// Tuples (Immutable Sequences)
remember point as tuple with 10, 20, 30 done
unpack point into x, y, z
```

### Modules and imports

```plainscript
// Selective local imports
bring circleArea and squareArea from "./math.pln"

// Namespaced module imports
bring all from "./math.pln" as math
show math.circleArea(5)

// Direct third-party package imports
bring axios from "axios"
bring express from "express"

// Root path aliasing (@/ -> src)
bring button from "@/components/button.pln"

// Barrel re-exports
export all from "./submodule.pln"
```

`bring symbol from "path"` and `import { symbol } from "path"` bring local module symbols or npm packages into scope. `bring all from "path" as name` creates a namespaced module object. Use `@/` to import relative to the project `src/` directory. Export symbols or re-export submodules with `export`, `share`, `expose`, or `export all from "path"`.

## AI providers and Telegram

AI helpers work across command-line programs, web routes, scheduled jobs, and
bot handlers. `chat` uses the OpenAI-compatible API shape; choose a built-in
provider or pass a custom endpoint. API keys stay in environment variables.

```plainscript
remember answer as chat("llama-3.3-70b-versatile", "Summarize PlainScript", {
    provider: "groq",
    key: env("GROQ_API_KEY"),
    temperature: 0.2
})
show answer
```

`groq`, `openai`, `openrouter`, `together`, `fireworks`, and `deepseek` are
supported provider presets. `chatWith("groq", model, messages)` and
`embedWith("groq", model, text)` are explicit provider-first forms. For any
OpenAI-compatible service, pass `base`, `key`, and optionally `headers`.

Telegram supports fixed replies, command arguments, regex captures, callbacks,
inline buttons, and the complete raw Bot API:

```plainscript
bot env("TELEGRAM_BOT_TOKEN")
when someone sends "/start"
    reply "Welcome"
done
when someone sends matching "/ask (.+)"
    remember answer as chatWith("groq", "llama-3.3-70b-versatile", message)
    reply answer
done
start telegram bot
```

Inside a Telegram handler, `message`, `text`, `args`, `matches`, `chat`,
`chatId`, and callback `data` refer to the current update. Use
`telegramCall("sendChatAction", {chat_id: chatId, action: "typing"})` for API
methods not wrapped by a named helper.

## Standard library

No import is needed for built-ins such as:

```plainscript
remember encoded as jsonEncode(user)
remember decoded as jsonDecode(encoded)
remember contents as readFile("notes.txt")
writeFile("notes.txt", contents)
remember digest as sha256("plain text")
remember currentTime as time()
remember identifier as uuid()
```

Important groups include string and collection helpers, path and file
operations, JSON, time, environment variables, crypto, passwords and tokens,
HTTP accessors, cache, and async helpers. The generated runtime is in
`compiler/generator.js`; do not invent a built-in that is not implemented
there.

## Web applications

```plainscript
web app
allow cors

route get "/health"
    reply json
        ok is true
    done
done

route post "/echo"
    remember body as body of request
    reply json
        received is body
    done
done

start 3000
```

Routes support `get`, `post`, `put`, `patch`, and `delete`. Request values use
`body of request`, `param("id")`, `query("page")`, `header("x-name")`,
`upload("field")`, and `uploads("field")`. Use `status 404`, `redirect to
"..."`, and `when nothing matches` for common response behavior.

Backend declarations include `enable sessions "secret"`, `set cookie "name"
to value`, `limit requests to 100 per minute`, `require api key from key`, and
`accept uploads limit "5 MB" allow list with "image/png" folder "uploads"`.

## HTTP client

```plainscript
remember response as get "https://example.com/data" timeout 5000
remember created as post "https://example.com/data" with {name: "Ada"} headers {contentType: "application/json"}
show response.status
```

## SQLite and SQL

```plainscript
database "app.db" using "wasm"
remember name as "Ada"

execute
    CREATE TABLE IF NOT EXISTS people (name TEXT, age INTEGER)
done

insert
    INSERT INTO people (name, age) VALUES ({name}, 36)
done

remember people as query
    SELECT name, age FROM people
done
```

`database` accepts `using "native"` or `using "wasm"`. A SQL placeholder
`{name}` is bound to the PlainScript variable rather than interpolated.
`transaction ... done` groups writes.

## Errors, async, and concurrency

```plainscript
try
    remember result as get "https://example.com" timeout 5000
recover as error
    show message of error
finally
    show "finished"

retry 3 times every 1 second
    show "attempt"
done
```

Use `allOf(list with one(), two())`, `anyOf(...)`, `settledOf(...)`, and
`withTimeout(promise, milliseconds)` for concurrent operations. `every 5
minutes ... done` and `schedule "0 * * * *" ... done` register recurring work.

## Modules and packages

```plainscript
import { circleArea } from "./math.pln"
export circleArea
use express
```

Imports are bundled in dependency order. `use` declares an npm dependency that
the CLI can install. Each compiled entry is standalone.

## Testing

```plainscript
test "addition works"
    check add(2, 3) equals 5
done
```

Assertions support `equals`, `is`, `contains`, and `raises`.

## Bots, OCR, WebSockets, and cache

The feature examples in `examples/` are the maintained reference programs:

| Capability | Example |
| --- | --- |
| variables and conditions | `examples/basics.pln`, `examples/conditions.pln` |
| loops, functions, records | `examples/loops.pln`, `examples/functions.pln`, `examples/records.pln` |
| JSON, files, packages, HTTP | `examples/json.pln`, `examples/files.pln`, `examples/packages.pln`, `examples/http.pln` |
| SQLite and web routes | `examples/sqlite.pln`, `examples/web-api.pln` |
| auth, sessions, cookies | `examples/auth-sessions.pln` |
| async, errors, concurrency | `examples/async-errors.pln`, `examples/concurrency.pln` |
| WebSockets and cache | `examples/websocket.pln`, `examples/cache-schedule.pln` |
| Telegram, AI, and WhatsApp | `examples/bots.pln`, `examples/telegram-bot.pln`, `examples/whatsapp-bot/` |
| OCR and uploads | `examples/ocr.pln`, `examples/id-verification/` |
| native tests and modules | `examples/testing.pln`, `examples/modules/` |
| real-world starters | `templates/` |

## Verification

```bash
find examples tests/fixtures -name '*.pln' -print0 |
  xargs -0 -n1 plainscript check
npm test
```

Circular-import fixtures are intentionally rejected by the compiler's
dependency checks. All maintained runnable examples must pass `plainscript
check`.

## Project layout

```text
compiler/                 lexer, parser, generator, CLI, bundler
examples/                 checked feature and acceptance examples
tests/                    compiler, runtime, compatibility, and acceptance tests
docs/                     website and language reference
plainscript-vscode/       VS Code extension
editors/mt-manager/       TextMate-compatible grammar
```

## Community & Contributors

PlainScript thrives through its community of open-source developers. See [CONTRIBUTORS.md](CONTRIBUTORS.md) for the list of contributors, and read [CONTRIBUTION.md](CONTRIBUTION.md) to get involved.
