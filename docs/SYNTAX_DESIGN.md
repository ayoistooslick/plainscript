# PlainScript syntax design

## Design goal

PlainScript should be recognizable to developers who already write JavaScript or TypeScript, without becoming a TypeScript clone. Familiar syntax should be chosen where it clarifies common code; distinctive constructs should remain only when they express a deliberate capability or a simpler rule. The compiler's actual behavior—not an aspirational example—is the authority for this design.

The research sources do not establish one universally best syntax. TypeScript keeps JavaScript control flow and uses type annotations after identifiers, with inference in contexts where it can determine a type. Its module handbook also treats module configuration and interoperation as part of the toolchain contract. Go and Rust use braces and explicit type boundaries in different ways. Python uses colon-led, indentation-delimited suites. Kotlin demonstrates both inferred expression-bodied functions and explicit block-bodied function results. These are design choices in their own ecosystems, not recipes PlainScript must copy. [1] [2] [3] [4] [5] [6]

The chosen direction is **familiar branch vocabulary with explicit block boundaries**. Conditional statements and match guards use `if`; alternate branches use `else` and `else if`. Blocks continue to close with `end`. This is a deliberate, limited change: conditions are frequent in real PlainScript programs, while changing every delimiter, type form, operator, callback, and runtime convention at once would obscure which changes actually improve code.

## Starting point: the 2.0.0 source snapshot

Before this migration, the PlainScript 2.0.0 source snapshot was a newline-insensitive, keyword-delimited language. The lexer discards newlines, and the parser uses `end` plus branch keywords to find block boundaries. Its main differences from JavaScript/TypeScript were therefore part of the grammar, not just spelling: conditionals were written `when`/`otherwise`, boolean operators were words (`and`, `or`, `not`), functions could declare a result with `->`, and blocks closed with `end`.

These choices have different costs. `when` is less familiar than `if` for an ordinary condition. `otherwise` is longer than `else`. The `end` terminator is explicit and allows the parser to ignore indentation, but is not JavaScript-style bracing. Word operators read clearly in prose but look unfamiliar in otherwise JavaScript-like expressions. `text`, `nothing`, and collection types such as `list of T` make the type vocabulary distinctive; changing them would affect every public signature and standard-library declaration. Lambdas already use the familiar `=>` token for expression bodies, but statement-bodied lambdas use `do … end`.

A source audit found that the condition form is heavily used in demos, templates, and tests. A class declaration is not part of the PlainScript grammar: JavaScript classes can be imported and instantiated at the interop boundary, but a `.pln` file cannot declare a class with methods. The specification also described `otherwise` as a match catch-all even though the parser accepts only `case` arms; this document corrects that example to the implemented wildcard pattern `_`.

## Research findings and design principles

ECMAScript defines JavaScript's syntax and runtime behavior, including native modules and async functions. TypeScript retains JavaScript constructs while adding type annotations and static checks; its handbook documents post-identifier annotations, inference, function types, and control-flow narrowing. Its module handbook also makes module-system configuration and interoperation an explicit part of the compiler contract. These sources support treating JavaScript familiarity and explicit interop semantics as meaningful design constraints, not as a reason to reproduce TypeScript wholesale. [1] [2] [3]

Go and Rust show that a language can use static types with different inference boundaries. Go documents local inference and a specified semicolon-insertion rule. Rust documents inference from context, explicit function parameter types, `->` return annotations, and value-producing `if` expressions. Kotlin documents inferred expression-bodied return types, explicit return types for block-bodied functions, nullable types, and `if`/`when` expressions. Python's reference documents colon-led suites whose indentation determines block structure. None of these conventions should be adopted without deciding how they interact with PlainScript's parser, formatter, type checker, and emitted JavaScript. [4] [6] [8] [9] [10]

The principles for PlainScript are:

1. **Familiarity for frequent constructs.** Use common names for common control flow when the meaning is the same.
2. **One canonical spelling.** A migration may break old syntax, but the compiler should not indefinitely accept two spellings for the same operation without a stated policy.
3. **Keep semantics stable when changing spelling.** A syntax change should preserve type checking, narrowing, return coverage, errors, and emitted behavior unless the design explicitly changes those semantics.
4. **Make block ownership visible.** A parser should not rely on hidden indentation or surprising newline rules.
5. **Keep type guarantees explicit.** Inference is useful when the initializer or expected type supplies evidence; lack of evidence should not silently weaken a checked value to `any`.
6. **Specify the JavaScript boundary.** Imports, `Promise`, thrown values, `undefined`/`nothing`, and untyped values must retain the documented interop behavior.
7. **Let tooling reinforce the grammar.** The formatter, diagnostics, examples, tests, and specification must all teach the same canonical form. Rust's style guide explicitly motivates shared formatting conventions as a way to reduce comprehension and cross-project acclimation costs. [13]

Language references explain their own rules; they do not provide comparative usability studies. The recommendations below are design judgments grounded in PlainScript's code and the cited official documentation.

## Before and after: ordinary code

### Simple function

Current and proposed PlainScript are unchanged here:

```plainscript
function double(value: number) -> number
    return value * 2
end
```

A comparable TypeScript function is:

```ts
function double(value: number): number {
  return value * 2;
}
```

The selected change does not alter function declarations. `->` is explicit and is also used by languages such as Rust, but TypeScript's colon return annotation is closer to its JavaScript function form. Changing return annotations is a separate syntax decision and is not bundled into this conditional migration. [2] [10]

### Typed function with an optional parameter

Current and proposed PlainScript:

```plainscript
function label(name: text, prefix?: text) -> text
    let start = prefix ?? ""
    return "{start}{name}"
end
```

TypeScript:

```ts
function label(name: string, prefix?: string): string {
  return `${prefix ?? ""}${name}`;
}
```

Both place the type beside the parameter and mark the optional argument locally. PlainScript's `text` and nullish `nothing` types intentionally remain in place for this change; they are part of the implemented language and its type system. TypeScript's handbook documents optional parameters and the JavaScript runtime meaning of an omitted argument. [2]

### Asynchronous function

Current and proposed PlainScript:

```plainscript
async function load(url: text) -> text
    let response = await fetch(url)
    return await response.text()
end
```

TypeScript:

```ts
async function load(url: string): Promise<string> {
  const response = await fetch(url);
  return await response.text();
}
```

The `async`/`await` vocabulary and `Promise` mapping are retained. ECMAScript specifies async functions; TypeScript documents their result types. Rust also makes async a function qualifier, illustrating another explicit way to communicate async behavior. [1] [2] [12]

### Conditional with multiple branches

Earlier PlainScript 2.0.0 syntax:

```plainscript
when score < 0
    return "invalid"
otherwise when score == 0
    return "zero"
otherwise
    return "positive"
end
```

JavaScript/TypeScript:

```ts
if (score < 0) {
  return "invalid";
} else if (score === 0) {
  return "zero";
} else {
  return "positive";
}
```

Proposed PlainScript:

```plainscript
if score < 0
    return "invalid"
else if score == 0
    return "zero"
else
    return "positive"
end
```

The branch conditions, branch scopes, narrowing facts, and generated behavior are unchanged. Only the source keywords change. Parentheses and braces are not added in this increment: PlainScript does not use semicolon-separated statements, and a complete brace-delimited block redesign would need a separate grammar and formatter proposal.

### Loop with nested conditions

Earlier PlainScript 2.0.0 syntax:

```plainscript
for item in items
    when item.active
        when item.score >= threshold
            process(item)
        end
    end
end
```

JavaScript/TypeScript:

```ts
for (const item of items) {
  if (item.active && item.score >= threshold) {
    process(item);
  }
}
```

Proposed PlainScript:

```plainscript
for item in items
    if item.active
        if item.score >= threshold
            process(item)
        end
    end
end
```

This migration makes each conditional recognizable without changing loop syntax, scope, or the `and` operator. Combining the conditions is possible, but this change does not rewrite boolean operators.

### Generic function

Current and proposed PlainScript:

```plainscript
function first<T>(items: list of T) -> T?
    return items[0]
end
```

TypeScript:

```ts
function first<T>(items: T[]): T | undefined {
  return items[0];
}
```

Generic inference and optional result semantics do not change. TypeScript's handbook documents generic inference from arguments; PlainScript's checker continues to own its current `T?` and `nothing` rules. [2]

### Class with methods

PlainScript currently has no class-declaration syntax, so neither the current nor proposed PlainScript grammar can express a user-defined class with methods. The supported JavaScript boundary can construct imported classes, for example:

```plainscript
import { DatabaseSync } from "node:sqlite"
let database = new DatabaseSync(":memory:")
```

The imported JavaScript class is typed as `any` unless a declaration supplies its shape. A JavaScript/TypeScript class can be written as:

```ts
class Counter {
  constructor(public value: number = 0) {}
  increment(): number { return ++this.value; }
}
```

Adding classes would need decisions about inheritance, privacy, constructor typing, emitted class semantics, and interop. It is not a syntax-only spelling change and remains a design item for future work.

### Object with typed properties

Current and proposed PlainScript:

```plainscript
type Person
    name: text
    age: number
end

let person: Person = { name: "Ada", age: 36 }
```

TypeScript:

```ts
type Person = { name: string; age: number };
const person: Person = { name: "Ada", age: 36 };
```

PlainScript's structural records and checker remain unchanged. The `type … end` declaration is explicit but differs from TypeScript's object type alias. This proposal does not introduce a competing brace-based declaration form.

### Error handling

Current and proposed PlainScript:

```plainscript
try
    risky()
catch error
    print("failed: {error}")
finally
    cleanup()
end
```

JavaScript/TypeScript:

```ts
try {
  risky();
} catch (error) {
  console.error(`failed: ${error}`);
} finally {
  cleanup();
}
```

`try`/`catch`/`finally` already use recognizable keywords. PlainScript's catch value remains `any`; typed error unions, Go-style multiple-return error checking and deferred cleanup, or a result type are separate semantic proposals. Python documents its own ordered exception matching and `else` behavior, but those semantics do not apply to PlainScript. [5] [7]

### HTTP endpoint

Earlier PlainScript 2.0.0 syntax used `when` for route selection:

```plainscript
async function handler(request: any) -> any
    let url = urlOf(request)
    when request.method == "GET" and url.pathname == "/health"
        return json({ status: "ok" })
    end
    return notFound()
end
```

JavaScript/TypeScript:

```ts
async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ status: "ok" });
  }
  return new Response("Not found", { status: 404 });
}
```

Proposed PlainScript:

```plainscript
async function handler(request: any) -> any
    let url = urlOf(request)
    if request.method == "GET" and url.pathname == "/health"
        return json({ status: "ok" })
    end
    return notFound()
end
```

The standard library continues to provide the HTTP helpers; route behavior and JavaScript interoperability do not change.

### Database query

Current and proposed PlainScript use the JavaScript driver at the interop boundary:

```plainscript
import { DatabaseSync } from "node:sqlite"
let database = new DatabaseSync(":memory:")
database.exec("create table tasks (id integer, title text)")
let insert = database.prepare("insert into tasks values (?, ?)")
insert.run(1, "write docs")
let rows = database.prepare("select id, title from tasks").all() as list of any
```

TypeScript with Node declarations can describe the driver more precisely, but that depends on declarations for the installed runtime/package. The PlainScript syntax change neither adds an ORM nor changes the `any` interop boundary.

### Frontend component

Current and proposed PlainScript:

```plainscript
import { createElement } from "react"

export function Greeting(name: text) -> any
    render
        element "p"
            "Hello, {name}!"
        end
    end
end
```

TypeScript/React:

```tsx
function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}!</p>;
}
```

PlainScript's `render`/`element` form remains an explicit lowering to the imported `createElement`; it is not JSX. This syntax is distinctive because it is tied to an existing compiler capability and does not require a JSX parser or runtime transform.

### Complete small application

Earlier PlainScript 2.0.0 route selection:

