'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  ROOT, sandbox, writeFiles, compileProject, runSource, diagnosticsOf,
} = require('./helpers');
const { createBundler } = require('../src/bundle');
const { Compiler } = require('../src/modules');
const { format } = require('../src/formatter');

test('classes, inheritance, super and is run with nominal instanceof checks', () => {
  const result = runSource(`
import { print } from "std/io"

class Animal
  name: text
  constructor(name: text)
    this.name = name
  end
  function speak() -> text
    return "{this.name} makes a sound"
  end
end

class Dog extends Animal
  constructor(name: text)
    super(name)
  end
  function speak() -> text
    return "{super.speak()} and barks"
  end
end

let dog = new Dog("Rex")
print(dog.speak())
print("{dog is Animal}")
print("{dog is Dog}")
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'Rex makes a sound and barks\ntrue\ntrue\n');
});

test('static members, field initializers and readonly fields enforce their rules', () => {
  const good = runSource(`
import { print } from "std/io"

class Counter
  static count: number = 0
  readonly label: text
  constructor(label: text)
    this.label = label
  end
  static function bump() -> number
    Counter.count += 1
    return Counter.count
  end
end

print("{Counter.bump()} {Counter.count} {new Counter("x").label}")
`);
  assert.strictEqual(good.status, 0, good.stderr);
  assert.strictEqual(good.stdout, '1 1 x\n');

  const readonly = diagnosticsOf(`
class Point
  readonly x: number
  constructor(x: number)
    this.x = x
  end
end
let point = new Point(1)
point.x = 2
`);
  assert.ok(readonly.some((diagnostic) => /readonly/i.test(diagnostic.message)), JSON.stringify(readonly));

  const missing = diagnosticsOf(`
class Thing
  name: text
end
`);
  assert.ok(missing.some((diagnostic) => /constructor/i.test(diagnostic.message)), JSON.stringify(missing));
});

test('generic classes infer constructor arguments and methods keep type parameters', () => {
  const result = runSource(`
import { print } from "std/io"

class Box<T>
  value: T
  constructor(value: T)
    this.value = value
  end
  function map<U>(transform: (T) -> U) -> Box<U>
    return new Box(transform(this.value))
  end
end

let boxed = new Box(3).map((value: number) => "number {value}")
print(boxed.value)
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'number 3\n');

  const wrong = diagnosticsOf(`
class Box<T>
  value: T
  constructor(value: T)
    this.value = value
  end
end
let boxed = new Box("text")
let number: number = boxed.value
`);
  assert.ok(wrong.some((diagnostic) => diagnostic.severity === 'error'), JSON.stringify(wrong));
});

test('ternary expressions evaluate lazily in value position', () => {
  const result = runSource(`
import { print } from "std/io"
function pick(flag: boolean) -> text
  return flag ? "yes" : "no"
end
print(pick(true))
print(pick(false))
print(1 > 2 ? "bad" : "good")
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'yes\nno\ngood\n');
});

test('generators yield lazily and iterate with for-each', () => {
  const result = runSource(`
import { print } from "std/io"

generator function evens(limit: number) -> number
  let index = 0
  while index < limit
    yield index * 2
    index += 1
  end
end

let total = 0
for value in evens(4)
  total += value
end
print(total)

generator function words() -> text
  yield "a"
  yield "b"
end
for word in words()
  print(word)
end
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '12\na\nb\n');

  const invalid = diagnosticsOf(`
generator function broken() -> number
  return 4
end
`);
  assert.ok(invalid.some((diagnostic) => /cannot return a value/i.test(diagnostic.message)), JSON.stringify(invalid));
});

test('typed throws and catches are enforced at compile time and rethrow mismatches', () => {
  const result = runSource(`
import { print } from "std/io"

class AppError extends Error
  code: number
  constructor(message: text, code: number)
    super(message)
    this.code = code
  end
end

function fail(code: number) throws AppError
  throw new AppError("failed", code)
end

try
  fail(7)
catch error: AppError
  print("{error.message} {error.code}")
end

try
  try
    throw new TypeError("wrong")
  catch error: AppError
    print("must not run")
  end
catch error: Error
  print("rethrown {error.message}")
end
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'failed 7\nrethrown wrong\n');

  const badThrow = diagnosticsOf(`
function wrong() throws TypeError
  throw new RangeError("no")
end
`);
  assert.ok(badThrow.some((diagnostic) => diagnostic.severity === 'error'), JSON.stringify(badThrow));

  const forbidden = diagnosticsOf(`
function safe() throws nothing
  throw new Error("no")
end
`);
  assert.ok(forbidden.some((diagnostic) => /throws nothing/i.test(diagnostic.message)), JSON.stringify(forbidden));
});

test('decorators replace class methods at runtime', () => {
  const result = runSource(`
import { print } from "std/io"

function loud(value: any) -> any
  return (name: text) => "{name}!"
end

class Greeter
  @loud
  function greet(name: text) -> text
    return "hello {name}"
  end
end

print(new Greeter().greet("bob"))
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'bob!\n');
});

test('BigInt literals, arithmetic and interpolation are native', () => {
  const result = runSource(`
import { print } from "std/io"
let big = 2n ** 10n
print("{big}")
print(12345678901234567890n)
print(0x10n + 0b10n)
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '1024\n12345678901234567890\n18\n');

  const mixed = diagnosticsOf(`
let value = 1n + 1
`);
  assert.ok(mixed.some((diagnostic) => diagnostic.severity === 'error'), JSON.stringify(mixed));
});

test('computed keys, shorthand fields and nested block comments work together', () => {
  const result = runSource(`
import { print } from "std/io"
let key = "answer"
let label = "shorthand"
let record = { [key]: 42, label }
/* outer /* inner */ still a comment */
print("{record.answer} {record.label}")
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '42 shorthand\n');
});

