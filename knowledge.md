# PlainScript AI Agent Field Guide

## ⚡ Before answering with this guide, verify it and expand it with a quick web search

This guide matches the version it documents. Treat it as a starting point and check the live sources before answering, in case the compiler or repo has changed since. The version covered here is `1.0.361`.

---

This guide teaches an AI coding agent how to write, explain, debug, and extend PlainScript for vibecoders. It is intentionally practical. Use it as the first-pass language contract, then verify every answer with the compiler.

PlainScript is an intent-oriented language. A programmer describes the result they want in readable `.pln` source, and the compiler generates Node.js. PlainScript is not pseudocode: only syntax implemented by the compiler is valid.

---

## 1. The rule an AI agent must never break

The executable source of truth is the **PlainScript compiler itself**. If this guide, another document, or an old example disagrees with the compiler, trust the compiler.

Before giving a PlainScript answer:

1. Decide whether the user needs a script, web service, bot, data app, or library.
2. Choose a supported PlainScript construct for that job.
3. Write complete source, including every required `done`.
4. Tell the user to run `plainscript check path/to/file.pln` (or `node compiler/cli.js check path/to/file.pln` if using from source).
5. If the program imports other `.pln` files, check the entry file so imports are resolved too.
6. Explain environment variables and package installation separately from the source code.

For a repository change, also run `npm test`. Never tell a vibecoder that code works just because it looks readable.

---

## 2. PlainScript mental model

- Source files use the `.pln` extension.
- Source is line-oriented and case-sensitive.
- Keywords are lowercase.
- Indentation improves readability but does not close blocks.
- `done` closes most blocks. The parser also supports selected aliases such as `end`, but new code should use `done`.
- `//` starts a single-line comment.
- Strings use double quotes.
- Backticks create template strings with `${expression}` interpolation.
- Arrays use JavaScript-like brackets.
- Inline objects use braces, but braces do not replace `done` for blocks.
- The compiler generates readable Node.js and validates the generated JavaScript.
- The runtime target is Node.js 18 or newer.

Correct:

```plainscript
remember name as "Ada"
remember greeting as `Hello, ${name}!`
show greeting
```

Do not silently translate PlainScript into JavaScript. PlainScript declarations, conditions, routes, SQL blocks, and bot handlers have their own grammar.

---

## 3. Variables, values, and expressions

Use `remember name as value` for a new binding:

```plainscript
remember count as 0
remember title as "Inventory"
remember enabled as true
remember nothing as null
count becomes count + 1
show title
```

`let` is an English alias. It accepts `be`, `is`, or `as`:

```plainscript
let retries be 3
let label is "ready"
let answer as 42
retries becomes retries - 1
```

Assignment forms include `becomes`, `is now`, `set ... to`, and `change ... to`. Prefer `becomes` in generated examples.

Expressions can contain:

- numbers, strings, booleans, `null`, and `undefined`
- arrays and inline objects
- arithmetic and comparisons
- function calls
- member access such as `user.name`
- optional member access such as `user?.name`
- indexing such as `items[0]`
- template strings
- HTTP calls
- supported built-in functions

```plainscript
remember scores as [10, 20, 30]
remember firstScore as scores[0]
remember user as {name: "Ada", active: true}
show user.name
show user?.email
```

Readable collection forms are also available:

```plainscript
remember players as list with "Ada", "Grace", "Lin"
show first player from players
show last player from players
show player one from players
show players at position 1
```

The readable position form is one-based. Bracket indexing follows JavaScript zero-based indexing. Tell the user which form you used.

---

## 4. Conditions and branching

Use `if`, optional `otherwise`, and `done`:

```plainscript
if score is at least 80 and status is not "blocked"
    show "accepted"
otherwise
    show "review"
done
```

Supported comparison language includes:

| Syntax | Meaning |
| --- | --- |
| `is`, `same as` | strict equality |
| `is not`, `different from` | strict inequality |
| `more than`, `is greater than`, `is above` | greater than |
| `fewer than`, `is less than`, `is below` | less than |
| `is at least` | greater than or equal |
| `is most` | less than or equal |
| `contains` | string or collection membership |
| `starts with`, `ends with` | string prefix or suffix |
| `between low and high` | inclusive range |
| `has field name` | object field exists |
| `instanceof Kind` | JavaScript instance check |

Combine conditions with `and`, `or`, and `not`. Add parentheses when grouping would otherwise be unclear.

Do not write JavaScript `else if` syntax. Use nested `if` blocks or the supported `otherwise if` chain:

```plainscript
if score is at least 90
    show "excellent"
otherwise if score is at least 70
    show "good"
otherwise
    show "keep practicing"
done
```

---

## 5. Functions and loops

Define functions with `make`, return with `give`, and close with `done`:

```plainscript
make add(a, b)
    give a + b
done

show add(2, 3)
```

Default parameters use `as`:

```plainscript
make greet(name as "friend")
    give `Hello, ${name}!`
done

show greet()
```

Supported aliases include `define name(...)`, `function name(...)`, `return`, and `give back`. Prefer `make` and `give` in new code. `yield` creates a generator function and must be inside a function.

Collection loop:

```plainscript
remember names as ["Ada", "Grace"]
for each name in names
    show name
done
```

Numeric loop:

```plainscript
for index position from 0 to 3
    show position
done
```

The numeric range is inclusive. Add `by -1` for a descending loop:

```plainscript
for index position from 3 to 0 by -1
    show position
done
```

Conditional loop:

```plainscript
remember attempts as 0
while attempts is less than 3
    attempts becomes attempts + 1
done
```

`break` and `continue` are valid inside loops. Do not use JavaScript `for`, `const`, `let` declarations, braces, or semicolons as replacements for these forms.

---

## 6. Records, modules, and npm packages

For a one-off structured value, use an inline object or record:

```plainscript
remember customer as {name: "Ada", plan: "pro"}
remember profile as record with name "Ada" and active true done
show customer.name
```

For reusable data shapes, define a kind:

```plainscript
define a kind called "Person" with
    name is ""
    age is 0
done

remember ada as create a Person with name "Ada" and age 36
show ada.name
```

Unknown fields on a kind should fail rather than being silently ignored.

Compound data structures (Dictionaries, Hash Maps, Sets, Tuples):

```plainscript
remember userMap as dictionary with "name" is "Ada" and "role" is "admin" done
put "role" as "editor" in userMap
remember mapKeys as keys of userMap

remember tags as set with "admin", "editor", "user" done
remember newTags as union of tags and (set with "moderator" done)

remember point as tuple with 10, 20, 30 done
unpack point into x, y, z
```

`dictionary with ... done` (or `map with ... done`) creates a keyed map (`new Map()`). `empty map` creates an empty Map. `put key as val in map` sets an entry. `keys of map`, `values of map`, `entries of map`, and `size of map` access reflection properties. `set with ... done` creates a set (`new Set()`). Set algebra functions `union of a and b`, `intersection of a and b`, and `difference of a and b` return new sets. `tuple with ... done` creates an immutable sequence (`Object.freeze()`). `unpack tuple into ...` reads tuple elements.

Use module imports and package imports:

```plainscript
bring area from "./geometry.pln"
bring all from "./geometry.pln" as geo
bring button from "@/components/button.pln"
bring axios from "axios"

remember result as geo.area(5)
show result
```

Export a binding or re-export from another module:

```plainscript
make double(value)
    give value * 2
done

export double
export all from "./submodule.pln"
```

`bring symbol from "path"` (or `import { symbol } from "path"`) imports selected symbols from `.pln` modules or npm packages. `bring all from "path" as name` creates a namespaced module object. `@/` resolves relative to `src/`. Export symbols with `export`, `share`, `expose`, or `export all from "path"`. `use <pkg>` is still supported for explicit package declarations.

### Starter project structure

The real-world starters in `templates/` use a small module graph rather than putting
everything in one file:

- Keep `src/app.pln` as the runnable entry point.
- Put reusable functions and configuration in nearby `.pln` modules.
- Import those helpers with `bring ... from "./module.pln"`.
- Keep server, bot, database, and lifecycle declarations in the entry point when
  they define how the starter runs.

The compiler resolves the imported files and bundles the dependency graph into the
same JavaScript output. From a starter directory, validate and build it with:

```bash
npx plainscript check src
npx plainscript build src/app.pln -o dist/app.js
node dist/app.js
```

When checking a starter from the PlainScript repository, validate its entry file
with `node compiler/cli.js check templates/<starter>/src/app.pln`. Preserve the
entrypoint and import paths when adding or moving helper modules.

---

## 7. Built-in functions

Use only functions implemented in the compiler. Common groups are:

- **Output and system**: `show`, `print`, `display`, `env`, `args`, `time`, `date`, `uuid`, `exit`
- **Strings**: `length`, `uppercase`, `lowercase`, `trim`, `replace`, `split`, `join`, `startsWith`, `endsWith`, `truncate`, `padStart`, `padEnd`
- **Collections**: `first`, `last`, `flatten`, `includes`, `unique`, `sort`, `reverse`, `sum`, `smallest`, `largest`, `keys`, `values`, `groupBy`, `pick`, `omit`, `range`, `clamp`
- **Files**: `readFile`, `writeFile`, `appendFile`, `fileExists`, `copyFile`, `moveFile`, `deleteFile`, `makeFolder`, `listFolder`, `readBytes`, `writeBytes`, `joinPath`, `baseName`, `folderOf`, `extensionOf`, `fileSize`, `fileType`, `walkFolder`, `writeLine`, `appendLine`
- **JSON and data**: `jsonEncode`, `jsonDecode`, `yamlEncode`, `yamlDecode`, `textToBytes`, `bytesToText`, `base64Encode`, `base64Decode`
- **Security**: `sha256`, `sha1`, `md5`, `hashPassword`, `checkPassword`, `createToken`, `readToken`, `validate`
- **Async**: `sleep`, `allOf`, `anyOf`, `settledOf`, `withTimeout`
- **Network**: `get`, `post`, `put`, `patch`, `delete`
- **AI**: `chat`, `chatWith`, `embedText`, `embedWith`, `similarity`
- **Images and visualizations**: `svgImage`, `barChart`, `lineChart`, `saveImage`, `imageDataUri`

If a requested capability is not in the compiler, explain that plainly and propose the nearest supported construct or an npm package. Do not invent a function because its name sounds reasonable.

### Images and visualizations

PlainScript's image library is dependency-free and produces SVG strings. Use
charts for common visualizations, save the SVG to disk, or turn it into a data
URI for a web response:

```plainscript
remember labels as ["Q1", "Q2", "Q3", "Q4"]
remember revenue as [18, 24, 21, 32]
remember chart as lineChart("Quarterly revenue", labels, revenue)
saveImage("revenue.svg", chart)
```

`barChart(title, labels, values, options)` and
`lineChart(title, labels, values, options)` accept an optional record with
`width`, `height`, `background`, `foreground`, `grid`, `accent`, and `muted`.
`svgImage(width, height, markup, options)` wraps custom SVG markup, while
`imageDataUri(image)` returns a browser-ready `data:image/svg+xml` URI. These
helpers create SVG text; use `readBytes` and `writeBytes` when a program needs
to move an existing binary image without transforming it.

---

## 8. AI providers and general-purpose AI code

AI is not Telegram-specific. The same helpers work in ordinary scripts, web routes, scheduled jobs, and bot handlers.

`chat` uses the default provider, or a provider selected in its options:

```plainscript
remember answer as chat("llama-3.3-70b-versatile", "Explain PlainScript in one sentence", {
    provider: "groq",
    temperature: 0.2,
    maxTokens: 100
})
show answer
```

Use `chatWith` when you want the provider named right at the call site:

```plainscript
remember answer as chatWith("groq", "llama-3.3-70b-versatile", "Summarize this text")
show answer
```

