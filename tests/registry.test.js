// tests/registry.test.js
// Tests for Phase 9: Decentralized Package Registry & Ecosystem

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parsePackageSpec, vendorPackage, resolveVendorEntry, restoreVendoredPackages } = require('../compiler/registry');
const { packPackage, initLibrary } = require('../compiler/packager');
const { bundle } = require('../compiler/bundler');
const { detectDependencies } = require('../compiler/dependency-detector');
const vm = require('vm');

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

console.log('\n── Phase 9: Decentralized Package Registry & Ecosystem ──\n');

// 1. Specifier Parsing
test('parsePackageSpec correctly parses git, plz, and npm package specifiers', () => {
  const gh = parsePackageSpec('github:alice/calc@v2.0.0');
  assert.strictEqual(gh.type, 'git');
  assert.strictEqual(gh.name, 'calc');
  assert.strictEqual(gh.ref, 'v2.0.0');
  assert.strictEqual(gh.url, 'https://github.com/alice/calc.git');

  const gitUrl = parsePackageSpec('git+https://gitlab.com/org/crypto-lib.git#dev');
  assert.strictEqual(gitUrl.type, 'git');
  assert.strictEqual(gitUrl.name, 'crypto-lib');
  assert.strictEqual(gitUrl.ref, 'dev');

  const remote = parsePackageSpec('https://cdn.plainscript.org/math-1.4.0.plz');
  assert.strictEqual(remote.type, 'remote-archive');
  assert.strictEqual(remote.name, 'math');

  const local = parsePackageSpec('./dist/helpers.plz');
  assert.strictEqual(local.type, 'local-archive');
  assert.strictEqual(local.name, 'helpers');

  const npm = parsePackageSpec('lodash');
  assert.strictEqual(npm.type, 'npm');
  assert.strictEqual(npm.name, 'lodash');
});

// 2. Packaging and Vendoring Pure PLN Packages
test('vendorPackage installs local .plz archive with SHA-256 verification and updates lockfile', () => {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-proj-'));
  const tmpLib = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-lib-'));

  // Scaffold library
  initLibrary(tmpLib, 'vector-math');
  fs.writeFileSync(
    path.join(tmpLib, 'src', 'index.pln'),
    'make addVectors(a, b)\n  give [a[0] + b[0], a[1] + b[1]]\ndone\nexport addVectors\n',
    'utf8'
  );

  // Pack into .plz
  const pkg = packPackage(tmpLib, { outDir: tmpProject });
  assert.ok(fs.existsSync(pkg.packageFile));

  // Vendor into tmpProject
  const res = vendorPackage(pkg.packageFile, tmpProject);
  assert.strictEqual(res.name, 'vector-math');
  assert.ok(res.integrity.startsWith('sha256-'));

  // Verify vendor structure
  const vendorEntry = resolveVendorEntry(tmpProject, 'vector-math');
  assert.ok(vendorEntry);
  assert.ok(fs.existsSync(vendorEntry));

  // Verify pln.json
  const manifest = JSON.parse(fs.readFileSync(path.join(tmpProject, 'pln.json'), 'utf8'));
  assert.ok(manifest.dependencies['vector-math']);

  // Verify pln.lock
  const lock = JSON.parse(fs.readFileSync(path.join(tmpProject, 'pln.lock'), 'utf8'));
  assert.ok(lock.packages['vector-math']);
  assert.strictEqual(lock.packages['vector-math'].integrity, res.integrity);

  // Cleanup
  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpLib, { recursive: true, force: true });
});

// 3. Pure Module Bundler Integration
test('bundler seamlessly resolves and inlines vendored .pln packages without Node wrappers', () => {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-bundle-proj-'));
  const tmpLib = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-bundle-lib-'));

  // 1. Scaffold and pack library
  initLibrary(tmpLib, 'geometry');
  fs.writeFileSync(
    path.join(tmpLib, 'src', 'index.pln'),
    'make area(w, h)\n  give w * h\ndone\nexport area\n',
    'utf8'
  );
  const pkg = packPackage(tmpLib, { outDir: tmpProject });

  // 2. Vendor library into project
  vendorPackage(pkg.packageFile, tmpProject);

  // 3. Create consumer app in tmpProject
  const appFile = path.join(tmpProject, 'app.pln');
  fs.writeFileSync(
    appFile,
    'bring area from "geometry"\nremember total as area(5, 6)\n',
    'utf8'
  );

  // 4. Bundle app
  const cwd = process.cwd();
  try {
    process.chdir(tmpProject);

    // Verify dependency detector does NOT classify "geometry" as an npm dependency
    const ast = require('../compiler/parser').parse(require('../compiler/lexer').tokenize(fs.readFileSync(appFile, 'utf8')));
    const deps = detectDependencies(ast);
    assert.strictEqual(deps.includes('geometry'), false);

    // Bundle
    const bundledJs = bundle(appFile);
    assert.ok(bundledJs.includes('area'));

    // Execute in VM to verify end-to-end functionality
    const sandbox = { console, module: { exports: {} } };
    vm.createContext(sandbox);
    const result = vm.runInContext(bundledJs + '\ntotal;', sandbox);
    assert.strictEqual(result, 30);
  } finally {
    process.chdir(cwd);
    fs.rmSync(tmpProject, { recursive: true, force: true });
    fs.rmSync(tmpLib, { recursive: true, force: true });
  }
});

// 4. Restore Vendored Packages
test('restoreVendoredPackages restores all dependencies from pln.json', () => {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-restore-proj-'));
  const tmpLib = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-restore-lib-'));

  initLibrary(tmpLib, 'toolbox');
  const pkg = packPackage(tmpLib, { outDir: tmpProject });

  // Add dependency to pln.json
  const plnJson = {
    name: 'test-app',
    version: '1.0.0',
    dependencies: {
      toolbox: pkg.packageFile,
    },
  };
  fs.writeFileSync(path.join(tmpProject, 'pln.json'), JSON.stringify(plnJson, null, 2), 'utf8');

  // Restore
  const restored = restoreVendoredPackages(tmpProject);
  assert.strictEqual(restored.length, 1);
  assert.strictEqual(restored[0].name, 'toolbox');
  assert.ok(fs.existsSync(path.join(tmpProject, '.plainscript', 'vendor', 'toolbox')));

  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpLib, { recursive: true, force: true });
});

console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}
