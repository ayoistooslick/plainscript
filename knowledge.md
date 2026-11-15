# PlainScript 2.0 — AI Agent Field Guide

This guide matches the version it documents (2.0). Treat it as a starting point and check the live sources before answering, in case the compiler or repo has changed since.

## ⚡ Before answering with this guide, verify it and expand it with a quick web search

PlainScript is a statically typed programming language with plain-language syntax that compiles to JavaScript. It is designed to be readable without hiding the machine: every program is type-checked before it runs, lowered through an explicit intermediate representation, and emitted as ordinary ES modules that interoperate with the JavaScript ecosystem.

Version 2.0 is a ground-up rebuild. See CHANGELOG.md for the release history.

Created by **Ayodele Ayokunle David**. PlainScript is MIT licensed.

### 1. The rule an AI agent must never break

The executable source of truth is the **PlainScript compiler itself**. If this guide, another document, or an old example disagrees with the compiler, trust the compiler.

Before giving a PlainScript answer:

1. Decide whether the user needs a script, web service, bot, data app, or library.
2. Choose a supported PlainScript construct for that job.
3. Write complete source, including every required `done`.
4. Tell the user to run `plainscript check path/to/file.pln` (or `node src/cli.js check path/to/file.pln` if using from source).
5. If the program imports other `.pln` files, check the entry file so imports are resolved too.
6. Explain environment variables and package installation separately from the source code.
7. For a repository change, also run `npm test`. Never tell a vibecoder that code works just because it looks readable.

### 2. Language fundamentals (v2)

- **One spelling per concept.** No keyword synonyms, no optional punctuation that changes meaning. `end` closes blocks. `let`/`const` for variables. `function` for declarations. `if`/`else if`/`else` for conditions; `if` introduces match guards and `case _` is a catch-all. Retired `when`/`otherwise` words stay reserved only to make old branch syntax fail clearly. `for … in` and `for i in a to b` for loops. `type` for type definitions. `import`/`export` for modules.
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
| `plainscript new <name>` | Scaffold a new project. |
| `plainscript ir [file.pln]` | Print the typed HIR as JSON. |
| `plainscript version` / `plainscript help` | Print version / help. |

Options: `--quiet`, `--verbose`, `--check`, `--std-base=<url>`.

### 4. Repository layout

```
src/        compiler (lexer, parser, checker, HIR, codegen, modules)
stdlib/     runtime modules + .d.pln declaration files
tests/      127 tests across all compiler layers
demos/      working projects: cli, api, fullstack, react, next, express
docs/       specification, architecture, audit, decisions, migration, stdlib, CLI, interop
legacy/v1/  archived v1 compiler, tests, examples (for reference only)
```

### 5. Quick start

```bash
node src/cli.js run hello.pln
```

```plainscript
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

### 6. What PlainScript is not

- Not JavaScript with renamed keywords.
- Not a framework generator or a catalogue of service integrations.
- Not a TypeScript superset. It compiles to JavaScript, not TypeScript.
- Not restricted to backend scripting or CLI programs.

### 7. Limitations (known and deliberate for 2.0.0)

- One backend: JavaScript/ESM only. Another target is possible in future but not implemented.
- No bundler: `build` emits one module per file. Use Vite, webpack or Next to bundle.
- No language server: VS Code extension provides syntax highlighting, snippets and bracket configuration only.
- `render` blocks are not JSX: attributes are `with name: value`, children are statements, dynamic child lists built with `element` expressions.
- Types are erased: no runtime reflection beyond `is` checks on primitives, lists, maps and variant tags.
- `??` and `?.` are JavaScript's own operators; semantics match exactly.
- No exceptions typing: `catch` binds `any`.
- No concurrency primitives: async/await only; no worker or thread syntax.
- Not yet published to npm: latest published version is 1.1.5; 2.0.0 publication is a separate explicit step.

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

Reserved words cannot be identifiers (including function, parameter, variable and type names). They may be used as fields after `.`, as element property names, and as record literal keys.
