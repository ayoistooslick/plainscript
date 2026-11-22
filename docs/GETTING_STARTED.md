<!-- compile-examples -->

# Getting started with PlainScript 2.1

PlainScript is a statically typed language that compiles to JavaScript. You
write a `.pln` file, the compiler checks it, and you run the emitted ES module
with Node, Vite, Next.js or any other JavaScript toolchain.

This guide uses the 2.1 dialect. If you have a 2.0 codebase, read
[Migrating from 2.0](MIGRATION_2_1.md); nothing breaks until you add the pragma.

## 1. Install

PlainScript needs Node.js 20 or newer. From a clone of the repository:

```bash
node src/cli.js version
```

Once the package is installed, the `plainscript` command replaces
`node src/cli.js`:

```bash
npm install plainscript-lang
npx plainscript version
```

## 2. Your first program

Create `hello.pln`. The first line opts this file into the 2.1 dialect:

```plainscript
#syntax 2.1

import { print } from "std/io"

define greet(name: text) returns text
    return "Hello, {name}!"
end

print(greet("world"))
```

Run it:

```bash
node src/cli.js run hello.pln
```

```text
Hello, world!
```

`run` compiles in memory and executes the result. To see the JavaScript:

```bash
node src/cli.js build hello.pln
```

The emitted module contains a normal `function greet(name)` and
`console.log`. There is no runtime library.

## 3. Bindings

`value` binds a name that cannot be reassigned; `set` binds one that can;
`change` assigns to an existing mutable binding.

```plainscript
#syntax 2.1

import { print } from "std/io"

value maxAttempts is 3
set attempts to 0

while attempts is less than maxAttempts
    change attempts to attempts + 1
    print("attempt {attempts} of {maxAttempts}")
end
```

Locals are checked. Assigning to a `value` is a compile error, and so is using
a name that was never declared.

## 4. Types and functions

Types are written after a colon in a parameter list, and a function's result
follows `returns`.

```plainscript
#syntax 2.1

import { print } from "std/io"
import { filter } from "std/list"

type Task
    id: number
    title: text
    done: boolean
end

define openTasks(tasks: list of Task) returns list of Task
    return tasks
        |> filter((task: Task) => not task.done)
end

value tasks: list of Task is [
    { id: 1, title: "write the compiler", done: true },
    { id: 2, title: "ship 2.1", done: false },
]

for each task in openTasks(tasks)
    print("{task.id}. {task.title}")
end
```

`|>` is the pipeline operator: the value on the left becomes the first argument
of the call on the right.

## 5. Conditionals and loops

```plainscript
#syntax 2.1

import { print } from "std/io"

define describe(score: number) returns text
    when score is at least 90
        return "excellent"
    otherwise when score is at least 60
        return "passing"
    otherwise
        return "needs work"
    end
end

for i from 1 to 3
    print("{i}: {describe(i * 30)}")
end

for each word in ["alpha", "beta"]
    print(word)
end
```

Every block closes with `end`. Indentation is for readers; the compiler uses
`end`.

## 6. Optional values and errors

`T?` is `T or nothing`. Narrow it with `is nothing` before using it. Errors are
handled with `try`, `catch` and `finally`; `throw` takes any value.

```plainscript
#syntax 2.1

import { print } from "std/io"
import { parseNumber } from "std/text"

define parseAge(raw: text) returns number?
    set parsed to parseNumber(raw, -1)
    when parsed is less than 0
        return nothing
    end
    return parsed
end

define report(raw: text) returns text
    set age to parseAge(raw)
    when age is nothing
        return "not a number: {raw}"
    end
    return "age: {age}"
end

try
    print(report("42"))
    print(report("forty"))
    throw "demonstrating catch"
catch failure
    print("caught: {failure}")
finally
    print("done")
end
```

## 7. Modules and npm packages

A `.pln` file is an ES module. Relative imports use `.pln` paths and are emitted
with `.js`; package and Node built-in imports pass through unchanged.

```plainscript
#syntax 2.1

import { print } from "std/io"
import { join } from "node:path"
import { existsSync } from "node:fs"

declare const process: any

value here is process.cwd()
print(join(here, "src"))
print(existsSync(join(here, "package.json")))
```

Packages without TypeScript declarations are `any` at the boundary. Add
`declare` statements for the parts you rely on, or keep the values in explicitly
typed PlainScript code as soon as possible.

## 8. A project

`plainscript new` writes a project:

```bash
node src/cli.js new my-app
cd my-app
npm install
npm run build
```

The default project has `src/main.pln`, a `package.json` with a build script,
and a `plainscript.config.json` that maps `src/` to `dist/`.

```text
my-app/
  package.json
  plainscript.config.json
  src/main.pln        # compiled to dist/main.js
```

`plainscript build` reads the config, compiles the module graph and writes one
ES module per source file. `plainscript watch` rebuilds on change.

## 9. JSX, regex and other languages

Native JSX is available in `.pln` files. A component needs the React factory in
scope for the classic runtime:

```plainscript
#syntax 2.1

import { createElement } from "react"

export define Badge(props: { label: text }) returns any
    return <span className="badge">{props.label}</span>
end
```

Regex literals are values typed as `regex`:

```plainscript
#syntax 2.1

import { print } from "std/io"

value pattern is /^[a-z]+$/i
print(pattern.test("PlainScript"))
print("PlainScript" is regex)
```

To use PlainScript from Python, Java, Go, C or another runtime, expose a module
over the bridge and generate a client:

```bash
plainscript bridge src/service.pln --call=add --args='[2, 3]'
plainscript bindings src/service.pln --out=bindings
```

- [JSX and React](JSX.md)
- [Regular expressions](REGEX.md)
- [Cross-language bridges](CROSS_LANGUAGE.md)

## 10. Where to go next

- [Language reference](LANGUAGE_REFERENCE.md) — every construct, with the 2.0
  spelling beside it.
- [Integrations](INTEGRATIONS.md) — Express, React + Vite, Next.js, HTTP and
  SQLite projects that are built and tested in this repository.
- [Type system](TYPE_SYSTEM.md) — generics, unions, narrowing, variants and
  advanced types.
- [Compiler](COMPILER.md) — how source becomes JavaScript.
- [Migrating to 2.2](MIGRATION_2_2.md) — analysis, conversion and boundaries.
- [CLI reference](CLI.md) — every command and flag.
