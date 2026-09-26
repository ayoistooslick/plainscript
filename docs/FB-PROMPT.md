# PlainScript General-Purpose Build Prompt

This document is the standing guide for an AI coding agent or programmer
building a serious project with PlainScript. It describes the compiler and
runtime that are present in this repository. Treat the compiler and the
checked examples as the source of truth: if a snippet does not pass
`node compiler/cli.js check <file.pln>`, it is not a PlainScript program yet.

## 1. What PlainScript is

PlainScript is a line-oriented, intent-oriented language that compiles to
readable JavaScript. It is designed to express application logic clearly
while retaining access to the Node.js, browser, and npm ecosystems.

PlainScript is not a replacement for every JavaScript library. Its strongest
general-purpose pattern is:

1. keep application intent, state, control flow, and data transformations in
   `.pln` files;
2. use PlainScript's built-ins for common application concerns;
3. call JavaScript APIs and npm packages when the platform or ecosystem
   already provides the right implementation;
4. compile before running or shipping.

The compiler does not use an AI model to generate code. Compilation is
deterministic and produces ordinary JavaScript.

## 2. Project shape

For a small program, one file is enough:

```text
hello/
  app.pln
```

For a larger application, keep the source and generated output separate:

```text
my-app/
  src/
    app.pln
    domain.pln
    http.pln
  public/
    index.html
  package.json
  plainscript.config.json
```

`plainscript build` discovers `.pln` files under `src/` and writes matching
`.js` files under `dist/`. With no `src/` directory, the project root is
scanned. `plainscript.config.json` may set `rootDir`, `outDir`, and `exclude`.
Generated JavaScript is build output; do not hand-edit it.

Use separate source files for browser and server code. Browser code can be
compiled as a package-free script; server code can use Node built-ins and
server packages.

## 3. Build and run loop

The CLI commands are:

```text
node compiler/cli.js check src/app.pln
node compiler/cli.js build src/app.pln
node compiler/cli.js build src/app.pln -o public/app.js
node compiler/cli.js run src/app.pln
node compiler/cli.js start
node compiler/cli.js fmt src/app.pln
node compiler/cli.js doctor
node compiler/cli.js install
```

Use `check` early and often. It parses imports, generates JavaScript, and
validates the generated syntax without writing build output. Use `build` for
artifacts and `run` for a one-file Node program. `start` builds the project's
entry file and runs the generated output.

When a project uses npm packages, keep them in `package.json`. The compiler's
dependency detector reports packages used by `use`, imports, and built-in
integration statements. The CLI can install detected dependencies, but
package installation still depends on the Node version, package availability,
native modules, and the local environment.

## 4. Core syntax

### Values and assignment

PlainScript supports strings, template strings, numbers, booleans, `null`,
`undefined`, BigInt, arrays, objects, function values, and JavaScript objects
returned by libraries.

```plainscript
remember name as "Ada"
let age be 36
remember tags as ["compiler", "language"]
remember user as { name: name, active: true }
name becomes "Grace"
show `Hello, ${name}`
show user.name
show tags[0]
```

Use `remember` or `let` for a local binding and `becomes`, `is now`, `set`,
or `change` for assignment. Destructuring is available for arrays and
objects:

```plainscript
remember pair as [10, 20]
remember [first, second] as pair
show first
show second
```

### Expressions and conditions

Arithmetic uses `+`, `-`, `*`, `/`, `%`, and `**`. Word forms such as `plus`,
`minus`, `times`, and `divided by` are also supported. Member calls, indexed
access, optional chaining, nullish coalescing, `new`, `typeof`, `void`, and
`delete` are available.

```plainscript
remember score as 7 * 6
if score is at least 40 and name contains "A"
    show "accepted"
otherwise
    show "review"
done
```

Conditions support equality, ordering, string predicates, `between`,
`instanceof`, property checks, and `and`, `or`, and `not`. Inline conditional
expressions use `choosing ... then ... otherwise ...`.

### Functions, closures, and generators

```plainscript
make add(a, b)
    give a + b
done

make greet(name as "friend")
    give `Hello, ${name}`
done

show add(2, 3)
show greet()
```

Functions may capture values from their surrounding scope, accept rest
parameters, and destructure parameters. `yield` turns a function into a
JavaScript generator:

```plainscript
make countUp(limit)
    remember i as 0
    while i is less than limit
        i becomes i + 1
        yield i
    done
done

remember values as countUp(3)
show values.next().value
```

### Control flow and collections

```plainscript
for each item in ["a", "b", "c"]
    show item
done

remember count as 0
while count is less than 3
    count becomes count + 1
done

for index i from 0 to 3
    show i
done
```

`break` and `continue` work inside loops. The standard library includes
collection and text helpers such as `length`, `first`, `last`, `range`,
`sort`, `reverse`, `unique`, `sum`, `flatten`, `groupBy`, `paginate`, `split`,
`join`, `trim`, `replace`, `startsWith`, and `endsWith`. These helpers return
ordinary JavaScript values.

