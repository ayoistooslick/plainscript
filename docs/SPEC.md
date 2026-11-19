# The PlainScript 2.0 Language Specification

This document defines the language implemented by the compiler in `src/`. When this
document and the compiler disagree, the compiler is authoritative and the document is a
bug.

PlainScript is statically typed, expression-oriented where it helps readability, and
compiles to ECMAScript modules. Types exist at compile time only; they are erased from the
output except for the small runtime checks described in [Runtime semantics](#13-runtime-semantics).

---

## 1. Design rules

1. **One spelling per concept.** No keyword synonyms, no optional punctuation that changes
   meaning, no silent coercions beyond JavaScript's own.
2. **Readable, not conversational.** Programs read as structured prose, but `if`, `then`,
   `do` and `end` are not English sentences and are not treated as such.
3. **The compiler enforces the language.** If the checker accepts a program, the emitter
   produces code with the same meaning. Nothing relies on a runtime type library.
4. **JavaScript is the platform, not the definition.** Semantics are defined here, then
   realised on the JavaScript runtime that PlainScript targets. Where a JavaScript detail
   leaks (numbers are IEEE-754 doubles, object identity, `Promise`), it is stated.
5. **Interop is a boundary, not a hole.** Values crossing into untyped JavaScript become
   `any` explicitly. Nothing else is implicitly `any`.

---

## 2. Lexical structure

### 2.1 Source files

- Files use the extension `.pln` and are UTF-8.
- A program is a sequence of declarations and statements. Newlines are insignificant
  except inside text literals; statement boundaries are determined by the grammar and by
  block keywords.
- Indentation carries no meaning to the compiler. `plainscript fmt` normalises it for
  readers.

### 2.2 Comments

```plainscript
# A line comment runs to the end of the line.
```

There are no block comments. Documentation comments are ordinary comments; the compiler
does not extract them.

### 2.3 Identifiers

An identifier starts with a letter or `_` and continues with letters, digits or `_`.
Unicode letters are accepted. Identifiers are case-sensitive. Keywords (section 14) are
not identifiers.

### 2.4 Numbers

Decimal integers and fractions: `0`, `42`, `3.5`, `1e9`, `2.5e-3`. Numeric literals are
IEEE-754 doubles, as in JavaScript. There is no separate integer type and no bigint
literal.

### 2.5 Text

Three forms:

```plainscript
"double quoted, with {interpolation} and \"escapes\""
'single quoted, raw: {braces} and \n are literal'
"""triple quoted,
   spanning lines,
   no interpolation"""
```

- `"…"` supports `{expression}` interpolation and the escapes `\"`, `\\`, `\n`, `\t`, `\r`.
  A literal `{` is written `\{`.
- `'…'` is raw: no interpolation, no escapes. It cannot contain a single quote.
- `"""…"""` is multiline and raw. It cannot contain `"""`.

Interpolation embeds any expression: `"total: {sum(values)}"`. The expression is lowered
to string concatenation, so its runtime value uses JavaScript's string conversion rules.

### 2.6 Punctuation

```
( ) [ ] { } , : . ?. ?? |> ... -> => = == != < <= > >= + - * / % += -= *= /= %= is as
```

`#` starts a comment. `...` is spread/rest. `->` introduces a return type. `=>` forms a
lambda.

---

## 3. Programs and modules

Every `.pln` file is a module. Modules are ECMAScript modules: the emitted file has one
`import`/`export` surface and is loaded by the host (Node, a bundler, a browser).

```plainscript
import { print } from "std/io"
import express from "express"
import * as path from "node:path"
import "./side-effect.pln"
```

- `std/<name>` resolves to the bundled standard library.
- `./x` and `../x` resolve to sibling `.pln` files; the specifier is emitted with `.js`.
- Bare specifiers (`express`) are passed through to the JavaScript runtime unchanged.
- Modules are compiled as a graph. Circular imports are a compile error (`PS4001`), not a
  partially initialised runtime module.
- A module that imports a name that is not exported is an error (`PS3205`).
- Imports of **types only** are erased from the output; a module imported solely for its
  types produces no runtime import.

Exports:

```plainscript
export const answer = 42
export function greet(name: text) -> text ... end
export type Person ... end
export { localName as publicName }
export { thing } from "./other"
export default main
export default function handler(request: any) -> any ... end
export default function (request: any) -> any ... end
```

Only a `const`/`let` name, function or type can be exported. A destructuring declaration
cannot be exported (`PS3312`).

A `default` export may be a function **declaration**. When it is named, the name is bound
inside the module (so the function can call itself) and the emitted code is
`export default function name(...)`, not a lambda; anonymous default functions are
allowed and can only be reached through the imported binding. A `default` export of any
other expression (`export default main`, `export default { ... }`) is emitted as
`export default <expression>`.

A compiled module can ship its surface as a declaration file.
`plainscript build --declarations` writes `<name>.d.pln` next to every emitted
`<name>.js`. A declaration file contains only exported type declarations, `declare
function` signatures (inferred return types included), overload signatures, `declare
const` values, re-exports, and the imports those signatures use; private types referenced
by public signatures are kept without `export`. Conditional, mapped, indexed, tuple and
literal types are printed in their source form.

A relative import of `./x.js` reads `./x.d.pln` for its types, so a project can compile
and run against built JavaScript without the library's sources. JavaScript imported
without a declaration is an error (`PS4005`) instead of a silently untyped module.

A bare specifier (`import { Task } from "my-lib"`) resolves through `node_modules` using
the same entry rules the JavaScript host uses. Types come from the declaration named by
the `exports` map's `types` condition for that subpath, or by the package's
`types`/`typings` field, or a `.d.pln` beside the resolved entry. An installed package
that ships no declaration stays untyped, which is the normal case for JavaScript
libraries.

`plainscript build --declarations` writes that metadata for a library too: when the build
has a single entry module, `types` and `exports["."].types` are set to its declaration and
`exports["."].import` to its runtime, preserving any existing export keys and conditions.

A `type` declaration may name a type imported from another module. Importing a variant
alias also brings its constructors with it, so `Published(3)` and `case Published(views)`
behave the same in the importing module as in the declaring one.

`declare` introduces ambient values without emitting code:

```plainscript
declare function fetch(url: text) -> Promise of any
declare const process: any
```

---

## 4. Declarations

### 4.1 Variables

```plainscript
let count = 0            # mutable
const limit = 10         # immutable
let total: number = 0    # explicit type
let (left, right) = pair              # tuple destructuring
let { name, age } = person            # record destructuring
```

- `let` bindings are mutable; `const` bindings are not (`PS3307`). Mutating a `const`
  object's fields is a separate question answered by the field's own type.
- Destructuring binds fresh variables. Tuple patterns take their element type from a
  `list of T`; record patterns take field types from a record and give `any` for map
  values. An unknown record field is an error (`PS3313`).
- A declaration without an initialiser is a parse error; there is no implicit `nothing`.

### 4.2 Functions

```plainscript
function greet<T>(name: text, punctuation?: text, ...rest: list of text) -> text
    return punctuation ?? "!"
end
```

- Parameters may be required, optional (`?`), or rest (`...`). An optional parameter must
  come after required ones; a rest parameter must be last.
- The declared return type is required unless the function's result is inferred from its
  `return` statements. Inference yields a union of returned types plus `nothing` when the
  body can fall through.
- A function that declares a non-optional result must return on every path (`PS3401`).
  `return` always takes a value; use `return nothing` for an early exit (`PS3402`).
- Generic parameters are introduced with `<T, U>` after the name and are inferred at call
  sites.
- Exported generic aliases preserve their parameter list across module boundaries. An
  importing module must provide the declared number of type arguments, and those arguments
  are substituted recursively through record fields, lists, optionals, functions and
  unions just as they are within the declaring module.
- A parameter type annotation is required on a function declaration. A lambda may omit it
  only when an expected function type supplies the parameter type (§4.3).
- A function declared directly as a default export may omit its name:
  `export default function (request: any) -> any ... end`. Every other function
  declaration requires one.
- Functions are values: passing one where a function type is expected checks arity and
  parameter/return assignability.
- **Overloads** declare one or more call signatures followed by exactly one implementation:

  ```plainscript
  overload function format(value: text) -> text
  overload function format(value: number) -> text
  function format(value: any) -> text
      return "value:{value}"
  end
  ```

  A call selects the first signature whose arguments are inferable/assignable. No match is
  `PS3354`; an incompatible or missing implementation is `PS3355`. Overloads survive
  imports and generated `.d.pln` declarations.
- **Type predicates** narrow the first argument when the function is called in a condition:

  ```plainscript
  function isPerson(value: any) -> value is Person
      return value != nothing and value.name is text
  end
  ```

  A predicate must name a parameter and cannot be async (`PS3353`). The positive branch
  has the target type; the negative branch removes it from unions and optionals.

### 4.3 Lambdas

```plainscript
let double = (value: number) => value * 2
let later = async (value: number) => await work(value)
```

A lambda body is a single expression, or a block introduced by `do` and closed with `end`:

```plainscript
app.get("/", (request: any, response: any) => do
    response.json({ ok: true })
end)
```

Parameter types may be omitted when they can be inferred from the expected function type.
An async lambda (`async (x) => ...`) is an async function: `await` is legal inside it and
its type is a function returning `Promise of` the awaited result.
Because a block lambda needs its `end`, the single-expression form is preferred for
callbacks passed inside argument lists.

### 4.4 Types

Record type:

```plainscript
type Person
    name: text
    age: number
    nickname?: text
end
```

Variant type:

```plainscript
type Shape = Circle(radius: number) or Rectangle(width: number, height: number) or Point
```

- A unit variant (`Point`) has no fields and compiles to its own name as a string.
- A variant with fields compiles to `{ $kind: "Circle", radius }`.
- Constructors (`Circle(2)`, `Point`) are ordinary functions/values in scope.
- `type` also names any other type: `type Handler = (request: any) -> any`,
  `type Result<T> = Ok(value: T) or Failed(reason: text)`.

Aliases are transparent for assignability but retain their name in diagnostics.

---

## 5. Types

### 5.1 Primitives

| Type | Values | Notes |
| --- | --- | --- |
| `number` | IEEE-754 doubles | No separate integer type. |
| `text` | strings | UTF-16 code units, as in JavaScript. |
| `boolean` | `true`, `false` | No truthiness: conditions must be `boolean`. |
| `nothing` | `nothing` | The absence of a value; JavaScript `null`/`undefined` at the boundary. |
| `any` | anything | Only at JavaScript boundaries or explicit annotations. |

### 5.2 Composite types

```
list of T                 # JavaScript array
map of text to T          # object with text keys
map of K to V             # K must be text at this version
T?                        # T or nothing
Promise of T              # awaited value is T
(A, B) -> R               # function value
{ name: text, age: number }   # anonymous record
[A, B]                    # fixed-length tuple
A or B                    # union
A & B                     # intersection (records merge)
keyof { name: text }      # literal union of field names
typeof value              # type of a declared value
Person["name"]            # indexed access to a field
Pair[0]                   # indexed access to a tuple element
T[K]                      # deferred indexed access while T/K are generic
A extends B ? C : D       # conditional type
{ [K in keyof T]: T[K] }  # mapped type
{ [K in keyof T]?: V }    # optional mapped fields
"open"                    # literal type
T<...>                    # named generic instantiation
```

`map of text to V` is the only map form with field syntax: when a value's type is a map,
`value.field` reads a key (with `T?` when the key may be absent). Lists do not have
methods or a `.length` property; use `std/list`.

Tuple types use brackets: `[number, text]`. A literal numeric index selects that element;
destructuring and assignment are checked element by element. `keyof` produces a literal
union of the record's field names, and `typeof` reuses the type of a hoisted value. Indexed
access is supported for record field literals, tuple indexes, list elements, map keys and
`keyof` of a known record; a missing field is `PS3207`. `A & B` merges record fields, with
conflicting required fields intersected (usually `never`).

Conditional types are non-distributive and evaluate when their check no longer contains an
unresolved type parameter. Mapped types expand when the key set is a concrete literal union
(commonly `keyof` of a known record); otherwise they stay deferred. Deferred indexed access
such as `T[0]` resolves after generic substitution. While a construct is deferred the
checker is intentionally permissive, like an unresolved generic; concrete instantiation is
the enforcement point. Variadic tuples and `readonly` field modifiers are not implemented.

### 5.3 Assignability

A value of type `S` is assignable to `T` when:

- `T` is `any`, or `S` is `nothing` and `T` is optional;
- primitives are identical;
- both are lists with assignable elements, or maps with assignable values;
- both are functions with equal parameter counts (optional and rest handled), assignable
  parameters (contravariant) and assignable results (covariant);
- records are structurally assignable: every required field of `T` exists in `S` with an
  assignable type; extra fields in `S` are allowed; optional fields may be absent;
- both are tuples of equal length with pairwise-assignable elements;
- literal types are assignable to their primitive base and to the same literal;
- `S` is a member of union `T`, or every member of union `S` is assignable to `T`;
- a conditional type resolves to its selected branch, a mapped type to its expanded
  record, and an indexed access to the selected field/element, before assignability is
  decided;
- `T` is a named alias that dereferences to a matching type.

Nominal typing is not used. Two records with the same fields are the same type. Variance is
derived structurally: function parameters are contravariant, results and containers are
covariant, and records are width-subtyped. There are no `in`/`out` variance annotations.

### 5.4 Narrowing

Facts are derived from conditions and applied inside their branches:

```plainscript
if value is text                          # value: text in this branch
if value is nothing                       # optional becomes nothing
if value is not nothing                   # optional loses nothing
if shape is Circle                        # variant narrowed to Circle
if shape is Circle and shape.radius > 1
if item.done                              # boolean field fact
if x == "yes"                             # literal equality narrows unions
```

Narrowing understands `and`, `or`, `not`, `is`, `is not`, `==`, `!=`, member paths and
`else` (the negation of all preceding branches). Reading a `T?` without narrowing is
`PS3350`; reading a field that only some union members have is `PS3351`.

`is` tests are runtime checks for primitives, lists, maps and variant tags; other type
tests are compile-time only.

### 5.5 Generics

Type parameters on functions and types are inferred from arguments:

```plainscript
function first<T>(items: list of T) -> T?
    return items[0]
end

let value = first([1, 2, 3])     # value: number?
```

An unresolvable type parameter falls back to `any`. Generic constraints are written after
a colon and are checked at call sites:

```plainscript
type Named
    name: text
end

function label<T: Named>(value: T) -> text
    return value.name
end
```

`label({ name: "Ada" })` compiles and can read `value.name`; `label({ age: 37 })` reports
`PS3343`. Constraints on type aliases use the same syntax.

`std/contract.object` is checker-aware: when its shape is a record literal whose values are
contract schemas, the result's `Schema<T>` parse result is inferred recursively from those
schema outputs. Primitive schemas, nested object schemas, arrays and optional schemas are
supported. An optional schema field becomes an optional property in `T`. This lets an
operation's input and output model flow from schema values into its implementation and
client signature without a separate model declaration. The check is based on the schema
expression; arbitrary JavaScript validators are not inferred. `enumeration` and `literal`
schemas derive literal unions, so `"open" or "done"` fields reject other values at compile
time and are exhaustively matchable.

---

## 6. Expressions

### 6.1 Precedence

From loosest to tightest:

| Level | Operators |
| --- | --- |
| 1 | `\|>` pipeline (left associative) |
| 2 | `or` |
| 3 | `and` |
| 4 | `??` |
| 5 | `==` `!=` |
| 6 | `<` `<=` `>` `>=` |
| 7 | `+` `-` |
| 8 | `*` `/` `%` |
| 9 | unary `not`, unary `-`, `await` |
| 10 | `new`, `as` casts, calls, member access, indexing |

Logical operators are the keywords `and` and `or`. Symbolic `&&` and `||` are not part of
the language and are rejected by the lexer; there is one spelling per concept.

`|>` passes the left value as the **first** argument: `value |> f(a)` is `f(value, a)`.
When the right side is a lambda, it is called with the left value:
`value |> (x) => x + 1`.

### 6.2 Literals

```plainscript
42, 3.5, "text {value}", 'raw', """multiline"""
true, false, nothing
[1, 2, 3]
{ name: "ada", "quoted key": 1 }
```

Record/map literals use `{ key: value }`; keys may be identifiers or text literals. There
is no shorthand `{ name }` form and no computed key syntax.

### 6.3 Operators

- Arithmetic: `+ - * / %`, requiring `number` operands (`PS3344`). `+` does not concatenate
  text; use interpolation.
- Comparison: `== != < <= > >=` compare values; `==` is strict equality.
- Logic: `and`, `or`, `not`, short-circuiting, requiring `boolean` operands.
- `??` returns the right side when the left is `nothing`.
- `?.` short-circuits member access and calls on `nothing`.
- `is` / `is not` test a type (narrowing in conditions).
- `new` constructs a JavaScript class value: `new URL(text)`, `new DatabaseSync(path)`,
  `new Response(body, { headers: ... })`. It applies to the whole call expression
  (`new Parser(a, b)`), and the constructed value has type `any` because constructor
  signatures live on the JavaScript side.
- `as` asserts a type. It is erased; incompatible casts are a compile error where the
  compiler can prove disjointness (`PS3360`).

### 6.4 Assignment

`x = v`, `x += v`, `x -= v`, `x *= v`, `x /= v`, `x %= v`. Assignment is a statement.
Targets are names, fields and indexes. Assigning to a `const` or function name is
`PS3307`; assigning an incompatible type is `PS3317`.

---

## 7. Statements

### 7.1 Conditions

```plainscript
if condition
    ...
else if other
    ...
else
    ...
end
```

Conditions must be `boolean` (`PS3318`). `if` is a statement, not an expression; use a
function or `match` when a value is needed. `else if` and `else` are optional, and the
whole conditional ends with `end`.

### 7.2 Loops

```plainscript
for item in items
    ...
end

for index in 0 to 10          # 0..9, exclusive upper bound
    ...
end

while running
    ...
end
```

`break` and `continue` work in loops (`PS3309` outside one). A `for … in` loop over a
`list of T` binds `item: T`. A range loop binds a `number`.

### 7.3 Match

```plainscript
match shape
    case Circle(radius) if radius > 0
        ...
    case Rectangle(width, height)
        ...
    case Point
        ...
    case _
        ...
end
```

Patterns:

| Pattern | Matches |
| --- | --- |
| `_` | anything, binds nothing |
| `name` | anything, binds `name` |
| `42`, `"text"`, `true`, `nothing` | equality |
| `Circle(radius)` | variant tag `Circle`, binds fields positionally |
| `Point` | unit variant (a string tag) |
| `[a, b]` | list of exactly two, binds elements |
| `[a, ...rest]` | list with at least one element |
| `(a, b)` | tuple/record pair |
| `{ name, age }` | record fields by name |

A guard introduced by `if` may follow a `case` pattern. Matching is exhaustive when every
variant is covered or a wildcard/binding pattern is present (`PS3345`). Duplicate cases
are `PS3306`.
A binding pattern makes later cases unreachable, which the checker reports.

### 7.4 Errors

```plainscript
try
    risky()
catch error
    print("failed: {error}")
finally
    cleanup()
end
```

`catch` binds `any`; thrown values may be anything. `throw value` throws. `finally` runs on
both paths. Errors are not typed in 2.0.

### 7.5 Render blocks

```plainscript
render
    element "main" with className: "page"
        element "h1"
            "{title}"
        end
        element "ul"
            ...rows
        end
    end
end
```

- `render` is a statement whose value is discarded (typically returned by the enclosing
  function).
- `element "tag" with prop: value, other: flag` creates an element by calling
  `createElement(tag, props, ...children)` **from the enclosing scope**. That name must be
  imported or declared; PlainScript has no built-in element factory.
- A prop without `:` is shorthand for a boolean/name value: `with disabled`.
- Children are statements. A child expression contributes its value; `...expr` spreads a
  list of children; nested `element` blocks nest.
- `element` is also an expression, which is how dynamic child lists are built:

```plainscript
let rows: list of any = []
for item in items
    rows = append(rows, element "li" "{item.title}" end)
end
```

There are no fragments, no context syntax and no automatic keys.

### 7.6 Other statements

- `print x` is not a statement; import `print` from `std/io` or call a function.
- An expression on its own line is evaluated and discarded.

---

## 8. Async

```plainscript
async function load(url: text) -> text
    let response = await fetch(url)
    return await response.text()
end
```

- `async function` returns `Promise of R`, where `R` is the declared or inferred result.
- `await` requires a `Promise` operand (`PS3327`) and an enclosing `async` function
  (`PS3406`).
- `await value as T` casts the awaited value.
- Top-level `await` is allowed, because output is an ES module.
- Async lambdas are supported: `async (x: number) => await work(x)`.

The language has no task/cancellation syntax of its own. Import `std/task` for task groups,
cooperative cancellation, timeouts, channels and worker handles. These primitives wrap the
host event loop and cannot preempt hostile synchronous code. See
[CONCURRENCY.md](CONCURRENCY.md).

---

## 9. Diagnostics

Every diagnostic has a stable code, a file, a line and a column, and a source excerpt.
Errors are never downgraded to warnings; `check` exits non-zero when any diagnostic is
reported. Compilation failure writes nothing.

| Range | Area |
| --- | --- |
| `PS1xxx` | lexer |
| `PS2xxx` | parser |
| `PS3xxx` | types, names, control flow |
| `PS4001` | circular import |
| `PS4002` | unresolvable import |
| `PS5000` | internal compiler error |

Notable type codes: `PS3205` missing export, `PS3301` unknown name, `PS3304` not callable,
`PS3307` immutable assignment, `PS3311` bad initialiser, `PS3317` bad assignment,
`PS3327` await non-Promise, `PS3333` unknown field, `PS3341`/`PS3342` arity,
`PS3343` argument type, `PS3344` arithmetic on non-numbers, `PS3345` non-exhaustive match,
`PS3350` maybe-nothing access, `PS3351` union missing field, `PS3353` invalid type
predicate, `PS3354` no overload matches, `PS3355` overload/implementation mismatch,
`PS3401` missing return, `PS3402` `return` without a value, `PS3404` return type mismatch,
`PS3406` await outside async.

---

## 10. Compilation model

```
source .pln
  → lexer         tokens (with interpolation and template parts)
  → parser        AST (spans on every node)
  → type checker  diagnostics + export tables
  → lowering      typed HIR: templates, pipes, patterns and elements desugared
  → emitter       ESM + source map
```

- Output is one `.js` file per `.pln` file, next to a `.js.map`. There is no bundling.
- Relative `.pln` imports become `.js`; `std/…` becomes a package or a base URL.
- `plainscript run` compiles into `.plainscript/run/` with
  `package.json {"type":"module"}` so Node loads the output as ESM.
- `plainscript build` writes `dist/` (configurable) and adds a `package.json` with
  `"type": "module"` when the surrounding project is not already ESM.
- Source maps map each emitted statement to its source line.

---

## 11. Runtime semantics

- Numbers, text, booleans, lists and maps are the JavaScript values of the same name.
  There is no boxing and no wrapper classes.
- `nothing` is JavaScript `null` in generated code. `undefined` from JavaScript is
  indistinguishable from `nothing` after crossing the boundary.
- Records and maps are plain objects. Variant values are strings (unit variants) or
  objects with `$kind`.
- Types are erased. Field access, calls and loop iteration rely on the checker, not on
  runtime guards.
- `is` lowers to inline checks: `typeof` for primitives, `Array.isArray` for lists, a
  non-null object test for maps, `$kind`/string comparison for variants.
- `??` and `?.` are JavaScript's own operators, so their semantics match exactly.
- Equality is JavaScript strict equality; there is no structural equality operator.
- Errors thrown by JavaScript propagate as values and can be caught.

---

## 12. Scope rules

- A module has one top-level scope. Function declarations are hoisted within their block.
- `if`, `for`, `while`, `match` arms, `try`/`catch`/`finally` and function bodies create
  child scopes.
- Closures capture the enclosing scope; nested functions see the local variables around
  them.
- Shadowing is allowed and resolved lexically. Redeclaring a name in the same scope is a
  duplicate-name diagnostic.
- Module imports are visible in the whole module, including before their import statement.

---

## 13. Interoperability rules

- Values from JavaScript without declarations have type `any`; `any` is assignable in both
  directions and member access on it is unchecked.
- Declaring shapes for JavaScript is done with `declare` and record types, not with a
  separate declaration language.
- `Promise` is the JavaScript promise; `async`/`await` compile to native syntax.
- `std/http` uses the Web-standard `Request`/`Response` objects, which Node 20, Deno, Bun
  and Cloudflare Workers all provide.
- Emitted code never imports a PlainScript runtime. The only imports are the ones written
  in source plus the standard library modules the program uses.

---

## 14. Reserved words

```
and        as         async      await      break      case       catch
const      continue   declare    do         element    else       end
export     false      finally    for        from       function   if
import     in         is         let        match      new        nothing
not        or         otherwise  render     return     throw      to
true       try        type       when       while      with
```

Reserved words cannot be identifiers, including function, parameter, variable and type
names. `when` and `otherwise` are retained as reserved words only so source using their
retired branch syntax receives a parser error; they are not accepted as branch introducers.
Reserved words may be used as fields after `.`, as element property names, and as record
literal keys.
