// CLI tests for PlainScript  -  global --quiet / --verbose flags and the
// version / check / build / run commands, driven as real child processes.
//
//   version:  prints a semver string (PlainScript vMAJOR.MINOR.PATCH)
//   check:    ✓ success line for valid files, ✗ + error + non-zero exit for bad ones
//   --quiet:  suppresses the ✓/✗ per-file chatter and stage lines, never errors
//   --quiet:  still surfaces validation errors and non-zero exits
//   --quiet build:  compiles to disk with a silent stdout
//   --quiet run:    program stdout survives, chatter is gone, works from any cwd
//   --verbose:      prints ✓ ... (Nms) timing lines
//
// Run with: node tests/cli.test.js

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

const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'compiler', 'cli.js');

function runCli(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return {
      status: e.status === null ? 1 : e.status || 1,
      stdout: e.stdout || '',
      stderr: e.stderr || '',
    };
  }
}

function outputOf(r) {
  return `${r.stdout}${r.stderr}`;
}

function tmpDir(prefix = 'plainscript-cli-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('version: prints a semver string', () => {
  const r = runCli(['version'], REPO_ROOT);
  assert(r.status === 0, `version exit code must be 0, got ${r.status}`);
  const out = outputOf(r).trim();
  assert(/^PlainScript v\d+\.\d+\.\d+$/.test(out), `expected a semver version, got:\n${out}`);
});

test('--version and -v: standard flags print the same version string', () => {
  const viaFlag = runCli(['--version'], REPO_ROOT);
  const viaShort = runCli(['-v'], REPO_ROOT);
  const viaWord = runCli(['version'], REPO_ROOT);
  assert(viaFlag.status === 0, `--version must exit 0, got ${viaFlag.status}`);
  assert(viaShort.status === 0, `-v must exit 0, got ${viaShort.status}`);
  const a = outputOf(viaFlag).trim();
  const b = outputOf(viaShort).trim();
  const c = outputOf(viaWord).trim();
  assert(a === c && b === c, `all version forms must agree, got: ${JSON.stringify([a, b, c])}`);
  assert(/^PlainScript v\d+\.\d+\.\d+$/.test(c), `expected a semver version, got: ${c}`);
});

test('-v as a program argument survives run (does not mean version)', () => {
  const tmp = tmpDir();
  const prog = path.join(tmp, 'echo-args.pln');
  fs.writeFileSync(prog, 'remember a as args()\nshow "count: " + count of a\nshow "first: " + a[0]\n');
  const r = runCli(['run', prog, '-v'], tmp);
  assert(r.status === 0, `run must exit 0, got ${r.status}`);
  const out = outputOf(r);
  assert(out.includes('first: -v'), `program must receive -v as an argument, got:\n${out}`);
});

test('check: valid file prints a ✓ success line and exits 0', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'ok.pln'), 'show "hello"\n', 'utf8');
  const r = runCli(['check', 'ok.pln'], dir);
  assert(r.status === 0, `check of a valid file must exit 0, got ${r.status}`);
  assert(outputOf(r).includes('✓'), `expected a ✓ success line, got:\n${outputOf(r)}`);
});

test('check: invalid file prints ✗ + error and exits non-zero', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'bad.pln'), 'this is not valid plainscript !!!\n', 'utf8');
  const r = runCli(['check', 'bad.pln'], dir);
  assert(r.status !== 0, `check of an invalid file must exit non-zero, got ${r.status}`);
  const out = outputOf(r);
  assert(out.includes('✗'), `expected a ✗ failure line, got:\n${out}`);
  assert(out.includes('bad.pln'), `failure line must name the file, got:\n${out}`);
});

test('test: runs an explicit PlainScript test file', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'math.test.pln');
  fs.writeFileSync(file, [
    'make add(a, b)',
    '  give a + b',
    'done',
    'test "addition"',
    '  check add(2, 3) equals 5',
    'done',
  ].join('\n'), 'utf8');
  const r = runCli(['test', file], dir);
  assert(r.status === 0, `test command must exit 0, got ${r.status}:\n${outputOf(r)}`);
  assert(outputOf(r).includes('addition'), `test output must name the test, got:\n${outputOf(r)}`);
  assert(outputOf(r).includes('1 PlainScript test file'), `test output must summarize files, got:\n${outputOf(r)}`);
});

test('--quiet check: valid file prints no ✓/✗ lines and exits 0', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'ok.pln'), 'show "hello"\n', 'utf8');
  const r = runCli(['--quiet', 'check', 'ok.pln'], dir);
  assert(r.status === 0, `quiet check of a valid file must exit 0, got ${r.status}`);
  const out = outputOf(r);
  assert(!out.includes('✓') && !out.includes('✗'),
    `quiet check must print no ✓/✗ per-file line, got:\n${out}`);
});

