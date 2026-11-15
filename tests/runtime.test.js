'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { runSource, runProject } = require('./helpers');

test('hello world runs', () => {
  const result = runSource('import { print } from "std/io"\nprint("hello")\n');
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'hello\n');
});

test('interpolation and arithmetic evaluate', () => {
  const result = runSource(`import { print } from "std/io"
let a = 2
let b = 3
print("{a} + {b} = {a + b}")
print("{2 ** 10}")
print("{7 % 4}")
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '2 + 3 = 5\n1024\n3\n');
});

test('lists, pipelines and stdlib compose', () => {
  const result = runSource(`import { print } from "std/io"
import { join, upper } from "std/text"
import { map, filter, reduce, range, sortBy } from "std/list"

let numbers = range(1, 5)
let evens = numbers |> filter((n: number) => n % 2 == 0)
let doubled = evens |> map((n: number) => n * 2)
let total = reduce(doubled, 0, (a: number, b: number) => a + b)
print(join(doubled |> map((n: number) => "{n}"), ","))
print("total={total}")
print(upper(join(["b", "a"] |> sortBy((v: text) => v), "-")))
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '4,8\ntotal=12\nA-B\n');
});

test('records, destructuring and optional fields work', () => {
  const result = runSource(`import { print } from "std/io"
type User
    name: text
    email?: text
end

let user: User = { name: "Ada" }
let { name } = user
print(name)
print("{user.email ?? "no email"}")
let (first, second) = ["one", "two"]
print("{first}-{second}")
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'Ada\nno email\none-two\n');
});

test('variants and exhaustive match run correctly', () => {
  const result = runSource(`import { print } from "std/io"
type Shape = Circle(radius: number) or Rect(width: number, height: number) or Empty

function area(shape: Shape) -> number
    match shape
        case Circle(r)
            return 3 * r * r
        case Rect(w, h)
            return w * h
        case Empty
            return 0
    end
end

print("{area(Circle(2))}")
print("{area(Rect(2, 5))}")
print("{area(Empty)}")
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '12\n10\n0\n');
});

test('match patterns bind records, lists and guards', () => {
  const result = runSource(`import { print } from "std/io"
import { count } from "std/list"
function describe(value: any) -> text
    match value
        case { kind: "user", name }
            return "user {name}"
        case [first, ...rest]
            return "list starting {first} with {count(rest)}"
        case n when n > 10
            return "big number"
        case "hello"
            return "a greeting"
        case _
            return "something else"
    end
end
print(describe({ kind: "user", name: "Ada" }))
print(describe([1, 2, 3]))
print(describe(42))
print(describe("text"))
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'user Ada\nlist starting 1 with 2\nbig number\nsomething else\n');
});

test('async functions await sequential work', () => {
  const result = runSource(`import { print } from "std/io"
import { sleep, elapsed, now } from "std/time"

async function work(started: number) -> number
    await sleep(10)
    return elapsed(started)
end

async function main() -> nothing
    let started = now()
    let took = await work(started)
    print("{took >= 5}")
end

main()
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'true\n');
});

test('try, catch, finally and throw behave like JavaScript', () => {
  const result = runSource(`import { print } from "std/io"
function risky() -> nothing
    throw "bad thing"
end
try
    risky()
catch failure
    print("caught: {failure}")
finally
    print("cleanup")
end
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'caught: bad thing\ncleanup\n');
});

test('loops support ranges, break and continue', () => {
  const result = runSource(`import { print } from "std/io"
let seen = ""
for i in 0 to 5
    when i == 1
        continue
    end
    when i == 4
        break
    end
    seen = "{seen}{i}"
end
print(seen)
let countdown = 3
while countdown > 0
    print(countdown)
    countdown -= 1
end
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '023\n3\n2\n1\n');
});

test('maps are plain objects and std/map works with them', () => {
  const result = runSource(`import { print } from "std/io"
import { set, get, has, keys, size } from "std/map"
let scores: map of text to number = {}
set(scores, "ada", 10)
set(scores, "grace", 12)
print(get(scores, "ada") ?? 0)
print(has(scores, "linus") ?? false)
print(size(scores))
print(keys(scores) |> (items: list of text) => items[0])
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '10\nfalse\n2\nada\n');
});

test('json round-trips through std/json', () => {
  const result = runSource(`import { print } from "std/io"
import { encode, decode } from "std/json"
let value = { name: "Ada", tags: ["math", "music"], active: true }
let text = encode(value)
let back = decode(text) as map of text to any
print(back.name)
print(back.tags[1])
print("{back.active}")
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'Ada\nmusic\ntrue\n');
});

test('type tests have real runtime behaviour', () => {
  const result = runSource(`import { print } from "std/io"
type Point
    x: number
    y: number
end
let value: any = { x: 1, y: 2 }
print("{value is Point}")
print("{value is list}")
print("{nothing is nothing}")
print("{1 is number}")
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'true\nfalse\ntrue\ntrue\n');
});

test('casts are erased at runtime', () => {
  const result = runSource('import { print } from "std/io"\nlet value = 1 as any as text\nprint(value)\n');
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '1\n');
});

test('command line arguments reach the program', () => {
  const result = runProject(
    { 'main.pln': 'import { print, args } from "std/io"\nimport { count } from "std/list"\nprint(args() |> (items: list of text) => count(items))\nprint(args()[0])\n' },
    'main.pln',
    ['hello', 'world'],
  );
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '2\nhello\n');
});

test('an uncaught throw exits non-zero', () => {
  const result = runSource('import { print } from "std/io"\nthrow "boom"\n');
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /boom/);
});

test('render blocks produce elements through the factory', () => {
  const result = runSource(`import { print } from "std/io"
import { count } from "std/list"

function createElement(tag: any, props: any, ...children: list of any) -> any
    let label = tag
    when props is map of text to any
        label = "{tag}[{props.kind ?? 'none'}]"
    end
    return "<{label}>{count(children)}"
end

function view(name: text) -> any
    render
        element "div" with kind: "card"
            "hello {name}"
            element "br" end
        end
    end
end

print(view("Ada"))`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '<div[card]>2\n');
});