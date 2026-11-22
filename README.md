<!-- compile-examples -->

# PlainScript 2.2

PlainScript is an independent, statically typed programming language for the
JavaScript platform. It reads like structured English, checks every program
before it runs, and compiles to ordinary ES modules that use the JavaScript
ecosystem directly — React, Next.js, Vite, Express, Node built-ins and npm
packages included.

Version 2.2 adds native JSX, native regular expressions, cross-language
JSON-RPC bridges and a migration tool, without breaking 2.0 or 2.1 source. The
English-oriented 2.1 dialect remains the primary surface of the language.

Created by **Ayodele Ayokunle David**. PlainScript is MIT licensed.

---

## Quick start

PlainScript needs Node.js 20 or newer and has no runtime dependencies.

```plainscript
#syntax 2.1

# hello.pln
import { print } from "std/io"

define greet(name: text) returns text
    return "Hello, {name}!"
end

print(greet("world"))
```

```bash
node src/cli.js run hello.pln
# Hello, world!
```

## What 2.2 adds

- **Native JSX/TSX-style components.** Write React components directly in
  `.pln` files. Classic `createElement` and automatic `jsx-runtime` modes,
  fragments, spread attributes, custom factories, per-file pragmas and prop
  checking are implemented. See [JSX and React](docs/JSX.md).
- **Native regular expressions.** Regex literals are typed, validated and
  emitted as native `RegExp` values, with captures, named groups, flags and
  typed helpers in `std/text`. See [Regular expressions](docs/REGEX.md).
- **Cross-language interoperability.** A JSON-RPC 2.0 bridge serves PlainScript
  modules over stdio or HTTP and generates clients for JavaScript, TypeScript,
  Python, C, C++, Java, Kotlin, Go, Rust, Ruby, PHP, C#, Swift and Dart.
  `std/bridge` calls Python services from PlainScript. See
  [Cross-language bridges](docs/CROSS_LANGUAGE.md).
- **Migration tooling.** `plainscript migrate` analyses a project, plans phases,
  safely converts eligible JavaScript modules, generates interoperability
  boundaries for JSX/TS/TSX/CommonJS modules and writes Markdown or JSON reports.
  See [Migrating to 2.2](docs/MIGRATION_2_2.md).
- **Module fixes.** Value re-exports, declared local runtimes and generated
  boundaries now resolve and execute correctly.

Check types without running, or compile a project to ES modules:

```bash
node src/cli.js check hello.pln     # type-check only
node src/cli.js build               # compile src/**.pln into dist/
node src/cli.js new my-app          # scaffold a project
node src/cli.js fmt                 # normalise formatting
```

Once installed as a package the same commands are available as `plainscript`.

---

## Why the syntax looks different

PlainScript is not JavaScript with renamed keywords. It has one spelling per
concept, blocks that close with `end`, and a checker that enforces the language
before anything runs.

2.1 chooses words for how a declaration reads aloud:

| Concept | 2.0 | 2.1 |
| --- | --- | --- |
| Immutable binding | `const total = 0` | `value total is 0` |
| Mutable binding | `let count = 0` | `set count to 0` |
| Assignment | `count = count + 1` | `change count to count + 1` |
| Function | `function greet(name: text) -> text` | `define greet(name: text) returns text` |
| Condition | `if` / `else if` / `else` | `when` / `otherwise when` / `otherwise` |
| Each loop | `for item in items` | `for each item in items` |
| Range loop | `for i in 0 to 9` | `for i from 0 to 9` |
| Comparison | `a >= b` | `a is at least b` |

Two rules keep the dialect coherent rather than a second set of aliases:

1. **A 2.1 file has one spelling per concept.** Writing `let` or `function`
   inside a `#syntax 2.1` file is a compile error with the 2.1 word as a hint.
2. **Only words that read better were changed.** `match`, `case`, `try`,
   `catch`, `finally`, `while`, `import`, `export`, `async`, `await`, `and`,
   `or`, `not` and `render` are already English and keep their spelling.

`value`, `set`, `change`, `define`, `returns` and `each` are contextual: they
introduce a construct only where that construct can appear, so they remain
usable as ordinary identifiers — `value` can still be a parameter name, and
`for each in names` binds a loop variable named `each`.

2.0 is not deprecated. A file without a pragma compiles exactly as it did
before, and 2.0 and 2.1 modules can import one another in the same graph. See
[the migration guide](docs/MIGRATION_2_1.md).

A project can standardise on 2.1 without a pragma in every file, and still keep
exceptions:

```json
{
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "syntax": "2.1"
  }
}
```

