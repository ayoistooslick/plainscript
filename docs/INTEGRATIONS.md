<!-- compile-examples -->

# Integrations

PlainScript emits ordinary ES modules. Any JavaScript framework that accepts a
module works without a plugin, a runtime shim or a custom bundler.

This page covers the eight integrations in [`integrations/`](../integrations).
Each example is a complete program compiled by the test suite; the full projects
are built and executed by `npm test` and `npm run verify:integrations`.

| Integration | Verified by |
| --- | --- |
| Express 5 | HTTP session in `npm test` |
| React + Vite | React SSR in `npm test`; Vite production build in `npm run verify:integrations` |
| Next.js 15 | `next build` and prerendered HTML in `npm run verify:integrations` |
| Async HTTP | real server + client in `npm test` |
| SQLite | inserts, queries, aggregate and rollback in `npm test` |
| CLI application | argument parsing, JSON persistence and exit codes in `npm test` |
| Multi-module project | `build --declarations`, emitted modules and cross-module types in `npm test` |
| Full-stack app | Express + SQLite CRUD, restart persistence and React SSR in `npm test` |

## Express 5

Express is an untyped JavaScript package, so the app object and request handlers
are `any` deliberately. Everything else stays typed.

```plainscript
#syntax 2.1

import express from "express"
import { print, env } from "std/io"
import { parseNumber } from "std/text"

set app to express()
app.use(express.json())

app.get("/health", (request: any, response: any) => do
    response.json({ status: "ok" })
end)

app.post("/items", (request: any, response: any) => do
    set body to request.body
    when body is map of text to any
        response.status(201).json({ received: body })
    otherwise
        response.status(400).json({ error: "JSON object required" })
    end
end)

set port to parseNumber(env("PORT", "4501"))
app.listen(port, () => do
    print("express listening on {port}")
end)
```

Run the full project:

```bash
cd integrations/express-api
npm install
npm start
```

The test suite starts the compiled server, checks `/health`, creates, updates and
deletes a note, and asserts the 400 and 404 responses.

## React + Vite

`render` and `element` lower to `createElement`. A PlainScript component is an
ordinary React function component, so hooks, event handlers and keys behave
exactly as documented by React.

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

Build the Vite project:

```bash
cd integrations/react-vite
npm install
npm run build
```

The build compiles `src/App.pln` to `src/generated/App.js` and bundles it with
Vite. The test suite renders the component through `react-dom/server` and
asserts the produced markup.

## Next.js 15

A Next.js server component is the same function component. The project compiles
`app/Home.pln` to `app/generated/Home.js`; `app/page.js` imports it.

```plainscript
#syntax 2.1

import { createElement } from "react"

export define Home() returns any
    render
        element "main" with className: "page"
            element "h1"
                "Rendered by Next.js"
            end
            element "p"
                "This markup came from a PlainScript component."
            end
        end
    end
end
```

Build the Next.js project:

```bash
cd integrations/next-app
npm install
npm run build
```

`npm run verify:integrations` runs the production build and checks that the
prerendered HTML contains the component's markup.

## Async HTTP

`std/http` accepts and returns Web-standard `Request` and `Response` objects on
top of Node's HTTP server. `fetchJson` uses the platform `fetch`.

```plainscript
#syntax 2.1

import { serve, json, fetchJson } from "std/http"
import { print } from "std/io"
import { parseNumber } from "std/text"

type Status
    ok: boolean
    message: text
end

set port to 4503
set server to await serve(port, (request: any) => json({ ok: true, message: "hello" }))

set status to await fetchJson("http://127.0.0.1:{port}/status") as Status
print(status.message)

server.close()
```

`integrations/http-client` runs this pattern end to end: it starts a server,
performs two asynchronous requests, prints the responses and closes the server.

## SQLite

Node's built-in `node:sqlite` driver is used directly. Prepare statements once,
bind every value, and narrow rows into records at the boundary.

