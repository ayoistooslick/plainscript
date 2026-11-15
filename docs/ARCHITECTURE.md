# Compiler architecture

PlainScript 2.0 is a single-pass-per-stage compiler with an explicit typed IR between
checking and emission. There are no runtime dependencies, and the emitted code has no
PlainScript runtime.

```
 .pln source
      │
      ▼
 ┌─────────┐   tokens (text, templates, punctuation, keywords)
 │ lexer   │   src/lexer.js
 └─────────┘
      │
      ▼
 ┌─────────┐   AST with spans on every node
 │ parser  │   src/parser.js
 └─────────┘
      │
      ▼
 ┌─────────┐   diagnostics + export tables + inferred signatures
 │ checker │   src/checker.js  (types in src/types.js)
 └─────────┘
      │
      ▼
 ┌─────────┐   typed HIR: desugared templates, pipes, patterns, elements
 │ lowering│   src/hir.js
 └─────────┘
      │
      ▼
 ┌─────────┐   ES module text + source map
 │ emitter │   src/codegen.js, src/sourcemap.js
 └─────────┘
```

`src/modules.js` owns the module graph: resolution, cycle detection, std declarations,
per-module compilation and output writing. `src/cli.js` is a thin front end over it.
`src/index.js` is the programmatic API.

## Layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| Language core | `docs/SPEC.md` | Syntax and semantics, independent of JavaScript. |
| Compiler | `src/lexer.js`, `parser.js`, `checker.js`, `types.js`, `hir.js`, `codegen.js`, `modules.js`, `diagnostics.js`, `sourcemap.js` | Accepts only specified programs and emits equivalent modules. |
| Runtime interface | `stdlib/*.js` | Ordinary JavaScript modules the emitted code imports. No global runtime, no class hierarchy, no reflection. |
| Standard library | `stdlib/*.js` + `stdlib/*.d.pln` | Fundamentals only. |
| Packages | user projects | Everything service-, vendor- or framework-specific. |

The 2.0 compiler does **not** contain a bundler, a dependency detector, an LSP server or
service helpers. Those are separate tools (Vite/webpack/Next for bundling), future work
(LSP) or packages.

## Lexer

- Produces `{t, v, line, col}` tokens: `ident`, `kw`, `number`, `text`, `template`,
  `punct`, `eof`.
- Text literals are split into interpolation parts at lex time; the parser receives
  `{text}` and `{exprTokens}` segments, so `"a {b} c"` is one `template` token.
- Triple-quoted and raw single-quoted literals are distinct token forms.
- Comments are dropped but lines are preserved for diagnostics.
- Lexical errors are `PS1001`–`PS1004`; the lexer reports and recovers at the line end.

## Parser

Recursive descent with one token of lookahead, plus targeted backtracking for lambdas and
generic parameter lists (`tryLambda`, `tryTypeParameters`). Design points:

- Blocks are keyword-delimited (`end`), so newlines are insignificant. This removes
  automatic-semicolon-insertion ambiguity entirely.
- `return` requires an expression, removing the only place where a newline would otherwise
  change meaning.
- Every node carries `line` and `col`; diagnostics use them for code frames.
- Reserved words cannot be identifiers, but are accepted as property names after `.`, as
  element attributes and as record keys.
- `element` is parsed in both statement and expression position; `render` is a statement.

The parser never infers types and never emits code.

## Type checker

`src/checker.js` runs after parsing and before lowering. It:

1. Collects type declarations, resolving aliases and variant constructors (`collectTypes`,
   `resolveAllTypes`).
2. Hoists imports, functions, `declare`d values and exported type names (`hoist`,
   `hoistFunctions`).
3. Checks statements with a lexical scope chain, inferring expression types
   (`typeOf`) and reporting diagnostics.
4. Applies narrowing facts derived from conditions (`narrowFacts`, `applyFacts`).
5. Verifies match exhaustiveness and unreachable cases.
6. Verifies return coverage and declared return types.
7. Publishes an export table (`values` and `types`) for importers, plus inferred function
   signatures and the set of type-only imports used to erase runtime imports.

Types live in `src/types.js`: `prim`, `list`, `map`, `promise`, `record`, `variant`,
`unit`, `fn`, `union`, `var`, `named`, plus `assignable`, `infer`, `substitute`,
`deref`, `showType`. Named aliases are registered per checker instance so diagnostics keep
the author's names.