A `#syntax 2.0` pragma in an individual file overrides the project default, and
`plainscript --syntax=2.1 <command>` overrides both for a single run. Precedence
is: file pragma, then `--syntax`, then `plainscript.config.json`, then 2.0.

---

## A short tour

```plainscript
#syntax 2.1

import { print } from "std/io"
import { filter, map, sum } from "std/list"

# Records are structural types.
type Person
    name: text
    age: number
end

# Variants are discriminated unions; unit variants are plain strings.
type Shape = Circle(radius: number) or Rectangle(width: number, height: number) or Point

define area(shape: Shape) returns number
    match shape
    case Circle(radius)
        return 3.14159 * radius * radius
    case Rectangle(width, height)
        return width * height
    case Point
        return 0
    end
end

value people: list of Person is [
    { name: "ada", age: 36 },
    { name: "grace", age: 45 },
    { name: "linus", age: 17 },
]

value adults is people
    |> filter((person: Person) => person.age is at least 18)
    |> map((person: Person) => "{person.name}: {person.age}")

print(adults)
print(area(Rectangle(3, 4)))

# Optional values use T? and are narrowed with `is nothing`.
define findAge(name: text) returns number?
    for each person in people
        when person.name is equal to name
            return person.age
        end
    end
    return nothing
end

value adaAge is findAge("ada")
when adaAge is number
    print("ada is {adaAge}")
end

value totalAge is sum(map(people, (person: Person) => person.age))
print("total age: {totalAge}")
```

---

## The type system

Every program is checked before it runs:

- **Inference and annotations.** Bindings and function signatures are checked,
  not assumed. Return types are part of the contract.
- **Generics and constraints.** `define first<T>(values: list of T) returns T?`
  works with explicit or inferred type arguments, including constraints.
- **Structural records and variants.** Records are width-subtyped; variants are
  exhaustive in `match`.
- **Unions, intersections and narrowing.** `number or text`, `T?`, `is` type
  tests, literal types, tuple types, readonly fields, mapped/conditional types,
  indexed access, overloads and type predicates are enforced.
- **`nothing` safety.** Optional values must be narrowed before use; `as` is an
  explicit, unchecked boundary cast.

Types are erased at runtime. The checker is the enforcer; the emitted module is
plain JavaScript with no type library.

---

## Real applications, actually verified

The repository ships integration projects written in 2.1 and checks them:

| Integration | What runs | Status |
| --- | --- | --- |
| [`integrations/express-api`](integrations/express-api) | Express 5 JSON API; real HTTP create/read/update/delete session | Passes in `npm test` |
| [`integrations/react-vite`](integrations/react-vite) | React 19 component written with native PlainScript JSX; compiled to a Vite bundle | SSR test in `npm test`; production bundle via `npm run verify:integrations` |
| [`integrations/next-app`](integrations/next-app) | Next.js 15 App Router server component | `next build` + prerendered HTML via `npm run verify:integrations` |
| [`integrations/http-client`](integrations/http-client) | `std/http` server plus async `fetchJson` client | Passes in `npm test` |
| [`integrations/sqlite`](integrations/sqlite) | Node SQLite, prepared statements, transactions | Passes in `npm test` |
| [`integrations/cli-app`](integrations/cli-app) | Typed CLI: arguments, JSON store, exit codes | Passes in `npm test` |
| [`integrations/multi-module`](integrations/multi-module) | Three modules sharing declared types; `build --declarations` | Passes in `npm test` |
| [`integrations/fullstack`](integrations/fullstack) | Express + SQLite + React over shared types | HTTP CRUD, restart persistence and SSR in `npm test` |

Closures, async/await, error handling and framework callbacks all lower to the
same JavaScript a developer would write by hand. There is no PlainScript
runtime and no framework wrapper.

---

## Using npm packages

Imports of npm packages, Node built-ins, React and browser globals work because
the output is a plain ES module. Un-typed JavaScript boundaries are `any`
deliberately:

```plainscript
#syntax 2.1

import express from "express"
import { print } from "std/io"

declare const process: any

set app to express()
app.use(express.json())

app.get("/health", (request: any, response: any) => do
    response.json({ status: "ok" })
end)

set port to 4501
app.listen(port, () => do
    print("listening on {port}")
end)
```

React components can use native JSX. The compiler lowers elements to the
configured factory (classic `createElement` by default) or to the automatic
runtime; hooks and events are ordinary PlainScript code:

```plainscript
#syntax 2.1

import { createElement } from "react"

export type TaskProps
    title: text
    done?: boolean
end

define status(done: boolean) returns text
    when done
        return "done"
    end
    return "open"
end

export define Task(props: TaskProps) returns any
    return <li className="task">
        <span>{props.title}</span>
        <small>{status(props.done ?? false)}</small>
    </li>
end
```

`render` and `element` blocks remain available and also lower to
`createElement` calls resolved from module scope. They are a statement-oriented
component surface; JSX is the expression-oriented one. Neither needs a plugin,
custom bundler or PlainScript-specific runtime.

Regex literals are native values with typed helpers:

```plainscript
#syntax 2.1

import { print } from "std/io"
import { findMatch, replaceAllMatches } from "std/text"

set content to "release-2.1, release-2.2"
set found to findMatch(content, /release-(?<major>\d+)\.(?<minor>\d+)/)
when found is not equal to nothing
    print(found.named["major"])
end
print(replaceAllMatches(content, /release-/g, "v"))
```

```plainscript
#syntax 2.1

import { createElement, useState } from "react"

export define Counter() returns any
    set (count, setCount) to useState(0)

    render
        element "button" with onClick: () => setCount(count + 1)
            "Count: {count}"
        end
    end
end
```

---

## Tooling

| Command | Purpose |
| --- | --- |
| `plainscript run [file]` | Compile and execute a program (default `src/main.pln`). |
| `plainscript build [files…]` | Type-check the module graph and emit `.js` + `.js.map` into `dist/`. `--declarations` also writes `.d.pln`. |
| `plainscript watch [files…]` | Rebuild after `.pln` changes. |
| `plainscript check [files…]` | Type-check only; non-zero exit on diagnostics. |
| `plainscript fmt [files…]` | Normalise indentation and block layout without changing tokens. |
| `plainscript test [files…]` | Run `std/test` suites. |
| `plainscript new <dir> [--template <id>]` | Scaffold a default or bundled application. |
| `plainscript lsp` | Language server over stdio. |
| `plainscript dap` | Debug Adapter Protocol server over stdio. |
| `plainscript bridge <file>` | Serve a module over newline-delimited JSON-RPC 2.0 (`--http`, `--call`, `--args`, `--manifest`). |
| `plainscript bindings <file>` | Generate cross-language clients (`--lang`, `--out`) from a bridge manifest. |
| `plainscript migrate [paths…]` | Analyse, convert and generate interoperability boundaries (`--json`, `--write`, `--report`, `--check`). |
| `plainscript interop [files…]` | Translate the supported `.d.ts` subset to `.d.pln`. |
| `plainscript ir <file>` | Print the typed HIR that code generation consumes. |

Details are in the [CLI reference](docs/CLI.md).

---

## Documentation

Start with [Getting started](docs/GETTING_STARTED.md), then:

- [Language reference](docs/LANGUAGE_REFERENCE.md) — the complete 2.1 surface,
  with the 2.0 equivalent of every construct.
- [Language specification](docs/SPEC.md) — normative semantics for both
  dialects.
- [Compiler](docs/COMPILER.md) — pipeline, dialect resolution, diagnostics and
  emitted modules.
- [Integrations](docs/INTEGRATIONS.md) — Express, React + Vite, Next.js, HTTP
  and SQLite.
- [JSX and React](docs/JSX.md) — components, runtimes, prop checking.
- [Regular expressions](docs/REGEX.md) — literals, captures, helpers.
- [Cross-language bridges](docs/CROSS_LANGUAGE.md) — Python, C, JVM, Go,
  Rust and the generated clients.
- [Migrating to 2.2](docs/MIGRATION_2_2.md), [from 2.0](docs/MIGRATION_2_1.md).
- [Type system](docs/TYPE_SYSTEM.md), [interop](docs/INTEROP.md),
  [contracts](docs/UNIFIED_CONTRACTS.md), [databases](docs/DATABASES.md).
- [Capability audit for 2.2](docs/CAPABILITY_AUDIT_2_2.md).

---

## Repository layout

```
src/            lexer, dialect, parser, checker, typed HIR, codegen, modules, CLI, LSP, DAP
stdlib/         JavaScript runtime modules plus .d.pln declarations
integrations/   real Express, React + Vite, Next.js, HTTP, SQLite, CLI, multi-module and full-stack projects in 2.1
templates/      application starters
demos/          larger sample applications (CLI, API, full-stack, contracts, realtime)
tests/          compiler, runtime, CLI, interop, packaging and integration suites
docs/           guides, reference, specification and generated documentation site
editors/vscode/ VS Code extension and grammar
legacy/v1/      archived v1 compiler, tests and docs
```

