'use strict';

// Regression coverage for the constructs that must work together: nested
// functions, conditionals, loops, match, try/catch/finally and async/await.
// Each test states the diagnostic contract, and the runtime test proves the
// generated JavaScript actually executes the composed program.

const { test } = require('node:test');
const assert = require('node:assert');

const { runSource, runProject, diagnosticsOf, codesOf } = require('./helpers');
const { parse } = require('../src/parser');
const { checkModule } = require('../src/checker');
const { CompileError } = require('../src/diagnostics');
const { showType } = require('../src/types');

function parseCodes(source) {
  try {
    parse(source, 'test.pln');
    return [];
  } catch (failure) {
    if (failure instanceof CompileError) return failure.diagnostics.map((diagnostic) => diagnostic.code);
    throw failure;
  }
}

function check(source) {
  const ast = parse(source, 'test.pln');
  return checkModule({ file: 'test.pln', source, program: ast });
}

const NESTED_PROGRAM = `type Size
    small: number
    large: number
end

function classify(value: number) -> text
    if value < 0
        return "negative"
    else if value == 0
        return "zero"
    else
        return "positive"
    end
end

function sum(values: list of number) -> number
    let total = 0
    for value in values
        if value > 0
            total += value
        end
    end
    return total
end

function safeDivide(a: number, b: number) -> number or nothing
    try
        if b == 0
            throw "division by zero"
        end
        return a / b
    catch failure
        if failure is text
            return nothing
        end
        return nothing
    finally
        let untouched = 1
    end
end

function describe(values: list of number) -> text
    match values
    case []
        return "empty"
    case [first]
        return classify(first)
    case [first, ...rest]
        for value in rest
            if value < first
                return "unsorted"
            end
        end
        return "sorted"
    end
end

function outer(value: number) -> number
    function inner(candidate: number) -> number
        if candidate > 10
            return 10
        end
        return candidate
    end
    return inner(value)
end

function nestedLoops(values: list of number) -> number
    let hits = 0
    for outerValue in values
        for innerValue in values
            if outerValue == innerValue
                if innerValue > 0
                    hits += 1
                end
            end
        end
    end
    return hits
end

let totals = [sum([1, 2, 3]), outer(42), nestedLoops([1, 2])]
`;

test('nested functions, conditionals, loops, match and try/catch compose without diagnostics', () => {
  const result = check(NESTED_PROGRAM);
  assert.deepStrictEqual(result.diagnostics.map((diagnostic) => diagnostic.code), []);
});

test('a try/catch block consumes only its own end', () => {
  // Two sibling try blocks, each with a catch, must not steal one another's
  // terminator, and code after them must still be checked.
  const source = `function attempt() -> number
    try
        return 1
    catch problem
        return 2
    end
end

function second() -> number
    try
        return 3
    catch problem
        return 4
    end
end

let value = attempt() + second()
`;
  const result = check(source);
  assert.deepStrictEqual(result.diagnostics.map((diagnostic) => diagnostic.code), []);
});

test('symbolic logical operators are rejected: and/or are the only spellings', () => {
  assert.ok(parseCodes('let flag = true && false').length > 0);
  assert.ok(parseCodes('let flag = true || false').length > 0);
  assert.deepStrictEqual(parseCodes('let flag = true and false\nlet other = false or true'), []);
});

test('function declaration parameters require a type annotation', () => {
  const codes = parseCodes('function identity(value) -> number\n    return value\nend');
  assert.ok(codes.includes('PS2001'), `expected PS2001, got ${codes.join(', ')}`);
});

test('lambda parameters may omit annotations when the expected type supplies them', () => {
  const diagnostics = diagnosticsOf(`declare function apply(callback: (number) -> number) -> number
let doubled = apply((value) => value * 2)
`);
  assert.deepStrictEqual(diagnostics.map((diagnostic) => diagnostic.code), []);
});

test('an async function call produces a Promise of its declared result', () => {
  const result = check(`async function work(value: number) -> number
    return value + 1
end

let pending = work(1)
`);
  assert.deepStrictEqual(result.diagnostics.map((diagnostic) => diagnostic.code), []);
  assert.strictEqual(showType(result.checker.global.lookup('pending').type), 'Promise of number');
});

test('await accepts an async call and a declared Promise', () => {
  const diagnostics = diagnosticsOf(`async function work(value: number) -> number
    return value + 1
end

declare const pending: Promise of text

async function run() -> number
    let first = await work(1)
    let label = await pending
    return first
end
`);
  assert.deepStrictEqual(diagnostics.map((diagnostic) => diagnostic.code), []);
});

