<!-- compile-examples -->

# PlainScript 2.2 language reference

This is the practical reference for the 2.1 dialect. The normative semantics are
in [the specification](SPEC.md); this page shows the surface, names the 2.0
equivalent, and states the rules the compiler enforces.

Every `plainscript` example on this page is a complete program compiled by the
test suite.

## 1. Files and dialects

A source file uses the `.pln` extension and UTF-8. The first line may opt into a
dialect:

```plainscript
#syntax 2.1

import { print } from "std/io"

print("2.1 dialect")
```

Rules:

- `#syntax 2.1` must be the first line. Leading whitespace and a BOM are
  allowed.
- A file without a pragma uses the project default from
  `plainscript.config.json` (`compilerOptions.syntax`, or a top-level
  `syntax`); without one, the default is 2.0.
- A file with `#syntax 2.0` or `#syntax 2.1` overrides the project default. The
  `--syntax=2.1` flag overrides the configuration for a single command.
- An unknown version (`#syntax 3.0`) is a compile error (`PS1005`); it never
  silently falls back.
- A pragma anywhere except the first line is an ordinary comment.
- Dialects are per file. A 2.0 module can import a 2.1 module and vice versa.
- `plainscript fmt` preserves the pragma.

Comments start with `#` and run to the end of the line. There are no block
comments.

## 2. Bindings

```plainscript
#syntax 2.1

import { print } from "std/io"

value name is "Ada"        # immutable
set count to 0             # mutable
change count to count + 1  # assignment

print("{name} has {count}")
```

| Concept | 2.1 | 2.0 |
| --- | --- | --- |
| Immutable | `value x is 1` (alias: `val x is 1`) | `const x = 1` |
| Mutable | `set x to 1` | `let x = 1` |
| Assignment | `change x to 2` | `x = 2` |
| Compound assignment | `change x to x + 1` | `x += 1` |
| Type annotation | `value x: number is 1` | `const x: number = 1` |

`val` is an accepted short spelling of `value` everywhere a binding can start,
including destructuring and `export`: `val Messi is 3` and `export val rating is 10`
mean exactly what `value … is …` means. It is contextual like `value`, so it stays
usable as a parameter or variable name.

Destructuring works with both words:

```plainscript
#syntax 2.1

import { print } from "std/io"

value { width, height } is { width: 3, height: 4 }
set label to "box"

print("{label}: {width * height}")
```

`change` also assigns through members and indexes:

```plainscript
#syntax 2.1

import { print } from "std/io"

set user to { name: "Ada", tags: ["first"] }
change user.name to "Grace"
change user.tags[0] to "updated"

print("{user.name}: {user.tags[0]}")
```

A `value` cannot be reassigned; the checker reports it. Bindings are block
scoped and shadowing an outer binding is allowed.

## 3. Text and interpolation

Double-quoted text interpolates `{expression}` and supports escapes. Single
quotes are raw; triple quotes are multiline.

```plainscript
#syntax 2.1

import { print } from "std/io"

value name is "world"
value multiline is """
two
lines"""

print("Hello, {name}!")
print(multiline)
print('raw {name} stays literal')
```

Interpolation accepts any expression, including comparison phrases. Its value
uses JavaScript string conversion.

## 4. Types

### Primitives and collections

```plainscript
#syntax 2.1

import { print } from "std/io"
import { fromEntries } from "std/map"

value title: text is "counts"
value quantity: number is 3
value active: boolean is true
value missing: nothing is nothing
value names: list of text is ["ada", "grace"]
value lookup: map of text to number is fromEntries([{ key: "ada", value: 1 }])
value pattern: regex is /ada/i

print("{title}: {quantity} {active} {missing}")
print(names)
print(lookup)
```

`any` is the untyped boundary. `unknown` must be narrowed before use. `never`
is the empty type.

### Records

```plainscript
#syntax 2.1

import { print } from "std/io"

type User
    id: number
    name: text
    nickname?: text
end

value user: User is { id: 1, name: "Ada" }
print(user.name)
```

Records are structural: any value with at least the required fields is accepted.
`readonly` fields cannot be assigned through.