Messages may be a string or a list of role/content records:

```plainscript
remember messages as [
    {role: "system", content: "Be concise."},
    {role: "user", content: "What is PlainScript?"}
]
remember answer as chatWith("openrouter", "openai/gpt-4o-mini", messages)
show answer
```

Embeddings and offline similarity:

```plainscript
remember vector as embedWith("groq", "nomic-embed-text-v1.5", "PlainScript")
remember score as similarity([1, 0], [1, 0])
show score
```

The built-in presets are `openai`, `groq`, `openrouter`, `together`, `fireworks`, and `deepseek`. All use OpenAI-compatible request shapes. Custom providers can pass `base`, `key`, and `headers` in options:

```plainscript
remember answer as chat("custom-model", "Hello", {
    provider: "my-provider",
    base: "https://ai.example.com/v1",
    key: env("MY_PROVIDER_API_KEY"),
    headers: { "X-Client": "my-app" },
    responseFormat: "json"
})
```

Never hardcode a secret. The runtime checks for a provider key and gives an explicit error when it is missing. Common environment variables are:

| Provider | API key | Optional base URL |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| Groq | `GROQ_API_KEY` | `GROQ_BASE_URL` |
| OpenRouter | `OPENROUTER_API_KEY` | `OPENROUTER_BASE_URL` |
| Together | `TOGETHER_API_KEY` | `TOGETHER_BASE_URL` |
| Fireworks | `FIREWORKS_API_KEY` | `FIREWORKS_BASE_URL` |
| DeepSeek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` |

AI calls are asynchronous. At top level the compiler wraps the generated program so `await` works. Inside a route, function, or handler, it marks that function as asynchronous.

---

## 9. Web applications and APIs

Start a web application, add routes, and close each block:

```plainscript
web app
allow cors

route get "/health"
    reply json
        ok is true
    done
done

route post "/echo"
    remember input as body of request
    reply json
        received is input
    done
done

when nothing matches
    status 404
    reply "not found"
done

start 3000
```

Supported route methods are `get`, `post`, `put`, `patch`, and `delete`.
Request accessors include:

- `body of request`
- `param("id")`
- `query("page")`
- `header("x-token")`
- `upload("file")`
- `uploads("file")`

Response constructs include `reply`, `reply json`, `reply file`, `status`, and `redirect to`:

```plainscript
web app
route get "/users/:id"
    remember id as param("id")
    if id is empty
        status 400
        reply "missing id"
    otherwise
        reply id
    done
done

route get "/"
    reply file "public/index.html"
done

route get "/dashboard"
    reply file "views/dashboard.html"
done

start 3000
```

`reply file "<path>"` sends a file directly with Express's `res.sendFile()`. The path is relative to the project root. Content-Type is set automatically from the file extension (e.g., `.html` → `text/html`, `.css` → `text/css`, `.js` → `application/javascript`).

Backend declarations:

```plainscript
web app
enable sessions "session-secret"
limit requests to 100 per minute
require api key from env("API_KEY")
accept uploads limit "5 MB" allow list with "image/png" folder "uploads"

route get "/preferences"
    set cookie "theme" to "dark" expires in 7 days
    reply "saved"
done

start 3000
```

For production, keep secrets in environment variables instead of literals. `enable sessions` and `set cookie` are server features; they do not create a database or user account system by themselves.

### Browser apps and games

The same compiler targets browsers as well as Node. A `web app` can `serve folder "public"` with a `reply file "index.html"` route, or you `build` a `.pln` and load `game.js` with a `<script>` tag. Browser code is interop-first: canvas properties, DOM APIs, and WebGL/Three.js are just PlainScript property/call syntax, and JavaScript functions are first-class (pass `make` functions as callbacks).

```plainscript
remember canvas as document.getElementById("game")
remember ctx as canvas.getContext("2d")
remember pressed as {}

when document "keydown" happens as ke
    pressed[ke.key] becomes true
done