Record kinds are useful when a domain object has declared fields:

```plainscript
define a kind called "Player" with
    name is ""
    score is 0
done

remember player as create a Player with name "Ada" and score 4
show player.name
```

## 5. Modules and npm interoperability

Local PlainScript modules are bundled in dependency order:

```plainscript
import "./domain.pln"
import { add } from "./math.pln"
show add(2, 3)
```

Use explicit exports when a module's public surface matters:

```plainscript
make add(a, b)
    give a + b
done
export add
```

Circular local imports are rejected. Relative imports may omit the `.pln`
extension and may resolve an `index.pln` or `app.pln` entry in a directory.

Use an npm package directly:

```plainscript
use path
remember file as path.join("data", "items.json")
show path.basename(file)
```

Packages with JavaScript identifiers can be bound automatically. Packages
whose names are not valid identifiers should use an alias or a named import:

```plainscript
use node-fetch as fetcher
remember result as fetcher("https://example.com")
```

The exact package name and export shape remain the npm package's contract.
PlainScript passes values into JavaScript and receives values back; it does
not normalize every library API.

The `bring`/`import` forms can import a namespace, default export, or named
exports from a non-local package. Use `new Type(...)` for JavaScript
constructors, member chains for objects, and callbacks in the same places
the JavaScript API expects them.

## 6. Async and event-driven programming

PlainScript propagates asynchronous requirements through functions and
handlers. Use `wait for` or `await` around a promise:

```plainscript
make loadProfile(id)
    wait for sleep(10)
    give { id: id, ready: true }
done

remember profile as wait for loadProfile(7)
show profile.ready
```

Async built-ins include promise-aware HTTP requests, database operations,
mail, OCR, AI helpers, browser asset loading, and `sleep`. Promise
combinators are available as `all of`, `any of`, `settled of`, and
`withTimeout`. `run background` schedules work without blocking the current
path.

```plainscript
make fetchItem(name)
    wait for sleep(5)
    give name
done

remember results as all of [fetchItem("one"), fetchItem("two")]
show results[0]
show results[1]
```

Timers and scheduled work use `after`, `every`, `schedule`, and
`run background`. Event-driven features use `when`, `emit`, WebSocket
handlers, browser event listeners, and the event APIs supplied by imported
JavaScript libraries.

Errors are ordinary JavaScript exceptions. Handle them explicitly:

```plainscript
try
    remember response as get "https://example.com" timeout 5000
    show response.status
recover as err
    show message of err
finally
    show "request complete"
done
```

`retry ... done` provides bounded retry behavior. Errors thrown inside a
PlainScript callback or imported JavaScript callback remain part of the same
exception path, so validate error boundaries in tests.

## 7. Files, data, and system integration

PlainScript provides synchronous file helpers for simple scripts and data
pipelines:

```plainscript
remember input as readFile("input.json")
remember data as jsonDecode(input)
remember names as data
gather each item in names giving item.name
writeFile("names.json", jsonEncode(names))
```

There are helpers for bytes, append/copy/move/delete, folders, file existence,
JSON encoding/decoding, environment variables, UUIDs, hashing, and dates.
For more specialized Node APIs, use `use fs`, `use path`, `use crypto`,
`use child_process`, streams, buffers, typed arrays, or another npm package.

Process execution, exit codes, stdin/stdout/stderr, and OS-specific behavior
belong to the Node API used by the program. Keep those calls behind a small
PlainScript module so the rest of the application stays portable.

## 8. HTTP and backend applications

An Express-backed application can be expressed directly:

```plainscript
web app
allow cors

route get "/health"
    reply json
        ok is true
    done
done

route post "/items"
    remember missing as validate("name")
    if length(missing) is greater than 0
        status 400
        reply json
            errors is missing
        done
    otherwise
        reply json
            name is body("name")
        done
    done
done

start 3000
```

Supported route methods are `get`, `post`, `put`, `patch`, and `delete`.
Request data can be read with `body`, `param`, `query`, `header`, upload
helpers, and the route-specific request forms documented in
`docs/PLAINSCRIPT-SPEC.md`. Responses can be text, JSON, files, redirects,
or explicit status responses.

The backend surface also includes static folders, sessions, cookies, API key
checks, rate limiting, CORS, validation, and fallback routes. These are
convenience generators over Express middleware; for middleware or server
features not covered by the friendly syntax, use Express/npm directly.

The HTTP client supports `get`, `post`, `put`, `patch`, and `delete` with
options such as headers, JSON bodies, and timeouts. Check status and error
behavior at the application boundary; network failures are not silently
converted into successful responses.

## 9. Databases and external services

SQLite supports a native driver and a WebAssembly fallback:

```plainscript
database "app.db" using "wasm"
execute
    CREATE TABLE items (name TEXT)
done
insert
    INSERT INTO items (name) VALUES ({name})
done
remember name as "Ada"
remember items as query
    SELECT name FROM items
done
show items
```

SQL block placeholders are bound parameters, not string interpolation. Use
transactions for related writes. PostgreSQL and MongoDB are generated through
their JavaScript drivers, and asynchronous query behavior remains visible in
the generated program.

Email, Redis/in-memory cache, OCR, Telegram, WhatsApp, AI provider helpers,
and scheduled jobs are available as integration layers. They require the
corresponding package and service configuration. Credentials belong in
environment variables or the deployment's secret store, never in source.

For an unsupported provider, prefer `fetch`, the provider's npm SDK, or a
small external service instead of adding project-specific compiler syntax.

## 10. Browser, graphics, and multimedia

Package-free generated output can run from a normal browser script. A static
HTML shell can load the compiled file:

```html
<canvas id="game" width="640" height="480"></canvas>
<script src="game.js"></script>
```

PlainScript can call browser globals and libraries:

```plainscript
remember canvas as document.getElementById("game")
remember ctx as canvas.getContext("2d")
ctx.fillStyle becomes "black"
ctx.fillRect(0, 0, 640, 480)

when document "keydown" happens as event
    show event.key
done

every frame
    ctx.clearRect(0, 0, 640, 480)
done
```

Browser helpers cover DOM selection, HTML parsing, pointer coordinates,
gamepads, dropped files, image/audio loading, JSON/byte fetches, data URLs,
Web Audio, and WebGL shader/program/buffer helpers. WebSocket clients can use
the browser's `WebSocket` object.

Three.js, canvas libraries, WebGL/WebGPU libraries, audio/video APIs, image
processors, and rendering engines should remain JavaScript dependencies.
Load a browser-global library before the compiled script or use a browser
bundler for npm imports. PlainScript does not provide a complete graphics or
game engine.

## 11. Testing and verification

Start with compiler validation:

```text
node compiler/cli.js check src/app.pln
npm test
```

PlainScript also has a native test DSL:

```plainscript
test "addition"
    check 2 + 2 equals 4
done
```

Use regular Node tests for integration boundaries such as real HTTP servers,
browser harnesses, database drivers, network services, package exports, and
process behavior. Add a representative example when a capability crosses
multiple layers; an isolated generator assertion is not enough.

For every new feature, check:

- synchronous and asynchronous callers;
- errors inside callbacks and across module boundaries;
- promise ordering and timeouts;
- generated JavaScript syntax;
- browser versus Node globals;
- missing environment configuration;
- package detection and installation;
- malformed source and useful diagnostics;
- backwards compatibility with existing examples.

## 12. Common mistakes

- Do not claim a snippet works without running `plainscript check`.
- Do not put `require()` in a browser bundle unless a bundler is handling it.
- Do not assume an npm package's default export is callable; verify its API.
- Do not use SQL string concatenation when a bound placeholder is available.
- Do not put API keys, database URLs, or session secrets in `.pln` files.
- Do not use server-only globals such as `process` or `fs` in browser code.
- Do not treat an async function as synchronous just because its source reads
  naturally; await its result at the boundary.
- Do not create circular local imports.
- Do not edit generated files instead of the `.pln` source.
- Do not add compiler syntax for a capability already exposed cleanly by an
  npm package or browser API.

## 13. What PlainScript should own

PlainScript is a good home for application flow, domain rules, validation,
data shaping, orchestration, route handlers, error handling, and the glue
between services. Its line-oriented syntax is especially useful for readable
business logic and small-to-medium service modules.

Delegate mature platform implementations to JavaScript/npm: database drivers,
HTTP clients, graphics engines, codecs, cloud SDKs, model runtimes, and
specialized algorithms. PlainScript should make those systems usable without
turning each one into a proprietary language feature.

## 14. Current limitations

- The compiler targets JavaScript; runtime behavior follows the Node or
  browser version executing the generated code.
- Package installation can be blocked by the environment or by a package's
  native-module and Node-version requirements.
- Browser npm imports need a bundler; package-free output is the simplest
  browser deployment path.
- External services still require their own credentials, network access,
  quotas, and operational handling.
- PostgreSQL, MongoDB, Redis, mail, AI, OCR, Telegram, WhatsApp, and similar
  integrations are adapters around third-party packages, not local emulators.
- The language does not provide static type checking or a separate memory
  safety model; use JavaScript tooling and runtime validation where needed.
- Cancellation, distributed coordination, and streaming semantics depend on
  the underlying JavaScript API. Design those boundaries explicitly.

When a proposed feature falls outside this guide, first test whether existing
PlainScript syntax plus a JavaScript or npm API is enough. Only add a language
feature when the gap is real, broadly reusable, and worth its compatibility
cost.