### Variants and unions

```plainscript
#syntax 2.1

import { print } from "std/io"

type Shape = Circle(radius: number) or Rectangle(width: number, height: number) or Empty

define area(shape: Shape) returns number
    match shape
    case Circle(radius)
        return 3 * radius * radius
    case Rectangle(width, height)
        return width * height
    case Empty
        return 0
    end
end

print(area(Circle(2)))
print(area(Rectangle(2, 5)))
print(area(Empty))
```

Variant constructors are values: `Circle(2)` has type `Circle`, which is
assignable to `Shape`.

### Optionals and type tests

```plainscript
#syntax 2.1

import { print } from "std/io"

define find(values: list of number, target: number) returns number?
    for each value in values
        when value is equal to target
            return value
        end
    end
    return nothing
end

value found is find([1, 2, 3], 2)

when found is nothing
    print("missing")
otherwise
    print("found {found}")
end

value raw: any is "text"
when raw is text
    print(raw)
end
```

`is` is a type test in expression position. The comparison phrases in section 9
are separate, complete word sequences.

### Generics, constraints and predicates

```plainscript
#syntax 2.1

import { print } from "std/io"

define first<T>(values: list of T) returns T?
    for each value in values
        return value
    end
    return nothing
end

define keys<T: { id: number }>(value: T) returns number
    return value.id
end

define isText(value: any) returns value is text
    return value is text
end

print(first([10, 20]))
print(keys({ id: 7 }))
print(isText("yes"))
```

Type parameters live between the function name and the parameter list.
Constraints use a colon. Predicates use `returns value is Type`.

### Function types, tuples and advanced types

```plainscript
#syntax 2.1

import { print } from "std/io"

type Pair = [number, text]
type Mapper = (number) -> number
type FieldNames<T> = { [K in keyof T]: T[K] }

define apply(mapper: Mapper, value: number) returns number
    return mapper(value)
end

value pair: Pair is [1, "one"]
value doubled is apply((value: number) => value * 2, 21)

print(pair[0])
print(doubled)
```

Conditional types (`T extends U ? X : Y`), mapped types, `keyof`, indexed access,
literal types and intersections (`&`) are also implemented. Readonly is a
compile-time assignment check, not runtime immutability.

## 5. Functions

```plainscript
#syntax 2.1

import { print } from "std/io"

define greet(name: text, punctuation: text = "!") returns text
    return "Hello, {name}{punctuation}"
end

define rest(prefix: text, ...values: list of number) returns text
    return "{prefix}: {values}"
end

async define double(value: number) returns number
    return value * 2
end

print(greet("Ada"))
print(rest("numbers", 1, 2, 3))

async define main() returns nothing
    print(await double(21))
end

await main()
```

| Concept | 2.1 | 2.0 |
| --- | --- | --- |
| Declaration | `define f() returns T` | `function f() -> T` |
| Async | `async define f() returns T` | `async function f() -> T` |
| Return type | `returns T` | `-> T` |
| Type arrow | `(number) -> number` | `(number) -> number` |

Inside a type, `->` remains the function arrow in both dialects. In a declaration
either `returns` or `->` is accepted in 2.1; documentation uses `returns`.

Lambdas keep the 2.0 form:

```plainscript
#syntax 2.1

import { print } from "std/io"
import { map } from "std/list"

value doubled is map([1, 2, 3], (value: number) => value * 2)
print(doubled)
```

A lambda whose body is a block uses `do … end`. Async lambdas are written
`async (value: number) => …`.

Function overloading and type predicates are available through `overload
define` / `overload function` and `returns value is T`. Return types are
required for declarations; lambda parameter and result types are inferred from
context where possible.

## 6. Conditionals and match

```plainscript
#syntax 2.1

import { print } from "std/io"

define classify(value: number) returns text
    when value is greater than 0
        return "positive"
    otherwise when value is less than 0
        return "negative"
    otherwise
        return "zero"
    end
end

print(classify(4))
print(classify(-4))
print(classify(0))
```

