// Tests for PlainScript  -  zero-config production build model.
//
//   build:    plainscript build writes dist/<name>.js preserving source names and
//             structure relative to the source root (TypeScript-style)
//   src:      automatic src/ discovery; src/ falls back to project root
//   run:      execution happens from a scratch directory outside the
//             project  -  execution never writes output files into it
//   packages: multi-file projects and npm-package-style projects build to a
//             normal Node-consumable dist/
//
// Run with: node tests/build.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const CLI = path.join(__dirname, '..', 'compiler', 'cli.js');

function runCli(args, cwd) {
  try {
    return execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env },
    });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

function runNode(file, cwd) {
  try {
    return execFileSync(process.execPath, [file], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env },
    });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

function tmpDir(prefix = 'plainscript-build-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

// ── Source discovery ──────────────────────────────────────────────────────────

test('src: without src/ the project root is scanned and output goes to dist/', () => {
  const dir = tmpDir();
  write(dir, 'messi.pln', 'show "goal"\n');
  const out = runCli(['build'], dir);
  assert(fs.existsSync(path.join(dir, 'dist', 'messi.js')),
    `expected dist/messi.js, got output:\n${out}`);
});

test('src: an existing src/ folder becomes the source root automatically', () => {
  const dir = tmpDir();
  write(dir, 'src/index.pln', 'show "src entry"\n');
  write(dir, 'stray.pln', 'show "outside src"\n');
  runCli(['build'], dir);
  assert(fs.existsSync(path.join(dir, 'dist', 'index.js')), 'src/index.pln must build to dist/index.js');
  assert(!fs.existsSync(path.join(dir, 'dist', 'stray.js')), 'files outside src/ must not be compiled');
});

test('src: multiple files under src/ are all compiled to dist/', () => {
  const dir = tmpDir();
  write(dir, 'src/a.pln', 'show "a"\n');
  write(dir, 'src/b.pln', 'show "b"\n');
  const out = runCli(['build'], dir);
  assert(fs.existsSync(path.join(dir, 'dist', 'a.js')), 'src/a.pln must build to dist/a.js');
  assert(fs.existsSync(path.join(dir, 'dist', 'b.js')), 'src/b.pln must build to dist/b.js');
  assert(out.includes('2 file(s) compiled'), `expected 2-file summary, got:\n${out}`);
});

test('src: subdirectories under src/ are mirrored into dist/', () => {
  const dir = tmpDir();
  write(dir, 'src/lib/utils/helper.pln', 'show "helper"\n');
  runCli(['build'], dir);
  assert(fs.existsSync(path.join(dir, 'dist', 'lib', 'utils', 'helper.js')),
    'expected dist/lib/utils/helper.js');
});

test('src: entry is src/app.pln by default for start', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.pln'), 'show "custom-entry"\n');
  const out = runCli(['start'], dir);
  assert(out.includes('custom-entry'), `start must execute src/app.pln, got:\n${out}`);
});

// ── plainscript.config.json overrides ─────────────────────────────────────────────

test('config: outDir override redirects build output', () => {
  const dir = tmpDir();
  write(dir, 'plainscript.config.json', JSON.stringify({ compilerOptions: { outDir: './build' } }));
  write(dir, 'src/app.pln', 'show "ok"\n');
  runCli(['build'], dir);
  assert(fs.existsSync(path.join(dir, 'build', 'app.js')), 'expected build/app.js');
  assert(!fs.existsSync(path.join(dir, 'dist', 'app.js')), 'default dist/ must not appear when outDir is overridden');
});

test('config: rootDir override changes source discovery root', () => {
  const dir = tmpDir();
  write(dir, 'plainscript.config.json', JSON.stringify({ compilerOptions: { rootDir: './lib' } }));
  write(dir, 'lib/core.pln', 'show "core"\n');
  write(dir, 'src/other.pln', 'show "other"\n');
  runCli(['build'], dir);
  assert(fs.existsSync(path.join(dir, 'dist', 'core.js')), 'expected dist/core.js from lib/ sources');
  assert(!fs.existsSync(path.join(dir, 'dist', 'other.js')), 'files outside rootDir must not compile');
});

test('config: exclude skips named directories', () => {
  const dir = tmpDir();
  write(dir, 'plainscript.config.json', JSON.stringify({ compilerOptions: { exclude: ['vendor'] } }));
  write(dir, 'src/app.pln', 'show "app"\n');
  write(dir, 'src/vendor/old.pln', 'show "old"\n');
  runCli(['build'], dir);
  assert(fs.existsSync(path.join(dir, 'dist', 'app.js')), 'src/app.pln must compile');
  assert(!fs.existsSync(path.join(dir, 'dist', 'vendor', 'old.js')), 'excluded directory must not compile');
});

