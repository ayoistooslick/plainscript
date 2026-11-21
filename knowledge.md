# PlainScript 2.1 — AI Agent Field Guide

This guide matches the version it documents (2.1). Treat it as a starting point and check the live sources before answering, in case the compiler or repo has changed since.

## ⚡ Before answering with this guide, verify it and expand it with a quick web search

PlainScript is a statically typed programming language with plain-language syntax that compiles to JavaScript. It is designed to be readable without hiding the machine: every program is type-checked before it runs, lowered through an explicit intermediate representation, and emitted as ordinary ES modules that interoperate with the JavaScript ecosystem.

Version 2.1 adds an English-oriented dialect that is opted into per file with `#syntax 2.1`. Version 2.0 remains the default and every 2.0 program still compiles. See CHANGELOG.md and docs/LANGUAGE_REFERENCE.md.

Created by **Ayodele Ayokunle David**. PlainScript is MIT licensed.

### 1. The rule an AI agent must never break

The executable source of truth is the **PlainScript compiler itself**. If this guide, another document, or an old example disagrees with the compiler, trust the compiler.

Before giving a PlainScript answer:

1. Decide whether the user needs a script, web service, bot, data app, or library.
2. Choose a supported PlainScript construct for that job.
3. Write complete source, including every required `end`.
4. Tell the user to run `plainscript check path/to/file.pln` (or `node src/cli.js check path/to/file.pln` if using from source).
5. If the program imports other `.pln` files, check the entry file so imports are resolved too.
6. Explain environment variables and package installation separately from the source code.
7. For a repository change, also run `npm test`. Never tell a vibecoder that code works just because it looks readable.

### 2. Language fundamentals

- **Two dialects, one AST.** A file starts with `#syntax 2.1` to use the English-oriented surface; otherwise it is 2.0. Both produce the same syntax tree and can import one another. 2.1 is the primary presentation in the docs; 2.0 is fully supported.
- **2.1 syntax.** `value x is 1` (immutable), `set x to 1` (mutable), `change x to 2` (assign), `define f() returns T`, `when` / `otherwise when` / `otherwise`, `for each x in xs`, `for i from 0 to 9`, `otherwise` as a `match` fallback, and comparison phrases (`is equal to`, `is not equal to`, `is greater than`, `is less than`, `is at least`, `is at most`).
- **2.0 syntax.** `const`/`let`, `function f() -> T`, `if`/`else if`/`else`, `for x in xs`, `for i in a to b`. `end` closes blocks in both dialects. In 2.1, the 2.0 declaration words are rejected with `PS2030` and the replacement in the message.
- **Contextual words.** `value`, `set`, `change`, `define`, `returns` and `each` are not reserved; they remain valid identifiers. `for each in xs` binds a loop variable named `each`; `each` is a foreach marker only when a binding pattern follows it. `when` and `otherwise` are reserved in both dialects.
- **Project dialect.** `compilerOptions.syntax` (or a top-level `syntax`) in `plainscript.config.json`, or `--syntax=<v>`, sets the default dialect; a file pragma overrides it. `plainscript new` writes a 2.1 configuration.
- `type` for type definitions, `import`/`export` for modules, `case _` or `otherwise` for catch-all match arms.
- **Statically typed with inference.** Function signatures are checked, not assumed. Generics, unions, narrowing, structural records, variants, and `nothing` safety are enforced by the compiler.
- **JavaScript interop.** React, Next.js, Node, Express, Vite, browser APIs — all work because the compiler emits plain ES modules. Types at the boundary are `any` deliberately.
- **Standard library.** 11 focused modules: `std/io`, `std/text`, `std/list`, `std/map`, `std/math`, `std/json`, `std/time`, `std/fs`, `std/http`, `std/test`, `std/dom`. No built-in integrations for Stripe, Telegram, Supabase, MongoDB, OpenAI, or individual cloud services.
- **Blocks close with `end`.** No conversational English syntax. `return` always takes a value. `return nothing` for early exit.
- **`render`/`element` blocks** lower to `createElement` calls from the module scope. Import React (or another library) — no JSX transform, no custom runtime.
- **Async:** `async function`, `await`. Declared return type is the resolved value. Top-level `await` allowed.

### 3. CLI commands

