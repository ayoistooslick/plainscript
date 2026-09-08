// tests/wasm.test.js
// Tests for Phase 10: Native WebAssembly (Wasm) Target

const assert = require('node:assert');
const { compileToWasm, WatEmitter, WasmCompiler } = require('../compiler/wasm');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

console.log('\n── Phase 10: Native WebAssembly (Wasm) Target ──\n');

// 1. Basic Arithmetic and Binary Validation
test('compiles arithmetic functions to valid Wasm binary', () => {
  const src = [
    'make add(a, b)',
    '  give a + b',
    'done',
    'make multiply(x, y)',
    '  give x * y',
    'done',
    'make calc(a, b, c)',
    '  give (a + b) * c',
    'done',
  ].join('\n');

  const { wasm, wat, exports, instantiateSync } = compileToWasm(src);

  // Validate Wasm binary
  assert.ok(WebAssembly.validate(wasm), 'Emitted buffer must be valid WebAssembly binary');
  assert.deepStrictEqual(exports, ['add', 'multiply', 'calc']);

  // Validate WAT
  assert.ok(wat.includes('(func $add'));
  assert.ok(wat.includes('(i32.add'));
  assert.ok(wat.includes('(i32.mul'));

  // Execute synchronously
  const instance = instantiateSync();
  assert.strictEqual(instance.add(15, 27), 42);
  assert.strictEqual(instance.multiply(6, 7), 42);
  assert.strictEqual(instance.calc(2, 3, 4), 20);
});

// 2. Conditionals and Natural Language Comparisons
test('compiles branching and comparisons (if/otherwise, is greater than)', () => {
  const src = [
    'make max(a, b)',
    '  if a is greater than b',
    '    give a',
    '  otherwise',
    '    give b',
    '  done',
    'done',
    'make isEven(n)',
    '  if n % 2 is equal to 0',
    '    give 1',
    '  otherwise',
    '    give 0',
    '  done',
    'done',
  ].join('\n');

  const { wasm, instantiateSync } = compileToWasm(src);
  assert.ok(WebAssembly.validate(wasm));

  const instance = instantiateSync();
  assert.strictEqual(instance.max(10, 20), 20);
  assert.strictEqual(instance.max(99, 5), 99);
  assert.strictEqual(instance.isEven(4), 1);
  assert.strictEqual(instance.isEven(7), 0);
});

// 3. Loops (repeat N times & while)
test('compiles loop constructs (repeat N times, while)', () => {
  const src = [
    'make countLoops(n)',
    '  remember acc as 0',
    '  repeat n times',
    '    acc becomes acc + 1',
    '  done',
    '  give acc',
    'done',
    'make sumWhile(limit)',
    '  remember sum as 0',
    '  remember i as 1',
    '  while i is at most limit',
    '    sum becomes sum + i',
    '    i becomes i + 1',
    '  done',
    '  give sum',
    'done',
  ].join('\n');

  const { wasm, instantiateSync } = compileToWasm(src);
  assert.ok(WebAssembly.validate(wasm));

  const instance = instantiateSync();
  assert.strictEqual(instance.countLoops(5), 5);
  assert.strictEqual(instance.countLoops(0), 0);
  assert.strictEqual(instance.sumWhile(10), 55); // 1 + 2 + ... + 10 = 55
});

// 4. Function-to-Function Calls
test('compiles internal function calls within Wasm module', () => {
  const src = [
    'make square(x)',
    '  give x * x',
    'done',
    'make sumOfSquares(a, b)',
    '  give square(a) + square(b)',
    'done',
  ].join('\n');

  const { wasm, instantiateSync } = compileToWasm(src);
  assert.ok(WebAssembly.validate(wasm));

  const instance = instantiateSync();
  assert.strictEqual(instance.square(5), 25);
  assert.strictEqual(instance.sumOfSquares(3, 4), 25); // 9 + 16 = 25
});

console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}
