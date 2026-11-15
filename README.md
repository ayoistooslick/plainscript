# PlainScript 2.0

PlainScript is a statically typed programming language with plain-language syntax that
compiles to JavaScript. It is designed to be readable without hiding the machine: every
program is type-checked before it runs, lowered through an explicit intermediate
representation, and emitted as ordinary ES modules that interoperate with the JavaScript
ecosystem.

Version 2.0 is a ground-up rebuild of the language, compiler, runtime interface and
standard library. It is a breaking release; see [CHANGELOG.md](CHANGELOG.md) and
[docs/MIGRATION.md](docs/MIGRATION.md).

Created by **Ayodele Ayokunle David**. PlainScript is MIT licensed.

---

## What PlainScript is

- **A language with its own semantics.** Blocks close with `end`. There is exactly one
  spelling for each concept: `let`/`const`, `function`, `when`/`otherwise`, `match`/`case`,
  `for … in`, `type`, `import`/`export`. There are no synonyms such as `done`/`end` or
  `show`/`print`/`log`.
- **Statically typed, with inference.** Function signatures are checked, not assumed.
  Generics, unions, narrowing, structural records, variants, exhaustiveness and `nothing`
  safety are enforced by the compiler.
- **A real compiler.** Lexer → parser → type checker → typed HIR → JavaScript emitter with
  source maps. Types are erased at runtime, so the checker is the enforcer, and JavaScript
  boundaries are typed `any` deliberately rather than accidentally.
- **Interoperable first.** React, Next.js, Vite, Node, npm packages, browser APIs and the
  Web `Request`/`Response` model are supported by emitting plain modules, not by wrapping
  frameworks.
- **Small and honest.** The standard library covers fundamentals (`text`, `list`, `map`,
  `math`, `json`, `time`, `fs`, `http`, `io`, `dom`, `test`) and nothing else. Stripe,
  Telegram, OpenAI, databases and auth are packages, not keywords.

## What PlainScript is not

- Not JavaScript with renamed keywords. The syntax, type system, module graph, pattern
  matching and diagnostics are implemented in this repository.
- Not a framework generator or a catalogue of service integrations.
- Not a TypeScript superset. It compiles to JavaScript, not to TypeScript.

---

## Quick start

PlainScript needs Node.js 20 or newer and has no runtime dependencies. From a clone:

```bash
node src/cli.js run hello.pln
```

```plainscript
# hello.pln
import { print } from "std/io"

function greet(name: text) -> text
    return "Hello, {name}!"
end

print(greet("world"))
```

```bash
$ node src/cli.js run hello.pln
Hello, world!
```

Check types without running, emit ES modules, or open a project:

```bash
node src/cli.js check hello.pln      # type-check, print diagnostics
node src/cli.js build                # compile src/**.pln into dist/
node src/cli.js new my-app           # scaffold package.json + src/main.pln
node src/cli.js run                  # compile and run src/main.pln
```

Once installed as a package, the same commands are available as `plainscript`.

---

## A short tour

```plainscript
import { print } from "std/io"
import { map, filter, sum } from "std/list"
import { upper } from "std/text"

# Records are structural types.
type Person
    name: text
    age: number
end

# Variants are discriminated unions; unit variants are plain strings.
type Shape = Circle(radius: number) or Rectangle(width: number, height: number) or Point

function area(shape: Shape) -> number
    match shape
        case Circle(radius)
            return 3.14159 * radius * radius
        case Rectangle(width, height)
            return width * height
        case Point
            return 0
    end
end

let people: list of Person = [
    { name: "ada", age: 36 },
    { name: "grace", age: 45 },
]

let adults = people
    |> filter((person: Person) => person.age >= 18)
    |> map((person: Person) => upper(person.name))

print(adults)                       # ["ADA", "GRACE"]
print(area(Rectangle(3, 4)))        # 12

# Optional values use T? and are narrowed with `is nothing`.
function findAge(name: text) -> number?
    for person in people
        when person.name == name
            return person.age
        end
    end
    return nothing
end

when findAge("ada") is number
    print("found")
end
```

See [docs/SPEC.md](docs/SPEC.md) for the complete language definition, and run
`node src/cli.js ir file.pln` to see the typed intermediate representation the backend
consumes.

---

## Tooling