test('reflection reports runtime types and class names', () => {
  const result = runSource(`
import { print } from "std/io"
import { typeOf, className, fieldsOf } from "std/reflect"
class Point
  x: number
  y: number
  constructor(x: number, y: number)
    this.x = x
    this.y = y
  end
end
let point = new Point(1, 2)
print("{typeOf(point)} {className(point)} {fieldsOf(point)}")
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'instance Point x,y\n');
});

test('the optimizer folds literals and removes unreachable statements', () => {
  const project = compileProject({
    'main.pln': `
import { print } from "std/io"
function compute() -> number
  return 1 + 2 * 3
  print("unreachable")
end
print(compute())
`,
  });
  assert.deepStrictEqual(project.compiler.diagnostics, []);
  const code = fs.readFileSync(project.entryOut, 'utf8');
  assert.match(code, /return 7;/);
  assert.doesNotMatch(code, /unreachable/);
});

test('modules bundle into one ES module without a compiler at runtime', () => {
  const directory = sandbox();
  writeFiles(directory, {
    'math.pln': `
export const factor = 3
export class Box
  value: number
  constructor(value: number)
    this.value = value
  end
  function scaled() -> number
    return this.value * factor
  end
end
export function label(value: number) -> text
  return "box {value}"
end
`,
    'main.pln': `
import { Box, label, factor } from "./math"
export function compute() -> text
  let box = new Box(4)
  return "{label(box.scaled())} factor={factor}"
end
`,
  });
  const outFile = path.join(directory, 'bundle.mjs');
  const bundler = createBundler({ root: ROOT });
  const result = bundler.bundle(path.join(directory, 'main.pln'), outFile);
  assert.deepStrictEqual(result.diagnostics, []);
  assert.strictEqual(result.ok, true);
  fs.writeFileSync(outFile, result.code);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import { compute } from ${JSON.stringify(outFile)}; process.stdout.write(compute());`], { encoding: 'utf8' });
  assert.strictEqual(child.status, 0, child.stderr);
  assert.strictEqual(child.stdout, 'box 12 factor=3');
});

test('bundling an exported let fails instead of freezing ESM live bindings', () => {
  const directory = sandbox();
  writeFiles(directory, {
    'main.pln': 'export let value = 1\n',
  });
  const bundler = createBundler({ root: ROOT });
  const result = bundler.bundle(path.join(directory, 'main.pln'), path.join(directory, 'bundle.mjs'));
  assert.strictEqual(result.ok, false);
  assert.ok(result.diagnostics.some((diagnostic) => /live binding/i.test(diagnostic.message)));
});

test('the persistent build cache skips unchanged files and invalidates importers', () => {
  const directory = sandbox();
  writeFiles(directory, {
    'package.json': '{"type":"module"}\n',
    'src/math.pln': 'export const base = 10\nexport function add(a: number, b: number) -> number\n  return a + b\nend\n',
    'src/main.pln': 'import { add, base } from "./math"\nimport { print } from "std/io"\nprint(add(base, 5))\n',
  });
  const cli = path.join(ROOT, 'src', 'cli.js');
  const first = spawnSync(process.execPath, [cli, 'build'], { cwd: directory, encoding: 'utf8' });
  assert.strictEqual(first.status, 0, first.stderr);
  const second = spawnSync(process.execPath, [cli, 'build'], { cwd: directory, encoding: 'utf8' });
  assert.strictEqual(second.status, 0, second.stderr);
  assert.match(second.stderr, /2 cached/);
  assert.match(second.stderr, /0 file/);

  fs.writeFileSync(path.join(directory, 'src', 'math.pln'), 'export const base = 20\nexport function add(a: number, b: number) -> number\n  return a + b\nend\n');
  const third = spawnSync(process.execPath, [cli, 'build'], { cwd: directory, encoding: 'utf8' });
  assert.strictEqual(third.status, 0, third.stderr);
  assert.match(third.stderr, /1 file/);
  const run = spawnSync(process.execPath, [path.join(directory, 'dist', 'main.js')], { cwd: directory, encoding: 'utf8' });
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(run.stdout, '25\n');
});

test('the formatter indents classes, constructors and methods', () => {
  const source = `class Point
x: number
constructor(x: number)
this.x = x
end
function double() -> number
return this.x * 2
end
end`;
  const formatted = format(source, 'format.pln');
  assert.match(formatted, /^class Point\n {4}x: number\n {4}constructor\(x: number\)\n {8}this\.x = x\n {4}end\n {4}function double\(\) -> number\n {8}return this\.x \* 2\n {4}end\nend\n$/);
});

test('a TypeScript class declaration keeps constructor argument checking', () => {
  const directory = sandbox();
  writeFiles(directory, {
    'widget.d.pln': `
export declare class Widget
  readonly code: number
  constructor(message?: text, code?: number)
  function value() -> text
end
`,
    'main.pln': `
import { Widget } from "./widget"
let good = new Widget("ok", 1)
let text: text = good.value()
let bad = new Widget(42)
`,
  });
  const compiler = new Compiler({ root: ROOT });
  compiler.compile(path.join(directory, 'main.pln'), { outFile: path.join(directory, 'main.js') });
  const errors = compiler.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  assert.strictEqual(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0].message, /constructor of "Widget"/);
});