| Command | Purpose |
| --- | --- |
| `plainscript run [file.pln]` | Compile and execute a program. |
| `plainscript build [files…]` | Type-check and emit ES modules into `dist/`. |
| `plainscript check [files…]` | Type-check only; exits non-zero on diagnostics. |
| `plainscript fmt [files…]` | Normalise indentation and block layout. |
| `plainscript test [files…]` | Run `*.test.pln` files. |
| `plainscript watch [files…]` | Rebuild on change. |
| `plainscript new <name>` | Scaffold a new 2.1 project. |
| `plainscript lsp` / `plainscript dap` | Language server / debug adapter over stdio. |
| `plainscript migrate [paths…]` | Report JavaScript/TypeScript migration blockers. |
| `plainscript interop [files…]` | Translate the supported `.d.ts` subset to `.d.pln`. |
| `plainscript ir [file.pln]` | Print the typed HIR as JSON. |
| `plainscript version` / `plainscript help` | Print version / help. |

Options: `--quiet`, `--verbose`, `--check`, `--std-base=<url>`.

### 4. Repository layout

```
src/            compiler (lexer, dialect, parser, checker, HIR, codegen, modules, CLI, LSP, DAP)
stdlib/          runtime modules + .d.pln declaration files
integrations/    Express, React+Vite, Next.js, HTTP and SQLite projects in PlainScript 2.1
tests/           340+ tests across compiler layers, docs examples and integrations
demos/           larger sample applications
docs/            guides, reference, specification and generated documentation site
legacy/v1/       archived v1 compiler, tests, examples (for reference only)
```

### 5. Quick start

```bash
node src/cli.js run hello.pln
```

```plainscript
#syntax 2.1

import { print } from "std/io"

define greet(name: text) returns text
    return "Hello, {name}!"
end

print(greet("world"))
```

```bash
$ node src/cli.js run hello.pln
Hello, world!
```

### 6. What PlainScript is not

- Not JavaScript with renamed keywords.
- Not a framework generator or a catalogue of service integrations.
- Not a TypeScript superset. It compiles to JavaScript, not TypeScript.
- Not restricted to backend scripting or CLI programs.

### 7. Limitations (known and deliberate for 2.1.0)

- One backend: JavaScript/ESM only. Another target is possible in future but not implemented.
- No bundler: `build` emits one module per file. Use Vite, webpack or Next to bundle.
- Language tooling: `plainscript lsp` provides diagnostics, completion, hover, navigation, rename, symbols, formatting, semantic tokens and quick fixes; the VS Code debugger uses `plainscript dap`. The extension is test-level, not UI-automated.
- `render` blocks are not JSX: attributes are `with name: value`, children are statements, and loops/branches inside a render block build dynamic child lists. `element Fragment` gives a fragment; keys are explicit (`with key: …`), never inferred.
- Types are erased: no runtime reflection beyond `is` checks on primitives, lists, maps and variant tags.
- `??` and `?.` are JavaScript's own operators; semantics match exactly.
- No exceptions typing: `catch` binds `any`. Promise `then`/`catch`/`finally` are typed, but a rejection reason is always `any`.
- Concurrency is cooperative: `std/task` adds groups, cancellation, timeouts, channels and worker handles; there is no compiler-level task syntax.
- Not yet published: the npm registry serves 2.0.0; publishing 2.1.0 is a separate explicit step.
- Integrations: eight projects under `integrations/` are compiled and executed by `npm test` (Express, React SSR, SQLite, HTTP, CLI, multi-module, full-stack); the Vite and Next production builds need their own installs and run through `npm run verify:integrations`, which CI does not run by default.

## 8. Migration from v1 to v2

- All v1 keyword aliases are removed. Use the one correct spelling.
- `done`/`end`/`together` → `end` only.
- `show`/`print`/`display`/`log` → `print` from `std/io`.
- Service constructs (SQL, WhatsApp, OCR, Telegram, sessions/OAuth) are removed; use packages instead.
- Type checker is now enforcing; previously accepted programs may now reject.
- `std/text.format` removed: use `"{expr}"` interpolation instead.
- Module resolution changed: `std/<name>` resolves to bundled declarations; relative imports use `.js` extension.

### Where to find the full specification

- `docs/SPEC.md` — complete language specification
- `docs/DECISIONS.md` — architectural decisions and their reasoning
- `docs/AUDIT.md` — audit of v1 that motivated the rebuild
- `docs/MIGRATION.md` — migration guide from v1 to v2

### 9. Quick reference: reserved words

```
and        as         async      await      break      case       catch
const      continue   declare    do         element    else       end
export     false      finally    for        from       function   if
import     in         is         let        match      new        nothing
not        or         otherwise  render     return     throw      to
true       try        type       when       while      with
```

The 2.1 declaration words `value`, `set`, `change`, `define`, `returns` and `each` are
contextual, not reserved: they introduce a construct only in statement position and remain
valid identifiers elsewhere.

Reserved words cannot be identifiers (including function, parameter, variable and type names). They may be used as fields after `.`, as element property names, and as record literal keys.