test('--quiet check: invalid file still prints the error and exits non-zero', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'bad.pln'), 'this is not valid plainscript !!!\n', 'utf8');
  const r = runCli(['--quiet', 'check', 'bad.pln'], dir);
  assert(r.status !== 0, `quiet check of an invalid file must exit non-zero, got ${r.status}`);
  const out = outputOf(r);
  assert(out.includes('✗'), `quiet mode must not hide the failure marker, got:\n${out}`);
  assert(out.length > 0 && out.trim().length > 0, 'quiet mode must not swallow the error output');
});

test('--quiet build: compiles a .pln to dist/ with no ✓ -> lines on stdout', () => {
  // Single-file build form: under --quiet the stage banner is silent and the
  // whole invocation prints no ✓/-> chatter (the batch form resets
  // QUIET_STAGES at the end of the compile pass).
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'messi.pln'), 'remember club as "inter miami"\nshow club\n', 'utf8');
  const r = runCli(['--quiet', 'build', 'messi.pln'], dir);
  assert(r.status === 0, `quiet build must exit 0, got ${r.status}`);
  assert(fs.existsSync(path.join(dir, 'dist', 'messi.js')),
    `expected dist/messi.js on disk, got:\n${outputOf(r)}`);
  const out = outputOf(r);
  assert(!out.includes('✓'), `quiet build must print no ✓ -> lines, got:\n${out}`);
  const js = fs.readFileSync(path.join(dir, 'dist', 'messi.js'), 'utf8');
  assert(js.includes('let club = "inter miami"'), 'dist/messi.js must match the source program');
});

test('--quiet build: batch project build is silent too and still writes dist/', () => {
  // The batch (no-file) form compiles every .pln under the source root; under
  // --quiet neither the stage banner nor the per-file "✓ -> dist/..." summary
  // lines may appear, but the compiled artifacts must still land on disk.
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.pln'), 'remember n as 1\nshow n\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'src', 'b.pln'), 'remember s as "ping"\nshow s\n', 'utf8');
  const r = runCli(['--quiet', 'build'], dir);
  assert(r.status === 0, `quiet batch build must exit 0, got ${r.status}`);
  assert(fs.existsSync(path.join(dir, 'dist', 'a.js')),
    `expected dist/a.js on disk, got:\n${outputOf(r)}`);
  assert(fs.existsSync(path.join(dir, 'dist', 'b.js')),
    `expected dist/b.js on disk, got:\n${outputOf(r)}`);
  const out = outputOf(r);
  assert(!out.includes('✓') && !out.includes('->') && !out.includes('compiled to'),
    `quiet batch build must be silent, got:\n${out}`);
});

test('--quiet run: prints program output with no chatter, from repo root and /tmp', () => {
  const hello = path.join('examples', 'hello.pln');

  const fromRoot = runCli(['--quiet', 'run', hello], REPO_ROOT);
  assert(fromRoot.status === 0, `quiet run from repo root must exit 0, got ${fromRoot.status}`);
  assert(fromRoot.stdout.includes('Hello, PlainScript!'),
    `program output must survive --quiet, got:\n${outputOf(fromRoot)}`);
  assert(!fromRoot.stdout.includes('✓'),
    `no stage chatter under --quiet, got:\n${fromRoot.stdout}`);

  const tmp = tmpDir();
  const absHello = path.join(REPO_ROOT, hello);
  const fromTmp = runCli(['--quiet', 'run', absHello], tmp);
  assert(fromTmp.status === 0, `quiet run from /tmp must exit 0, got ${fromTmp.status}`);
  assert(fromTmp.stdout.includes('Hello, PlainScript!'),
    `program output must survive from /tmp, got:\n${outputOf(fromTmp)}`);
  assert(!fromTmp.stdout.includes('✓'),
    `no stage chatter under --quiet from /tmp, got:\n${fromTmp.stdout}`);
});

test('--verbose run: prints a ✓ ... (Nms) timing line', () => {
  const hello = path.join('examples', 'hello.pln');
  const r = runCli(['--verbose', 'run', hello], REPO_ROOT);
  assert(r.status === 0, `verbose run must exit 0, got ${r.status}`);
  assert(/✓ .*\(\d+ms\)/.test(outputOf(r)),
    `expected a "✓ ... (Nms)" timing line, got:\n${outputOf(r)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
