'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { translateTypeScript, translateFile } = require('../src/typescript-declarations');
const { parse } = require('../src/parser');

const ROOT = path.resolve(__dirname, '..');

test('the supported TypeScript declaration subset translates into parseable PlainScript declarations', () => {
  const source = `import { Base } from "./base";
export interface User<T extends string = string> extends Base {
  readonly id: number;
  name?: string;
  tags: string[];
  pair: [number, string];
  meta: { ok: boolean; note: string | null };
  greet(prefix?: string): string;
}
export type Maybe<T> = T | null;
export type Args = [string, ...string[]];
export declare function load(id: number, ...names: string[]): Promise<User<string>>;
export declare const version: string;
export { Base };
`;
  const result = translateTypeScript(source, { file: '/tmp/api.d.ts', resolveImports: false });
  assert.match(result.code, /export type User<T: text>/);
  assert.match(result.code, /readonly id: number/);
  assert.match(result.code, /name\?: text/);
  assert.match(result.code, /pair: \[number, text\]/);
  assert.match(result.code, /export type Args = \[text, \.\.\.text\]/);
  assert.match(result.code, /export declare function load\(id: number, \.\.\.names: list of text\) -> Promise of User<text>/);
  assert.match(result.code, /export declare const version: text/);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'PS7004' && diagnostic.severity === 'warning'));
  assert.doesNotThrow(() => parse(result.code, 'api.d.pln'));
});

test('unsupported constructs produce errors and never silently become any', () => {
  const source = `export type Bad<T> = T extends Array<infer U> ? U : T;
export interface Indexed { [key: string]: number }
export type Good = { name: string };
`;
  const result = translateTypeScript(source, { file: '/tmp/bad.d.ts', resolveImports: false });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'PS7001' && /infer/.test(diagnostic.message)));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'PS7001' && /Index signatures/.test(diagnostic.message)));
  assert.doesNotMatch(result.code, /Bad/);
  assert.doesNotMatch(result.code, /Indexed/);
  assert.match(result.code, /export type Good = \{ name: text \}/);
  assert.doesNotMatch(result.code, /Bad = any/);
});

test('relative imports are resolved and translated alongside their dependants', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-interop-'));
  fs.writeFileSync(path.join(directory, 'base.d.ts'), 'export interface Base { id: number }\n');
  fs.writeFileSync(path.join(directory, 'api.d.ts'), 'import { Base } from "./base";\nexport interface User extends Base { name: string }\n');
  const result = translateFile(path.join(directory, 'api.d.ts'));
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code, /import \{ Base \} from "\.\/base"/);
  const base = translateFile(path.join(directory, 'base.d.ts'));
  assert.deepEqual(base.diagnostics, []);
  assert.match(base.code, /export type Base = \{ id: number \}/);
  assert.doesNotThrow(() => parse(result.code, 'api.d.pln'));
  assert.doesNotThrow(() => parse(base.code, 'base.d.pln'));
});

test('the interop CLI writes .d.pln files and reports unsupported declarations', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-interop-cli-'));
  const file = path.join(directory, 'api.d.ts');
  fs.writeFileSync(file, 'export interface Task { id: number; title?: string }\nexport type Unsupported<T> = T extends Array<infer U> ? U : T;\n');
  const output = spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli.js'), 'interop', file], { encoding: 'utf8' });
  const generated = path.join(directory, 'api.d.pln');
  assert.equal(output.status, 1);
  assert.match(output.stderr, /PS7001/);
  assert.equal(fs.existsSync(generated), false);
  fs.writeFileSync(file, 'export interface Task { id: number; title?: string }\n');
  const success = spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli.js'), 'interop', file], { encoding: 'utf8' });
  assert.equal(success.status, 0, success.stderr);
  assert.ok(fs.existsSync(generated));
  assert.match(fs.readFileSync(generated, 'utf8'), /title\?: text/);
});
