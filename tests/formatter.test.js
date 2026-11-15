'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { format } = require('../src/formatter');
const { tokenize } = require('../src/lexer');
const { CompileError } = require('../src/diagnostics');

test('nested blocks are indented four spaces per level', () => {
  const source = 'function f(n: number) -> number\nwhen n > 0\nreturn n\notherwise\nreturn 0\nend\nend\n';
  const expected = 'function f(n: number) -> number\n    when n > 0\n        return n\n    otherwise\n        return 0\n    end\nend\n';
  assert.strictEqual(format(source, 'f.pln'), expected);
});

test('match cases and try branches align with their opener', () => {
  const source = `function f(v: boolean) -> number
match v
case true
return 1
case false
return 0
end
end
`;
  const formatted = format(source, 'f.pln');
  const lines = formatted.split('\n');
  assert.strictEqual(lines[1], '    match v');
  assert.strictEqual(lines[2], '        case true');
  assert.strictEqual(lines[3], '            return 1');
});

test('comments and blank lines are preserved', () => {
  const source = '# leading comment\nfunction f() -> nothing\n\n# inside\nreturn nothing\nend\n';
  const formatted = format(source, 'f.pln');
  assert.match(formatted, /^# leading comment\nfunction f\(\) -> nothing\n\n    # inside\n    return nothing\nend\n$/);
});

test('runs of blank lines collapse to one', () => {
  const source = 'let a = 1\n\n\n\nlet b = 2\n';
  assert.strictEqual(format(source, 'f.pln'), 'let a = 1\n\nlet b = 2\n');
});

test('single-line declarations do not open blocks', () => {
  const source = 'type User = { name: text }\nlet user: User = { name: "Ada" }\n';
  assert.strictEqual(format(source, 'f.pln'), source);
});

test('formatting never changes the token stream', () => {
  const source = `type Shape = Circle(radius: number) or Empty
function area(s: Shape) -> number
match s
case Circle(r)
return 3 * r * r
case Empty
return 0
end
end
`;
  const before = tokenize(source).tokens.filter((token) => token.t !== 'eof').map((token) => token.v);
  const after = tokenize(format(source, 'f.pln')).tokens.filter((token) => token.t !== 'eof').map((token) => token.v);
  assert.deepStrictEqual(after, before);
});

test('formatting is idempotent', () => {
  const source = 'function f() -> number\n  return 1\nend\n';
  const once = format(source, 'f.pln');
  assert.strictEqual(format(once, 'f.pln'), once);
});

test('lexical errors are not silently reformatted', () => {
  assert.throws(() => format('let x = "unterminated\n', 'f.pln'), CompileError);
});
