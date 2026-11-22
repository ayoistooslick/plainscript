'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { tokenize } = require('../src/lexer');
const { parse } = require('../src/parser');
const { runSource, codesOf } = require('./helpers');

test('a regex literal is one token and survives parsing', () => {
  const result = tokenize('#syntax 2.1\nvalue pattern is /item-(?<id>\\d+)/gi\n', 'regex.pln', { dialect: '2.1' });
  assert.deepStrictEqual(result.errors, []);
  const regex = result.tokens.find((token) => token.t === 'regex');
  assert.ok(regex);
  assert.strictEqual(regex.pattern, 'item-(?<id>\\d+)');
  assert.strictEqual(regex.flags, 'gi');

  const ast = parse('#syntax 2.1\nvalue pattern is /item-(?<id>\\d+)/gi\n', 'regex.pln', { dialect: '2.1' });
  const declaration = ast.body[0];
  assert.strictEqual(declaration.init.kind, 'Regex');
  assert.strictEqual(declaration.init.pattern, 'item-(?<id>\\d+)');
});

test('division is still division after a value', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"
print(10 / 2)
print(10 / 2 / 5)
set x to 9
print(x / 3)
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '5\n1\n3\n');
});

test('regex values support test, source and flags', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"
set pattern to /ab+c/i
print(pattern.test("xxABBCxx"))
print(pattern.test("nothing"))
print(pattern.source)
print(pattern.flags)
print(pattern.ignoreCase)
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'true\nfalse\nab+c\ni\ntrue\n');
});

test('std/text exposes matching, captures, replacement and splitting', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"
import { count } from "std/list"
import { matches, findMatch, findAllMatches, matchTexts, replaceAllMatches, replaceMatch, splitMatch, escapeRegex } from "std/text"

set content to "item-42 and item-7"
print(matches(content, /item-\\d+/))
set found to findMatch(content, /item-(?<id>\\d+)/)
when found is not equal to nothing
    print(found.text)
    print(found.index)
    print(found.groups[0])
    print(found.named["id"])
end
print(count(findAllMatches(content, /item-(\\d+)/)))
print(matchTexts(content, /item-\\d+/))
print(replaceAllMatches("a1b22", /\\d+/g, "#"))
print(replaceMatch("a1b22", /\\d+/, "#"))
print(count(splitMatch("a, b,c", /,\\s*/)))
print(escapeRegex("a.b*c"))
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(
    result.stdout,
    'true\nitem-42\n0\n42\n42\n2\nitem-42,item-7\na#b#\na#b22\n3\na\\.b\\*c\n',
  );
});

test('global, multiline, unicode and zero-length matches behave predictably', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"
import { count } from "std/list"
import { findAllMatches, matchTexts, replaceAllMatches } from "std/text"

print(replaceAllMatches("a\\nb\\nc", /^./gm, "#"))
print(matchTexts("a1 b2", /[a-z](\\d)/))
print(count(findAllMatches("ab", /(?:)/)))
print(replaceAllMatches("café", /é/u, "e"))
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '#\n#\n#\na1,b2\n3\ncafe\n');
});

test('named groups and optional groups are returned as text', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"
import { findMatch } from "std/text"
set found to findMatch("2026-11-22", /(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})/)
when found is not equal to nothing
    print(found.named["year"])
    print(found.named["month"])
    print(found.named["day"])
end
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '2026\n11\n22\n');
});

test('an invalid regex literal is a lexical error with a code', () => {
  const codes = codesOf('#syntax 2.1\nvalue pattern is /(/\n');
  assert.ok(codes.includes('PS1008'), JSON.stringify(codes));
});

test('an unterminated regex literal is a lexical error', () => {
  const codes = codesOf('#syntax 2.1\nvalue pattern is /abc\n');
  assert.ok(codes.includes('PS1006'), JSON.stringify(codes));
});

test('regex type rejects unrelated fields', () => {
  const codes = codesOf('#syntax 2.1\nimport { print } from "std/io"\nset pattern to /a/\nprint(pattern.groups)\n');
  assert.ok(codes.includes('PS3335'), JSON.stringify(codes));
});

test('a regex can be tested with the is operator', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"
set value to /x/
print(value is regex)
print("text" is regex)
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'true\nfalse\n');
});
