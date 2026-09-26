const assert = require('assert');
const { format } = require('../compiler/formatter');

function test(name, fn) {
  fn();
  console.log(`  PASS  ${name}`);
}

test('formats else at the same level as its if', () => {
  const output = format('if true\nshow "yes"\nelse\nshow "no"\ndone\n');
  assert(output.includes('if true\n    show "yes"\nelse\n    show "no"\ndone'));
});

test('formats finally at the same level as try', () => {
  const output = format('try\nshow "work"\nfinally\nshow "cleanup"\ndone\n');
  assert(output.includes('try\n    show "work"\nfinally\n    show "cleanup"\ndone'));
});

test('formatter is idempotent for branches and cleanup', () => {
  const source = 'if true\nshow "yes"\notherwise\nshow "no"\ndone\n';
  assert.strictEqual(format(format(source)), format(source));
});

console.log('3 tests: passed');
