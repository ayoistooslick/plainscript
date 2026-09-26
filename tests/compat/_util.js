// Shared harness for the tests/compat capability suites.
//
// These suites compile PlainScript snippets in scratch temp directories and run
// the generated JavaScript with `plainscript run`, comparing runtime behaviour
// (what the program outputs), not the generated source text.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(ROOT, 'compiler', 'cli.js');

function tmpDir(prefix = 'plainscript-compat-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

// Run a PlainScript source file through the CLI and capture the program's own
// printed output, stripping the compiler's status chatter (✓/✗ banners, blank
// lines and the trailing "Done." marker).
function runFile(file, opts = {}) {
  const cwd = opts.cwd || path.dirname(file);
  let raw;
  try {
    raw = execFileSync(process.execPath, [CLI, 'run', file], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env },
    });
  } catch (e) {
    raw = (e.stdout || '') + (e.stderr || '');
  }
  return raw.split('\n')
    .filter((line) => {
      const t = line.trim();
      if (t === '' || t === 'Done.') return false;
      if (/^[✓✗]/.test(t)) return false;
      if (/^Resolving imports|^Building dependency graph|^Checking runtime dependencies|^Generating JavaScript/.test(t)) return false;
      if (/expected .* to be installed|^Install missing/.test(t)) return false;
      return true;
    })
    .join('\n');
}

// Write one source file and run it; returns the program's printed output.
// Files written to cwd (default scratch) for any `use`/import resolution.
function run(src, opts = {}) {
  const dir = opts.cwd || tmpDir();
  const name = opts.name || 'main.pln';
  write(dir, name, src);
  return runFile(path.join(dir, name), { cwd: dir });
}

// Run every .pln file in a directory through `plainscript check` and report
// whether all passed.
function checkDir(dir) {
  try {
    const out = execFileSync(process.execPath, [CLI, 'check', dir, '--json'], {
      encoding: 'utf8',
      env: { ...process.env },
    });
    const data = JSON.parse(out);
    return { ok: data.ok, sources: data.sources, deps: data.dependencySummary };
  } catch (e) {
    return { ok: false, error: (e.stdout || '') + (e.stderr || '') };
  }
}

// Build one file into dist/ via the CLI (returns the CLI output).
function build(dir, file = 'src/app.pln') {
  return execFileSync(process.execPath, [CLI, 'build', file], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env },
  });
}

// Run a compiled .js file directly with Node.
function runNode(file, cwd) {
  return execFileSync(process.execPath, [file], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env },
  });
}

// ── Shared pass/fail harness ──────────────────────────────────────────────────
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function summary() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

module.exports = {
  ROOT,
  CLI,
  tmpDir,
  write,
  run,
  runFile,
  checkDir,
  build,
  runNode,
  test,
  assert,
  summary,
};
