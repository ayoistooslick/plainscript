# PlainScript 1.0.363 language specification

This reference covers the syntax implemented by `compiler/lexer.js` and
`compiler/parser.js`. The runtime it generates lives in
`compiler/generator.js`. Every example here is checked against the
repository's maintained example set.

## Design

PlainScript is a line-oriented, intent-oriented language made for Node.js.
Source files use `.pln`. Blocks end with `done` unless the syntax says
`together`, and `end` is accepted as a synonym for `done` in every block
position. Whitespace does not matter.

The basic declaration forms are:

```plainscript
remember name as "Ada"
let age be 36
name becomes "Grace"
show name
```

Comments begin with `//`. Double-quoted strings support escapes. Backtick
strings keep their content as-is and support `${expression}` interpolation.

## Values and expressions

PlainScript has strings, template strings, numbers, booleans, `null`,
`undefined`, BigInt, arrays, objects, identifiers, function calls, member
access, optional member access, and indexed access.

```plainscript
remember names as ["Ada", "Grace"]
remember user as {name: "Ada", active: true}
show names[0]
show user?.name
```

English-style collection expressions:

```plainscript
remember items as list with "one", "two", "three"
remember profile as record with name "Ada" and role "admin" done
show first item from items
show last item from items
show item one from items
show items at position 1
```

Arithmetic uses `+`, `-`, `*`, `/`, `%`, and `**`, with normal
precedence. Word forms `plus`, `minus`, `times`, and `divided by` also work.
`??` plus unary `-`, `wait for`, `typeof`, `void`, and `delete` are
supported.

### Assignment

`becomes` is the ordinary assignment operator. Compound forms combine an
operator with assignment; the symbols `+=`, `-=`, `*=`, `/=`, and `%=` (plus
the legacy `++=` spelling of `+=`) reuse the same grammar:

```plainscript
remember score as 10
score += 5
score -= 3
score *= 2
score /= 4
score %= 7
let count be 0
count ++= 1
show score
```

The word forms `or becomes`, `and becomes`, and `nullish becomes` map to
the logical assignments `||=`, `&&=`, and `??=`:

```plainscript
let name be null
name or becomes "Grace"
name and becomes name
name nullish becomes "default"
show name
```

`set <expr> to <value>` and `change <expr> to <value>` are prefix synonyms
for `becomes`, and the same words work postfixed after the expression:

```plainscript
let age be 16
set age to 17
change age to 18
age set to 19
age change to 20
show age
```

## Conditions

```plainscript
if age is at least 18 and name contains "A"
    show "adult"
otherwise
    show "minor"
done
```

Operators:

| Syntax | Result |
| --- | --- |
| `is`, `same as` | `===` |
| `is not`, `different from` | `!==` |
| `more than`, `is greater than`, `is above` | `>` |
| `fewer than`, `is less than`, `is below` | `<` |
| `is at least` | `>=` |
| `is at most` | `<=` |
| `contains`, `starts with`, `ends with`, `made of` | string predicates |
| `between low and high` | inclusive range |
| `has field field` | property existence |
| `instanceof Kind` | instance test |

Use `and`, `or`, and `not` to combine conditions. Inline conditionals use
`choosing condition then yesValue otherwise noValue`.

## Functions

Write a function with `make` and return a value with `give`:

```plainscript
make add(a, b)
    give a + b
done

show add(2, 3)
```

Function parameters can have simple defaults:

```plainscript
make greet(name as "friend")
    give `Hello, ${name}`
done
```

Aliases like `define`, `function`, `return`, and `give back` also work. Use
`make` and `give` for the readable form:

```plainscript
make add(a, b)
    give a + b
done
```

`yield` turns a function into a generator. Functions can use `wait for` and
other async operations.

`intend name(params)` is a callable declaration equivalent to `make` at
runtime, but it remains an `IntentDeclaration` in the AST and compiler IR. This
metadata is reserved for future contract analysis, documentation generation,
and semantic diagnostics.

```plainscript
intend greet(name)
    give `Hello ${name}`
done
```

Tooling can inspect the backend-neutral representation with:

```bash
plainscript ir path/to/program.pln
```

The command emits versioned JSON and preserves statement kinds, source spans,
function parameters, and intent metadata. The JavaScript backend continues to
consume the existing AST while alternate backends are developed against this
stable boundary.

## Typed data contracts

Contextual `type` declarations describe the required shape of a record. A
function parameter can refer to a declared type after `as`; unlike a default
literal such as `name as "friend"`, a type name is an identifier such as
`User`.

