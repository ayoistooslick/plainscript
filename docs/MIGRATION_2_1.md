<!-- compile-examples -->

# Migrating from PlainScript 2.0 to 2.1

2.1 is additive. Every 2.0 file compiles unchanged, and a project can move one
file at a time. Nothing in this guide is required to keep shipping on 2.0.

The migration has two steps: add the pragma, then let the compiler rename.

## 1. Add the pragma

Put `#syntax 2.1` on the first line of a file:

```plainscript
#syntax 2.1

import { print } from "std/io"

print("this file is now 2.1")
```

The pragma is a comment to every other tool, so editors, Git and the formatter
keep working unchanged.

## 2. Rename what the compiler reports

In a 2.1 file the 2.0 declarations are rejected with `PS2030`, and the message
names the 2.1 word. The full mapping:

| 2.0 | 2.1 | Notes |
| --- | --- | --- |
| `const x = 1` | `value x is 1` | Immutable. `val x is 1` is an accepted alias. |
| `let x = 1` | `set x to 1` | Mutable. |
| `x = 2` | `change x to 2` | Works for names, members and indexes. |
| `x += 1` | `change x to x + 1` | `+=` still parses in expressions; `change` is the documented 2.1 form. |
| `function f() -> T` | `define f() returns T` | `->` remains the arrow in function types. |
| `async function f()` | `async define f()` | |
| `if` | `when` | |
| `else if` | `otherwise when` | |
| `else` | `otherwise` | Also the fallback arm of `match`. |
| `for x in xs` | `for each x in xs` | `for each` is required in 2.1. |
| `for i in 0 to 9` | `for i from 0 to 9` | The range stays inclusive. |
| `a == b` | `a is equal to b` | Symbols still work; phrases are the documented form. |
| `a != b` | `a is not equal to b` | |
| `a > b` | `a is greater than b` | |
| `a < b` | `a is less than b` | |
| `a >= b` | `a is at least b` | |
| `a <= b` | `a is at most b` | |

Unchanged in 2.1: `match`, `case`, `while`, `break`, `continue`, `try`, `catch`,
`finally`, `throw`, `return`, `let`-free expressions, `type`, `declare`,
`import`, `export`, `async`, `await`, `and`, `or`, `not`, `is` (type test), `as`,
`render`, `element`, and all arithmetic operators.

`value`, `val`, `set`, `change`, `define`, `returns` and `each` are contextual, so
they remain usable as identifiers. `when` and `otherwise` are reserved in both
dialects.

## 3. Opt whole projects in

A pragma in every file is tedious for a new project. Set the default once in
`plainscript.config.json`:

```json
{
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "syntax": "2.1"
  }
}
```

Files without a pragma then compile as 2.1, including imported modules.
Migrate incrementally by putting `#syntax 2.0` at the top of the files you have
not converted yet, or pass `--syntax=2.1` for a one-off build. Precedence is:
file pragma, `--syntax`, the configuration file, then 2.0.

The language server and `plainscript fmt` read the same setting, so editor
diagnostics and formatting agree with the build.

## 4. Watch for these edge cases

- **`returns` is only a declaration keyword.** Function types still use `->`:
  `(number) -> number`.
- **`for each` is a single loop shape.** `for x in xs` is a 2.1 syntax error
  (`PS2014`), which prevents two spellings for the same loop. The one exception
  is a loop variable literally named `each`: `for each in xs` is a foreach loop
  binding `each`, because `each` stays a legal identifier.
- **`otherwise` closes `match`.** A `match` with an `otherwise` arm does not need
  a wildcard `case`.
- **Phrases are operators, not keywords.** They have the same precedence as the
  symbol they replace. `not` still binds tighter than a comparison, so write
  `not (a is greater than b)` when you mean the negation.
- **Errors point at the 2.1 word.** A `PS2030` includes the replacement in the
  message.

## 5. Mixed projects

Dialects are per file and the AST is shared, so migration does not require a
big-bang change:

- A 2.0 entry module can import a 2.1 module.
- A 2.1 module can import a 2.0 module and call its functions and use its types.
- `plainscript build`, `check`, `watch`, `fmt`, `lsp` and `dap` handle both in
  one project.

## 6. Format and check

```bash
plainscript fmt src          # keeps the pragma and formats 2.1 blocks
plainscript check src        # reports every remaining 2.0 word in 2.1 files
npm test                     # compiler, runtime and integration suites
```

The formatter understands `define`, `when` and `otherwise`, keeps them on their
source lines, and never rewrites tokens.

## 7. A converted file

The 2.0 program:

```plainscript
#syntax 2.0

import { print } from "std/io"

function label(done: boolean) -> text
    if done
        return "done"
    else
        return "open"
    end
end

let count = 0
for item in [1, 2, 3]
    count = count + item
end

print(label(count >= 6))
print(count)
```

and its 2.1 equivalent:

```plainscript
#syntax 2.1

import { print } from "std/io"

define label(done: boolean) returns text
    when done
        return "done"
    otherwise
        return "open"
    end
end

set count to 0
for each item in [1, 2, 3]
    change count to count + item
end

print(label(count is at least 6))
print(count)
```

Both programs print `done` then `6`.

## 8. Checklist

1. Add `#syntax 2.1` to a leaf module.
2. Run `plainscript check` and rename what `PS2030` reports.
3. Run the module's tests.
4. Repeat outward through the import graph.
5. Optionally remove the symbols in favour of phrases for consistency, or keep
   symbols where they read better; both are accepted.

If a file needs more time, remove its pragma: the file returns to 2.0 semantics
with no other change.
