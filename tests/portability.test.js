// tests/portability.test.js
// Tests for Multi-Runtime Portability (ESM, Node), Standalone Binaries, and Native PLN Packaging

const fs = require('fs');
const path = require('path');
const os = require('os');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate, createGenerationContext } = require('../compiler/generator');
const { createStandaloneBundle } = require('../compiler/standalone');
const { initLibrary, packPackage, inspectPackage, unpackPackage } = require('../compiler/packager');

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('\n── Multi-Runtime Portability, Standalone & Packaging Tests ───────────\n');

// 1. Target emission (ESM, Node)
test('target: node emits CommonJS require and module.exports', () => {
  const src = `
make add(a, b)
  give a + b
done
`;
  const ast = parse(tokenize(src));
  const ctx = createGenerationContext({ target: 'node' });
  const js = generate(ast, ctx);
  if (!js.includes("module.exports = { add }")) {
    throw new Error(`Expected CommonJS module.exports, got:\n${js}`);
  }
});

test('target: esm emits native ES module exports and imports', () => {
  const src = `
make multiply(a, b)
  give a * b
done
`;
  const ast = parse(tokenize(src));
  const ctx = createGenerationContext({ target: 'esm' });
  const js = generate(ast, ctx);
  if (!js.includes("export { multiply };")) {
    throw new Error(`Expected ESM export statement, got:\n${js}`);
  }
  if (js.includes("module.exports")) {
    throw new Error(`ESM target should not contain module.exports:\n${js}`);
  }
});

test('target: esm selective bring and export statements emit ESM syntax', () => {
  const src = `
bring { join } from "path"
export greet
make greet(name)
  give "Hello, " + name
done
`;
  const ast = parse(tokenize(src));
  const ctx = createGenerationContext({ target: 'esm' });
  const js = generate(ast, ctx);
  if (!js.includes('import { join } from "path";')) {
    throw new Error(`Expected ESM named import, got:\n${js}`);
  }
  if (!js.includes('export { greet };')) {
    throw new Error(`Expected ESM export statement, got:\n${js}`);
  }
});

// 2. Standalone packaging
test('standalone: createStandaloneBundle creates self-contained bundle banner', () => {
  const fakeCompile = (file, opts) => `console.log("Running standalone app");`;
  const bundle = createStandaloneBundle('test.pln', fakeCompile);
  if (!bundle.includes('PlainScript Standalone Executable Bundle')) {
    throw new Error(`Expected standalone banner in bundle, got:\n${bundle}`);
  }
  if (!bundle.includes('Running standalone app')) {
    throw new Error(`Expected compiled code in bundle, got:\n${bundle}`);
  }
});

// 3. Native PLN Packager
test('packager: initLibrary scaffolds complete library structure with pln.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-lib-test-'));
  try {
    const manifest = initLibrary(tmpDir, 'test-lib');
    if (manifest.name !== 'test-lib') throw new Error(`Expected manifest name test-lib, got ${manifest.name}`);
    if (!fs.existsSync(path.join(tmpDir, 'pln.json'))) throw new Error('pln.json not created');
    if (!fs.existsSync(path.join(tmpDir, 'src', 'index.pln'))) throw new Error('src/index.pln not created');
    if (!fs.existsSync(path.join(tmpDir, 'tests', 'index.test.pln'))) throw new Error('tests/index.test.pln not created');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('packager: packPackage bundles sources and generates .d.ts into .plz archive', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-pack-test-'));
  try {
    initLibrary(tmpDir, 'math-utils');
    const packResult = packPackage(tmpDir, { outDir: tmpDir });
    
    if (!fs.existsSync(packResult.packageFile)) {
      throw new Error(`Package file ${packResult.packageFile} was not created`);
    }
    if (!packResult.packageName.endsWith('.plz')) {
      throw new Error(`Package name should end with .plz, got ${packResult.packageName}`);
    }

    // Inspect package
    const inspection = inspectPackage(packResult.packageFile);
    if (inspection.manifest.name !== 'math-utils') {
      throw new Error(`Inspection name mismatch: ${inspection.manifest.name}`);
    }
    if (!inspection.files.includes('src/index.pln')) {
      throw new Error(`Expected src/index.pln in archive files: ${inspection.files.join(', ')}`);
    }
    if (!inspection.files.includes('src/index.d.ts')) {
      throw new Error(`Expected auto-generated src/index.d.ts in archive files: ${inspection.files.join(', ')}`);
    }

    // Unpack package
    const unpackDir = path.join(tmpDir, 'extracted');
    const unpackResult = unpackPackage(packResult.packageFile, unpackDir);
    if (!fs.existsSync(path.join(unpackDir, 'src', 'index.pln'))) {
      throw new Error('Unpacked src/index.pln not found');
    }
    if (!fs.existsSync(path.join(unpackDir, 'src', 'index.d.ts'))) {
      throw new Error('Unpacked src/index.d.ts not found');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
