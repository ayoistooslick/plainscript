// Tests for Phase 2: Compiler Architecture, Semantic Analysis, and .d.ts Generation.

const { test, assert, tmpDir, CLI } = require('./compat/_util');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { analyzeSemantics } = require('../compiler/passes/semantic');
const { generateTypeDeclarations } = require('../compiler/passes/types');
const fs = require('fs');
const path = require('path');

test('semantic: validates record kind schemas and catches unknown fields', () => {
  const validSource = `
define a kind called "User" with
    name is ""
    age is 0
done
remember u as create a User with name "Ada" and age 36
`;
  const validAst = parse(tokenize(validSource));
  const validRes = analyzeSemantics(validAst);
  assert(validRes.ok === true, 'valid schema should pass semantic analysis');

  const invalidSource = `
define a kind called "User" with
    name is ""
done
remember u as create a User with name "Ada" and invalidProp 123
`;
  const invalidAst = parse(tokenize(invalidSource));
  const invalidRes = analyzeSemantics(invalidAst);
  assert(invalidRes.ok === false, 'unknown field should trigger semantic error');
  assert(invalidRes.errors[0].message.includes('invalidProp'), 'error should mention invalid field');
});

test('semantic: catches break and continue outside loops', () => {
  const badSource = `
remember x as 10
break
`;
  const ast = parse(tokenize(badSource));
  const res = analyzeSemantics(ast);
  assert(res.ok === false, 'break outside loop must fail');
  assert(res.errors[0].message.includes('can only be used inside loops'), 'descriptive loop error');
});

test('types: generateTypeDeclarations generates typescript interfaces and function signatures', () => {
  const source = `
define a kind called "Product" with
    title is ""
    price is 0.0
    inStock is true
done

make calculateTax(amount, rate as 0.1)
    give amount * rate
done

remember appVersion as "1.0.4"
`;
  const ast = parse(tokenize(source));
  const dts = generateTypeDeclarations(ast);

  assert(dts.includes('export interface Product {'), 'contains Product interface');
  assert(dts.includes('title: string;'), 'title is string');
  assert(dts.includes('price: number;'), 'price is number');
  assert(dts.includes('inStock: boolean;'), 'inStock is boolean');
  assert(dts.includes('export declare function calculateTax(amount: any, rate?: number): any;'), 'function signature');
  assert(dts.includes('export declare let appVersion: string;'), 'variable declaration');
});

test('cli: plainscript build --types generates .d.ts alongside .js', () => {
  const dir = tmpDir();
  const plnFile = path.join(dir, 'test.pln');
  fs.writeFileSync(plnFile, 'make add(a, b)\n  give a + b\ndone\n');

  const { execFileSync } = require('child_process');
  execFileSync(process.execPath, [CLI, 'build', plnFile, '--types'], { cwd: dir });
  const dtsFile = path.join(dir, 'dist', 'test.d.ts');
  const jsFile = path.join(dir, 'dist', 'test.js');

  assert(fs.existsSync(jsFile), 'dist/test.js exists');
  assert(fs.existsSync(dtsFile), 'dist/test.d.ts exists');
  const dtsContent = fs.readFileSync(dtsFile, 'utf8');
  assert(dtsContent.includes('export declare function add(a: any, b: any): any;'), 'd.ts content correct');
});

const { summary } = require('./compat/_util');
summary();