---

## Tests and verification

```bash
npm test                       # 382 tests: compiler, runtime, JSX, regex, interop, migration, CLI, packaging and integrations
npm run docs:build             # build the documentation site into docs/
npm run verify:integrations    # Vite production bundle and Next.js production build
```

The suite covers the lexer, both dialects, parser, checker, inference,
narrowing, exhaustiveness, code generation, runtime behaviour, module
resolution and re-exports, async, error handling, CLI behaviour, formatter
invariants, native JSX rendering through React 19, regex semantics and
diagnostics, the JSON-RPC bridge with Python and compiled C clients, migration
analysis and boundary execution, npm/Node interop, packaging, real
Express/React/SQLite/HTTP execution and the documentation examples.

---

## Limitations

Known and deliberate for 2.2.0:

- **One backend.** JavaScript/ESM only. The IR and emitter are separated so
  another target is possible, but none exists.
- **No bundler.** `build` emits one module per file. Browser projects use Vite,
  Next or another bundler, as the integrations do. Importing the standard
  library in a browser needs `--std-base`.
- **Advanced type limits.** Arbitrary intersections of unions/functions,
  optional tuple elements and general TypeScript-style conditional inference
  remain absent. Readonly is a compile-time assignment check. Deferred
  constructs stay permissive until instantiated.
- **Concurrency is cooperative.** `std/task` provides groups, cancellation,
  timeouts, channels and worker handles; it cannot stop promises or host calls
  that ignore cancellation.
- **Two component surfaces.** Native JSX is expression-oriented and supports
  classic and automatic React runtimes. `render`/`element` blocks are
  statement-oriented: attributes are `with name: value`, children are
  statements, and loops and branches build dynamic child lists. Neither infers
  keys automatically. Third-party component props are `any`; only local
  components with declared prop records are checked.
- **Cross-language boundaries are processes, not native FFI.** The JSON-RPC
  bridge keeps memory and crashes apart and works without a compiler plugin per
  language, at the cost of serialisation. C, C++, Java, Kotlin, Go, Rust, C#,
  Ruby, PHP, Swift and Dart clients are generated; only JavaScript, Python and C
  were executed end to end in this environment. Native FFI and WebAssembly are
  not implemented.
- **Migration converts the JavaScript family.** Python, Rust, Go, JVM, Ruby,
  PHP, C#, Swift and Dart modules are analysed but stay native; connect them
  through the bridge. The migration tool does not run a project's test command
  for you, and it does not translate non-JavaScript source line by line.
- **No ternary expression.** PlainScript has statement conditionals (`when` /
  `otherwise`) and expressions such as `match`; it does not have `a ? b : c`.
  Classes, `this`, generators and decorators also remain boundary concerns.
- **Types are erased.** No runtime reflection beyond `is` checks on primitives,
  lists, maps and variant tags. `as` is unchecked at runtime.
- **Promise typing is available.** `catch` binds `any` for non-Promise values,
  but `Promise` exposes typed `then`/`catch`/`finally` methods so rejection
  handlers are checked. A `p.then((n: text) => …)` is rejected when `p`
  resolves a `number`. Typed operational errors use `OperationResult`/`OperationFailure`.
- **Database support requires an installed driver.** `std/db` is SQLite via
  Node's `node:sqlite`; PostgreSQL/MySQL adapters dynamically load
  application-installed drivers. The default suite uses driver-shaped fakes;
  `tests/db-live.test.js` runs the same operations against real servers when
  `PLAINSCRIPT_TEST_POSTGRES_URL` / `PLAINSCRIPT_TEST_MYSQL_URL` are set. No
  live server is available in this checkout, so that path is unverified here.
- **Debugging is adapter-based.** `plainscript dap` maps breakpoints and stack
  frames through source maps; the VS Code integration is test-level.
- **TypeScript interop is a subset.** `plainscript interop` translates
  declarations with a direct PlainScript equivalent and reports the rest.
- **Benchmarks are PlainScript-only.** No cross-language speed claim is made.
- **Publication is a separate step.** The source version is 2.2.0; npm and
  GitHub release state depends on credentials and is recorded in the release
  notes rather than inferred from the repository.

## Contributing

See [CONTRIBUTION.md](CONTRIBUTION.md). Architectural decisions are recorded in
[docs/DECISIONS.md](docs/DECISIONS.md); the v1 audit that motivated the rebuild
is in [docs/AUDIT.md](docs/AUDIT.md).

## License

MIT. PlainScript was created by Ayodele Ayokunle David.
