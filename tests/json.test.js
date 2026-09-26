const assert = require('assert');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate } = require('../compiler/generator');

function run(source) {
  const output = [];
  const js = generate(parse(tokenize(source)));
  new Function('console', js)({ log: value => output.push(value) });
  return output;
}

console.log('Portable JSON');
const encoded = run('show jsonEncode(123n)')[0];
assert(encoded.includes('"bigint"'));
assert.strictEqual(run('show jsonDecode(jsonEncode(123n))')[0], 123n);
assert(run('show jsonEncode(new Map())')[0].includes('"map"'));
assert(run('show jsonEncode(new Set())')[0].includes('"set"'));
assert.throws(() => run(`remember x as {}
x.self becomes x
show jsonEncode(x)`), /circular/i);
console.log('5 tests: passed');
