# PlainScript

[![CI](https://github.com/ayoistooslick/plainscript/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/ayoistooslick/plainscript/actions/workflows/npm-publish.yml)

PlainScript is a programming language that reads like English and runs on Node.js. You write `.pln` files, and PlainScript turns them into JavaScript you can run anywhere.

## Get started in 60 seconds

```bash
npx plainscript new hello
cd hello
npm install
npx plainscript check
npm run build
npm start
```

Run a single file without saving any build output:

```bash
npx plainscript run examples/basics.pln
```

## Commands

| Command | What it does |
| --- | --- |
| `plainscript new [name]` | Create a new project |
| `plainscript check` | Validate your code |
| `plainscript build` | Compile to JavaScript in `dist/` |
| `plainscript run <file>` | Check, install, and run a file |
| `plainscript start` | Build and start `src/app.pln` |
| `plainscript fmt <file>` | Format your code |
| `plainscript add <package>` | Add an npm package |
| `plainscript remove <package>` | Remove an npm package |
| `plainscript update` | Update installed packages |
| `plainscript doctor` | Check your project setup |
| `plainscript version` | Print version |

Run `plainscript check` after every change — it validates your code and catches errors early.

## Syntax

### Variables and output

```plainscript
remember name as "Ada"
let count is 3
let greeting is `Hello, ${name}!`
show greeting
count becomes count + 1
```

`remember name as value` declares a variable. `show`, `print`, and `display` all print output.

### Conditions

```plainscript
if score is at least 80 and status is not "blocked"
    show "accepted"
otherwise
    show "review"
done
```

You can use `is`, `more than`, `fewer than`, `contains`, `starts with`, `ends with`, `and`, `or`, and `not`.

### Lists and records

```plainscript
remember players as list with "Ada", "Grace", "Lin"
show players at position 1

remember user as record with name "Ada" and active true done
show user.name
```

You can also use plain JavaScript arrays and objects: `[1, 2, 3]` and `{name: "Ada"}`.

### Functions

```plainscript
make add(a, b)
    give a + b
done

show add(2, 3)
```

```plainscript
make greet(name as "friend")
    give `Hello, ${name}`
done
```

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
// Dictionaries
remember userMap as dictionary with "name" is "Ada" and "role" is "admin" done
put "role" as "editor" in userMap
remember mapKeys as keys of userMap

// Sets
remember tags as set with "admin", "editor", "user" done
remember newTags as union of tags and (set with "moderator" done)

// Tuples
remember point as tuple with 10, 20, 30 done
unpack point into x, y, z
```

### Imports and exports

```plainscript
// Import specific functions
bring circleArea and squareArea from "./math.pln"

// Import with a namespace
bring all from "./math.pln" as math
show math.circleArea(5)

// Import an npm package
bring axios from "axios"

// Use @/ to import from src/
bring button from "@/components/button.pln"

// Re-export everything from another file
export all from "./submodule.pln"
```

## AI providers

PlainScript can call AI models from any provider that supports the OpenAI API format. Your API keys stay in environment variables.

```plainscript
remember answer as chat("llama-3.3-70b-versatile", "Summarize PlainScript", {
    provider: "groq",
    key: env("GROQ_API_KEY"),
    temperature: 0.2
})
show answer
```

Supported providers: `groq`, `openai`, `openrouter`, `together`, `fireworks`, `deepseek`. You can also point to any custom OpenAI-compatible endpoint with `base`, `key`, and `headers`.

## Telegram bots

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

Inside a handler, `message`, `args`, `matches`, `chat`, and `chatId` give you access to the current update.

## Standard library

No imports needed — these work out of the box:

```plainscript
remember encoded as jsonEncode(user)
remember decoded as jsonDecode(encoded)
remember contents as readFile("notes.txt")
writeFile("notes.txt", contents)
remember digest as sha256("plain text")
remember currentTime as time()
remember identifier as uuid()
```

Other built-in helpers cover strings, collections, file paths, HTTP, caching, environment variables, and crypto.

## Images and visualizations

PlainScript includes a dependency-free SVG image library. Use `barChart` or
`lineChart` to turn labels and numbers into an image, then save it as an SVG or
embed it in a web response with `imageDataUri`:

```plainscript
remember months as ["Jan", "Feb", "Mar", "Apr"]
remember signups as [12, 18, 27, 35]

remember chart as barChart("Monthly signups", months, signups, {
    width: 720,
    height: 420,
    accent: "#40c463"
})

saveImage("dist/monthly-signups.svg", chart)
show "Saved dist/monthly-signups.svg"
```

Use `lineChart(title, labels, values, options)` for trends, `svgImage(width,
height, markup, options)` for custom SVG content, and `imageDataUri(image)` when
an image needs to be returned from a route or embedded in HTML. The generated
image is a string, so it works with `saveImage`, `reply`, and normal string
helpers without a native graphics dependency.

![Example PlainScript visualization](docs/visualization-example.svg)

## Web apps

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

Routes support `get`, `post`, `put`, `patch`, and `delete`. Read request data with `body of request`, `param("id")`, `query("page")`, and `header("x-name")`.

## Browser games and interactive apps

The same `.pln` you run on Node compiles to a browser script. Drive a canvas,
handle keyboard, pointer, touch, and gamepad input, run `requestAnimationFrame`
loops with delta time, load images and audio, and call any JavaScript library
(Three.js, WebGL, WebGPU, Matter.js) through plain interop — no bundler needed:

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
and game development guide — input, loops, assets, audio, state, collision,
networking, persistence, and interop — is [docs/GAME-PROMPT.md](docs/GAME-PROMPT.md).

## HTTP client

```plainscript
remember response as get "https://example.com/data" timeout 5000
remember created as post "https://example.com/data" with {name: "Ada"} headers {contentType: "application/json"}
show response.status
```

## SQLite

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

Use `using "native"` for a Node.js SQLite backend, or `using "wasm"` for in-memory. SQL placeholders like `{name}` bind to PlainScript variables.

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

Run promises in parallel with `allOf()`, `anyOf()`, and `settledOf()`. Schedule recurring work with `every 5 minutes ... done`.

## Testing

```plainscript
test "addition works"
    check add(2, 3) equals 5
done
```

Assertions: `equals`, `is`, `contains`, and `raises`.

## Examples

The `examples/` folder has working code for every feature:

| Topic | Files |
| --- | --- |
| Basics | `examples/basics.pln`, `examples/conditions.pln` |
| Loops, functions, records | `examples/loops.pln`, `examples/functions.pln`, `examples/records.pln` |
| Natural string verbs | `examples/string-verbs.pln` |
| JSON, files, HTTP | `examples/json.pln`, `examples/files.pln`, `examples/http.pln` |
| Database, web routes | `examples/sqlite.pln`, `examples/web-api.pln` |
| Auth and sessions | `examples/auth-sessions.pln` |
| Async and errors | `examples/async-errors.pln`, `examples/concurrency.pln` |
| WebSockets, cache | `examples/websocket.pln`, `examples/cache-schedule.pln` |
| Bots | `examples/bots.pln`, `examples/telegram-bot.pln`, `examples/whatsapp-bot/` |
| OCR, uploads | `examples/ocr.pln`, `examples/id-verification/` |
| Images, visualizations | `examples/visualization.pln` |
| Tests, modules | `examples/testing.pln`, `examples/modules/` |
| Starter projects | `templates/` |

## Project structure

```text
compiler/                 compiler, parser, and CLI
examples/                 feature demos and examples
tests/                    test suite
docs/                     website and docs
plainscript-vscode/       VS Code extension
editors/mt-manager/       TextMate grammar
```
