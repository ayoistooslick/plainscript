# JavaScript interoperability

PlainScript emits ES modules. There is no runtime library, no wrapper around React, and no
custom module format, so interoperability is a question of what the emitted JavaScript can
import — which is everything Node, a bundler or a browser can import.

```plainscript
import { createElement, useState } from "react"     # npm package
import express from "express"                        # npm package, CommonJS default
import { readFile } from "node:fs/promises"          # Node builtin
import "./style.css"                                 # bundler asset
import { helper } from "./helper.pln"                # PlainScript module
```

Types at the boundary are `any` unless declared:

```plainscript
declare const process: any
declare function fetch(url: text, options?: any) -> Promise of any
declare const document: any
```

Declaring is how you opt JavaScript values into the checker without a separate declaration
language. For a TypeScript library that already ships `.d.ts` files, `plainscript interop`
can translate the supported declaration subset rather than requiring hand-written
ambient declarations.

## Node.js

Target: Node 20+. `plainscript run` compiles the module graph into `.plainscript/run/`
with an ESM `package.json` and spawns Node. `plainscript build` emits ESM files with
explicit `.js` specifiers, so the same output runs under `node dist/main.js`.

Verified:

- `std/fs`, `std/http` and `std/io` on Node's standard library.
- `import` of `node:` builtins; the interop test suite imports a builtin and asserts on the
  result.
- npm packages resolved by Node from `node_modules`.

### Express

`demos/express` runs a real Express 4 application. The handlers are PlainScript lambdas with
block bodies (`=> do … end`), and the app was exercised with `curl`:

```plainscript
import express from "express"
import { print } from "std/io"

const app = express()
let hits = 0

app.get("/", (request: any, response: any) => do
    hits += 1
    response.json({ ok: true, hits: hits, framework: "express" })
end)

app.get("/users/:id", (request: any, response: any) => do
    response.json({ id: request.params.id })
end)

app.listen(4501, () => do
    print("express app listening on 4501")
end)
```

```bash
$ curl -s localhost:4501/
{"ok":true,"hits":1,"framework":"express"}
$ curl -s localhost:4501/users/42
{"id":"42"}
```

Node's ESM loader handles Express's CommonJS default export; named imports from CommonJS
work when Node's cjs-module-lexer can detect them.

### A Node HTTP API without a framework

`demos/api` uses `std/http` with the Web `Request`/`Response` model:

```plainscript
import { serve, json, notFound, requestJson, urlOf } from "std/http"

async function handler(request: any) -> any
    let url = urlOf(request)
    if request.method == "GET" and url.pathname == "/health"
        return json({ status: "ok" })
    end
    return notFound()
end

await serve(4321, handler)
```

Verified with `curl`: `GET /health`, `GET /tickets`, `POST /tickets` returning `201` with
the created object, and `404` for an unknown path.

Because the handler signature is Web-standard, the same code shape runs on Node 20, Deno,
Bun and Cloudflare Workers; only `serve(port, …)` is Node-specific.

## React

`render` blocks call `createElement` from the enclosing scope. Importing React is enough —
no JSX transform, no Babel plugin, no custom runtime.

```plainscript
import { createElement, useState } from "react"

export function Counter() -> any
    let (count, setCount) = useState(0)
    render
        element "button" with onClick: () => setCount(count + 1)
            "clicked {count} times"
        end
    end
end
```

Hooks are ordinary functions; the `(count, setCount)` tuple returned by `useState` is
destructured with the language's normal binding pattern. Event handlers are lambdas typed
`any` at React's boundary. Props are `with name: value`; `key` and `className` are accepted
like any other property (keywords are valid property names).

### Vite

`demos/react` is a Vite project whose entry imports the compiled component:

```
demos/react/
  index.html              <script type="module" src="/src/main.js">
  src/main.js             createRoot(...).render(createElement(App))
  src/App.pln             the component
  src/generated/App.js    emitted by plainscript build
  vite.config.js          allows importing stdlib from the repository root
  plainscript.config.json rootDir src, outDir src/generated
```

```bash
cd demos/react
npm install
npm run build      # plainscript build && vite build
```

Observed output: Vite bundled 25 modules, React included, into
`dist/assets/index-*.js` (224 kB, 70 kB gzip). The built page was then loaded in a browser:
the heading, the input and the add button rendered, typing a title and pressing "Add"
produced a row, and clicking the row toggled it to "done". That exercises `useState`,
`onChange`, `onSubmit`, `onClick`, dynamic child lists and conditional labels.

