const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { checkTypes } = require('../compiler/type-checker');
const { LspService } = require('../compiler/lsp');

function ast(source) { return parse(tokenize(source)); }
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (error) { console.log(`  FAIL  ${name}`); throw error; }
}
function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

console.log('Static types and LSP');
test('valid typed records produce no static diagnostics', () => {
  const result = checkTypes(ast(`type User\n  id is number\n  name is text\ndone\nintend greet(user as User)\n  give user.name\ndone\nshow greet({ id: 1, name: "Ada" })`));
  assert.deepStrictEqual(result.diagnostics, []);
  assert.strictEqual(result.ir.kind, 'Program');
});

test('invalid literal records produce field diagnostics before execution', () => {
  const result = checkTypes(ast(`type User\n  id is number\n  name is text\ndone\nmake greet(user as User)\n  give user.name\ndone\nshow greet({ id: "wrong", extra: true })`));
  assert(result.diagnostics.some(item => item.code === 'PLN-TYPE-FIELD' && /id/.test(item.message)));
  assert(result.diagnostics.some(item => item.code === 'PLN-TYPE-FIELD' && /extra/.test(item.message)));
  assert(result.diagnostics.every(item => item.range.start.line === 7));
});

test('unknown member access gets a source-local diagnostic', () => {
  const result = checkTypes(ast(`type User\n  name is text\ndone\nmake greet(user as User)\n  give user.missing\ndone`));
  const item = result.diagnostics.find(item => item.code === 'PLN-TYPE-FIELD');
  assert(item);
  assert.strictEqual(item.range.start.line, 4);
});

test('LSP service advertises capabilities and publishes diagnostics', () => {
  const service = new LspService();
  const uri = 'file:///tmp/plain-lsp-test.pln';
  const init = service.request('initialize');
  assert.strictEqual(init.capabilities.hoverProvider, true);
  assert.strictEqual(init.capabilities.definitionProvider, true);
  const published = service.notification('textDocument/didOpen', { textDocument: {
    uri,
    version: 1,
    text: 'type User\n  name is text\ndone\nmake greet(user as User)\n  give user.missing\ndone',
  }});
  assert(published.diagnostics.some(item => item.code === 'PLN-TYPE-FIELD'));
});

test('LSP provides completion, hover, definition, and stdio JSON-RPC', () => {
  const service = new LspService();
  const uri = 'file:///tmp/plain-lsp-tools.pln';
  service.setDocument(uri, 'type User\n  name is text\ndone\nintend greet(name)\n  give name\ndone\nshow greet("Ada")', 1);
  assert(service.completion(uri).items.some(item => item.label === 'intend'));
  assert(service.hover(uri, { line: 3, character: 8 }).contents.value.includes('greet'));
  assert(service.definition(uri, { line: 6, character: 7 }));

  const server = path.join(__dirname, '..', 'compiler', 'lsp.js');
  const input = Buffer.concat([
    frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    frame({ jsonrpc: '2.0', method: 'exit', params: {} }),
  ]);
  const result = spawnSync(process.execPath, [server], { input, encoding: 'utf8' });
  assert.strictEqual(result.status, 1);
  assert(result.stdout.includes('"id":1'));
});

console.log('5 tests: passed');
