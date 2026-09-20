// Tests for PlainScript Enterprise-Grade Module and Package Importing System.
//
// Run with: node tests/modules.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { tokenize, TOKEN } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate, createGenerationContext } = require('../compiler/generator');
const { bundle, resolveDependencies } = require('../compiler/bundler');
const { detectDependencies } = require('../compiler/dependency-detector');
const { checkTypes } = require('../compiler/type-checker');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

function assert(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected "${expected}", got "${actual}"`);
  }
}

console.log('── Enterprise Module & Package System Tests ───────────────────────────\n');

// ── 1. Lexer & Parser Tests ──────────────────────────────────────────────────

test('lexer tokenizes bring, all, share, expose, from keywords', () => {
  const tokens = tokenize('bring all from "./math.pln" as math').map(t => t.value);
  assert(tokens.includes('bring'), true, 'missing bring token');
  assert(tokens.includes('all'), true, 'missing all token');
  assert(tokens.includes('from'), true, 'missing from token');
});

test('parser parses selective imports: bring add and multiply from "./math.pln"', () => {
  const ast = parse(tokenize('bring add and multiply from "./math.pln"'));
  const stmt = ast.body[0];
  assert(stmt.type, 'ImportStatement');
  assert(stmt.path, './math.pln');
  assert(JSON.stringify(stmt.names), JSON.stringify(['add', 'multiply']));
});

test('parser parses namespaced imports: bring all from "./math.pln" as math', () => {
  const ast = parse(tokenize('bring all from "./math.pln" as math'));
  const stmt = ast.body[0];
  assert(stmt.type, 'ImportStatement');
  assert(stmt.path, './math.pln');
  assert(stmt.namespace, 'math');
});

test('parser parses package imports: bring get from "axios"', () => {
  const ast = parse(tokenize('bring get from "axios"'));
  const stmt = ast.body[0];
  assert(stmt.type, 'ImportStatement');
  assert(stmt.path, 'axios');
  assert(stmt.defaultImport, 'get');
});

test('parser parses path-aliased imports: bring button from "@/components/button.pln"', () => {
  const ast = parse(tokenize('bring button from "@/components/button.pln"'));
  const stmt = ast.body[0];
  assert(stmt.type, 'ImportStatement');
  assert(stmt.path, '@/components/button.pln');
});

test('parser parses barrel exports: export all from "./submodule.pln"', () => {
  const ast = parse(tokenize('export all from "./submodule.pln"'));
  const stmt = ast.body[0];
  assert(stmt.type, 'ExportStatement');
  assert(stmt.exportAll, true);
  assert(stmt.fromPath, './submodule.pln');
});

test('parser parses multi-symbol exports: export add and multiply', () => {
  const ast = parse(tokenize('export add and multiply'));
  const stmt = ast.body[0];
  assert(stmt.type, 'ExportStatement');
  assert(JSON.stringify(stmt.names), JSON.stringify(['add', 'multiply']));
});

// ── 2. Dependency Detector Integration ──────────────────────────────────────

test('dependency detector detects npm packages imported via bring/import', () => {
  const deps = detectDependencies('bring get from "axios"\nbring express from "express"');
  assert(deps.includes('axios'), true, 'missing axios dependency');
  assert(deps.includes('express'), true, 'missing express dependency');
});

// ── 3. Generator & Bundler Integration ────────────────────────────────────────

test('generator emits CommonJS require for npm package imports', () => {
  const js = generate(parse(tokenize('bring axios from "axios"')));
  assert(js.includes('require("axios")') || js.includes("require('axios')"), true, 'missing require("axios")');
});

test('generator emits barrel re-export assignments', () => {
  const js = generate(parse(tokenize('export all from "./math.pln"')));
  assert(js.includes('Object.assign(module.exports, require("./math.pln"))'), true, 'missing Object.assign for barrel export');
});

test('bundler handles path aliasing (@/ -> src)', () => {
  const tmpDir = path.join(__dirname, 'tmp_module_test');
  const srcDir = path.join(tmpDir, 'src');
  const compDir = path.join(srcDir, 'components');
  fs.mkdirSync(compDir, { recursive: true });

  const btnFile = path.join(compDir, 'button.pln');
  const mainFile = path.join(srcDir, 'main.pln');

  fs.writeFileSync(btnFile, 'make renderBtn()\n  give "Button"\ndone\nexport renderBtn');
  fs.writeFileSync(mainFile, 'bring renderBtn from "@/components/button.pln"\nshow renderBtn()');

  const oldCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    const bundledJs = bundle(mainFile);
    assert(bundledJs.includes('renderBtn()'), true, 'bundled JS missing renderBtn');
  } finally {
    process.chdir(oldCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('bundler handles implicit .pln extension and folder index resolution', () => {
  const tmpDir = path.join(__dirname, 'tmp_module_ext_test');
  const utilsDir = path.join(tmpDir, 'utils');
  fs.mkdirSync(utilsDir, { recursive: true });

  const helperFile = path.join(tmpDir, 'helper.pln');
  const indexFile = path.join(utilsDir, 'index.pln');
  const mainFile = path.join(tmpDir, 'main.pln');

  fs.writeFileSync(helperFile, 'make help()\n  give "ok"\ndone\nexport help');
  fs.writeFileSync(indexFile, 'make util()\n  give 42\ndone\nexport util');
  fs.writeFileSync(mainFile, 'bring help from "./helper"\nbring util from "./utils"\nshow help()');

  try {
    const bundledJs = bundle(mainFile);
    assert(bundledJs.includes('help()'), true, 'bundled JS missing helper');
    assert(bundledJs.includes('util()'), true, 'bundled JS missing index util');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Summary ──────────────────────────────────────────────────────────────────

test('generator: export statement before declaration defers assignment to end of file (no TDZ)', () => {
  const js = generate(parse(tokenize('share who\nremember who as "leaf"')));
  const assignIdx = js.indexOf('module.exports.who = who;');
  const declIdx = js.indexOf('let who = "leaf"');
  assert(assignIdx !== -1, true, 'expected deferred module.exports.who assignment');
  assert(declIdx !== -1, true, 'expected let who declaration');
  assert(assignIdx > declIdx, true, 'export assignment must come after declaration');
});

test('generator: namespace import of a local module builds a live getter object, not a require fallback', () => {
  const context = createGenerationContext();
  context.bundled = true;
  context.importSurfaces = new Map([['./lib.pln', ['config', 'double']]]);
  const js = generate(parse(tokenize('bring all from "./lib.pln" as lib\nshow lib.config.env')), context);
  assert(js.includes('const lib = { get config()'), true, 'expected live getter namespace object');
  assert(!js.includes('require("./lib.pln")'), true, 'bundled namespace import must not emit a require fallback');
});

test('bundler: namespace import resolves surface through generateBundle context', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-ns-'));
  const libFile = path.join(tmpDir, 'lib.pln');
  const mainFile = path.join(tmpDir, 'main.pln');
  fs.writeFileSync(libFile, 'remember config as {env: "test", retries: 3}\nmake double(n)\n  give n * 2\ndone\nexport config\nexport double');
  fs.writeFileSync(mainFile, 'bring all from "./lib.pln" as lib\nshow lib.config.env\nshow lib.double(21)');
  try {
    const bundledJs = bundle(mainFile);
    assert(bundledJs.includes('const lib = { get config()'), true, 'expected live getter namespace object');
    assert(!bundledJs.includes('require("./lib.pln")'), true, 'bundled output must not require the .pln source');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('static checker resolves imported contracts and return types across files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-cross-file-types-'));
  const modelFile = path.join(tmpDir, 'model.pln');
  const mainFile = path.join(tmpDir, 'main.pln');
  fs.writeFileSync(modelFile, `type User\n  id is number\n  name is text\ndone\nmake getUsers() returns list of User\n  give [{ id: 1, name: "Ada" }]\ndone\nexport User\nexport getUsers`);
  fs.writeFileSync(mainFile, `bring User and getUsers from "./model.pln"\nmake first() returns User\n  give getUsers()[0]\ndone\nshow first().name`);
  try {
    const files = resolveDependencies(mainFile);
    const ast = { type: 'Program', body: files.flatMap(file => file.ast.body) };
    assert(checkTypes(ast).diagnostics.length, 0, 'cross-file contracts should resolve');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('static checker reports an unknown imported symbol deterministically', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-cross-file-missing-'));
  const modelFile = path.join(tmpDir, 'model.pln');
  const mainFile = path.join(tmpDir, 'main.pln');
  fs.writeFileSync(modelFile, 'make present()\n  give 1\ndone\nexport present');
  fs.writeFileSync(mainFile, 'bring missing from "./model.pln"\nshow missing()');
  try {
    const files = resolveDependencies(mainFile);
    const ast = { type: 'Program', body: files.flatMap(file => file.ast.body) };
    assert(checkTypes(ast).diagnostics.some(item => item.code === 'PLN-MODULE-UNKNOWN'), true, 'missing imports should be diagnosed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