```plainscript
import { serve, json, notFound, urlOf } from "std/http"
import { print, env } from "std/io"
import { parseNumber } from "std/text"

async function handler(request: any) -> any
    let url = urlOf(request)
    when url.pathname == "/health"
        return json({ status: "ok" })
    end
    when url.pathname == "/hello"
        return json({ message: "hello" })
    end
    return notFound()
end

let port = parseNumber(env("PORT", "4321"))
print("Listening on {port}")
await serve(port, handler)
```

Equivalent JavaScript/TypeScript route structure:

```ts
async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") return Response.json({ status: "ok" });
  if (url.pathname === "/hello") return Response.json({ message: "hello" });
  return new Response("Not found", { status: 404 });
}
```

Proposed PlainScript changes only the branch spellings:

```plainscript
import { serve, json, notFound, urlOf } from "std/http"
import { print, env } from "std/io"
import { parseNumber } from "std/text"

async function handler(request: any) -> any
    let url = urlOf(request)
    if url.pathname == "/health"
        return json({ status: "ok" })
    end
    if url.pathname == "/hello"
        return json({ message: "hello" })
    end
    return notFound()
end

let port = parseNumber(env("PORT", "4321"))
print("Listening on {port}")
await serve(port, handler)
```

This example uses only modules and calls already present in `stdlib/http.d.pln`, `stdlib/io.d.pln`, and `stdlib/text.d.pln`; its handler is type-checked and run through the existing module compiler.

## Proposed grammar

The canonical conditional grammar is:

```ebnf
Conditional ::= "if" Expression Statement* ("else" "if" Expression Statement*)* ("else" Statement*)? "end"
MatchArm    ::= "case" Pattern ("if" Expression)? Statement*
```

`end` remains the required block terminator. Newlines remain insignificant; `else` and `end` are the boundaries that stop a conditional body. The `if` after `else` introduces another branch, not a nested body. A match guard uses `if`, matching the same conditional keyword. A match catch-all remains `case _`; `else` is not a match arm.

The lexer reserves `if` and `else`. It also keeps the retired words `when` and `otherwise` reserved, but the parser no longer accepts them as branch introducers; this makes old source fail clearly instead of letting those words become misleading identifiers. The parser maps the new spellings to the existing `Conditional` AST node (`branches` and optional `otherwise` body) and the existing `Match` guard field. The semantic representation deliberately keeps the property name `otherwise` internally; AST field names are not source syntax. Checker, HIR, and code generation continue to receive the same node kinds and emit the same JavaScript as before.

## Why not change more in this increment?

**Braces for every block.** JavaScript and TypeScript use braces, but PlainScript's `{}` already means a map/record literal, destructuring pattern, type record, or import/export group. A brace-block grammar must define how statements are separated after newlines are discarded, how expression braces are distinguished from statement blocks, and how formatter recovery works. Go's semicolon insertion and Python's indentation grammar demonstrate that separator rules are language design, not a cosmetic delimiter swap. This needs its own prototype and parser ambiguity analysis. [4] [6]

**Symbolic `&&`, `||`, and `!`.** These are familiar to JavaScript users, but PlainScript explicitly rejected the punctuation aliases because two spellings violate its one-spelling rule. Adding symbols while retaining words would create the same problem; replacing words would be a separate compatibility change that touches lexer, parser precedence, checker operator normalization, formatter, documentation, and every source example. This design leaves the deliberate `and`/`or`/`not` rule alone.

**Return types and collection types.** TypeScript's `: T` return annotations are familiar to its users, while Go and Rust use other conventions. Changing `->` to `:` and `list of T`/`Promise of T` to bracket/generic forms would touch type parsing, declarations, generated `.d.pln` files, templates, libraries, and migration tooling. No evidence justifies bundling those changes with ordinary branching. [2] [4] [10]

**Expression-valued conditions or implicit returns.** Kotlin and Rust support value-producing `if`; Rust makes semicolons affect whether a block yields a value. PlainScript currently models `when` as a statement and requires `return value`. This is a semantic expansion, not a spelling simplification. Keep it deferred until its typing, unreachable branches, return coverage, and code generation are designed. [8] [10]

