'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { runSource, compileProject } = require('./helpers');

test('Node builtins can be imported by name and used', () => {
  const result = runSource(`import { join, basename } from "node:path"
import { print } from "std/io"
print(join("a", "b", "c.txt"))
print(basename("/tmp/file.txt"))
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'a/b/c.txt\nfile.txt\n');
});

test('default imports from npm-style modules work', () => {
  const result = runSource(`import path from "node:path"
import { print } from "std/io"
print(path.dirname("/tmp/a/b.txt"))
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '/tmp/a\n');
});

test('ambient declarations type global values', () => {
  const result = runSource(`import { print } from "std/io"
declare const process: any
print(process.platform |> (value: text) => value != "")
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'true\n');
});

test('untyped JavaScript values are usable through any', () => {
  const result = runSource(`import { print } from "std/io"
let numbers = [3, 1, 2] as any
numbers.sort()
print(numbers[0])
let payload = { items: [{ id: 1 }, { id: 2 }] } as any
print(payload.items[1].id)
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '1\n2\n');
});

test('PlainScript libraries are consumable from JavaScript', () => {
  const project = compileProject({
    'lib/greet.pln': `export function greet(name: text) -> text
    return "Hello, {name}"
end
`,
  }, 'lib/greet.pln');
  const consumer = path.join(project.directory, 'consumer.mjs');
  fs.writeFileSync(consumer, `import { greet } from "./out/lib/greet.js";\nconsole.log(greet("JS"));\n`);
  const result = spawnSync(process.execPath, [consumer], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'Hello, JS\n');
});

test('deep npm package usage is not blocked by the checker', () => {
  const result = runSource(`import { print } from "std/io"
declare const JSON: any
let value = JSON.parse("{\\"a\\": 1}")
print(value.a)
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '1\n');
});

test('errors from JavaScript surface as catchable values', () => {
  const result = runSource(`import { print } from "std/io"
import { decode } from "std/json"
try
    decode("{oops")
catch failure
    print("caught")
end
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'caught\n');
});