test('config: combined outDir + rootDir overrides', () => {
  const dir = tmpDir();
  write(dir, 'plainscript.config.json', JSON.stringify({ compilerOptions: { outDir: './build', rootDir: './lib' } }));
  write(dir, 'lib/app.pln', 'show "from-lib"\n');
  runCli(['build'], dir);
  assert(fs.existsSync(path.join(dir, 'build', 'app.js')), 'expected build/app.js');
});

test('config: start uses rootDir and outDir from config', () => {
  const dir = tmpDir();
  write(dir, 'plainscript.config.json', JSON.stringify({ compilerOptions: { rootDir: './app', outDir: './build' } }));
  write(dir, 'app/index.pln', 'show "config-start"\n');
  const out = runCli(['start'], dir);
  assert(out.includes('config-start'), `start must use config rootDir, got:\n${out}`);
});

// ── Build model behaviour ────────────────────────────────────────────────────

test('build: source filenames are preserved (messi.pln -> dist/messi.js)', () => {
  const dir = tmpDir();
  write(dir, 'messi.pln', 'remember club as "inter miami"\nshow club\n');
  runCli(['build'], dir);
  const js = fs.readFileSync(path.join(dir, 'dist', 'messi.js'), 'utf8');
  assert(js.includes('let club = "inter miami"'), 'generated JS must match the source program');
  const printed = runNode(path.join(dir, 'dist', 'messi.js'), dir);
  assert(printed.includes('inter miami'), `dist/messi.js must be executable, got:\n${printed}`);
});

test('build: directory structure under the source root is preserved', () => {
  const dir = tmpDir();
  write(dir, 'src/a/b/deep.pln', 'show "deep"\n');
  runCli(['build'], dir);
  assert(fs.existsSync(path.join(dir, 'dist', 'a', 'b', 'deep.js')), 'expected dist/a/b/deep.js');
});

test('build: never writes dist/index.js for a differently named source', () => {
  const dir = tmpDir();
  write(dir, 'messi.pln', 'show "goal"\n');
  runCli(['build'], dir);
  assert(!fs.existsSync(path.join(dir, 'dist', 'index.js')), 'output name must follow the source name');
});

test('build: an explicit file argument builds just that file into dist/', () => {
  const dir = tmpDir();
  write(dir, 'one.pln', 'show "one"\n');
  write(dir, 'two.pln', 'show "two"\n');
  runCli(['build', 'two.pln'], dir);
  assert(fs.existsSync(path.join(dir, 'dist', 'two.js')), 'expected dist/two.js');
  assert(!fs.existsSync(path.join(dir, 'dist', 'one.js')), 'other sources must stay unbuilt');
});

test('build: compilation is deterministic (identical bytes across rebuilds)', () => {
  const dir = tmpDir();
  write(dir, 'det.pln', 'remember n as 7\nshow n\n');
  runCli(['build'], dir);
  const first = fs.readFileSync(path.join(dir, 'dist', 'det.js'), 'utf8');
  fs.rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
  runCli(['build'], dir);
  const second = fs.readFileSync(path.join(dir, 'dist', 'det.js'), 'utf8');
  assert(first === second, 'rebuilds must produce byte-identical output');
});

test('build: node_modules and hidden directories are never scanned', () => {
  const dir = tmpDir();
  write(dir, 'keep.pln', 'show "kept"\n');
  write(dir, 'node_modules', 'junk', 'junk.js', 'not-plainscript');
  write(dir, 'node_modules', 'junk', 'fake.pln', 'show "should not compile"');
  write(dir, '.hidden', 'secret.pln', 'show "should not compile"');
  const out = runCli(['build'], dir);
  assert(!out.includes('fake.pln') && !out.includes('secret.pln'), `excluded dirs leaked into the build:\n${out}`);
  assert(!fs.existsSync(path.join(dir, 'dist', 'fake.js')), 'node_modules must not be compiled');
  assert(!fs.existsSync(path.join(dir, 'dist', 'secret.js')), 'hidden dirs must not be compiled');
});

test('build: a stale dist is not re-scanned as source', () => {
  const dir = tmpDir();
  write(dir, 'loop.pln', 'show "v1"\n');
  runCli(['build'], dir);
  const out = runCli(['build'], dir);
  assert(out.includes('1 file(s) compiled'), `dist/ contents leaked into discovery:\n${out}`);
});

