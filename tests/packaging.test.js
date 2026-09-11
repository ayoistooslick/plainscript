// Packaging regression tests for PlainScript v1.0.362.
//
// These guard the dependency architecture that makes `plainscript-lang`
// installable on platforms where better-sqlite3 has no usable native binary
// (e.g. Android/Termux ARM64 with Node 24):
//   - better-sqlite3 must be an OPTIONAL runtime backend, never mandatory.
//   - the compiler/CLI must start without it (no eager optional import).
//   - the WebAssembly SQLite engine (sql.js) must work when the native
//     engine is absent, and vice versa.
//   - a missing optional engine produces a clear, useful error, and only
//     when that engine is actually requested.
//   - the packed npm artifact installs and runs with optional dependencies
//     omitted.
//
// Run with: node tests/packaging.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate, createGenerationContext, wrapAsync } = require('../compiler/generator');

const ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
  }
}

// Async tests are queued and joined before the summary (same pattern as the
// backend suite).
const pendingTests = [];
let lastTest = Promise.resolve();

function testAsync(name, fn) {
  const run = () => fn().then(
    () => { console.log(`  PASS  ${name}`); passed++; },
    (e) => { console.log(`  FAIL  ${name}`); console.log(`        ${e.message}`); failed++; },
  );
  lastTest = lastTest.then(run, run);
  pendingTests.push(lastTest);
}

