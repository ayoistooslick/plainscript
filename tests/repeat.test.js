// tests/repeat.test.js
// Tests for Phase 5: Natural English Intent-Oriented Grammar Adaptation

const assert = require('node:assert');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate } = require('../compiler/generator');

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

function compile(src) {
  return generate(parse(tokenize(src)));
}

console.log('\n── Phase 5: Natural English Intent-Oriented Grammar Adaptation ──\n');

// 1. Natural Intent Repeat Loops
test('repeat N times counts exact iterations', () => {
  const src = [
    'remember counter as 0',
    'repeat 5 times',
    '  counter becomes counter + 1',
    'done',
  ].join('\n');
  const js = compile(src);
  const fn = new Function(js + '\nreturn counter;');
  assert.strictEqual(fn(), 5);
});

test('repeat with item in collection loops over elements', () => {
  const src = [
    'remember fruits as ["apple", "banana", "cherry"]',
    'remember collected as []',
    'repeat with fruit in fruits',
    '  collected becomes collected.concat([fruit])',
    'done',
  ].join('\n');
  const js = compile(src);
  const fn = new Function(js + '\nreturn collected;');
  assert.deepStrictEqual(fn(), ['apple', 'banana', 'cherry']);
});

test('repeat while condition executes until condition is false', () => {
  const src = [
    'remember x as 0',
    'repeat while x is below 3',
    '  x becomes x + 1',
    'done',
  ].join('\n');
  const js = compile(src);
  const fn = new Function(js + '\nreturn x;');
  assert.strictEqual(fn(), 3);
});

test('repeat until condition executes until condition is true', () => {
  const src = [
    'remember energy as 10',
    'remember cycles as 0',
    'repeat until energy is 0',
    '  energy becomes energy - 2',
    '  cycles becomes cycles + 1',
    'done',
  ].join('\n');
  const js = compile(src);
  const fn = new Function(js + '\nreturn { energy, cycles };');
  assert.deepStrictEqual(fn(), { energy: 0, cycles: 5 });
});

test('break and continue work inside repeat loops', () => {
  const src = [
    'remember sum as 0',
    'repeat 10 times',
    '  sum becomes sum + 1',
    '  if sum is 3',
    '    break',
    '  done',
    'done',
  ].join('\n');
  const js = compile(src);
  const fn = new Function(js + '\nreturn sum;');
  assert.strictEqual(fn(), 3);
});

// 2. Natural English Comparison Phrasing
test('is equal to and is not equal to', () => {
  const src = [
    'remember a as 10',
    'remember eq as false',
    'remember neq as false',
    'if a is equal to 10',
    '  eq becomes true',
    'done',
    'if a is not equal to 5',
    '  neq becomes true',
    'done',
  ].join('\n');
  const js = compile(src);
  const fn = new Function(js + '\nreturn { eq, neq };');
  assert.deepStrictEqual(fn(), { eq: true, neq: true });
});

test('is greater than or equal to and is less than or equal to', () => {
  const src = [
    'remember x as 10',
    'remember ge as false',
    'remember le as false',
    'if x is greater than or equal to 10',
    '  ge becomes true',
    'done',
    'if x is less than or equal to 10',
    '  le becomes true',
    'done',
  ].join('\n');
  const js = compile(src);
  const fn = new Function(js + '\nreturn { ge, le };');
  assert.deepStrictEqual(fn(), { ge: true, le: true });
});

test('is more than comparison', () => {
  const src = [
    'remember score as 42',
    'remember passed as false',
    'if score is more than 40',
    '  passed becomes true',
    'done',
  ].join('\n');
  const js = compile(src);
  const fn = new Function(js + '\nreturn passed;');
  assert.strictEqual(fn(), true);
});

test('is in and is not in list condition', () => {
  const src = [
    'remember list as ["admin", "editor", "viewer"]',
    'remember hasAdmin as false',
    'remember hasGuest as false',
    'if "admin" is in list',
    '  hasAdmin becomes true',
    'done',
    'if "guest" is not in list',
    '  hasGuest becomes true',
    'done',
  ].join('\n');
  const js = compile(src);
  const fn = new Function(js + '\nreturn { hasAdmin, hasGuest };');
  assert.deepStrictEqual(fn(), { hasAdmin: true, hasGuest: true });
});

// 3. Natural Accessors & Display Statements
test('first item of, last item of, first of, last of accessors', () => {
  const src = [
    'remember items as ["first-val", "mid-val", "last-val"]',
    'remember f1 as first item of items',
    'remember l1 as last item of items',
    'remember f2 as first of items',
    'remember l2 as last of items',
  ].join('\n');
  const js = compile(src);
  const fn = new Function(js + '\nreturn { f1, l1, f2, l2 };');
  assert.deepStrictEqual(fn(), {
    f1: 'first-val',
    l1: 'last-val',
    f2: 'first-val',
    l2: 'last-val',
  });
});

test('count of list accessor', () => {
  const src = [
    'remember items as [10, 20, 30, 40]',
    'remember totalItems as count of items',
  ].join('\n');
  const js = compile(src);
  const fn = new Function(js + '\nreturn totalItems;');
  assert.strictEqual(fn(), 4);
});

test('display and log statements', () => {
  const src = [
    'display "hello display"',
    'log "hello log"',
  ].join('\n');
  const js = compile(src);
  assert.ok(js.includes('console.log("hello display")'));
  assert.ok(js.includes('console.log("hello log")'));
});

test('bare return statement in function', () => {
  const src = [
    'make testEarlyExit(n)',
    '  if n is below 0',
    '    return',
    '  done',
    '  give n * 2',
    'done',
    'remember resNeg as testEarlyExit(-5)',
    'remember resPos as testEarlyExit(5)',
  ].join('\n');
  const js = compile(src);
  const fn = new Function(js + '\nreturn { resNeg, resPos };');
  assert.deepStrictEqual(fn(), { resNeg: undefined, resPos: 10 });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
