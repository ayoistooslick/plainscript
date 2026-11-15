# Audit of PlainScript 1.x

This audit was performed on the source archived at `legacy/v1/`, not on README claims.
Every number and quotation below comes from that tree.

## Method

- Read the lexer, parser, generator, type checker, module loader, CLI, formatter, source
  map writer, LSP server and the 36 test files.
- Ran the v1 suite before archiving: **427 tests passed**. The suite exercised the
  implementation as written, including its aliases and service constructs.
- Compared the published package metadata (`plainscript-lang`, `latest = 1.1.5`) with the
  repository's `package.json` and documentation.
- Checked what the documentation promised against what the compiler accepted.

## Size and shape

| File | Lines |
| --- | --- |
| `compiler/parser.js` | 5,263 |
| `compiler/generator.js` | 5,181 |
| `compiler/cli.js` | 1,298 |
| `compiler/type-checker.js` | 803 |
| `compiler/lexer.js` | 587 |
| `compiler/lsp.js` | 311 |
| `compiler/bundler.js` | 259 |
| `compiler/dependency-detector.js` | 199 |
| `compiler/formatter.js` | 193 |
| `compiler/sourcemap.js` | 142 |
| `compiler/ir.js` | 62 |
| **Total** | **14,304** |

Two files, the parser and the generator, held 73% of the compiler. The type checker was
6% of it. That ratio describes the project's real centre of gravity: accepting and
emitting many surface forms, rather than enforcing a language.

## What worked

- The compiler was real. It lexed, parsed and emitted runnable Node programs, and the test
  suite passed.
- Source maps were produced.
- Module resolution, async/await and a usable CLI existed.
- Code generation was direct and fast; there was no runtime library to load.
- Error reporting had file/line/column and code frames.

These are the parts worth keeping in spirit, and 2.0 re-implements them with a smaller,
stricter surface.

## What was wrong

### 1. Alias soup instead of a language

The lexer and parser accepted multiple spellings for the same construct. The parser's own
suggestion table begins:

```js
const STATEMENT_KEYWORDS = [
  'remember', 'show', 'display', 'log', 'if', 'make', 'intend', 'give',
  'for', 'while', 'repeat', 'until', 'use', 'import', 'when', 'listen', 'reply', 'serve',
  'web', 'route', 'start', 'database', 'query', 'insert', 'update', 'delete', 'execute',
  'ask', 'bot', 'ocr', 'try', 'recover', 'retry',
  ...
```

and the block/expression tables add `done`, `end`, `together`, `print`, `bring`,
`otherwise`, `else`, `above`, `below`, `at least`, `be`, `then` and more.

Consequences:

- Every construct had several correct spellings and no canonical one, so programs from
  different authors looked like different languages.
- `if`/`else` and `when`/`otherwise` coexisted; `done` and `end` closed blocks;
  `show`/`print`/`display`/`log` all printed.
- The parser spent thousands of lines on tolerant matching and recovery for these forms.
- "Did you mean?" suggestions were derived from a keyword table that was itself the source
  of the ambiguity.

### 2. Service integrations were part of the grammar

The parser's keyword set and the generator contained first-class syntax and runtime code
for specific services. Occurrences in `compiler/parser.js`:

```
39 SQL      17 whatsapp    14 session    14 Telegram    9 ocr    4 oauth    4 mongodb
```

The generator emitted helper implementations directly, for example
`__whatsappStart`, `__whatsappPair`, `__whatsappOnMessage`, `__whatsappReply`,
`__whatsappSend`, `__whatsappDownload`, plus SQL execution, sessions, OCR and OAuth
plumbing.

This is the "boilerplate language" failure mode: the language grew constructs for
individual vendors instead of primitives those vendors' packages could be written with.
It made the language impossible to specify, impossible to keep current, and useless to
anyone not using those exact services.

### 3. The IR was dead code

`compiler/ir.js` opens with:

> The current JavaScript backend still consumes the rich AST directly. This module
> establishes a serializable semantic boundary for tooling, diagnostics, contract
> analysis, and future backends without changing generated programs.

The IR was 62 lines, unused by the backend, and not covered by the "future backends" it
described. There was therefore no compiler middle end: parsing, checking and emission were
entangled in the generator's 5,181 lines.

### 4. Type checking was a surface check

`type-checker.js` was 803 lines and checked a "spec" layer: annotations were compared
where they were convenient, but there was no complete model of assignability, no generics
inference, no narrowing beyond simple cases, no exhaustiveness, and no guarantee that a
program the checker accepted would not fail at runtime on a type error. The generator did
not depend on checked types.

The practical result: the language *looked* typed and the type checker was advisory.

### 5. Documentation described a different project

The repository shipped `knowledge.md`, an agent guide pinning version `1.0.363`, plus
`RELEASE_NOTES.md` for 1.1.5, a changelog whose entries mixed compiler facts with
"completeness milestones", and README material for constructs that the grammar accepted
through aliases. The npm package's latest version (1.1.5) and the repository's
documentation drifted apart.

### 6. Tooling was coupled to internals that could not survive a rewrite

- The VS Code extension started `../compiler/lsp.js` from the source tree, so the packaged
  extension could not work outside a clone.
- CI ran `npm run release:check`, `npm run docs:check` and `node tests/packaging.test.js`,
  none of which exist in the tree, so the pipeline could not pass.
- A bundler and a dependency detector existed inside the compiler, mixing the language's
  job (emit modules) with a build tool's job (bundle them).

### 7. Test coverage measured the wrong thing

427 passing tests is not a small suite, but many asserted that aliases worked and that
service helpers were emitted. Passing tests therefore *locked in* the design problems
instead of protecting a specification. There was no test that the checker rejected an
untyped program, because the checker's contract was not that strong.

## Verdict

The v1 implementation was a working compiler for a language that had not been designed. It
optimised for accepting input and generating integrations. The parts worth keeping were
mechanical — lexing, parsing, emission, source maps, the CLI shape — not architectural.

Rebuilding was cheaper and more honest than patching:

- The surface had to shrink, not grow, so a breaking major release was required.
- The type system had to become the contract, which meant the backend had to consume
  checked types through a real IR.
- The standard library had to replace both the intrinsic keyword helpers and the vendors.

That is what 2.0 does. It keeps the ambition (a readable language that compiles to
JavaScript and works with the JavaScript ecosystem), and removes the parts that made the
language unspecifiable.

## Comparison

| Concern | v1 | v2 |
| --- | --- | --- |
| Keywords | dozens of synonyms, service verbs | 45 reserved words, one spelling each |
| Blocks | `done`/`end`/`together` | `end` |
| Types | advisory spec checker | assignability, inference, generics, narrowing, exhaustiveness |
| Middle end | unused 62-line IR | typed HIR consumed by the emitter |
| Services | grammar + generator code | not in the language; packages instead |
| Stdlib | intrinsic keywords and helpers | 11 explicit modules with `.d.pln` declarations |
| Output | AST-driven generator, optional bundler | ESM per file, source maps, no bundler |
| Tests | 427 assertions incl. aliases | 127 tests per compiler layer + built demos |
| Docs | mixed versions and claims | specification, audit, decisions, migration |