function assertIncludes(actual, expected, label) {
  if (!String(actual).includes(expected)) {
    throw new Error(
      `${label || 'Expected'} to include:\n        ${expected}\n        Got:\n        ${String(actual).trim()}`
    );
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// Compile PlainScript the way `plainscript build` does (async runtime wrapper).
function compileProgram(source) {
  const context = createGenerationContext();
  let js = generate(parse(tokenize(source)), context);
  if (context.needsAsync) js = wrapAsync(js);
  return js;
}

// Providers control what `require('better-sqlite3')` and `require('sql.js')`
// resolve to inside generated programs:
//   provider.native = 'real'  -> the real module (installed as a devDependency)
//   provider.native = 'throw' -> MODULE_NOT_FOUND (simulates the Termux case)
//   provider.wasm   = same options
// Any other module falls through to the real Node require.
function makeRequire(provider = {}) {
  return (name) => {
    const kind = name === 'better-sqlite3' ? provider.native
      : name === 'sql.js' ? provider.wasm
      : null;
    if (kind === 'real') return require(name);
    if (kind === 'throw') {
      const e = new Error(`Cannot find module '${name}'`);
      e.code = 'MODULE_NOT_FOUND';
      throw e;
    }
    return require(name);
  };
}

// Evaluate generated JS with the controlled require. Async-wrapped programs
// are awaited. Returns captured console lines; throws on program errors.
async function runGenerated(js, provider = {}) {
  const logs = [];
  const sandboxConsole = {
    log: (...args) => logs.push(args.map(String).join(' ')),
    error: (...args) => logs.push('[err] ' + args.map(String).join(' ')),
  };
  const match = js.match(/^\(async \(\) => \{\n([\s\S]*)\n\}\)\(\);$/);
  const body = match
    ? `return (async () => {\n${match[1]}\n})();`
    : `${js}\n;return undefined;`;
  const fn = new Function('require', 'console', 'process', body)(
    makeRequire(provider), sandboxConsole, { env: {} }
  );
  await fn;
  return logs;
}

// ── Dependency-declaration guard ─────────────────────────────────────────────

test('package.json: better-sqlite3 is optional, never a mandatory dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(pkg.version === '1.0.362', `expected version 1.0.362, got ${pkg.version}`);
  assert(!pkg.dependencies || !pkg.dependencies['better-sqlite3'],
    'better-sqlite3 must not be a mandatory dependency');
  assert(pkg.optionalDependencies && pkg.optionalDependencies['better-sqlite3'],
    'better-sqlite3 must be declared an optional dependency');
  assert(pkg.optionalDependencies && pkg.optionalDependencies['sql.js'],
    'sql.js (WebAssembly engine) must be an optional dependency');
  assert(pkg.devDependencies && pkg.devDependencies['better-sqlite3'],
    'better-sqlite3 must remain a devDependency for the test suite');
  const scripts = pkg.scripts || {};
  assert(!(scripts.install || scripts.postinstall || scripts.preinstall),
    'no install/postinstall/preinstall hook may build native addons');
});

// ── The compiler and plain programs never touch the optional engines ────────

testAsync('a plain program runs with no SQLite engines available at all', async () => {
  const js = compileProgram(`show "hello from plainscript"
remember x as 40
show x + 2
`);
  const logs = await runGenerated(js, { native: 'throw', wasm: 'throw' });
  assert(logs[0] === 'hello from plainscript', `unexpected output: ${logs.join('|')}`);
  assert(logs[1] === '42', `unexpected output: ${logs.join('|')}`);
});

testAsync('use sqlite is lazy: starting such a program needs no native engine', async () => {
  const js = compileProgram(`use sqlite
show "up"
`);
  const logs = await runGenerated(js, { native: 'throw' });
  assert(logs[0] === 'up', `unexpected output: ${logs.join('|')}`);
});

testAsync('constructing a native database without the engine gives a teaching error', async () => {
  const js = compileProgram(`use sqlite
remember db as sqlite("app.db")
show "unreachable"
`);
  let thrown = null;
  try {
    await runGenerated(js, { native: 'throw' });
  } catch (e) {
    thrown = e;
  }
  assert(thrown, 'expected the program to throw');
  assertIncludes(thrown.message, 'better-sqlite3', 'native-engine error');
  assertIncludes(thrown.message, 'wasm', 'fallback hint');
});

// ── WebAssembly engine (the Termux fallback) ─────────────────────────────────

testAsync('WASM SQLite works when the native engine is unavailable', async () => {
  const js = compileProgram(`database ":memory:" using "wasm"
execute
    CREATE TABLE t (name TEXT)
done
remember who as "bo"
insert
    INSERT INTO t (name) VALUES ({who})
done
remember updated as "bo2"
transaction
    update
        UPDATE t SET name = {updated} WHERE name = {who}
    done
done
remember rows as query
    SELECT name FROM t
done
for each row in rows
show row.name
done
`);
  const logs = await runGenerated(js, { native: 'throw', wasm: 'real' });
  assertIncludes(logs.join('\n'), 'bo2', 'wasm query result after transaction');
  assert(!logs.join('\n').includes('unavailable'),
    'explicit wasm mode must not trigger the native probe warning');
});

// ── Native engine (the default) ──────────────────────────────────────────────

testAsync('native SQLite works when better-sqlite3 is available', async () => {
  const js = compileProgram(`database ":memory:"
execute
    CREATE TABLE t (name TEXT)
done
remember who as "cy"
insert
    INSERT INTO t (name) VALUES ({who})
done
remember rows as query
    SELECT name FROM t
done
for each row in rows
show row.name
done
`);
  // sql.js is unavailable: any accidental fallback to WASM must fail loudly.
  const logs = await runGenerated(js, { native: 'real', wasm: 'throw' });
  assertIncludes(logs.join('\n'), 'cy', 'native query result');
  assert(!logs.join('\n').includes('unavailable'), 'must use the native engine');
});

// ── Clear errors, on request only ────────────────────────────────────────────

testAsync('requesting the native engine without it gives a clear wasm hint', async () => {
  const js = compileProgram(`database "app.db" using "native"
show "unreachable"
`);
  let thrown = null;
  try {
    await runGenerated(js, { native: 'throw', wasm: 'real' });
  } catch (e) {
    thrown = e;
  }
  assert(thrown, 'expected the program to throw');
  assertIncludes(thrown.message, 'native SQLite engine is not usable', 'explicit native error');
  assertIncludes(thrown.message, 'wasm', 'fallback hint');
  assertIncludes(thrown.message, 'app.db', 'reported file');
});

testAsync('requesting a database with both engines missing gives one clear error', async () => {
  const js = compileProgram(`database ":memory:"
show "unreachable"
`);
  let thrown = null;
  try {
    await runGenerated(js, { native: 'throw', wasm: 'throw' });
  } catch (e) {
    thrown = e;
  }
  assert(thrown, 'expected the program to throw');
  assertIncludes(thrown.message, 'SQLite is not available on this machine', 'combined error');
  assertIncludes(thrown.message, 'npm install better-sqlite3 sql.js', 'install hint');
});

// ── Packed artifact installs and runs without better-sqlite3 ─────────────────

function npmAvailable() {
  try {
    execFileSync('npm', ['--version'], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

test('packed package installs with optional dependencies omitted and still runs', () => {
  if (!npmAvailable()) {
    console.log('        (npm unavailable; skipping real-install assertion)');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-pack-'));
  try {
    const tarball = path.join(tmp, 'pack');
    fs.mkdirSync(tarball, { recursive: true });
    execFileSync('npm', ['pack', ROOT, '--pack-destination', tarball, '--json'], {
      cwd: ROOT, stdio: 'ignore',
    });
    const files = fs.readdirSync(tarball).filter((f) => f.endsWith('.tgz'));
    assert(files.length === 1, `expected one tarball, got ${files.join(', ')}`);
    const tgz = path.join(tarball, files[0]);

    execFileSync('npm', ['init', '-y'], { cwd: tmp, stdio: 'ignore' });
    execFileSync('npm', [
      'install', tgz,
      '--omit=optional',
      '--no-audit', '--no-fund', '--no-package-lock', '--no-save',
    ], { cwd: tmp, stdio: 'ignore' });

    assert(!fs.existsSync(path.join(tmp, 'node_modules', 'better-sqlite3')),
      'install without optional deps must not contain better-sqlite3');

    const installed = path.join(tmp, 'node_modules', 'plainscript-lang');
    const versionOut = execFileSync(process.execPath,
      ['-e', "console.log(require('./node_modules/plainscript-lang/compiler/version').VERSION)"],
      { cwd: tmp, encoding: 'utf8' });
    assert(versionOut.trim() === '1.0.362', `compiler version from packed artifact: ${versionOut.trim()}`);

    const cliOut = execFileSync(process.execPath,
      [path.join(installed, 'compiler', 'cli.js'), 'version'],
      { cwd: tmp, encoding: 'utf8' });
    assertIncludes(cliOut, '1.0.362', 'packed CLI version output');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Summary ──────────────────────────────────────────────────────────────────

Promise.all(pendingTests).then(() => {
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
});