const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { lowerToIR, IR_VERSION } = require('../compiler/ir');

function parseSource(source) { return parse(tokenize(source)); }
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (error) { console.log(`  FAIL  ${name}`); throw error; }
}

console.log('Compiler IR and intent metadata');
test('intent declarations remain distinct in the AST', () => {
  const ast = parseSource(`intend greet(name)\n  give "Hello " + name\ndone`);
  assert.strictEqual(ast.body[0].type, 'IntentDeclaration');
  assert.strictEqual(ast.body[0].intent.kind, 'declaration');
  assert.strictEqual(ast.body[0].intent.parameterCount, 1);
});

test('intent declarations lower to callable IR with metadata', () => {
  const ir = lowerToIR(parseSource(`intend greet(name)\n  give "Hello " + name\ndone`));
  assert.strictEqual(ir.irVersion, IR_VERSION);
  assert.strictEqual(ir.kind, 'Program');
  assert.strictEqual(ir.body[0].kind, 'IntentDeclaration');
  assert.strictEqual(ir.body[0].intent.name, 'greet');
  assert.strictEqual(ir.body[0].parameters[0].kind, 'Object');
});

test('IR preserves return contracts and typed collection bindings', () => {
  const ir = lowerToIR(parseSource(`type User
  id is number
done
make getUsers() returns list of User
  give []
done
let users as list of User is []`));
  const fn = ir.body.find(item => item.kind === 'FunctionDeclaration');
  const binding = ir.body.find(item => item.kind === 'RememberStatement');
  assert.strictEqual(fn.returnType.kind, 'list');
  assert.strictEqual(fn.returnType.value.name, 'User');
  assert.strictEqual(binding.typeAnnotation.kind, 'list');
});

test('intent declarations remain callable at runtime', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-intent-'));
  const file = path.join(dir, 'intent.pln');
  fs.writeFileSync(file, 'intend greet(name)\n  give "Hello " + name\ndone\nshow greet("Ada")\n');
  const cli = path.join(__dirname, '..', 'compiler', 'cli.js');
  const output = execFileSync(process.execPath, [cli, '--quiet', 'run', file], { encoding: 'utf8' });
  assert.match(output, /Hello Ada/);
});

test('IR is serializable and preserves source spans', () => {
  const ir = lowerToIR(parseSource('show "hello"\n'));
  assert.strictEqual(ir.body[0].kind, 'ShowStatement');
  assert.deepStrictEqual(ir.body[0].span, { line: 1, column: 1 });
  assert.doesNotThrow(() => JSON.stringify(ir));
});

test('ir CLI emits machine-readable JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-ir-'));
  const file = path.join(dir, 'intent.pln');
  fs.writeFileSync(file, 'intend greet(name)\n  give name\ndone\n');
  const cli = path.join(__dirname, '..', 'compiler', 'cli.js');
  const output = execFileSync(process.execPath, [cli, 'ir', file], { encoding: 'utf8' });
  const ir = JSON.parse(output);
  assert.strictEqual(ir.irVersion, 1);
  assert.strictEqual(ir.body[0].kind, 'IntentDeclaration');
});

console.log('6 tests: passed');
