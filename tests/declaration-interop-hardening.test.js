'use strict';

// Practical .d.ts interoperability: declared classes, template-literal types
// and declaration merging, using declaration shapes that appear in real npm
// packages rather than minimal examples.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { translateTypeScript } = require('../src/typescript-declarations');
const { parse } = require('../src/parser');
const { compileProject } = require('./helpers');

const PACKAGE_DECLARATION = `
export interface ClientOptions {
  baseUrl: string;
  retries?: number;
  readonly apiKey?: string;
  onEvent?(event: ClientEvents, payload: unknown): void;
}
export interface ClientOptions {
  timeout?: number;
}

export type ClientEvents = 'ready' | 'error' | \`request-\${'start' | 'end'}\`;
export type Route = \`/api/\${string}\`;

export declare class Client<T extends object = object> {
  constructor(options: ClientOptions);
  readonly options: ClientOptions;
  connected: boolean;
  request<R>(path: string, body?: T): Promise<R>;
  on(event: ClientEvents, handler: (payload: T) => void): Client<T>;
  static connect(options: ClientOptions): Client<object>;
  protected session: unknown;
  private token;
}

export declare function createClient(options: ClientOptions): Client<object>;
`;

test('class declarations become an instance record plus a runtime binding', () => {
  const result = translateTypeScript(PACKAGE_DECLARATION, { file: '/tmp/client.d.ts', resolveImports: false });
  assert.match(result.code, /export type Client<T: \{ \}> = \{ readonly options: ClientOptions/);
  assert.match(result.code, /connected: boolean/);
  assert.match(result.code, /request: \(path: text, body\?: T\) -> Promise of any/);
  assert.match(result.code, /on: \(event: ClientEvents, handler: \(payload: T\) -> nothing\) -> Client<T>/);
  assert.match(result.code, /export declare const Client: any/);
  // Private, protected and static members cannot be instance fields. The class
  // itself is still translated, and only the static omission is reported.
  assert.doesNotMatch(result.code, /session|token/);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'PS7005' && /Static class members/.test(diagnostic.message)));
  assert.doesNotThrow(() => parse(result.code, 'client.d.pln'));
});

test('template literal types expand finite patterns and widen open ones', () => {
  const result = translateTypeScript(PACKAGE_DECLARATION, { file: '/tmp/client.d.ts', resolveImports: false });
  assert.match(result.code, /export type ClientEvents = "ready" or "error" or "request-start" or "request-end"/);
  // `/api-${string}` has no finite expansion; text plus a warning is honest.
  assert.match(result.code, /export type Route = text/);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'PS7005' && /translated as text/.test(diagnostic.message)));
});

test('repeated interfaces merge instead of producing a duplicate type', () => {
  const result = translateTypeScript(PACKAGE_DECLARATION, { file: '/tmp/client.d.ts', resolveImports: false });
  const declarations = result.code.split('\n').filter((line) => line.includes('type ClientOptions'));
  assert.equal(declarations.length, 1);
  assert.match(declarations[0], /baseUrl: text/);
  assert.match(declarations[0], /retries\?: number/);
  assert.match(declarations[0], /timeout\?: number/);
  assert.doesNotThrow(() => parse(result.code, 'client.d.pln'));
});

test('a translated declaration module type-checks as PlainScript', () => {
  const result = translateTypeScript(PACKAGE_DECLARATION, { file: '/tmp/client.d.ts', resolveImports: false });
  const project = compileProject({ 'client.pln': result.code }, 'client.pln');
  const errors = project.compiler.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  assert.deepEqual(errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`), []);
});

test('star re-exports and ambient modules give an actionable diagnostic', () => {
  const result = translateTypeScript(`export * from "./internal";\ndeclare module "loose" { export const value: string }\n`, { file: '/tmp/edge.d.ts', resolveImports: false });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'PS7001' && /Star re-exports/.test(diagnostic.message)));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'PS7001' && /Ambient module/.test(diagnostic.message)));
});