**Classes.** The language currently interoperates with JavaScript classes but cannot declare its own. Adding class definitions is a larger feature with type-checker and HIR consequences. The requested syntax pass will not suggest that interop is equivalent to native class support.

## Compatibility and migration

This is a hard syntax replacement, not an alias period. `when condition … end` becomes `if condition … end`; `otherwise when condition` becomes `else if condition`; `otherwise` becomes `else`; and `case pattern when guard` becomes `case pattern if guard`. The retired words remain reserved but are not accepted as branch introducers, ensuring old branch syntax reports a parser error rather than being reinterpreted.

The AST, type checking, narrowing, scope behavior, early-return analysis, and JavaScript output remain unchanged. No capabilities are removed. Existing `.pln` source using the previous spelling must be migrated. `docs/MIGRATION.md` includes a direct mapping and `docs/SPEC.md` describes only the implemented canonical grammar. Archived v1 materials under `legacy/v1/` remain an historical snapshot and are not rewritten.

Because this is a source-breaking change after the 2.0.0 snapshot, it must not be presented as a patch-compatible release. The repository version and release number require an explicit release decision before npm publication. This work changes the GitHub source only; it does not publish to npm.

## Required compiler changes and verification

The implementation touches the lexer keyword set, parser statement dispatch and conditional/match-guard productions, parser recovery starts, formatter indentation rules, diagnostics tests, syntax-highlighting examples if present, active examples/templates, and documentation. Checker, HIR, and code generation should remain semantically unchanged. Tests must prove that the new syntax reaches the existing AST and runtime behavior, that old branch spelling is rejected as syntax, and that nested branches, match guards, diagnostics, formatting, type narrowing, and actual demos still work.

Verification includes the full `npm test` suite, `plainscript check` across every active `.pln` under `demos/`, `templates/`, and `stdlib/`, formatter idempotence on migrated programs, and running representative endpoint/UI builds. Tests must not be weakened to accommodate the change.

## Decisions requiring attention

1. The migration is intentionally breaking. Confirm the target release version before tagging or publishing; npm publication is outside this task.
2. Explicit `end` is retained for this increment. A future brace design must settle statement separators and record-literal ambiguity before implementation.
3. `and`/`or`/`not`, `->`, `text`/`nothing`, collection type forms, and `render`/`element` remain canonical for now. Their alternatives need separate evidence and migration plans.
4. User-defined classes remain unsupported. JavaScript class interop is not a substitute for class syntax.
5. Match catch-all syntax is `case _`; the old specification's `otherwise` example did not match the parser and must not be perpetuated.

## The 2.1 dialect: an English-oriented surface

2.1 revisits the vocabulary without touching the type system, the block model or
the emitted JavaScript. The design question was narrow: which 2.0 spellings read
poorly when a program is spoken aloud, and what is the smallest coherent
replacement?

### What changed

| Concept | 2.0 | 2.1 | Reason |
| --- | --- | --- | --- |
| Immutable binding | `const x = 1` | `value x is 1` | States what the binding is, not what the emitter does. |
| Mutable binding | `let x = 1` | `set x to 1` | Reads as an instruction; pairs with `change`. |
| Assignment | `x = 2` | `change x to 2` | A one-character operator is easy to miss in a long body. |
| Function | `function f() -> T` | `define f() returns T` | `define` names the act; `returns` reads as prose. |
| Conditional | `if`/`else` | `when`/`otherwise` | `when` introduces a condition without implying a question. |
| Each loop | `for x in xs` | `for each x in xs` | Distinguishes iteration from the numeric range form. |
| Range loop | `for i in 0 to 9` | `for i from 0 to 9` | `from … to …` pairs the bounds. |
| Comparison | `>=`, `<` | `is at least`, `is less than` | Symbols are fine on a slide and poor in a code review sentence. |

### What did not change, deliberately

`match`, `case`, `while`, `break`, `continue`, `try`, `catch`, `finally`,
`throw`, `return`, `type`, `declare`, `import`, `export`, `async`, `await`,
`and`, `or`, `not`, `is` (type test), `as`, `render`, `element` and every
arithmetic operator keep their spelling. They are already English words with the
right meaning; renaming them would add vocabulary without adding clarity, which
is exactly the failure mode of a “renamed JavaScript” language. `end` remains the
block terminator in both dialects for the same reason: it is unambiguous,
consistent, and already load-bearing in the grammar.

