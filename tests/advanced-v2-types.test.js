'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runSource, runProject, codesOf, compileProject } = require('./helpers');
const { generateDeclarations } = require('../src/declarations');

test('variadic tuples accept fixed prefixes and arbitrary trailing elements', () => {
  const result = runSource(`import { print } from "std/io"
type Args = [text, ...text]
let one: Args = ["run"]
let many: Args = ["run", "build", "test"]
let exact: [text, text] = ["run", "build"]
let widened: Args = exact
print("{one[0]}:{many[2]}:{widened[1]}")
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'run:test:build\n');
});

test('variadic tuple rests reject a wrong trailing type', () => {
  const result = runSource('type Args = [text, ...text]\nlet bad: Args = ["run", 42]\n');
  assert.equal(result.status, 1);
  assert.ok(result.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3311'));
});

test('tuple indexing uses the rest type after the fixed prefix', () => {
  assert.deepEqual(codesOf('type Args = [text, ...text]\nfunction label(args: Args) -> text\n    return args[4]\nend'), []);
  const bad = codesOf('let pair: [number, text] = [1, "one"]\nlet value: number = pair[1]\n');
  assert.ok(bad.includes('PS3311'));
});

test('readonly record fields reject assignment but ordinary fields remain writable', () => {
  const result = runSource(`type Project
    readonly id: number
    name: text
end
let project: Project = { id: 1, name: "Compiler" }
project.name = "PlainScript"
project.id = 2
print(project.name)
`);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.ok(result.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3319'));
});

test('readonly inline record fields are preserved through intersections', () => {
  const result = runSource(`type Locked = { readonly id: number } & { name: text }
let value: Locked = { id: 1, name: "ok" }
value.id = 2
`);
  assert.equal(result.status, 1);
  assert.ok(result.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3319'));
});

test('distributive conditional types distribute over an imported generic union', () => {
  const project = runProject({
    'kinds.pln': `export type Kind<T> = T extends number ? "numeric" : "other"
export type Unwrap<T> = T extends list of any ? T[number] : T
`,
    'main.pln': `import { Kind, Unwrap } from "./kinds"
let k: Kind<number or text> = "numeric"
let k2: Kind<number or text> = "other"
let bad: Kind<number or text> = "boolean"
let n: Unwrap<number or text> = 1
let t: Unwrap<number or text> = "x"
let expanded: Unwrap<list of number> = 2
print("{k}:{k2}:{n}:{t}:{expanded}")
`,
  });
  assert.equal(project.status, 1);
  const codes = project.compiler.diagnostics.map((diagnostic) => diagnostic.code);
  assert.ok(codes.includes('PS3311'));
  assert.ok(project.compiler.diagnostics.every((diagnostic) => !/boolean/.test(diagnostic.message) || diagnostic.code === 'PS3311'));
});

test('nested conditioned generics and declaration output retain new syntax', () => {
  const project = compileProject({
    'types.pln': `export type Args = [text, ...text]
export type Publish<T> = T extends list of any ? T[number] : T
export type Locked
    readonly id: number
    value: text
end
`,
    'main.pln': `import { Args, Locked } from "./types"
let args: Args = ["build"]
let locked: Locked = { id: 1, value: "ok" }
`,
  });
  assert.equal(project.compiler.diagnostics.length, 0, JSON.stringify(project.compiler.diagnostics));
  const record = project.compiler.modules.get(path.join(project.directory, 'types.pln'));
  const declaration = generateDeclarations(record);
  assert.match(declaration, /\[text, \.\.\.text\]/);
  assert.match(declaration, /readonly id: number/);
  assert.match(declaration, /Publish<T>/);
});