| Concept | 2.1 | 2.0 |
| --- | --- | --- |
| If | `when` | `if` |
| Else if | `otherwise when` | `else if` |
| Else | `otherwise` | `else` |

`match` keeps its spelling and adds `otherwise` as the fallback arm:

```plainscript
#syntax 2.1

import { print } from "std/io"

define label(value: number) returns text
    match value
    case 0
        return "zero"
    case 1
        return "one"
    otherwise
        return "many"
    end
end

print(label(0))
print(label(9))
```

Arms may guard with `when`:

```plainscript
#syntax 2.1

import { print } from "std/io"

value command is "deploy"

match command
case text when command is not equal to ""
    print("handling {command}")
otherwise
    print("empty command")
end
```

## 7. Loops

```plainscript
#syntax 2.1

import { print } from "std/io"

for each item in ["a", "b"]
    print(item)
end

for i from 1 to 3
    print(i)
end

set count to 0
while count is less than 2
    change count to count + 1
end

for each item in ["skip", "stop", "never"]
    when item is equal to "skip"
        continue
    end
    when item is equal to "stop"
        break
    end
    print(item)
end
```

| Concept | 2.1 | 2.0 |
| --- | --- | --- |
| Each value | `for each x in xs` | `for x in xs` |
| Numeric range | `for i from 0 to 9` | `for i in 0 to 9` |
| While | `while condition` | `while condition` |

`break` and `continue` are unchanged. The range is inclusive.

`each` is an ordinary identifier as well as a loop marker. When a binding name
follows it, `each` opens a foreach loop; when `in` or `from` follows it, the
variable itself is named `each`:

```plainscript
#syntax 2.1

import { print } from "std/io"

for each in ["a", "b"]
    print(each)
end

for each from 1 to 2
    print(each)
end
```

## 8. Errors

```plainscript
#syntax 2.1

import { print } from "std/io"

define divide(a: number, b: number) returns number or nothing
    when b is equal to 0
        throw "division by zero"
    end
    return a / b
end

try
    print(divide(10, 2))
    print(divide(1, 0))
catch failure
    print("failed: {failure}")
finally
    print("cleanup")
end
```

`try`, `catch` and `finally` are unchanged; each block closes with `end`.
`catch` binds the thrown value as `any`. There is no checked exception type;
typed operational failures use `std/contract`'s result types.

## 9. Operators

| Meaning | 2.1 phrase | Symbol |
| --- | --- | --- |
| Equal | `is equal to` | `==` |
| Not equal | `is not equal to` | `!=` |
| Greater | `is greater than` | `>` |
| Less | `is less than` | `<` |
| At least | `is at least` | `>=` |
| At most | `is at most` | `<=` |

Phrases lower to the symbolic operators before parsing, so they have exactly the
same precedence and code generation. Both spellings are accepted in 2.1 for
migration; phrase operators are the documented form.

```plainscript
#syntax 2.1

import { print } from "std/io"

print(2 is equal to 2)
print(2 is not equal to 3)
print(3 is greater than 2)
print(1 is less than 2)
print(2 is at least 2)
print(2 is at most 2)
print(true and not false)
print(1 is equal to 1 or 2 is equal to 3)
```

`and`, `or`, `not`, `??`, `?.`, `|>` and all arithmetic operators are shared with
2.0. `not` is unary and binds tighter than a comparison; parenthesise when in
doubt.

## 10. Regular expressions

Regex literals are native expressions typed as `regex` and emitted as native
JavaScript `RegExp` values. A `/` is division after a value and starts a regex
where an expression is expected.

```plainscript
#syntax 2.1

import { print } from "std/io"

value pattern is /item-(?<id>\d+)/i
print(pattern.test("ITEM-42"))
print(pattern.source)
print(pattern.flags)
print(pattern is regex)
print(10 / 2)
```

`std/text` provides typed helpers for captures, named groups, replacement and
splitting. A `RegexMatch` has `text`, `index`, positional `groups` and a `named`
map.