| Command | Purpose |
| --- | --- |
| `plainscript run [file]` | Compile and execute a program (default `src/main.pln`). |
| `plainscript build [files…]` | Type-check the module graph and emit `.js` + `.js.map` into `dist/`. With `--declarations`, also write `<name>.d.pln` so another PlainScript project can compile against the built library without its sources. |
| `plainscript check [files…]` | Type-check only; exits non-zero on diagnostics. |
| `plainscript fmt [files…]` | Normalise indentation and block layout without changing tokens. |
| `plainscript test [files…]` | Run `std/test` files and report pass/fail. |
| `plainscript new <dir>` | Scaffold a project. |
| `plainscript ir <file>` | Print the typed HIR that code generation consumes. |
| `plainscript version` | Print the compiler version. |

Details, including `--check`, `--std-base` and project configuration, are in
[docs/CLI.md](docs/CLI.md).

---

## JavaScript ecosystem

The backend emits one ES module per source file. Imports of npm packages, Node built-ins,
React and browser globals work because the output is plain JavaScript with no runtime
library:

```plainscript
import { createElement, useState } from "react"
import express from "express"
import { readFile } from "node:fs/promises"

declare const document: any
```

`render` blocks lower to `createElement` calls resolved from the module scope, so a
component written in PlainScript is a normal React component, usable in Vite, Next.js or
any other React toolchain — no plugin, no JSX runtime, no custom bundler.

Verified in this repository:

| Demo | What was actually run |
| --- | --- |
| [`demos/cli`](demos/cli) | Add/list/complete tasks with persistence; executed. |
| [`demos/api`](demos/api) | JSON HTTP API; exercised with `curl` (GET, POST, 404). |
| [`demos/fullstack`](demos/fullstack) | Shared types, API + browser client; loaded in a browser, list rendered, POST round-tripped. |
| [`demos/react`](demos/react) | React + Vite; built, loaded in a browser, add/toggle interactions verified. |
| [`demos/next`](demos/next) | Next.js App Router; `next build` compiled and prerendered the PlainScript server component. |
| [`demos/database`](demos/database) | SQLite CRUD API (`node:sqlite`, prepared statements); curl matrix incl. `201`/`400`/`404`, and rows still present after restarting the process. |
| [`demos/realtime`](demos/realtime) | Server-Sent Events; `curl -N /events` captured `hello`, `presence`, per-second `tick` frames and a published message. |

See [docs/INTEROP.md](docs/INTEROP.md) for the integration recipes; each demo's source
header carries the exact commands, and [docs/PROGRESS.md](docs/PROGRESS.md) records the
observed output for the database and real-time applications.

---

## Repository layout

```
src/        lexer, parser, checker, typed HIR, codegen, modules, formatter, CLI
stdlib/     JavaScript runtime modules plus .d.pln declaration files
tests/      lexer, parser, checker, compiler, runtime, CLI, interop, formatter, packaging
demos/      cli, api, database, fullstack, react, realtime, next
docs/       specification, architecture, audit, decisions, migration, stdlib, CLI, interop
plainscript-vscode/  syntax highlighting and snippets for .pln files
legacy/v1/  the complete v1 compiler, tests and docs, archived for reference
```

## Tests

```bash
npm test
```

The suite covers lexing, parsing, type checking, inference, narrowing, exhaustiveness,
code generation, runtime behaviour, module resolution, async, error handling, CLI
behaviour, formatter invariants, npm/Node interop and packaging. Demo applications are
built and run separately; see [docs/DEMOS.md](docs/DEMOS.md).

## Limitations

These are known and deliberate for 2.0.0, not oversights:

- **One backend.** JavaScript/ESM only. The IR and emitter are separated so another target
  is possible, but none exists.
- **No bundler.** `build` emits one module per file. Browser projects use Vite, webpack or
  Next to bundle, as the demos do. Importing the standard library in a browser requires
  `--std-base` plus serving those module URLs (see the full-stack demo).
- **No language server.** The VS Code extension provides syntax highlighting, snippets and
  bracket configuration only. There is no completion or go-to-definition yet.
- **`render` blocks are not JSX.** Attributes are `with name: value`, children are
  statements, and dynamic child lists are built with `element` expressions. There are no
  fragments, context shorthand or automatic key inference.
- **Types are erased.** No runtime reflection beyond `is` checks on primitives, lists,
  maps and variant tags. `as` is unchecked at runtime.
- **No exceptions typing.** `catch` binds `any`.
- **No concurrency primitives.** Async/await only; no worker or thread syntax.
- **Not published yet.** npm still serves 1.1.5. Publishing 2.0.0 is a separate, explicit
  release step.

## Contributing

See [CONTRIBUTION.md](CONTRIBUTION.md). Architectural decisions and their reasoning are
recorded in [docs/DECISIONS.md](docs/DECISIONS.md); the v1 audit that motivated the
rebuild is in [docs/AUDIT.md](docs/AUDIT.md).

## License

MIT. PlainScript was created by Ayodele Ayokunle David.