test('build: with no sources at all the CLI teaches instead of crashing', () => {
  const dir = tmpDir();
  const out = runCli(['build'], dir);
  assert(out.toLowerCase().includes('no .pln files found'), `expected a teaching error, got:\n${out}`);
});

// ── Run model: scratch execution, nothing left in the project ────────────────

test('run: executes correctly and leaves zero files behind in the project', () => {
  const dir = tmpDir();
  write(dir, 'go.pln', 'show "ran fine"\n');
  const before = fs.readdirSync(dir).sort().join(',');
  const out = runCli(['run', 'go.pln'], dir);
  assert(out.includes('ran fine'), `program did not run:\n${out}`);
  assert(out.includes('Done.'), `expected completion marker:\n${out}`);
  const after = fs.readdirSync(dir).sort().join(',');
  assert(before === after, `project directory changed: before [${before}] after [${after}]`);
  const strays = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert(strays.length === 0, `run wrote files beside the source: ${strays.join(', ')}`);
});

// Fabricate an installed package so require() resolution can be proven
// without touching the network.
function writeLocalPackage(projectDir, pkgName, mainSrc) {
  const pkgDir = path.join(projectDir, 'node_modules', pkgName);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: pkgName, main: 'index.js' }));
  fs.writeFileSync(path.join(pkgDir, 'index.js'), mainSrc, 'utf8');
}

test('run: requires resolve against project node_modules even from the scratch dir', () => {
  const dir = tmpDir();
  writeLocalPackage(dir, 'fakerunpkg', 'module.exports = "resolved-ok"');
  write(dir, 'app.pln', 'use fakerunpkg\nshow fakerunpkg\n');
  const out = runCli(['run', 'app.pln'], dir);
  assert(out.includes('resolved-ok'), `NODE_PATH resolution failed:\n${out}`);
});

test('start: builds src/app.pln into dist and executes that output', () => {
  const dir = tmpDir();
  write(dir, path.join('src', 'app.pln'), 'show "started-from-dist"\n');
  const out = runCli(['start'], dir);
  assert(out.includes('started-from-dist'), `start did not execute:\n${out}`);
  assert(fs.existsSync(path.join(dir, 'dist', 'app.js')), 'start must persist the built output in dist/');
});

// ── Integration: multi-file project ──────────────────────────────────────────

test('integration: a multi-file project imports are bundled and the dist output runs standalone', () => {
  const dir = tmpDir();
  // Use only core statements so no packages are needed.
  write(dir, path.join('src', 'index.pln'), [
    'import "./helpers/greet.pln"',
    '',
    'greet("PlainScript")',
  ].join('\n'));
  write(dir, path.join('src', 'helpers', 'greet.pln'), [
    'make greet(who)',
    '    show `Hello ${who}`',
    'done',
  ].join('\n'));

  const out = runCli(['build'], dir);
  assert(fs.existsSync(path.join(dir, 'dist', 'index.js')), `multi-file build failed:\n${out}`);
  assert(fs.existsSync(path.join(dir, 'dist', 'helpers', 'greet.js')), 'each source file gets its own dist output');

  const printed = runNode(path.join(dir, 'dist', 'index.js'), dir);
  assert(printed.includes('Hello PlainScript'), `standalone dist output broken:\n${printed}`);
});

// ── Integration: npm-package-style project ───────────────────────────────────

test('integration: an npm-package-style project builds src/index.pln -> dist/index.js consumable by Node', () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({
    name: 'my-plainscript-package',
    version: '1.0.1',
    main: 'dist/index.js',
    scripts: { build: 'plainscript build' },
    devDependencies: { plainscript: '^0.1.7' },
  }, null, 2));
  write(dir, path.join('src', 'index.pln'), [
    'remember greeting as "published"',
    'show `package says ${greeting}`',
  ].join('\n'));

  const out = runCli(['build'], dir);
  assert(fs.existsSync(path.join(dir, 'dist', 'index.js')), `package build failed:\n${out}`);
  assert(!fs.existsSync(path.join(dir, 'src', 'index.js')), 'sources must stay pristine');

  // A consumer requires the built package exactly like any Node module.
  const consumer = write(dir, 'consume.js', [
    `require('./dist/index.js');`,
  ].join('\n'));
  const printed = runNode(consumer, dir);
  assert(printed.includes('package says published'), `consumer could not use the built package:\n${printed}`);

  // The project's own package.json semantics were respected, not rewritten.
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert(pkg.main === 'dist/index.js' && pkg.name === 'my-plainscript-package', 'package.json was modified by the build');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