```plainscript
#syntax 2.1

import { print } from "std/io"
import { findMatch, matchTexts, replaceAllMatches } from "std/text"

set found to findMatch("release-2.2", /release-(?<major>\d+)\.(?<minor>\d+)/)
when found is not equal to nothing
    print(found.text)
    print(found.named["major"])
    print(found.named["minor"])
end

print(matchTexts("a1 b2", /[a-z]\d/))
print(replaceAllMatches("a1b22", /\d+/g, "#"))
```

Invalid patterns and flags are compile-time diagnostics (`PS1006`–`PS1008`).
The pattern engine is the host JavaScript engine; flags, lookaround, Unicode
and replacement syntax are the host's. See [Regular expressions](REGEX.md).

## 11. Modules

```plainscript
#syntax 2.1

import { print } from "std/io"
import { upper } from "std/text"

export value version is "2.3.1"

export define shout(text: text) returns text
    return upper("{text}!")
end

print(shout("hello"))
```

Imports and exports are unchanged in both dialects:

- `import { x } from "./module"` — relative `.pln` sources, emitted as `.js`.
- `import defaultName from "package"` — npm/Node packages pass through.
- `import * as name from "./module"`.
- `import "side-effect"`.
- `export`, `export default`, `export { a as b }`, `export { a } from "./m"`.
- Type-only imports are erased.

## 12. Components

```plainscript
#syntax 2.1

import { createElement, useState } from "react"

export define Counter() returns any
    set (count, setCount) to useState(0)

    render
        element "div" with className: "counter"
            element "p"
                "Count: {count}"
            end
            element "button" with onClick: () => setCount(count + 1)
                "Increment"
            end
        end
    end
end
```

`render` returns the expression; `element` builds a child. Attributes use
`with name: value`, children are statements, and `...list` inserts a dynamic
list. A `for each`/`for … from … to`/`while`/`when`/`match` child builds its
own part of the list, so a keyed list needs no helper function:

```plainscript
#syntax 2.1

import { createElement } from "react"

export define TaskList() returns any
    value tasks is [
        { id: 1, title: "write the docs" },
        { id: 2, title: "ship 2.1" },
    ]

    render
        element "ul"
            for each task in tasks
                element "li" with key: task.id
                    task.title
                end
            end
        end
    end
end
```

`element Fragment` renders sibling children without a wrapper element. Keys are
explicit; there is no automatic key inference. Everything lowers to
`createElement` from the module scope, so React (or another library exposing
`createElement`) must be imported.

## 13. JSX

JSX is parsed natively in a `.pln` file. The default classic runtime lowers
elements to `createElement`; the automatic runtime imports `jsx`/`jsxs` from a
configured package. Props on local components are checked when the component has
a record prop type.

```plainscript
#syntax 2.1

import { createElement, Fragment, useState } from "react"
import { map } from "std/list"

type TaskProps
    title: text
    done?: boolean
end

define Task(props: TaskProps) returns any
    return <li className="task">
        <span>{props.title}</span>
        <small>{props.done ?? false}</small>
    </li>
end

export define TaskList() returns any
    set (tasks, setTasks) to useState([
        { title: "write the docs", done: true },
        { title: "ship 2.2", done: false },
    ])
    return <Fragment>
        <ul>
            {tasks |> map((task: { title: text, done: boolean }) => <Task title={task.title} done={task.done} />)}
        </ul>
        <button type="button" onClick={() => setTasks([])}>Clear</button>
    </Fragment>
end
```

The automatic mode is selected per file:

```plainscript
#syntax 2.1
# @jsxRuntime automatic
# @jsxImportSource react

export define App() returns any
    return <main>
        <h1>Automatic runtime</h1>
    </main>
end
```

Pragmas override `plainscript.config.json`. Fragments, spread attributes,
expression children, entities and custom classic factories are supported. JSX
diagnostics include `PS1009`–`PS1014` and prop errors `PS3420`–`PS3422`. See
[JSX and React](JSX.md).

## 14. Interop boundaries

```plainscript
#syntax 2.1

import { print } from "std/io"

declare const process: any
declare function setTimeout(callback: () -> nothing, milliseconds: number) -> any

value started is process.hrtime()
setTimeout(() => do
    print("timer fired")
end, 1)
print(started != nothing)
```