test('await reports a non-Promise operand', () => {
  const codes = codesOf(`async function run() -> number
    let value = await 1
    return value
end
`);
  assert.ok(codes.includes('PS3327'), `expected PS3327, got ${codes.join(', ')}`);
});

test('await outside an async function is reported', () => {
  const codes = codesOf(`function run() -> number
    let value = await 1
    return value
end
`);
  assert.ok(codes.includes('PS3406'), `expected PS3406, got ${codes.join(', ')}`);
});

test('async lambdas may await, and their type is a Promise of the result', () => {
  const result = check(`declare function work(value: number) -> Promise of number

let later = async (value: number) => await work(value)
let pending: Promise of number = later(1)
`);
  assert.deepStrictEqual(result.diagnostics.map((diagnostic) => diagnostic.code), []);
  assert.strictEqual(showType(result.checker.global.lookup('later').type), '(value: number) -> Promise of number');
});

test('await inside a non-async lambda belongs to the lambda', () => {
  const codes = codesOf(`declare function work(value: number) -> Promise of number

let later = (value: number) => await work(value)
`);
  assert.ok(codes.includes('PS3406'), `expected PS3406, got ${codes.join(', ')}`);
});

test('named and anonymous default function exports compile and run', () => {
  const project = runProject({
    'lib/greet.pln': `export default function greet(name: text) -> text
    return "Hello, {name}!"
end
`,
    'lib/once.pln': `export default function () -> number
    return 7
end
`,
    'main.pln': `import greet from "./lib/greet"
import once from "./lib/once"
import { print } from "std/io"
print(greet("Ada"))
print(once())
`,
  }, 'main.pln');
  assert.strictEqual(project.status, 0, project.stderr);
  assert.strictEqual(project.stdout, 'Hello, Ada!\n7\n');
});

test('a default exported function can call itself', () => {
  const project = runProject({
    'lib/sum.pln': `export default function sumTo(n: number) -> number
    if n <= 0
        return 0
    end
    return n + sumTo(n - 1)
end
`,
    'main.pln': `import sumTo from "./lib/sum"
import { print } from "std/io"
print(sumTo(4))
`,
  }, 'main.pln');
  assert.strictEqual(project.status, 0, project.stderr);
  assert.strictEqual(project.stdout, '10\n');
});

test('new constructs class-based values from the JavaScript boundary', () => {
  const result = runSource(`import { print } from "std/io"
declare const URL: any
let url = new URL("https://example.com/a/b?flag=yes")
print(url.pathname)
print(url.searchParams.get("flag"))
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '/a/b\nyes\n');
});

test('recursive variant types match recursively', () => {
  const diagnostics = codesOf(`type Tree = Leaf(value: number) or Node(left: Tree, right: Tree)

function total(tree: Tree) -> number
    match tree
    case Leaf(value)
        return value
    case Node(left, right)
        return total(left) + total(right)
    end
end

let tree: Tree = Node(Leaf(1), Leaf(2))
let sum = total(tree)
`);
  assert.deepStrictEqual(diagnostics, []);
});

test('closures capture a fresh loop binding per iteration', () => {
  const result = runSource(`import { print } from "std/io"
import { append } from "std/list"

let adders: list of (number) -> number = []
for step in 0 to 2
    adders = append(adders, (x: number) => x + step)
end

for adder in adders
    print(adder(10))
end
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '10\n11\n12\n');
});

test('nested control flow and async lambdas execute correctly', () => {
  const result = runSource(`import { print } from "std/io"

async function work(value: number) -> number
    return value * 2
end

function risky(value: number) -> number or nothing
    try
        if value < 0
            throw "negative"
        end
        return value
    catch problem
        print("caught {problem}")
        return nothing
    finally
        print("cleanup")
    end
end

async function main() -> nothing
    let doubled = await work(21)
    print("doubled {doubled}")
    let safe = risky(-1)
    if safe == nothing
        print("safe nothing")
    end
end

await main()

let later = async (value: number) => await work(value)
print("lambda {await later(2)}")
`);

  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /doubled 42/);
  assert.match(result.stdout, /caught negative/);
  assert.match(result.stdout, /cleanup/);
  assert.match(result.stdout, /safe nothing/);
  assert.match(result.stdout, /lambda 4/);
});
