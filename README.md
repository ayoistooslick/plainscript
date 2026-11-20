# PlainScript 2.0

PlainScript is an independent, statically typed programming language for the JavaScript
platform. It is designed to be readable without hiding the machine: every
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
  spelling for each concept: `let`/`const`, `function`, `if`/`else`, `match`/`case`,
  `for … in`, `type`, `import`/`export`. There are no synonyms such as `done`/`end` or
  `show`/`print`/`log`.
- **Statically typed, with inference.** Function signatures are checked, not assumed.
  Generics, constraints, unions, narrowing, structural records/variants, exhaustiveness,
  recursive types, fixed and variadic tuples, readonly record fields, conditional/mapped
  types (including distributive checks over a naked type parameter), deferred indexed
  access, function overloads, type predicates, literal types and `nothing` safety are
  enforced by the compiler. Variance is structural and documented.
- **A real compiler.** Lexer → parser → type checker → typed HIR → JavaScript emitter with
  source maps. Types are erased at runtime, so the checker is the enforcer, and JavaScript
  boundaries are typed `any` deliberately rather than accidentally.
- **Interoperable first.** React, Next.js, Vite, Node, npm packages, browser APIs and the
  Web `Request`/`Response` model are supported by emitting plain modules, not by wrapping
  frameworks.
- **Small and honest.** The standard library covers fundamentals (`text`, `list`, `map`,
  `math`, `json`, `time`, `fs`, `http`, `io`, `dom`, `test`) plus structured concurrency
  (`std/task`), in-process or durable-store background jobs (`std/jobs`), WebSockets with
  fragmentation and authorization-before-upgrade (`std/ws`), SSE, SQLite persistence and
  migrations (`std/db`), dependency-injected PostgreSQL/MySQL adapters
  (`std/db-postgres`, `std/db-mysql`), password/token authentication (`std/auth`),
  OIDC/SAML service-provider helpers (`std/oidc`, `std/saml`) and runtime/schema contracts
  (`std/contract`). Drivers and identity libraries remain ordinary npm packages loaded by
  the application, not compiler dependencies.
- **Schema-derived full-stack contracts.** `std/contract.object` derives record types from
  runtime schemas. `fallibleOperation` carries a typed error union, `implementFallible`
  validates both outcomes, `router` dispatches by operation name, and `std/db` derives
  table columns and versioned migrations from the same schema. See
  [Unified Contracts](docs/UNIFIED_CONTRACTS.md) and the runnable
  [SQLite + React contracts demo](demos/contracts-fullstack/README.md).
- **Editor and debugger support built in.** `plainscript lsp` speaks LSP over stdio with
  diagnostics, completion, hover, definitions, workspace references, rename, formatting,
  semantic tokens and quick-fix code actions. `plainscript dap` is a DAP server over stdio
  for launching a compiled entry through Node's inspector and mapping breakpoints/stack
  frames through source maps. The VS Code extension in [`editors/vscode`](editors/vscode)
  launches both.
- **Practical adoption.** `plainscript migrate` scans JavaScript/TypeScript for blockers
  without rewriting files, and `plainscript interop` translates the supported TypeScript
  declaration subset to `.d.pln` while reporting unsupported constructs. npm interop keeps
  existing dependencies usable, and eight starters cover React, Next.js, Express, CLI,
  libraries and database/realtime apps.

## What PlainScript is not

- Not JavaScript with renamed keywords. The syntax, type system, module graph, pattern
  matching and diagnostics are implemented in this repository.
- Not a framework generator or a catalogue of service integrations; its bundled templates are
  complete PlainScript application slices intended to stress the language and its interop.
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
node src/cli.js new my-project --template project-management
node src/cli.js new my-store --template ecommerce
node src/cli.js new my-chat --template realtime-chat
node src/cli.js new my-ui --template react-vite
node src/cli.js new my-api --template express
node src/cli.js new my-lib --template library
node src/cli.js migrate src --check  # find JavaScript/TypeScript migration blockers
node src/cli.js interop types        # translate supported .d.ts declarations to .d.pln
node src/cli.js dap                  # start the DAP server over stdio
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
        if person.name == name
            return person.age
        end
    end
    return nothing
end

if findAge("ada") is number
    print("found")
