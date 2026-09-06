<div align="center">

<img src="https://github.com/ayoistooslick/plainscript/raw/main/docs/logo.jpg" alt="PlainScript logo" width="220" />

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
  - [Variables](#variables)
  - [String Templates](#string-templates)
  - [Conditions](#conditions)
  - [Functions](#functions)
  - [Arrays &amp; Objects](#arrays--objects)
  - [Loops](#loops)
  - [Natural-Language Expressions](#natural-language-expressions)
  - [Logical Assignment](#logical-assignment)
  - [Record Kinds, Concurrency &amp; More](#record-kinds-concurrency--more)
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
- [Web Applications](#web-applications)
- [Additional Backend Capabilities](#additional-backend-capabilities)
  - [HTTP Routing](#http-routing)
  - [Transactions](#transactions)
  - [Email](#email)
  - [Cron &amp; Background Jobs](#cron--background-jobs)
  - [WebSockets](#websockets)
  - [Cache](#cache)
  - [AI / ML](#ai--ml)
  - [Pagination](#pagination)
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

Most languages ask you to describe *how* a computation happens: loop constructs, control flow, boilerplate. PlainScript inverts that. You write source that reads like an instruction to a competent engineer, and a deterministic compiler — no rules engine, no AI, no hidden codegen — turns it into JavaScript.

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

**Current version:** `v1.0.2` — the `plainscript` npm package, with a TypeScript-style production build (`plainscript build` → `dist/`, source names and structure preserved).

---

## Quick Start

```bash
npx plainscript new myapp     # scaffolds src/app.pln and package.json
cd myapp
npm install                   # installs plainscript as a devDependency, plus runtime packages
npm run build                 # compiles src/ -> dist/ (plainscript build)
node dist/app.js              # or: npm start
```

Adding PlainScript to an existing project:

```bash
npm install --save-dev plainscript-lang
# start writing src/*.pln files — plainscript build auto-discovers them
```

No global install is required. Everything runs through `npm` scripts and `npx`.

---

## CLI Reference

| Command | Description |
|---|---|
| `plainscript run <file.pln>` | Installs missing dependencies, compiles, and executes. Runs from a scratch directory — nothing is written into your project. |
| `plainscript build [file.pln]` | Compiles to `dist/`. With no argument, builds every `.pln` file under the source root, preserving names and folder structure. |
| `plainscript check <file.pln>` | Checks syntax only. No output, no execution. |
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

---

## Building &amp; Configuration

`plainscript build` is a deterministic production build — TypeScript-style, but for `.pln` sources — with zero configuration required.

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
  "devDependencies": { "plainscript-lang": "^1.0.2" }
}
```

`src/index.pln` builds to `dist/index.js`; consumers install and `require()` it like any Node package. There is no PlainScript-specific registry or format — standard `package.json` semantics apply.

---

## Language Tour

### Variables

```
let name be "Ayokunle"
let age be 16
set age to 17
```

### String Templates

Backtick-delimited strings preserve whitespace and support `${expression}` interpolation:

```
let name be "World"
let greeting be `Hello ${name}!`
show greeting

let email be `Dear ${customer},

Thank you for your order #${orderId}.

Best regards,
The Team`
```

Interpolation compiles directly to JavaScript template literals — it is not evaluated at compile time. Literal dollar signs without `{` are preserved as-is.

### Conditions

```
when age is at least 18
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
| `more than` | `>` |
| `is less than` / `is below` | `<` |
| `fewer than` | `<` |
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

### Functions

```
to add a and b together
    give back a + b
done
show add(5, 7)

to multiply x and y together
    give back x * y
done
```

### Arrays &amp; Objects

```
let players be list with "Haaland", "Foden", "Rodri"
show players[0]
set players[1] to "Palmer"

let user be record with
    name "Ayokunle"
    age 17
done
show user.name
```

### Loops

```
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

```
let players be list with "Haaland", "Foden", "Rodri"

show first player from players   // players[0]
show last player from players    // players[players.length - 1]
show player two from players     // players[1]
first player from players is now "Haaland"  // players[0] = "Haaland"
```

Number words from `one` to `twenty` map to one-based positions — `player one` is the first item.

**Collections**

```
show players length              // players.length
add("Palmer" to players)         // players.push("Palmer")
remove("Rodri" from players)     // players.splice(players.indexOf("Rodri"), 1)

when players contains "Foden"      // players.includes("Foden")
    show "Found"
done
```

**Properties**

```
show name of user                // user.name
show city of address of customer // customer.address.city
name of user is now "Ayo"        // user.name = "Ayo"
```

`of` chains right-to-left: `city of address of customer` reads as the city of the address of the customer.

**Files**

```
let data be read("users.txt")   // fs.readFileSync("users.txt", 'utf8')
write(data to "users.txt")      // fs.writeFileSync(data, "users.txt", 'utf8')
```

The older `readFile()` / `writeFile()` forms still work and are unchanged.

### Logical Assignment

```
let flag be false
flag or is now true
show flag

let val be null
val nullish is now "default"
show val
```

### Record Kinds, Concurrency &amp; More

PlainScript 1.0.2 closes most of the gap with TypeScript-class languages using its own grammar. The full audit lives in [`docs/CAPABILITY_GAP_AUDIT.md`](./docs/CAPABILITY_GAP_AUDIT.md).

<details>
<summary>Expand full feature list</summary>

| Category | Features |
|---|---|
| Record kinds (classes) | `to define a kind called "Person" with name "" end`, then `create a Person with name "Ada" and age 17`. Plain-object instances; unknown fields throw. |
| Concurrency | `all of [...]`, `any of [...]`, `settled of [...]`, `withTimeout(promise, ms)` |
| Generators | `yield` inside `define ... end`; consumed with `for each` or `spread of` |
| Reflection | `typeOf`, `fieldsOf`, `valueOf`, `hasField`, `sizeOf` |
| Binary | `base64Encode/Decode`, `textToBytes/bytesToText`, `sha256/sha1/md5` |
| Config | `yamlDecode/yamlEncode`, `load env file ".env"` |
| CLI &amp; processes | `args()`, `runCommand(cmd, [args])` |
| Filesystem &amp; paths | `fileSize`, `fileType`, `lastModified`, `walkFolder`, `joinPath`, `baseName`, `folderOf`, `extensionOf` |
| Streams | `writeLine`, `appendLine` |
| Collections | `keyMap/mapSet/mapGet/mapHas/mapDelete`, `newSet/addToSet` |
| Dynamic modules | `loadModule("./m")` |
| Native tests | `test "name" ... end` with `check a equals b`, `check a contains b`, `check a is b`, `check <expr> raises "msg"` |
| Exports | `export <name>` |

</details>

---

## Backend Services

Everything in this section is compiled by the deterministic compiler — no rules, no AI, no hidden codegen.

### Databases

Portable databases (SQLite native or WebAssembly):

```
database "app.db"                  // probes better-sqlite3, falls back to sql.js
```

`plainscript install` verifies that `better-sqlite3` actually loads. If the native module cannot be used, PlainScript warns and continues on the pure-JavaScript WebAssembly engine (`sql.js`) — the same program runs unchanged. An engine can be forced explicitly:

```
database "app.db" using "native"   // hard requirement: better-sqlite3
database "app.db" using "wasm"     // hard requirement: sql.js
```

The WebAssembly engine persists the whole database to disk after every write, so data survives restarts either way.

### HTTP Client

```
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

```
let hash be hashPassword("correct horse")
when checkPassword(password of body of request, hash)
    let token be createToken(user, env("TOKEN_SECRET"), 3600)
done

let payload be readToken(token, env("TOKEN_SECRET"))
```

`hashPassword` / `checkPassword` use scrypt; tokens are HMAC-signed with an expiry and fail closed on tampering or timeout.

### Sessions &amp; Cookies

```
web app
enable sessions "a-long-random-secret"

route post "/login"
    user of session of request is username of body of request
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

```
set cookie "theme" to "dark" expires in 7 days
show cookie("theme")
clear cookie "theme"
```

### File Uploads

```
accept uploads limit "5 MB" allow list with "image/png", "image/jpeg" folder "uploads"

route post "/scan"
    let file be upload("doc")
    ocr path of file as text
    show "scanned: " + text
done
```

Files arrive as records with `name`, `type`, `size`, `data` (buffer), and `path` (string, when a folder is set). Oversized files return HTTP 413; wrong types return 415. `uploads("docs")` returns every file under a field name.

### Rate Limiting

```
rate limit 100 requests per minute
```

Sliding window per client IP; the quota-exceeded response is HTTP 429.

### Google OAuth

```
google oauth
    id is env("GOOGLE_ID")
    secret is env("GOOGLE_SECRET")
    callback is "https://myapp.dev/auth/google/callback"
    landing is "/dashboard"
done
```

Registers `/auth/google` (redirect) and `/auth/google/callback` (code-for-token exchange plus profile fetch). After login, the session holds the user and the browser lands on `landing`.

### Error Handling &amp; Retries

```
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

```
when nothing matches
    status 404
    show json
        error is "No such road"
    done
done
```

---

## Runtime Standard Library

No imports needed — these functions are built into the compiler:

| PlainScript | Description |
|---|---|
| `show(x)` | Print a value (`console.log`) |
| `readFile("path")` | Read a file as UTF-8 text |
| `writeFile("path", data)` | Write text to a file |
| `read("path")` | Read a file as UTF-8 text |
| `fileExists("path")` | Check if a file exists |
| `sleep(ms)` | Sleep synchronously |
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

## Web Applications

```
web app

route "/"
    show "Hello from PlainScript!"
done

route "/api/status"
    show json
        status is "ok"
        version is "2.0"
    done
done

start 3000
```

---

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

## Multi-File Projects

```
import "./math.pln"
import "./utils.pln"

show PI

show double(5)
```

Imports are bundled per entry: `plainscript build` gives every source file its own standalone output under `dist/`, with imported code inlined.

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
    show json
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

Full WhatsApp connectivity through Baileys — the implementation package is installed automatically and never appears in source:

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
- `login pairing` also accepts a variable — prompt for the number at runtime instead of hard-coding it:

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
| `use sqlite` | `const Database = require('better-sqlite3');` |
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