Development: `npm run dev` compiles PlainScript first, then starts Vite. The config's
`server.fs.allow` includes the repository root because compiled modules import
`std/list.js` from there; a published package would resolve it inside `node_modules`
instead.

## Next.js

`demos/next` is a Next.js 15 App Router project with a PlainScript React Server Component:

```
app/Home.pln        component, compiled to app/generated/Home.js
app/page.js         import { Home } ... ; export default function Page() { return Home(); }
app/layout.js       root layout
```

```bash
cd demos/next
npm install
npm run build      # plainscript build && next build
```

Observed: `next build` (Next 15.5.29) reported `✓ Compiled successfully`, generated four
static pages, and prerendered `/` as static content. The generated component imports
`react` and `std/list`; webpack resolved both. No Next plugin or loader is involved — the
file that Next consumes is ordinary JavaScript.

PlainScript components are server components by default, like any React component. Client
components work the same way with `"use client"` placed at the top of a `.js` wrapper, or
by adding the directive to the emitted file in a build step; PlainScript syntax itself has
no directives.

## Browser

The backend emits modules, not a bundle. Two ways to run PlainScript in a browser:

1. **Through a bundler** (Vite, webpack, Next, esbuild) — the default and simplest option.
2. **Directly**, by serving the emitted modules and their standard library imports as
   URLs. Build with `--std-base`:

```bash
plainscript build src/client.pln --std-base=/std
```

The emitted client then begins:

```js
import { createElement, mount } from "/std/dom.js";
import { append } from "/std/list.js";
```

The server must serve those paths. `demos/fullstack` copies `stdlib/dom.js` and
`stdlib/list.js` into `public/std/` and returns them with a JavaScript content type.
Verified in a browser: the client fetched `/todos`, rendered two rows, and a click on "Add
a todo" POSTed to the API and re-rendered with the new row.

Browser globals (`fetch`, `document`, `window`, `JSON`, `Date`) are not built in; declare
them:

```plainscript
declare function fetch(url: text, options?: any) -> Promise of any
declare const JSON: any
```

`std/dom` provides only `createElement` and `mount`; it reads `document` at call time, so it
is browser-only and must not be imported by server code.

## TypeScript declarations

`plainscript interop` reads `.d.ts` files and writes the supported subset as `.d.pln`
declarations next to them:

```bash
plainscript interop types/api.d.ts
plainscript interop types --json
```

Interfaces, aliases, object/function/tuple types, unions, intersections, `keyof`, indexed
access, mapped types, generics without defaults, exported functions/values and re-exports
are translated. `infer`, template-literal types, namespaces, classes, optional tuple
elements, index signatures and other constructs without a direct PlainScript equivalent
produce `PS7001` errors; a file with errors is not written. Omitted generic defaults are a
`PS7004` warning, not a silent substitution. Review warnings and run `plainscript check` on
the generated declaration before publishing it. This is a conservative subset translator,
not an arbitrary TypeScript parser or a TypeScript-to-PlainScript source converter.

## npm packages

Any package that works in ESM works here. Two practical notes:

- **Types**: a package's values are `any` unless you declare a shape or translate its
  `.d.ts` declarations. There are no community type definitions for PlainScript in 2.0.
- **CommonJS**: default imports work in Node (`import express from "express"`). Named
  imports depend on Node's static analysis of the CommonJS module; when in doubt, import
  the default and read members.

`tests/interop.test.js` covers deep property access on untyped values, default imports from
npm-style modules, Node builtins, ambient declarations, errors thrown by JavaScript being
catchable, and PlainScript libraries being importable from JavaScript.

## Consuming PlainScript from JavaScript

A built PlainScript module is a normal ESM module:

```js
// consumer.mjs
import { greet } from "./dist/lib/greet.js";
console.log(greet("world"));
```

Only `export`ed values are visible. Types are erased, so JavaScript callers get no runtime
checking; the PlainScript side was checked when it was built.

## What is not supported

- JSX/TSX files, or a `.pln` file containing JSX.
- Automatic TypeScript declaration (`.d.ts`) output; `plainscript interop` is an input
  translator for a declaration subset, and `.d.pln` is PlainScript's native output format.
- Bundling, code splitting or asset handling in the compiler. Use the ecosystem's tools.
- Decorators, proxies or reflection-based dependency injection.
