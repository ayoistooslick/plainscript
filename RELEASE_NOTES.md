# PlainScript 2.1.0 — release notes

PlainScript 2.1 adds an English-oriented dialect that reads like structured
prose, without changing the language underneath. It is opt-in per file, so every
2.0 program keeps compiling and running exactly as before.

## Highlights

- **`#syntax 2.1`** on the first line selects the new surface. `value x is 1`
  binds immutably, `set x to 1` mutably, and `change x to 2` assigns.
- **Declarations and branches read aloud.** `define greet(name: text) returns
  text`, `when`/`otherwise when`/`otherwise`, `for each item in items`,
  `for i from 0 to 9`, and `otherwise` as the fallback arm of `match`.
- **Comparison phrases.** `is equal to`, `is not equal to`, `is greater than`,
  `is less than`, `is at least`, `is at most`, with exactly the precedence and
  code generation of the symbolic operators.
- **One spelling per concept.** A literal `let`, `const`, `function`, `if`,
  `else` or `for x in xs` inside a 2.1 file is a compile error whose message
  names the 2.1 construct. `#syntax 2.0` remains the default.
- **Contextual, not reserved.** `value`, `set`, `change`, `define`, `returns`
  and `each` still work as ordinary identifiers. `for each in names` binds a
  loop variable named `each`; a binding pattern after the word is what makes it
  a foreach marker.
- **Project-wide opt-in.** `compilerOptions.syntax: "2.1"` in
  `plainscript.config.json` makes 2.1 the default for every file without a
  pragma, and `--syntax` overrides it per command. A file pragma still wins, so
  migration can be incremental.
- **Interoperable dialects.** 2.0 and 2.1 modules share types, values and the
  same compiler pipeline. Normalisation happens before parsing; the checker, HIR
  and JavaScript emitter are unchanged.

## Verified integrations

Eight real projects live in `integrations/`, each written in 2.1, including a typed CLI,
a three-module program and a full-stack Express + SQLite + React application:

| Project | Verification |
| --- | --- |
| Express 5 API | Real HTTP create/read/update/delete session in `npm test` |
| React 19 component | Rendered through `react-dom/server` in `npm test`; Vite production bundle verified |
| Next.js 15 App Router | `next build` succeeds and the page is prerendered with the component's markup |
| `std/http` server + client | Async requests against a live local server in `npm test` |
| SQLite (`node:sqlite`) | Prepared inserts, queries, aggregate and rollback in `npm test` |
| CLI application | Argument parsing, JSON persistence and 0/1/2 exit codes in `npm test` |
| Multi-module program | Three modules, cross-module types, `build --declarations` in `npm test` |
| Full-stack app | Express + SQLite CRUD, restart persistence and React SSR in `npm test` |

Run them:

```bash
npm test
npm run verify:integrations
```

## Documentation

`README.md` is rewritten around the 2.1 dialect. New guides:

- `docs/GETTING_STARTED.md`
- `docs/LANGUAGE_REFERENCE.md` (the complete 2.1 surface, with 2.0 equivalents)
- `docs/COMPILER.md` (pipeline and dialect resolution)
- `docs/INTEGRATIONS.md`
- `docs/MIGRATION_2_1.md`

`docs/SPEC.md` gains section 15, the formal 2.1 grammar and coherence rules.
Every PlainScript example in the compile-tested documents is compiled by the
test suite, and the documentation site builds with the new pages.

## Upgrade path

2.1 is not a breaking release. Nothing changes until a file adds the pragma.
To adopt it, add `#syntax 2.1` to a module and rename what `PS2030` reports;
`docs/MIGRATION_2_1.md` lists the complete mapping. A file that needs more time
can drop the pragma and return to 2.0 semantics.

The npm package is not published by these release notes. Publishing is a
separate, explicit release action; check the registry for the actual published
version.