### Ambiguities and how they are resolved

- **Contextual declaration words.** `value`, `set`, `change`, `define`,
  `returns` and `each` are not reserved. The parser treats them as construct
  introducers only in statement or declaration position, using lookahead: `set`
  followed by a name, or by a balanced pattern group followed by `to`. Hence
  `set(handler)` is a call, `set { a, b } to pair` is a binding, and `value`
  remains a legal parameter name.
- **`is` is overloaded across contexts.** It is the type-test operator in
  expressions, the separator in `value … is …`, and the first word of every
  comparison phrase. The three never compete: the phrase is only recognised when
  the complete word sequence is present, and the declaration `is` is consumed by
  the binding production before expression parsing begins.
- **`otherwise when` is not a new keyword.** It normalises to `else if`, so the
  parser has one branch shape, and the emitter has one `else if` chain.
- **One loop shape per form.** `for x in xs` is rejected in 2.1 (`PS2014`) rather
  than silently accepted, so a 2.1 file cannot accumulate two spellings of the
  same loop.
- **Phrases are operators.** Comparison phrases become the same token as their
  symbol before parsing. Precedence, associativity and code generation are
  therefore identical, and mixing the two forms cannot change meaning.

### Consistency audit

The 2.1 grammar was reviewed against the checklist in this document:

- **Nested blocks** close with one `end`, exactly as in 2.0. `otherwise` and
  `catch` do not open a new block level; the formatter aligns them with their
  opener.
- **Function declarations** use one return marker (`returns`) and one async
  prefix (`async define`). Function *types* keep `->`, which is a type arrow, not
  a declaration marker.
- **Mutable and immutable bindings** are distinguished by the declaration word
  and by the checker; `change` is the only assignment form in 2.1.
- **Types and generics** are untouched: `type`, `T`, constraints, unions,
  variants, records and predicates use the 2.0 forms.
- **Async operations** use `async define` + `returns` + `await`; no parallel
  async vocabulary was added.
- **Error handling** uses `try`/`catch`/`finally`; `throw` and `return` are
  unchanged.
- **Imports and exports** are unchanged, including `export define` and
  `export value`.
- **Objects and collections** keep record literals, list literals, `list of T`
  and `map of K to V`.
- **Readability in larger applications** was the deciding test: declarations,
  branches and comparisons are the lines a reader scans most, which is why they
  changed, while operators and control words that already read well did not.

The formal surface grammar is section 15 of [the specification](SPEC.md). The
practical reference, with the 2.0 equivalent of every construct, is
[the language reference](LANGUAGE_REFERENCE.md).

## References

[1]: https://tc39.es/ecma262/ "ECMAScript Language Specification"
[2]: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html "TypeScript Handbook Everyday Types"
[3]: https://www.typescriptlang.org/docs/handbook/modules/introduction.html "TypeScript Handbook Modules Introduction"
[4]: https://go.dev/ref/spec "The Go Programming Language Specification"
[5]: https://go.dev/doc/effective_go "Effective Go"
[6]: https://docs.python.org/3/reference/compound_stmts.html "The Python Language Reference Compound Statements"
[7]: https://docs.python.org/3/tutorial/errors.html "The Python Tutorial Errors and Exceptions"
[8]: https://kotlinlang.org/docs/basic-syntax.html "Kotlin Basic Syntax"
[9]: https://kotlinlang.org/docs/functions.html "Kotlin Functions"
[10]: https://doc.rust-lang.org/book/ch03-03-how-functions-work.html "The Rust Programming Language Functions"
[11]: https://doc.rust-lang.org/book/ch03-05-control-flow.html "The Rust Programming Language Control Flow"
[12]: https://doc.rust-lang.org/reference/items/functions.html "The Rust Reference Functions"
[13]: https://rust-lang.github.io/rfcs/2436-style-guide.html "Rust Style Guide"
