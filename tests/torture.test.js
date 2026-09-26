// Torture suite: runs real-world-ish PlainScript programs from
// tests/fixtures/torture/ through the actual CLI and asserts clean exits.
//
// Each fixture is self-asserting: it prints an "ok" marker at the end and
// calls `exit 1` the moment any expectation fails, so a zero exit code means
// every scenario behaved exactly as intended. New fixtures only need to be
// dropped into a subdirectory of tests/fixtures/torture/ to be picked up.
//
// The suite also covers failure quality: deliberately invalid programs must
// fail with a clean PlainScript error (no raw Node stack traces) and never
// hang the compiler.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'compiler', 'cli.js');
const TORTURE_DIR = path.join(__dirname, 'fixtures', 'torture');

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

// Copy the scenario into a fresh temp dir so fixtures can write files freely
// without polluting the repository, and multi-file scenarios keep working.
function stageScenario(scenario) {
  const src = path.join(TORTURE_DIR, scenario);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-torture-'));
  for (const f of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, f), path.join(dir, f));
  }
  return dir;
}

function runPln(file, args = [], options = {}) {
  let thrown = null;
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'run', file, ...args], {
      encoding: 'utf8',
      timeout: options.timeout || 30000,
      env: { ...process.env, TORTURE_MODE: 'permanent' },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    thrown = e;
  }
  return { code: thrown.status || 1, stdout: thrown.stdout || '', stderr: thrown.stderr || '' };
}

function failWithRawStack(label, output) {
  // A clean failure prints a PlainScript error; a compiler bug leaks Node
  // internals like "at tokenize (...:123:45)" or "node:internal".
  if (/at\s+\S+\s+\(.*:\d+:\d+\)/.test(output) || output.includes('node:internal')) {
    throw new Error(`${label}: raw stack trace leaked:\n${output.slice(0, 400)}`);
  }
}

// Discover every scenario directory with a <name>.pln entry file.
const scenarios = fs.readdirSync(TORTURE_DIR)
  .filter((name) => fs.statSync(path.join(TORTURE_DIR, name)).isDirectory())
  .sort();

console.log('\nTorture suite (real-world scenario programs)');

for (const scenario of scenarios) {
  const sourceEntry = path.join(TORTURE_DIR, scenario, `${scenario}.pln`);
  if (!fs.existsSync(sourceEntry)) {
    test(`torture/${scenario}`, () => {
      throw new Error(`missing entry file ${scenario}/${scenario}.pln`);
    });
    continue;
  }
  test(`torture/${scenario} runs cleanly end-to-end`, () => {
    const dir = stageScenario(scenario);
    const result = runPln(path.join(dir, `${scenario}.pln`));
    if (result.code !== 0) {
      throw new Error(`exit ${result.code}. Output:\n${(result.stdout + result.stderr).slice(0, 400)}`);
    }
    if (!result.stdout.includes('ok')) {
      throw new Error(`fixture did not print its ok marker. Output:\n${result.stdout.slice(0, 400)}`);
    }
  });
}

// CLI surface smoke: flags must not be swallowed or misrouted.
test('torture CLI: version flags', () => {
  for (const flag of ['version', '--version', '-v']) {
    let result = null;
    try {
      const stdout = execFileSync(process.execPath, [CLI, flag], { encoding: 'utf8', timeout: 15000 });
      result = { stdout };
    } catch (e) {
      result = { stdout: (e.stdout || '') + (e.stderr || '') };
    }
    if (!/\d+\.\d+/.test(result.stdout)) {
      throw new Error(`expected a version from "${flag}", got: ${result.stdout.slice(0, 120)}`);
    }
  }
});

test('torture CLI: arguments pass through to the program', () => {
  const dir = stageScenario('cliargs');
  const result = runPln(path.join(dir, 'cliargs.pln'), ['alpha', 'beta']);
  if (result.code !== 0) {
    throw new Error(`exit ${result.code}. Output:\n${(result.stdout + result.stderr).slice(0, 300)}`);
  }
  if (!result.stdout.includes('alpha|beta')) {
    throw new Error(`args did not reach the program. Output:\n${result.stdout.slice(0, 300)}`);
  }
  if (!result.stdout.includes('permanent')) {
    throw new Error(`env did not reach the program. Output:\n${result.stdout.slice(0, 300)}`);
  }
});

test('torture CLI: dash-flags after -- reach the program', () => {
  const dir = stageScenario('cliargs');
  const result = runPln(path.join(dir, 'cliargs.pln'), ['--', '--port', '8080']);
  if (!result.stdout.includes('--port|8080')) {
    throw new Error(`program did not receive its dash-flags. Output:\n${result.stdout.slice(0, 300)}`);
  }
});

test('torture CLI: -v passes through to the program', () => {
  const dir = stageScenario('cliargs');
  const result = runPln(path.join(dir, 'cliargs.pln'), ['-v']);
  if (!result.stdout.includes('-v')) {
    throw new Error(`-v was swallowed by the CLI. Output:\n${result.stdout.slice(0, 300)}`);
  }
});

// Failure quality: invalid programs must fail cleanly, positionally, fast.
test('torture invalid: syntax error fails cleanly, no stack trace', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-torture-'));
  const bad = path.join(dir, 'bad.pln');
  fs.writeFileSync(bad, 'remember as\nshow x\n');
  const result = runPln(bad);
  if (result.code === 0) throw new Error('invalid program should exit non-zero');
  failWithRawStack('syntax error', result.stdout + result.stderr);
  if (!/Line \d+, Column \d+/.test(result.stdout + result.stderr)) {
    throw new Error(`expected a positional PlainScript error, got:\n${(result.stdout + result.stderr).slice(0, 300)}`);
  }
});

test('torture invalid: unknown keyword suggests the real one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-torture-'));
  const bad = path.join(dir, 'bad2.pln');
  fs.writeFileSync(bad, 'remembr x as 1\n');
  const result = runPln(bad);
  if (result.code === 0) throw new Error('typo program should exit non-zero');
  failWithRawStack('unknown keyword', result.stdout + result.stderr);
  if (!(result.stdout + result.stderr).includes('remember')) {
    throw new Error(`expected a "did you mean" hint, got:\n${(result.stdout + result.stderr).slice(0, 300)}`);
  }
});

test('torture invalid: reserved word as a name names the word', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-torture-'));
  const bad = path.join(dir, 'bad3.pln');
  fs.writeFileSync(bad, 'remember log as 1\n');
  const result = runPln(bad);
  if (result.code === 0) throw new Error('reserved-word program should exit non-zero');
  failWithRawStack('reserved word', result.stdout + result.stderr);
  if (!(result.stdout + result.stderr).includes('"log" is a reserved PlainScript word')) {
    throw new Error(`expected a reserved-word hint, got:\n${(result.stdout + result.stderr).slice(0, 300)}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