```plainscript
type User
    id is number
    name is text
    active is optional boolean
    tags is list of text
    metadata is dictionary of text
done

make greet(user as User)
    give `Hello, ${user.name}`
done
```

The current implementation emits the contract into the generated program and
validates typed arguments at function entry. Required fields must be present;
primitive values must match their declared type. `optional T` accepts a missing
or null value, while `T or null` accepts null in addition to `T`. A declared
contract can also be used inside `list of` and `dictionary of`. The static
checker consumes the same AST and IR and reports unknown contract names, arity
errors, invalid literal fields, missing required fields, and invalid member
access. Generic types, whole-program inference, and compile-time exhaustiveness
checking are not yet part of this slice.

The checker powers the stdio language server started with `plainscript-lsp`.
The server publishes these diagnostics and provides hover, completion,
definition, and document-symbol responses using standard LSP JSON-RPC framing.

## Control flow

```plainscript
for each item in items
    show item
done

for index i from 0 to 2
    show i
done

while count is less than 3
    count becomes count + 1
done
```

Use `break` and `continue` inside loops. `match value against` uses `->`
case arrows and `otherwise`. `switch value against` works the same way and
is just another way to write it.

Regex capture uses `match pattern "..." in text as result`:
```plainscript
match pattern "^(\\d+)$" in "4061" as digits
show digits            // → "4061"
```

Collection size uses `count of`:
```plainscript
show count of [1, 2, 3]          // → 3
show count of "hello"            // → 5
```

`run in parallel ... done as <name>` executes each statement in the block as
its own concurrent async job and awaits them together with `Promise.all`,
collecting each statement's value in body order. It is not a worker-thread
API:

```plainscript
run in parallel
    makeJob(1)
    makeJob(2)
done as results
```

An expression statement (typically a call) contributes its return value; any
other statement runs as its own async job and contributes `undefined`.

## Record kinds

```plainscript
define a kind called "Player" with
    name is ""
    goals is 0
done

remember player as create a Player with name "Ada" and goals 4
```

`define a kind called` makes a new record kind. Fields use default
expressions. `create a Kind with field value and field value` builds an
instance.

## Modules and packages

```plainscript
import "./math.pln"
import { circleArea } from "./geometry.pln"
export circleArea
use express
```

Imports get bundled in dependency order. `use` declares an npm package.

## Web server syntax

```plainscript
web app
allow cors

route get "/health"
    reply json
        ok is true
    done
done

when nothing matches
    status 404
    reply "not found"
done

start 3000
```

Methods are `get`, `post`, `put`, `patch`, and `delete`. Request values use
`body of request`, `param("id")`, `query("name")`, `header("x-token")`,
`upload("file")`, and `uploads("file")`.

The server also supports:

```plainscript
enable sessions "secret"
route get "/preferences"
    set cookie "theme" to "dark" expires in 7 days
    reply "saved"
done
limit requests to 100 per minute
require api key from env("API_KEY")
accept uploads limit "5 MB" allow list with "image/png" folder "uploads"
```

## Database and HTTP

```plainscript
database "app.db" using "wasm"
execute
    CREATE TABLE users (name TEXT)
done
insert
    INSERT INTO users (name) VALUES ("Ada")
done
remember users as query
    SELECT name FROM users
done
```

SQL blocks are closed by `done`. `{variable}` placeholders are bound safely.
`transaction ... done` groups writes. `postgres connection` generates
PostgreSQL code instead.

HTTP client expressions:

```plainscript
remember response as get "https://example.com" timeout 5000
remember created as post "https://example.com" with {name: "Ada"} headers {accept: "application/json"}
```

## Errors and async

```plainscript
try
    remember value as get "https://example.com" timeout 5000
recover as error
    show message of error
finally
    show "finished"
done

retry 3 times every 1 second
    show "retry"
done
```

Concurrency helpers are `all of`, `any of`, `settled of`, and `withTimeout`.
Recurring blocks use `every 5 minutes ... done` and
`schedule "0 * * * *" ... done`.

## Interactive terminal

Simple CLI prompts read from stdin and write to stdout. `confirm("question")`
asks a yes/no question and resolves to a boolean; `choose("question",
options)` prints a numbered menu and resolves to the picked option (or `null`
when cancelled):

```plainscript
remember ok as confirm("Delete this file?")
remember color as choose("Pick a color", ["red", "green", "blue"])
show color
```

`clearTerminal()` clears the screen, `terminalWidth()` and
`terminalHeight()` report the terminal size, and `stderr(...)` writes to
standard error so diagnostics never pollute stdout:

```plainscript
stderr("starting")
clearTerminal()
show "width " + terminalWidth() + " height " + terminalHeight()
stderr("done")
```

## Statistics, vectors, and randomness

Numeric statistics over an array:

| Function | Result |
| --- | --- |
| `mean(values)` | Arithmetic mean, or `NaN` for an empty array. |
| `median(values)` | Middle value; average of the two middle values for even-length arrays. |
| `variance(values)` | Sample variance (`n - 1` denominator). |
| `deviation(values)` | Sample standard deviation. |

```plainscript
remember data as [2, 4, 4, 4, 5, 5, 7, 9]
show mean(data)
show median(data)
show variance(data)
show deviation(data)
```

Vector primitives operate on numeric arrays:

```plainscript
remember a as [1, 2, 3]
remember b as [4, 5, 6]
show dotProduct(a, b)
show magnitude(a)
show normalize(a)
```

`dotProduct(a, b)` sums the element-wise products, `magnitude(v)` is the
Euclidean length, and `normalize(v)` is the unit vector (a zero vector maps
to the same-length zero vector).

Randomness helpers (all inclusive where a range applies):

```plainscript
remember die as randomInteger(1, 6)
remember coin as randomChoice(["heads", "tails"])
remember loot as weightedChoice(["common", "rare", "legendary"], [0.7, 0.25, 0.05])
remember deck as shuffle(["A", "2", "3", "4", "5"])
remember hand as sample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3)
```

`randomInteger(low, high)` is inclusive on both ends, `randomChoice(items)`
picks one element, `weightedChoice(items, weights)` picks an element weighted
by its parallel weight, `shuffle(items)` returns a new shuffled copy, and
`sample(items, n)` returns a shuffled copy cut to `n` elements.

## Memoization and helpers

`memoize(function)` wraps a callable so repeated calls with the same argument
list hit a cache instead of re-running:

```plainscript
make slowSquare(n)
    give n * n
done

remember fastSquare as memoize(slowSquare)
show fastSquare(9)
```

`parseBoolean(text)` treats `"true"`, `"yes"`, `"1"`, and `"on"` (ignoring
case and surrounding whitespace) as `true` and everything else as `false`.
`characters(text)` splits a string into an array of its characters:

```plainscript
remember enabled as parseBoolean("yes")
remember letters as characters("hello")
show count of letters
```

## AI providers

`chat(model, messages, options)` and `embedText(model, text, options)` talk
to an OpenAI-compatible API. Provider presets pick safe defaults for the
endpoint and the environment variable:

| Provider | API key | Default base |
| --- | --- | --- |
| `openai` | `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| `groq` | `GROQ_API_KEY` | `https://api.groq.com/openai/v1` |
| `openrouter` | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` |
| `together` | `TOGETHER_API_KEY` | `https://api.together.xyz/v1` |
| `fireworks` | `FIREWORKS_API_KEY` | `https://api.fireworks.ai/inference/v1` |
| `deepseek` | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` |

```plainscript
remember answer as chat("llama-3.3-70b-versatile", "Hello from PlainScript", {
    provider: "groq",
    key: env("GROQ_API_KEY"),
    temperature: 0.2,
    maxTokens: 200
})
remember explicit as chatWith("groq", "llama-3.3-70b-versatile", "Hello")
show answer
```

`base`, `key`, `headers`, `temperature`, `maxTokens`, and `responseFormat`
are optional. Custom providers can supply a provider name plus `base` and
`key`; the runtime falls back to `PROVIDER_API_KEY` and `PROVIDER_BASE_URL`.
These calls work in ordinary programs, routes, jobs, and messaging handlers.

## WebSockets, cache, bots, and OCR

```plainscript
websocket server on 8080
    when socket connects
        send socket "connected"
    done
    when socket sends message
        broadcast message
    done
done

cache env("REDIS_URL")
cacheSet("key", "value", 60)
remember value as cacheGet("key")
```

Telegram:

```plainscript
bot env("TELEGRAM_BOT_TOKEN")
when someone sends "/start"
    reply "Welcome"
