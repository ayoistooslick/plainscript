# Migrating to PlainScript 2.3

2.3 is additive. Programs that compiled under 2.0, 2.1 or 2.2 compile under
2.3 without source changes. The one exception is a deliberate tightening: a
`throws` clause now checks the thrown class nominally, so a function that
declares `throws TypeError` can no longer throw a `RangeError` that happens to
have the same fields. Remove the clause to keep the old unchecked behaviour.

## New language surface

| Feature | Syntax |
| --- | --- |
| Classes | `class Name`, `constructor(...)`, `function method(...)`, `static`, `extends`, `super`, `this` |
| Ternary | `condition ? whenTrue : whenFalse` |
| Generators | `generator function f(...) -> Element`, `yield value`, `Iterator of Element` |
| Typed errors | `function f(...) throws AppError`, `catch error: AppError` |
| Decorators | `@decorator` above a class, function, method or field |
| BigInt | `123n`, `0xffn`, `0b1010n`, type `bigint` |
| Computed keys | `{ [expression]: value }` |
| Object shorthand | `{ name }` |
| Block comments | `/* ... */`, nested |

`class` and `throws` are contextual keywords, so existing variables named
`class` or `throws` still work.

## Classes

```plainscript
class AppError extends Error
    code: number
    readonly retryable: boolean

    constructor(message: text, code: number)
        super(message)
        this.code = code
        this.retryable = code >= 500
    end

    function describe() -> text
        return "{this.message} ({this.code})"
    end

    static function wrap(error: Error) -> AppError
        return new AppError(error.message, 500)
    end
end
```

- Methods are declared with `function`, exactly like free functions.
- A class without a constructor gets an implicit zero-argument constructor.
- Fields must be assigned before the constructor returns; `readonly` fields may
  only be assigned in the constructor.
- `x is C` and `x is not C` lower to `instanceof`.
- Generic classes infer their constructor arguments: `new Box(3)` is `Box<number>`.
- A class is both a value and a type. `export class` exports both halves.

## Typed errors

```plainscript
function load(id: text) throws NotFoundError or DatabaseError
    ...
end

try
    try
        load("a")
    catch error: NotFoundError
        print("missing")
    end
catch error: DatabaseError
    print("database")
end
```

PlainScript has one catch clause per `try`, as JavaScript does; nest `try`
blocks when you need more than one typed handler. A mismatch is rethrown at
run time, so a `catch error: NotFoundError` handler receives only values that
really are `NotFoundError` instances.

Omitting `throws` keeps the historical unchecked behaviour. `throws nothing`
forbids throwing entirely.

## Generators

```plainscript
generator function pages(first: number, last: number) -> number
    let page = first
    while page <= last
        yield page
        page += 1
    end
end

for page in pages(1, 3)
    print(page)
end
```

A generator's return annotation names the yielded element type; its call type
is `Iterator of Element`. Generators cannot return a final value.

## Tooling

- `plainscript bundle <entry>` writes a single ES module. Package and standard
  library imports stay external; internal modules become scoped wrappers.
  Exported `let` bindings are rejected rather than silently freezing ESM live
  bindings.
- `plainscript build` keeps a persistent per-file cache in
  `.plainscript/build-cache.json`. A file is reused only when its source,
  compiler version, configuration and every local declaration dependency are
  unchanged. `--no-cache` disables it.
- The compiler folds literal arithmetic and removes unreachable statements by
  default; `--no-optimize` keeps the raw HIR.
- `plainscript interop` now translates TypeScript classes into real
  `declare class` declarations with constructor, static, accessor and method
  signatures. `Partial`, `Required`, `Readonly`, `Pick`, `Record`, `Date`,
  `Error`, `RegExp`, `bigint` and `Function` are translated; unsupported
  utility types widen with an explicit `PS7005` warning instead of silently
  disappearing.

## Standard library additions

`std/iter`, `std/reflect`, `std/bigint`, `std/env`, `std/process`, `std/crypto`,
`std/compress`, `std/stream`, `std/worker` and `std/net` join the existing
modules. See the language reference for their exported functions.