The checker is the only enforcer of types. It is therefore required to be complete for the
constructs it accepts: when a construct's types cannot be checked, that is a compiler bug,
not a runtime concern.

## Typed HIR

`src/hir.js` lowers the AST into a smaller language the emitter can assume:

- `VarDecl` with real patterns, function declarations with resolved parameter metadata.
- Templates become concatenation; pipes become calls; `??`/`?.` stay as operators.
- Variant construction and unit variants become objects/strings (`$kind`).
- Match becomes a lowered decision structure with bindings.
- `render`/`element` become `createElement(tag, props, ...children)` calls at the correct
  scope.
- Casts disappear; `is` tests become inline runtime checks.
- Type-only imports disappear.
- Names that collide with JavaScript reserved words are escaped with a `$` prefix
  (`jsName`), so a PlainScript `default` or `new` parameter is legal and emitted safely.

The HIR is inspectable with `plainscript ir file.pln` and is what a future backend would
consume. It is deliberately not JavaScript: it has no statements for imports of types, no
templates, no patterns and no render forms.

## Emitter

`src/codegen.js` walks the HIR and prints ES modules.

- Statements map to JavaScript statements; `match` lowers to a labelled block with ordered
  branch tests and `break`.
- `is` lowers to `typeof`, `Array.isArray`, object tests or `$kind` comparisons.
- Every emitted statement records a mapping, and `src/sourcemap.js` encodes a v3 source
  map. Output files end with `//# sourceMappingURL=<name>.js.map`.
- The emitter contains no type information; it cannot introduce a runtime type check that
  the language does not specify.

## Module graph

`src/modules.js`:

- Resolves `std/<name>` to bundled declarations and runtime files, relative `.pln` files to
  their sources, and bare specifiers to the JavaScript runtime.
- Detects import cycles (`PS4001`) and unresolved modules (`PS4002`) before emitting.
- Compiles the whole graph before writing anything, so a failed build leaves no partial
  output.
- Rewrites relative specifiers from `.pln` to `.js`, and emits `std/…` either as
  `plainscript-lang/std/…` or as a URL base when `--std-base` is set for browser builds.
- Writes a `package.json` with `"type": "module"` into the output directory when the
  surrounding project is not already ESM.

## Standard library interface

Each module is a hand-written JavaScript file plus a `.d.pln` declaration file that the
checker parses like any other PlainScript module. This keeps runtime and types in one
reviewable place, with no build step and no `.d.ts` tooling, and it means a standard
library signature bug is a compiler-visible bug rather than a documentation problem.

## Diagnostics

`src/diagnostics.js` defines `CompileError` and the reporting helpers. Diagnostics carry a
stable code, message, file, line, column and optional source excerpt. The CLI prints code
frames, counts errors and exits non-zero. Warnings do not exist as a category; anything
worth reporting is an error, and everything reported is fixed before emission.

## Testing strategy

| File | Layer |
| --- | --- |
| `tests/lexer.test.js` | tokens, interpolation, escapes, errors |
| `tests/parser.test.js` | grammar, precedence, spans, parse errors |
| `tests/checker.test.js` | inference, assignability, narrowing, exhaustiveness, returns |
| `tests/compiler.test.js` | HIR, codegen, source maps, modules, std rewriting |
| `tests/runtime.test.js` | executed programs, async, errors, stdlib behaviour |
| `tests/cli.test.js` | run/build/check/fmt/test/new, exit codes, files written |
| `tests/interop.test.js` | npm packages, Node builtins, ambient declarations, JS consumers |
| `tests/formatter.test.js` | idempotence, token preservation, invalid input |
| `tests/package.test.js` | package metadata and exports |

Tests use `tests/helpers.js` to compile into sandboxed directories under
`.plainscript/tests/`, so std resolution and module rewriting are exercised exactly as in a
real project.

## Extension points

- **A second backend**: implement an emitter over the HIR; the checker and lowering are
  target-independent.
- **Editor tooling**: the checker's export tables and diagnostics are already structured
  data; an LSP would call `Compiler.compile` per document and translate diagnostics.
- **Standard library growth**: add `stdlib/x.js` + `stdlib/x.d.pln`; no compiler change is
  needed unless the module needs a new host capability.