if pressed["ArrowLeft"] is true
    ctx.fillStyle becomes "#0d1117"
    ctx.fillRect(10, 10, 40, 40)
done
```

`when <target> "<event>" happens` becomes `addEventListener`. Browser builtins (`select`, `selectAll`, `parseHTML`, `loadImage`, `loadAudio`, `fetchJson`, `fetchBytes`, `readDataUrl`, `audioContext`/`playTone`, `localPoint`, `gamepads`, `droppedFiles`, `webSocketSend`, and the WebGL helpers `webglContext`/`glShader`/`glProgram`/`glBuffer`) are auto-awaited promises or direct helpers  -  no `await` needed. `jsonEncode`/`jsonDecode` cover persistence. Animation forms are `every frame ... done` and an rAF-with-delta-time idiom; always use browser tools (never `while true`) and resume audio from a user gesture. The full expanding guide for browser and game development is `docs/GAME-PROMPT.md`.

---

## 10. SQLite, SQL, HTTP, and packages

Portable SQLite:

```plainscript
database "app.db" using "wasm"
remember name as "Ada"

execute
    CREATE TABLE IF NOT EXISTS people (name TEXT)
done

insert
    INSERT INTO people (name) VALUES ({name})
done

remember people as query
    SELECT name FROM people
done

show people
```

SQL is written in a block and closed with `done`. `{name}` is a bound parameter, not string concatenation. Use `transaction ... done` to group writes. `database ... using "native"` selects `better-sqlite3`; `using "wasm"` selects `sql.js`.

HTTP client calls return a response record with `ok`, `status`, `headers`, and parsed `data`:

```plainscript
remember response as get "https://example.com/data" timeout 5000
if response.ok is true
    show response.data
otherwise
    show response.status
done
```

Send a body and headers:

```plainscript
remember created as post "https://example.com/items" with {name: "Ada"} headers {contentType: "application/json"} timeout 5000
show created.status
```

Do not confuse an HTTP response with parsed JSON. Use `response.data` when the server returns JSON.

---

## 11. Telegram bots

Telegram is an optional runtime feature. Configure a token from the environment, write deterministic handlers first, and add AI only where useful:

```plainscript
bot env("TELEGRAM_BOT_TOKEN")

when someone sends "/start"
    reply "Welcome. Try /status."
done

when someone sends "/status"
    reply "All systems are operational."
done

start telegram bot
```

Pattern handlers expose update context:

```plainscript
bot env("TELEGRAM_BOT_TOKEN")

when someone sends matching "/ask (.+)"
    telegramCall("sendChatAction", {chat_id: chatId, action: "typing"})
    remember answer as chatWith("groq", "llama-3.3-70b-versatile", message)
    reply answer
done

start telegram bot
```

Inside Telegram handlers, these identifiers are mapped to the current update:

- `message`: the current message record
- `text`: message text
- `args`: words captured after a command
- `matches`: regex capture values
- `chat`: current chat record
- `chatId`: current chat ID
- `data`: callback query data

Callback buttons:

```plainscript
bot env("TELEGRAM_BOT_TOKEN")

when someone sends "/menu"
    reply "Choose" with buttons
        "About" -> "about"
        "Help" -> "help"
    done
done

when someone clicks "about"
    reply "PlainScript is intent-oriented."
done

start telegram bot
```

`telegramCall(method, params)` calls any Telegram Bot API method. Use it for an API operation that has no dedicated PlainScript statement. `telegramApi` is kept as a compatible alias.

Keep Telegram replies deterministic for commands such as `/start`, `/help`, and `/status`. Add provider-backed replies for open-ended questions, and handle provider failures with a recoverable response when appropriate.

---

## 12. OCR, uploads, email, and realtime

OCR accepts a path or an in-memory buffer:

```plainscript
ocr path of file as text
show text
```

For a web upload, enable the upload policy before reading `upload("file")` or `uploads("file")`:

```plainscript
web app
accept uploads limit "5 MB" allow list with "image/png", "image/jpeg" folder "uploads"