Declare JavaScript values with `declare`. Use `any` for values whose shape is
not modelled, and `as` for an explicit unchecked cast. `plainscript interop`
translates the supported TypeScript `.d.ts` subset to `.d.pln`.

## 15. 2.0 alongside 2.1

The 2.0 dialect remains fully supported. Its spelling for every concept in this
reference is listed in the tables above, and
[the specification](SPEC.md) describes both. A module written in each style can
share types and values:

```plainscript
#syntax 2.1

import { print } from "std/io"

# `combine` lives in a 2.0 module in a real project.
define combine(left: number, right: number) returns number
    return left + right
end

print(combine(20, 22))
```

When migrating, add `#syntax 2.1` and then rename the constructs the compiler
reports. `PS2030` names the 2.1 word to use. See
[Migrating from 2.0](MIGRATION_2_1.md).

## 16. Cross-language boundaries

`plainscript bridge` serves exported functions over newline-delimited JSON-RPC
2.0, and `std/bridge` calls another process that speaks the same protocol.
Generated clients translate the manifest into Python, JavaScript, C, C++, Java,
Kotlin, Go, Rust, Ruby, PHP, C#, Swift and Dart.

```plainscript
#syntax 2.1

import { open, close } from "std/bridge"
import { print } from "std/io"

set python to open("python3", ["service.py"])
print(await python.request("add", [2, 3]))
close(python)
```

The other side receives `{"jsonrpc":"2.0","id":1,"method":"add","params":[2,3]}`
and replies with a result or a structured error. The boundary is a process
boundary: values are JSON, memory is not shared, and a crash stays on its side.
See [Cross-language bridges](CROSS_LANGUAGE.md).

## 2.3 language additions

### Classes

```
import { print } from "std/io"

class Account
    owner: text
    readonly id: number
    static nextId: number = 1

    constructor(owner: text)
        this.owner = owner
        this.id = Account.nextId
        Account.nextId += 1
    end

    function label() -> text
        return "{this.owner} #{this.id}"
    end

    static function reset() -> nothing
        Account.nextId = 1
    end
end

class Admin extends Account
    constructor(owner: text)
        super(owner)
    end
    function label() -> text
        return "{super.label()} (admin)"
    end
end

let admin = new Admin("Ada")
print(admin.label())
print("{admin is Account}")
```

Classes use `function` for methods, just like free functions. Fields need a
type or an initializer. A constructor is optional. `static` and `readonly` are
contextual identifiers in class bodies.

Generic classes use the same angle-bracket syntax as generic functions:

```
class Box<T>
    value: T
    constructor(value: T)
        this.value = value
    end
    function map<U>(transform: (T) -> U) -> Box<U>
        return new Box(transform(this.value))
    end
end
```

### Ternaries, BigInt, records and comments

```
let count = 1
let label = count > 0 ? "some" : "none"
let large = 12345678901234567890n
let key = "answer"
let name = "Ada"
let record = { [key]: 42, name }
/* nested /* comments */ are fine */
```

### Generators

```
import { print } from "std/io"

generator function squares(limit: number) -> number
    let index = 1
    while index <= limit
        yield index * index
        index += 1
    end
end

for square in squares(3)
    print(square)
end
```

### Typed errors

```
import { print } from "std/io"

class ConfigError extends Error
    key: text
    constructor(key: text)
        super("missing config {key}")
        this.key = key
    end
end

function setting(key: text) throws ConfigError
    if key == "port"
        return "8080"
    end
    throw new ConfigError(key)
end

try
    print(setting("host"))
catch error: ConfigError
    print("missing {error.key}")
end
```

### Decorators

```
function tagged(value: any) -> any
    return value
end

class Greeter
    @tagged
    function greet(name: text) -> text
        return "hello {name}"
    end
end
```

A decorator is an expression that receives the decorated value and returns its
replacement.

### Iteration helpers

```
import { print } from "std/io"
import { range, map, toList } from "std/iter"

let doubled = toList(map(range(1, 4), (value: number) => value * 2))
print(doubled)
```
