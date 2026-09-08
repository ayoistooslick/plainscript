// tests/inference.test.js
// Tests for Phase 7: Semantic Type Inference & Compile-Time Rigor

const assert = require('node:assert');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { inferTypes, parseSqlSelectColumns } = require('../compiler/passes/inference');
const { analyzeSemantics } = require('../compiler/passes/semantic');
const { CLI, tmpDir } = require('./compat/_util');
const fs = require('fs');
const path = require('path');

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

console.log('\n── Phase 7: Semantic Type Inference & Compile-Time Rigor ──\n');

// 1. Literal and Primitive Inferences
test('infers primitive literal types correctly', () => {
  const src = [
    'remember num as 42',
    'remember str as "hello world"',
    'remember flag as true',
    'remember items as [1, 2, 3]',
  ].join('\n');
  const ast = parse(tokenize(src));
  const res = inferTypes(ast);

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.types.get('num'), 'number');
  assert.strictEqual(res.types.get('str'), 'text');
  assert.strictEqual(res.types.get('flag'), 'boolean');
  assert.strictEqual(res.types.get('items'), 'list<number>');
});

// 2. Binary and Stdlib Expression Type Deductions
test('infers binary operations and stdlib return types', () => {
  const src = [
    'remember a as 10 + 20',
    'remember greeting as "Hi " + "there"',
    'remember numbers as range(1, 10)',
    'remember loud as uppercase("shout")',
  ].join('\n');
  const ast = parse(tokenize(src));
  const res = inferTypes(ast);

  assert.strictEqual(res.types.get('a'), 'number');
  assert.strictEqual(res.types.get('greeting'), 'text');
  assert.strictEqual(res.types.get('numbers'), 'list<number>');
  assert.strictEqual(res.types.get('loud'), 'text');
});

// 3. Incompatible Reassignment Detection
test('catches incompatible variable reassignment at compile time', () => {
  const src = [
    'remember score as 100',
    'score becomes "high score"',
  ].join('\n');
  const ast = parse(tokenize(src));
  const res = inferTypes(ast);

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.errors.length, 1);
  assert(res.errors[0].message.includes('Type mismatch'));
  assert(res.errors[0].message.includes('cannot assign "text" to variable "score" declared as "number"'));
});

// 4. Compatible Reassignment Verification
test('allows compatible variable reassignment', () => {
  const src = [
    'remember counter as 0',
    'counter becomes counter + 1',
    'counter becomes 42',
  ].join('\n');
  const ast = parse(tokenize(src));
  const res = inferTypes(ast);

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.errors.length, 0);
  assert.strictEqual(res.types.get('counter'), 'number');
});

// 5. Function Return Type Deduction
test('infers return types from function give statements', () => {
  const src = [
    'make calculateTax(amount, rate)',
    '  give amount * rate',
    'done',
    'make getStatus()',
    '  give "OK"',
    'done',
  ].join('\n');
  const ast = parse(tokenize(src));
  const res = inferTypes(ast);

  assert.strictEqual(res.functions.get('calculateTax').returnType, 'number');
  assert.strictEqual(res.functions.get('getStatus').returnType, 'text');
});

// 6. Database Schema Type Inference
test('infers record shapes from SQL query statements', () => {
  const cols = parseSqlSelectColumns('SELECT id, username, email FROM users WHERE active = 1');
  assert.deepStrictEqual(cols, ['id', 'username', 'email']);

  const src = [
    'database "app.db"',
    'remember products as query',
    '  SELECT id, title, price FROM products',
    'done',
  ].join('\n');
  const ast = parse(tokenize(src));
  const res = inferTypes(ast);

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.types.get('products'), 'list<record<{ id: any, title: any, price: any }>>');
});

// 7. Symbol Lookup for LSP Hover Tooltips
test('provides accurate type info for LSP hover tooltips', () => {
  const src = [
    'remember totalScore as 500',
    'make scoreMultiplier(s)',
    '  give s * 2',
    'done',
  ].join('\n');
  const ast = parse(tokenize(src));
  const res = inferTypes(ast);

  const varInfo = res.getTypeInfo('totalScore', 1, 10);
  assert.strictEqual(varInfo.name, 'totalScore');
  assert.strictEqual(varInfo.type, 'number');

  const fnInfo = res.getTypeInfo('scoreMultiplier', 2, 6);
  assert.strictEqual(fnInfo.name, 'scoreMultiplier');
  assert(fnInfo.type.includes('number'));
});

// 8. Semantic Pass Integration
test('semantic pass incorporates type errors and warnings', () => {
  const src = [
    'remember flag as true',
    'flag becomes 99',
  ].join('\n');
  const ast = parse(tokenize(src));
  const sem = analyzeSemantics(ast);

  assert.strictEqual(sem.ok, false);
  assert(sem.errors.some((e) => e.message.includes('Type mismatch')));
});

// 9. PlainScript Check CLI Integration
test('plainscript check rejects source files with type conflicts', () => {
  const dir = tmpDir();
  const badFile = path.join(dir, 'type_error.pln');
  fs.writeFileSync(badFile, 'remember age as 25\nage becomes "twenty five"\n', 'utf8');

  let output = '';
  let code = 0;
  try {
    output = require('child_process').execFileSync(process.execPath, [CLI, 'check', badFile], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    code = e.status || 1;
    output = (e.stdout || '') + (e.stderr || '');
  }
  assert.strictEqual(code, 1);
  assert(output.includes('Type mismatch') || output.includes('failed validation'));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
