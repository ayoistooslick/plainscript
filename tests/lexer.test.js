'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { tokenize, KEYWORDS } = require('../src/lexer');

function kinds(source) {
  return tokenize(source).tokens.filter((token) => token.t !== 'eof').map((token) => [token.t, token.v]);
}

test('keywords and identifiers are distinguished', () => {
  assert.deepStrictEqual(kinds('let x = 1'), [
    ['kw', 'let'],
    ['ident', 'x'],
    ['punct', '='],
    ['number', '1'],
  ]);
  assert.ok(KEYWORDS.has('if'));
  assert.ok(KEYWORDS.has('else'));
  assert.ok(KEYWORDS.has('when'));
  assert.ok(KEYWORDS.has('otherwise'));
  assert.ok(!KEYWORDS.has('renderer'));
});

test('comments are collected separately and never appear as tokens', () => {
  const result = tokenize('# first\nlet x = 1 # trailing\n');
  assert.strictEqual(result.comments.length, 2);
  assert.strictEqual(result.comments[0].v, ' first');
  assert.deepStrictEqual(result.tokens.filter((t) => t.t !== 'eof').map((t) => t.v), ['let', 'x', '=', '1']);
  assert.strictEqual(result.errors.length, 0);
});

test('operators are lexed longest-first', () => {
  assert.deepStrictEqual(kinds('a |> b ?? c?.d ...e'), [
    ['ident', 'a'],
    ['punct', '|>'],
    ['ident', 'b'],
    ['punct', '??'],
    ['ident', 'c'],
    ['punct', '?.'],
    ['ident', 'd'],
    ['punct', '...'],
    ['ident', 'e'],
  ]);
});

test('numbers support separators, hex, binary and exponents', () => {
  const values = tokenize('1_000 0xFF 0b1010 2.5e3').tokens
    .filter((token) => token.t === 'number')
    .map((token) => Number(token.v));
  assert.deepStrictEqual(values, [1000, 255, 10, 2500]);
});

test('interpolating strings produce template parts', () => {
  const token = tokenize('"Hello {name}, you are {age} years"').tokens[0];
  assert.strictEqual(token.t, 'template');
  assert.deepStrictEqual(token.parts.map((part) => part.t), ['text', 'expr', 'text', 'expr', 'text']);
  assert.strictEqual(token.parts[1].src, 'name');
});

test('nested braces and strings inside interpolation are balanced', () => {
  const token = tokenize('"x {record({ a: "}" }).a} y"').tokens[0];
  assert.strictEqual(token.parts[1].src.trim(), 'record({ a: "}" }).a');
});

test('single quotes are raw (no interpolation)', () => {
  const token = tokenize("'Hello {name}'").tokens[0];
  assert.strictEqual(token.t, 'text');
  assert.strictEqual(token.v, 'Hello {name}');
});

test('triple-quoted strings keep newlines and drop the first one', () => {
  const token = tokenize('"""\nline one\nline two"""').tokens[0];
  assert.strictEqual(token.t, 'text');
  assert.strictEqual(token.v, 'line one\nline two');
});

test('escapes decode, including unicode and braces', () => {
  const token = tokenize('"a\\nb\\u0041\\{x\\}"').tokens[0];
  assert.strictEqual(token.v, 'a\nbA{x}');
});

test('unterminated strings report PS1003', () => {
  const result = tokenize('"no end');
  assert.strictEqual(result.errors[0].code, 'PS1003');
  assert.strictEqual(result.errors[0].span.line, 1);
});

test('unknown characters report PS1001 and lexing continues', () => {
  const result = tokenize('let x = 1 @ 2');
  assert.strictEqual(result.errors[0].code, 'PS1001');
  assert.ok(result.tokens.some((token) => token.v === '2'));
});

test('token positions point at the source', () => {
  const token = tokenize('let a\n  let b').tokens[2];
  assert.strictEqual(token.v, 'let');
  assert.strictEqual(token.line, 2);
  assert.strictEqual(token.col, 3);
});