done
start telegram bot
```

Inside a Telegram handler, `message`, `text`, `args`, `matches`, `chat`,
`chatId`, and callback `data` hold the update context. Fixed replies use
`reply "text"`; provider-backed replies can use `chatWith` before `reply`.
`telegramCall(method, params)` calls any Telegram Bot API method.

### WhatsApp

WhatsApp bots are declared with a `whatsapp bot ... done` block. The block
accepts the following clauses:

| Clause | Purpose |
|--------|---------|
| `auth "<folder>"` | Path where session credentials persist across restarts. |
| `use baileys "<pkg>"` | Optional. Override the Baileys package (default: `@whiskeysockets/baileys`). |
| `login qr` | Authenticate by scanning a QR code in the terminal. |
| `login pairing "<phone>"` | Authenticate by entering a phone number (digits only, no `+`). The argument may also be an expression such as `env("WHATSAPP_PHONE")`. |
| `on message ... done` | Handler that fires for every incoming message. |

Inside `on message` the incoming record is bound to `message`. Useful fields
include `message.text`, `message.type`, `message.mtype`, `message.caption`,
`message.buttonId`, `message.chat`, `message.sender`, `message.name`,
`message.id`, `message.time`, and `message.isGroup`.

**Pairing login example:**

```plainscript
whatsapp bot
    auth "plain-script-whatsapp"
    use baileys "@whiskeysockets/baileys"
    login pairing "2348012345678"
    on message
        if message.text is "/start"
            reply "Welcome!"
        done
        if message.text is "/help"
            reply "Available commands:\n/start\n/help"
        done
    done
done
```

**QR login example:**

```plainscript
whatsapp bot
    auth "plain-script-whatsapp"
    login qr
    on message
        if message.text is "/start"
            reply "Welcome"
        done
        if message.type is "image"
            download "media/photo.jpg"
            reply "Saved your photo!"
        done
        if message.type is "button"
            reply "You chose: " + message.buttonId
        done
    done
done
```

#### Sending different message types

Inside `on message` you can branch on `message.type` to handle text, images,
documents, buttons, lists, and more. The following helpers are available:

| Statement | Effect |
|-----------|--------|
| `reply <value>` | Send a plain-text reply. |
| `reply <value> with buttons ... done` | Send interactive buttons. |
| `download "<path>"` | Save incoming media (image, audio, document …) to disk. |
| `log message` | Print the full message record for debugging. |

`message.type` values include `"text"`, `"image"`, `"video"`, `"audio"`,
`"document"`, `"sticker"`, `"button"`, `"list"`, `"template-button"`,
`"reaction"`, `"contact"`, `"contacts"`, `"location"`, `"live-location"`,
`"poll"`, `"group-invite"`, and `"other"`.

**Full example  -  media, buttons, and list replies:**

```plainscript
whatsapp bot
    auth "plain-script-whatsapp"
    use baileys "@whiskeysockets/baileys"
    login pairing env("WHATSAPP_PHONE")
    on message
        log message
        if message.text is "/menu"
            reply "Choose a topic" with buttons
                "Hours" -> "hours"
                "Pricing" -> "pricing"
                "Human" -> "human"
            done
        done
        if message.type is "image"
            download "downloads/photo.jpg"
            reply "Got your picture. We saved it for the team."
        done
        if message.type is "document"
            download "downloads/file.bin"
            reply "We received your document."
        done
        if message.type is "button"
            reply "You chose: " + message.buttonId
        done
        if message.type is "list"
            reply "You picked: " + message.buttonId
        done
    done
done
```

OCR uses:

```plainscript
ocr path of file as text
```

## Images and visualizations

The standard library creates dependency-free SVG images:

```plainscript
remember labels as ["Jan", "Feb", "Mar"]
remember values as [12, 18, 27]
remember chart as barChart("Monthly signups", labels, values)
saveImage("signups.svg", chart)
```

The available helpers are:

| Function | Result |
| --- | --- |
| `svgImage(width, height, markup, options)` | An SVG image string containing custom markup. |
| `barChart(title, labels, values, options)` | An SVG bar chart. |
| `lineChart(title, labels, values, options)` | An SVG line chart. |
| `saveImage(path, image)` | Writes an SVG image string to disk and returns the path. |
| `imageDataUri(image)` | Converts an SVG image string to a browser data URI. |

Chart options may include `width`, `height`, `background`, `foreground`,
`grid`, `accent`, and `muted`. Image values are strings, so they can also be
returned from a route or inserted into HTML.

## Browser and games

PlainScript compiles to Plain JavaScript that runs in modern browsers. A
`web app` can serve the page itself, or you compile a `.pln` to `game.js` and
serve it with any static host. The tested workflows are:

1. **Static**, served by PlainScript  -  `web app` + `serve folder "public"` +
   a `reply file` route that returns `index.html`:

   ```plainscript
   web app
   serve folder "public"
   route get "/"
       reply file "public/index.html"
   done
   start 8000
   ```

2. **Static**, any host  -  `node compiler/cli.js build game.pln -o public/game.js`
   and include `<script src="game.js">` after the canvas and any CDN globals.

Canvas apps use the same value/property interop as everything else  -  canvas
state is assigned with `becomes`, then a draw call runs:

```plainscript
remember canvas as document.getElementById("game")
remember ctx as canvas.getContext("2d")
ctx.fillStyle becomes "#0d1117"
ctx.fillRect(0, 0, 320, 240)
```

Animation is `requestAnimationFrame`. Two native loop forms: `every frame`
(timing-agnostic) and an explicit rAF callback with delta seconds for
frame-rate-independent movement  -  see `docs/GAME-PROMPT.md` for the canonical
`dt` idiom. Input uses the DOM event form; `when <target> "<event>" happens`
becomes `addEventListener`, and reading a key map uses a boolean comparison:

```plainscript
remember keys as {}
when document "keydown" happens as ke
    keys[ke.key] becomes true