route post "/scan"
    remember image as upload("document")
    ocr image as text
    reply text
done

start 3000
```

Mail transport and send statements are available when the project provides the needed SMTP environment:

```plainscript
mail transport
    host is "smtp.example.com"
    port is 587
    user is env("SMTP_USER")
    pass is env("SMTP_PASS")
done

send mail
    to is "user@example.com"
    subject is "Report"
    body is "Ready"
done
```

WebSockets:

```plainscript
websocket server on 8080
    when socket connects
        send socket "connected"
    done
    when socket sends message
        broadcast message
    done
done
```

Use `cache`, `cacheGet`, `cacheSet`, and `cacheDelete` for the supported cache runtime. Use `every`, `schedule`, and `run background` for recurring or non-blocking work:

```plainscript
cache env("REDIS_URL")
cacheSet("status", "ready", 60)
remember status as cacheGet("status")
show status

every 5 minutes
    show "heartbeat"
done

schedule "0 2 * * *"
    show "nightly report"
done
```

`run background` takes a function call, not a bare expression:

```plainscript
make refresh()
    show "refreshing"
done

run background refresh()
```

---

## 13. Async code and error handling

Network, AI, OCR, database, and many bot operations can be asynchronous. Use the PlainScript async constructs instead of writing JavaScript `async` and `await` keywords:

```plainscript
remember response as get "https://example.com" timeout 5000
remember answer as chatWith("groq", "llama-3.3-70b-versatile", "Say hello")
show response.status
show answer
```

Run independent promises together:

```plainscript
remember results as allOf([
    get "https://example.com/a",
    get "https://example.com/b"
])
show results
```

Bound failures with `try`, `recover`, and optional `finally`:

```plainscript
try
    remember response as get "https://example.com" timeout 5000
    show response.data
recover as error
    show message of error
finally
    show "request finished"
done
```

Retry a block when an operation may temporarily fail:

```plainscript
retry 3 times every 1 second
    remember response as get "https://example.com"
    show response.status
done
```

Prefer explicit, user-facing recovery messages for AI provider, network, Telegram, OCR, and database errors. Do not catch an error and silently pretend the requested operation succeeded.

---

## 14. Native tests

PlainScript has a test DSL:

```plainscript
make add(a, b)
    give a + b
done

test "addition works"
    check add(2, 3) equals 5
done
```

Assertions include `equals`, `is`, `contains`, and `raises`:

```plainscript
test "invalid input raises"
    check jsonDecode("not json") raises "Unexpected"
done
```

Run repository tests with:

```bash
npm test
```

When changing the compiler, add a focused regression test. When changing
documentation, make sure every PlainScript fence still compiles. When changing a
starter, validate its `src/app.pln` entry point so imported modules are checked too.

---

## 15. Error prevention checklist

Before returning code to a vibecoder, check these common failure modes:

| Mistake | Correct response |
| --- | --- |
| Using `const`, JavaScript `let`, or semicolons | Use `remember`, PlainScript `let`, and `done` |
| Closing a block with indentation only | Add `done` |
| Writing `remember x value` | Write `remember x as value` |
| Calling `load()` for a module | Use `import "./file.pln"` or `loadModule("./file")` only if the runtime supports that helper |
| Using `let visits` as a declaration | Use `let visits be 0` |
| Passing a bare value to `run background` | Pass a function call such as `refresh()` |
| Using `message` in an ordinary web route | Use `body of request`, `param`, `query`, or `header` |
| Using Telegram context outside a Telegram handler | Move the expression inside the handler |
| Hardcoding API keys or bot tokens | Use `env("NAME")` and document the variable |
| Inventing a built-in | Search the compiler source, then use an npm package if needed |
| Treating `response` as JSON | Read `response.data` |
| Interpolating SQL strings manually | Use `{name}` bound parameters |
| Running a provider call without a key | Set the provider environment variable or pass `key` in options |
| Claiming code works without checking it | Run `plainscript check file.pln` |

When the compiler reports an error, preserve the line and column in the explanation. The compiler's suggestions are more reliable than guessing what the user intended.

---

## 16. Project recipes for vibecoders

### Small script

Use a single `.pln` file with `remember`, functions, and `show`:

```plainscript
make welcome(name)
    give `Welcome, ${name}!`