```plainscript
#syntax 2.1

import { print } from "std/io"
import { DatabaseSync } from "node:sqlite"

type Task
    id: number
    title: text
    done: boolean
end

set database to new DatabaseSync(":memory:")
database.exec("create table tasks (id integer primary key autoincrement, title text not null, done integer not null default 0)")

set insertTask to database.prepare("insert into tasks (title, done) values (?, ?)")
insertTask.run("write the compiler", 0)
insertTask.run("ship 2.1", 1)

for each row in database.prepare("select id, title, done from tasks order by id").all() as list of any
    set task: Task to { id: row.id as number, title: row.title as text, done: row.done is equal to 1 }
    print("{task.id}. {task.title} — done: {task.done}")
end

database.close()
```

`integrations/sqlite` also exercises updates, an aggregate query, and a
transaction that is rolled back.

## Command-line application

`integrations/cli-app` is a typed task tracker. It reads its arguments from
`std/io`, stores JSON through `std/fs` and `std/json`, and exits 2 on a usage
error and 1 when a task does not exist.

```plainscript
#syntax 2.1

import { print, eprint, args, exit } from "std/io"
import { encode } from "std/json"
import { append, count } from "std/list"

type Task
    id: number
    title: text
    done: boolean
end

set arguments to args()
set tasks: list of Task to []

when count(arguments) is equal to 0
    eprint("usage: add <title> | list")
    exit(2)
end

when arguments[0] is equal to "add"
    set rawTitle to arguments[1]
    set title to ""
    when rawTitle is text
        change title to rawTitle
    end
    when title is equal to ""
        eprint("add needs a title")
        exit(2)
    end
    change tasks to append(tasks, { id: count(tasks) + 1, title: title, done: false })
end

print(encode(tasks, 2))
```

`std/io`'s `args()` returns `list of text`, so the element access is optional
and is narrowed once with `is text`; that is the same rule as any other optional
value.

## Multi-module project

`integrations/multi-module` is a three-module program (`main.pln`, `cart.pln`,
`money.pln`) with types crossing every boundary. A type travels with the value
import; there is no separate type-import syntax, and the emitter drops imports
that are only used in type positions.

```plainscript
#syntax 2.1

# money.pln — the leaf module.
export type Money
    amount: number
    currency: text
end

export define money(amount: number, currency: text) returns Money
    return { amount: amount, currency: currency }
end

export define add(left: Money, right: Money) returns Money
    when left.currency is not equal to right.currency
        throw "cannot add {right.currency} to {left.currency}"
    end
    return money(left.amount + right.amount, left.currency)
end
```

`plainscript build --declarations` writes one `.js` and one `.d.pln` per module,
so `cart.d.pln` describes `LineItem` in terms of `Money` for other tools.

## Full-stack application

`integrations/fullstack` is one application with four modules: shared types, a
SQLite repository, an Express server and a React client. The server and the
repository are ordinary modules; the client imports the same `Note` type.

```plainscript
#syntax 2.1

import { open } from "std/db"
import { print } from "std/io"

type Note
    id: number
    body: text
    done: boolean
end

set database to await open(":memory:")
database.exec("create table notes (id integer primary key autoincrement, body text not null, done integer not null default 0)")
database.run("insert into notes (body, done) values (?, 0)", ["ship 2.1"])

for each row in database.query("select id, body, done from notes")
    set note: Note to { id: row.id as number, body: row.body as text, done: row.done is equal to 1 }
    print("{note.id}. {note.body} (done: {note.done})")
end

database.close()
```

The repository exposes a `NoteRepository` record of closures, so the server
cannot call a method the repository does not implement. The test suite starts
the server, creates, completes and deletes notes over HTTP, restarts it against
the same database file to confirm persistence, and renders the React component
through `react-dom/server`.

## Other frameworks

The rule is the same for every framework: if it can import an ES module that
exports functions, it can use PlainScript. Build the `.pln` files first
(`plainscript build`), point the framework at the generated `.js`, and keep the
framework's own configuration and entry points in JavaScript.

The templates in `templates/` cover React + Vite, Next.js, Express, a CLI and a
library; `demos/` contains larger examples, including a contracts demo shared
between a SQLite-backed API and a React client.