done
when document "keyup" happens as ke
    keys[ke.key] becomes false
done

if keys["ArrowLeft"] is true
    player.x becomes player.x - 4
done
```

Browser builtins are either direct helpers or auto-awaited promises  -  no
`await` is written for the loaders:

- `select("canvas")` / `selectAll(".card")` / `parseHTML("<div>...</div>")`
- `loadImage(url)` → `Image`; `loadAudio(url)` → `Audio` element
- `fetchJson(url)` → `{ok, status, data, text, parseError}`; `fetchBytes(url)`
  → `{ok, status, data: Uint8Array}`
- `readDataUrl(file)` → a `data:` URL string for a `File` (from
  `droppedFiles(event)` or a file input)
- `audioContext()` + `playTone(frequency, seconds, options)`  -  start from a
  user-gesture handler (`ctx.resume()`)
- `localPoint(event, canvas)` maps client to canvas coordinates
- `gamepads()` returns connected pads; `droppedFiles(event)` reads drag-drop
- WebSockets: client side uses `new WebSocket(url)` with `when ws "message"
  happens`, and `webSocketSend(ws, value)` sends strings as-is or
  JSON-stringifies anything else
- Persistence is direct interop: `localStorage.getItem(...)` /
  `setItem` plus `jsonEncode` / `jsonDecode` (JSON is a builtin data type)

WebGL runs through the WebGL2 canvas API (`webglContext(canvas)`, `glShader`,
`glProgram`, `glBuffer`  -  all protected by teaching errors) or a library such
as Three.js constructed interop-style with `new`. WebGPU is available via its
canvas API.
A detailed, expanding guide for browser games lives in
`docs/GAME-PROMPT.md`.

## JavaScript interop

`.pln` files are JavaScript; any JS API is reachable without sugar. Importing
uses `use` (bare npm name, bound lowercase) or `bring name from "pkg"`:

```plainscript
use matter
bring THREE from "three"
remember engine as matter.Engine.create()
remember scene as new THREE.Scene()
```

> Removed: a `javascript ... done` raw block existed briefly in 1.0.363 but
> is no longer part of the language. Interop is through imports (`use` /
> `bring`) and normal member calls, which are always available.

Call anything  -  member chains need no special syntax, and there is no wrapper
around values:

```plainscript
crypto.createHash("sha256").update("abc").digest("hex")
mesh.scale.set(2, 2, 2)
```

Construct with `new Type(args)`  -  as a statement, in `remember`, as an
argument, or bare without parens (`new Enemy`). A `make` function reference is
a first-class value  -  pass it as a callback:

```plainscript
make fitWindow()
    camera.aspect becomes window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
done
window.addEventListener("resize", fitWindow)
```

Promises are awaited with `await` / `wait for`; errors follow the `try` /
`recover as err` / `finally` idiom, never `.then` chaining:

```plainscript
try
    remember response as await fetch("/api/state")
    remember data as await response.json()
    show data
recover as err
    show message of err
done
```

Typed arrays construct and index like anything else
(`new Uint8Array(64)`, `buffer[0] becomes 255`). The generated file adds
`require()` only for `use`/`bring`, and ends with a guarded `module.exports`
tail so the same output works as a browser `<script>` and under Node. The
comprehensive guide is `docs/GAME-PROMPT.md`.

## Native tests

```plainscript
test "addition"
    check add(2, 3) equals 5
done
```

Assertions are `equals`, `is`, `contains`, and `raises`.

## CLI

```text
plainscript check [target]
plainscript build [file.pln]
plainscript build <file.pln> -o <output.js>
plainscript run <file.pln>
plainscript start
plainscript fmt <file.pln>
plainscript install
plainscript doctor
plainscript version
```

`check` parses imports, generates JavaScript, and validates that output with
Node's parser without writing files.