done

remember user as "Ada"
show welcome(user)
```

### REST API

Start with `web app`, add one health route, then add one resource route. Read request input with `body of request` and return records with `reply json`. Validate before writing to the database.

### SQLite app

Start with `database "app.db" using "wasm"` for portability. Add schema creation in an `execute` block, writes in `insert` or `update`, and reads in a `query` block. Use bound `{name}` parameters.

### Telegram bot

Start with hardcoded `/start`, `/help`, and `/status` handlers. Add buttons or pattern matching next. Add `chatWith` only for open-ended text.

### AI feature

Start with `chatWith(provider, model, prompt)`. Put the provider key in the environment. Add `try/recover` if the feature is user-facing. Use options for temperature, token limits, custom base URLs, or response format.

### Scheduled job

Put reusable work in `make report() ... done`, call it from a `schedule` block, and expose a health or status route if the job is deployed as a service.

### New package or integration

First check whether PlainScript already has a built-in. If not, declare the npm package with `use`, install it, and verify the generated JavaScript. Do not pretend a package call is a native PlainScript function.

---

## 17. Agent response format

When helping a vibecoder, answer in this order:

1. State the PlainScript approach in one sentence.
2. Show complete `.pln` code, not a fragment with omitted block endings.
3. List required environment variables and npm packages.
4. Give the exact `plainscript check` or `plainscript run` command.
5. Explain one important runtime behavior or limitation.
6. If the request is not supported, say what is unsupported and offer the closest valid alternative.

A good answer is friendly and direct, but compiler-checked. PlainScript makes code approachable; validation makes it dependable.

---

## 18. Quick reference: Keywords & constructs

**Declarations**: `remember`, `let`, `becomes`, `is now`, `set ... to`, `change ... to`
**Blocks**: `done` (closes most blocks), `end` (alias)
**Conditions**: `if`, `otherwise`, `otherwise if`
**Comparisons**: `is`, `same as`, `is not`, `different from`, `more than`, `is greater than`, `is above`, `fewer than`, `is less than`, `is below`, `is at least`, `is most`, `contains`, `starts with`, `ends with`, `between ... and ...`, `has field`, `instanceof`
**Logic**: `and`, `or`, `not`
**Loops**: `for each ... in ...`, `for index ... from ... to ...`, `while ...`, `break`, `continue`
**Functions**: `make`, `give`, `yield`
**Modules**: `import`, `export`
**Packages**: `use`
**Web**: `web app`, `route`, `allow cors`, `enable sessions`, `limit requests`, `require api key`, `accept uploads`, `start`, `reply file`
**Database**: `database`, `execute`, `insert`, `update`, `delete`, `query`, `transaction`
**HTTP**: `get`, `post`, `put`, `patch`, `delete`
**Telegram**: `bot`, `when someone sends`, `when someone clicks`, `reply`, `telegramCall`, `start telegram bot`
**AI**: `chat`, `chatWith`, `embedText`, `embedWith`, `similarity`
**Images**: `svgImage`, `barChart`, `lineChart`, `saveImage`, `imageDataUri`
**Async**: `try`, `recover`, `finally`, `retry`, `allOf`, `anyOf`, `settledOf`, `withTimeout`, `sleep`
**Files**: `readFile`, `writeFile`, `appendFile`, `fileExists`, `copyFile`, `moveFile`, `deleteFile`, `makeFolder`, `listFolder`
**Testing**: `test`, `check`, `equals`, `is`, `contains`, `raises`
**Other**: `show`, `print`, `display`, `env`, `args`, `time`, `date`, `uuid`, `exit`, `ocr`, `cache`, `cacheGet`, `cacheSet`, `cacheDelete`, `every`, `schedule`, `run background`, `websocket server`, `mail transport`, `send mail`, `reply file`