end
```

See [docs/SPEC.md](docs/SPEC.md) for the complete language definition and
[docs/SYNTAX_DESIGN.md](docs/SYNTAX_DESIGN.md) for the syntax rationale and migration notes. Run
`node src/cli.js ir file.pln` to see the typed intermediate representation the backend
consumes.

---

## Tooling

| Command | Purpose |
| --- | --- |
| `plainscript run [file]` | Compile and execute a program (default `src/main.pln`). |
| `plainscript build [files…]` | Type-check the module graph and emit `.js` + `.js.map` into `dist/`. With `--declarations`, also write `<name>.d.pln` so another PlainScript project can compile against the built library without its sources. Unchanged outputs are not rewritten. |
| `plainscript watch [files…]` | Rebuild after `.pln` changes, reusing the module cache for unaffected files. |
| `plainscript check [files…]` | Type-check only; exits non-zero on diagnostics. |
| `plainscript lsp` | Start the language server over stdio. |
| `plainscript dap` | Start the Debug Adapter Protocol server over stdio. |
| `plainscript fmt [files…]` | Normalise indentation and block layout without changing tokens. |
| `plainscript test [files…]` | Run `std/test` files and report pass/fail. |
| `plainscript new <dir> [--template <id>]` | Scaffold a default or bundled application. |
| `plainscript migrate [paths…]` | Report JavaScript/TypeScript migration blockers; `--check` is a CI gate. |
| `plainscript interop [files…]` | Translate the supported TypeScript `.d.ts` subset to `.d.pln` and report the rest. |
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
| [`demos/contracts-fullstack`](demos/contracts-fullstack) | Schema-derived operation contracts shared across a PlainScript API and React client; Vite production build and API validation/auth/SQLite-restart integration tests passed. |
| [`demos/realtime`](demos/realtime) | Server-Sent Events; `curl -N /events` captured `hello`, `presence`, per-second `tick` frames and a published message. |

See [docs/INTEROP.md](docs/INTEROP.md) for the integration recipes; each demo's source
header carries the exact commands, and [docs/PROGRESS.md](docs/PROGRESS.md) records the
observed output for the database and real-time applications.

---

## Repository layout

```
src/        lexer, parser, checker, typed HIR, codegen, modules, formatter, CLI
stdlib/     JavaScript runtime modules plus .d.pln declaration files
templates/  project-management, ecommerce, realtime-chat, react-vite, next, express, cli, library
tests/      lexer, parser, checker, compiler, runtime, CLI, interop, formatter, packaging
demos/      cli, api, database, fullstack, contracts-fullstack, react, realtime, next
docs/       specification, architecture, audit, decisions, migration, syntax design, CLI, interop
editors/vscode/  VS Code extension and TextMate grammar backed by `plainscript lsp`
legacy/v1/  the complete v1 compiler, tests and docs, archived for reference
```

## Tests

```bash
npm test
```

The suite covers lexing, parsing, type checking, inference, narrowing, exhaustiveness,
code generation, runtime behaviour, module resolution, async, error handling, CLI
behaviour, formatter invariants, npm/Node interop and packaging. Demo applications are
built and run separately; see [docs/DEMOS.md](docs/DEMOS.md). Reproducible compiler timings and
their scope are in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## Limitations

These are known and deliberate for 2.0.0, not oversights:

- **One backend.** JavaScript/ESM only. The IR and emitter are separated so another target
  is possible, but none exists.
- **No bundler.** `build` emits one module per file. Browser projects use Vite, webpack or
  Next to bundle, as the demos do. Importing the standard library in a browser requires
  `--std-base` plus serving those module URLs (see the full-stack demo).
- **Advanced type limits.** Conditional and mapped types, generic/deferred indexed
  access, variadic tuples, readonly record fields, distributive conditionals over a naked
  type parameter, user-defined type predicates and function overloads are implemented.
  Arbitrary intersections of unions/functions, optional tuple elements and general
  TypeScript-style conditional inference remain absent. Readonly is a compile-time
  assignment check, not runtime immutability. Deferred constructs remain permissive until
  instantiated, and deeply nested deferred combinations may not diagnose early.
- **Concurrency is cooperative.** `std/task` provides task groups, cancellation, timeouts,
  channels and worker handles; it cannot stop JavaScript promises or host calls that
  ignore a cancellation signal. There is no compiler-level task syntax.
- **`render` blocks are not JSX.** Attributes are `with name: value`, children are
  statements, and dynamic child lists are built with `element` expressions. There are no
  fragments, context shorthand or automatic key inference.
- **Types are erased.** No runtime reflection beyond `is` checks on primitives, lists,
  maps and variant tags. `as` is unchecked at runtime.
- **No exceptions typing.** `catch` binds `any`; typed operational errors use
  `OperationResult`/`OperationFailure` instead.
- **Database support requires an installed driver.** `std/db` is SQLite via Node 22's
  `node:sqlite`. `std/db-postgres` and `std/db-mysql` expose the same schema-derived
  table/migration surface by dynamically loading application-installed `pg` or
  `mysql2/promise`; the compiler package keeps zero runtime dependencies. Their table
  methods return Promises, unlike SQLite's synchronous methods. MongoDB remains direct npm
  interop. No live PostgreSQL/MySQL server is available in this repository's test
  environment, so adapter tests use driver-shaped fakes. See
  [docs/DATABASES.md](docs/DATABASES.md). WebSocket extensions are not implemented;
  fragmentation, control-frame checks and an `authorize(request)` hook before the upgrade
  handshake are.
- **Debugging is adapter-based.** `plainscript dap` is a minimal Debug Adapter Protocol
  server that launches a compiled JavaScript entry through Node's inspector and maps source
  positions both ways. It requires Node 22's global `WebSocket` (or an inspector-capable
  host), and the VS Code integration is test-level rather than UI-automated. LSP rename and
  references follow imported PlainScript symbols; refactoring is still limited to symbol
  rename. See [docs/DEBUGGING.md](docs/DEBUGGING.md).
- **Identity-provider integration is application-tested.** `std/oidc` and `std/saml`
  provide validated service-provider plumbing over application-installed libraries, but
  the repository has no live IdP, conformance suite or browser SSO automation. Account
  linking, session storage, replay prevention and provider metadata remain application
  responsibilities. See [docs/SECURITY.md](docs/SECURITY.md).
- **TypeScript interop is a subset.** `plainscript interop` translates declarations with a
  direct PlainScript equivalent and reports unsupported constructs instead of emitting
  `any`. It is not an arbitrary `.d.ts` parser or a TypeScript-to-PlainScript compiler.
- **Benchmarks are PlainScript-only.** `npm run bench` is reproducible, but no pinned
  TypeScript toolchain is installed, so no cross-language speed claim is made.
- **Not published yet.** npm still serves 1.1.5. Publishing 2.0.0 is a separate, explicit
  release step.

## Contributing

See [CONTRIBUTION.md](CONTRIBUTION.md). Architectural decisions and their reasoning are
recorded in [docs/DECISIONS.md](docs/DECISIONS.md); the v1 audit that motivated the
rebuild is in [docs/AUDIT.md](docs/AUDIT.md).

## License

MIT. PlainScript was created by Ayodele Ayokunle David.
