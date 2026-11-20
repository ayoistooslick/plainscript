<!-- compile-examples -->

# The PlainScript compiler

The compiler turns a `.pln` module graph into JavaScript ES modules. It has six
stages, each with its own diagnostics and tests:

```
source
  → lexer        tokens, comments, dialect normalisation
  → parser       abstract syntax tree
  → modules      import/export graph, std and npm resolution
  → checker      types, scopes, exhaustiveness, contracts
  → HIR          typed intermediate representation
  → codegen      JavaScript + source map
```

## 1. Dialect resolution

Dialect detection happens before lexing. `src/dialect.js` reads the first line:

- `#syntax 2.1` selects the 2.1 dialect.
- `#syntax 2.0` selects 2.0.
- A file without a pragma uses the project default from `plainscript.config.json`; with no
  default configured, it is 2.0.
- An unknown version produces `PS1005` and the file is not compiled.

The lexer then applies the 2.1 normalisation to its token stream:

1. Comparison phrases (`is greater than`, `is at most`, …) become the
   corresponding operator token.
2. `when` and `otherwise` become `if` and `else`, tagged `alias: true` so the
   parser can still reject the literal 2.0 word.
3. Contextual words (`value`, `set`, `change`, `define`, `returns`, `each`) are
   left in place. The parser recognises them only in statement or declaration
   position, which is why they remain usable as identifiers.

The parser stores the dialect on every node it builds from a file and passes it
to interpolation tokenisation, so a phrase inside `"{a is at least b}"` is
resolved with the same rules.

Because normalisation happens before parsing, both dialects produce the same AST
node kinds and the checker, HIR and backend contain no dialect branches.

## 2. Lexer

`src/lexer.js` produces tokens for identifiers, keywords, numbers, text and
templates, punctuation, and end-of-file. Comments are kept separately so the
formatter can preserve them. Text interpolation is lexed as a nested expression
and re-tokenised with the file's dialect by the parser.

Lexical diagnostics use `PS1001`–`PS1005`.

## 3. Parser

`src/parser.js` is a recursive-descent parser with token lookahead. Newlines are
insignificant: statements are delimited by grammar and blocks close with `end`.
That is what makes `fmt` safe — formatting cannot change meaning.

The parser's statement entry point handles both dialects. In 2.1 it additionally
recognises:

- `value name is expression` and `set name to expression` as `VarDecl`.
- `change target to expression` as an `Assignment`.
- `define` in place of `function`, and `returns` in place of a declaration
  arrow.
- `for each … in …` and `for … from … to …`.

It reports `PS2030` when a literal 2.0 word (`let`, `const`, `function`, `if`,
`else`) appears in a 2.1 file, with the 2.1 word in the message and a hint that
points at the pragma.

## 4. Modules

`src/modules.js` builds the import graph:

- `std/<name>` resolves to the bundled runtime and `.d.pln` declarations.
- `./x` and `../x` resolve to sibling `.pln` files and are emitted as `.js`.
- Bare specifiers (`express`, `node:sqlite`) pass through to the JavaScript
  runtime.
- Modules are compiled as a graph; cycles are a compile error (`PS4001`).
- Type-only imports are erased. A module imported only for types emits no
  runtime import.

Dialects are independent per module: a 2.0 entry can import a 2.1 library.

## 5. Checker

`src/checker.js` is the enforcer. It performs flow-sensitive type checking with
inference, generics, unions, narrowing, structural records and variants,
exhaustiveness in `match`, optional-value safety, variance checks and
readonly-field assignment checks. Diagnostics use `PS3xxx`.

The checker never inspects the dialect: it sees the same nodes for both
surfaces. `PS2030` is a parser diagnostic, not a type error.

## 6. HIR and code generation

`src/hir.js` lowers the checked AST to a typed intermediate representation with
explicit temporaries. `src/codegen.js` emits ES modules and a source map. The
output contains:

- `import`/`export` statements, with relative `.js` specifiers.
- Plain functions, classes, `async`/`await`, `try`/`catch`.
- Pattern matches lowered to `if` checks and destructuring.
- `render`/`element` lowered to `createElement` calls.
- No runtime type checks beyond `is` on primitives, lists, maps and variant
  tags.

For example, this program:

```plainscript
#syntax 2.1

import { print } from "std/io"

define greet(name: text) returns text
    return "Hello, {name}!"
end

print(greet("world"))
```

emits a module shaped like:

```javascript
import { print } from ".../stdlib/io.js";

function greet(name) {
    return `Hello, ${name}!`;
}

print(greet("world"));
```

## 7. Configuration and output

`plainscript.config.json` names the source root and output directory:

```json
{
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "syntax": "2.1"
  }
}
```

`syntax` sets the project's default dialect for files that carry no pragma. It
may also be written as a top-level `syntax` key. A `#syntax 2.0` or `#syntax 2.1`
pragma inside a file always wins, so a 2.1 project can keep a legacy module, and
the compiler reports `PS1005` for an unsupported value instead of guessing.
Precedence is: file pragma, `--syntax` flag, the configuration file, then 2.0.

Each module is written as `<name>.js` with `<name>.js.map` beside it, plus a
`package.json` marking the output as ESM. Unchanged outputs are not rewritten.
`--declarations` also writes `<name>.d.pln` and wires `types`/`exports` in the
project manifest.

## 8. Diagnostics

| Range | Layer | Examples |
| --- | --- | --- |
| `PS1xxx` | lexical and dialect | unexpected character, bad escape, unknown dialect |
| `PS2xxx` | syntax | missing `end`, 2.0 word in a 2.1 file, bad loop header |
| `PS3xxx` | types | unbound name, type mismatch, non-exhaustive match |
| `PS4xxx` | modules | missing file, import cycle, missing export |
| `PS5xxx` | internal | unexpected compiler failure |
| `PS6xxx` | configuration and CLI | bad config, bad flag |

Every diagnostic has a stable code, a file/line/column span, and often a hint.
The formatter renders a caret against the source line, which is what the CLI and
the language server display.

## 9. Testing the compiler

```bash
npm test
```

The suite covers the lexer, both dialects, grammar matrix, type checker,
inference, narrowing, generics, variance, HIR, code generation, runtime
behaviour, module resolution, CLI, formatter, package contents, documentation
examples and real integration projects.

The documentation examples marked `<!-- compile-examples -->` are extracted and
compiled by `tests/docs-examples.test.js`, so a guide cannot drift from the
compiler.
