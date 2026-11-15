'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { ROOT, sandbox, writeFiles } = require('./helpers');

const CLI = path.join(ROOT, 'src', 'cli.js');

function cli(args, cwd = ROOT) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

test('version prints the package version', () => {
  const result = cli(['version']);
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout.trim(), packageJson.version);
});

test('help lists every command and the module system', () => {
  const result = cli(['help']);
  assert.strictEqual(result.status, 0);
  for (const command of ['run', 'build', 'check', 'fmt', 'test', 'new', 'ir']) {
    assert.match(result.stdout, new RegExp(`\\b${command}\\b`));
  }
});

test('unknown commands exit with a usage error', () => {
  const result = cli(['nonsense']);
  assert.strictEqual(result.status, 2);
  assert.match(result.stderr, /Unknown command/);
});

test('run compiles and executes a program', () => {
  const directory = sandbox();
  writeFiles(directory, {
    'main.pln': 'import { print } from "std/io"\nprint("from cli")\n',
  });
  const result = cli(['run', 'main.pln'], directory);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'from cli\n');
});

test('run passes arguments through', () => {
  const directory = sandbox();
  writeFiles(directory, {
    'main.pln': 'import { print, args } from "std/io"\nprint(args()[0])\n',
  });
  const result = cli(['run', 'main.pln', 'first'], directory);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'first\n');
});

test('check reports diagnostics with codes and source frames', () => {
  const directory = sandbox();
  writeFiles(directory, {
    'bad.pln': 'let value: number = "text"\n',
  });
  const result = cli(['check', 'bad.pln'], directory);
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /PS3311/);
  assert.match(result.stderr, /bad\.pln:1:1/);
  assert.match(result.stderr, /\^/);
});

test('check --quiet prints only diagnostics', () => {
  const directory = sandbox();
  writeFiles(directory, { 'good.pln': 'let value = 1\n' });
  const result = cli(['check', '--quiet', 'good.pln'], directory);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '');
  assert.strictEqual(result.stderr, '');
});

test('fmt normalises indentation and --check reports drift', () => {
  const directory = sandbox();
  const messy = 'function f() -> number\nreturn 1\n      end\n';
  writeFiles(directory, { 'main.pln': messy });

  const check = cli(['fmt', '--check', 'main.pln'], directory);
  assert.strictEqual(check.status, 1);
  assert.match(check.stderr, /not formatted/);

  const formatted = cli(['fmt', 'main.pln'], directory);
  assert.strictEqual(formatted.status, 0, formatted.stderr);
  const expected = 'function f() -> number\n    return 1\nend\n';
  assert.strictEqual(fs.readFileSync(path.join(directory, 'main.pln'), 'utf8'), expected);

  const again = cli(['fmt', '--check', 'main.pln'], directory);
  assert.strictEqual(again.status, 0, again.stderr);
});

test('build writes JavaScript, source maps and a module marker', () => {
  const directory = sandbox();
  writeFiles(directory, {
    'package.json': JSON.stringify({ name: 'built', version: '0.0.0' }),
    'src/app.pln': 'import { print } from "std/io"\nprint("built")\n',
  });
  const result = cli(['build'], directory);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(directory, 'dist', 'app.js')));
  assert.ok(fs.existsSync(path.join(directory, 'dist', 'app.js.map')));
  const marker = JSON.parse(fs.readFileSync(path.join(directory, 'dist', 'package.json'), 'utf8'));
  assert.strictEqual(marker.type, 'module');

  const run = spawnSync(process.execPath, [path.join(directory, 'dist', 'app.js')], { encoding: 'utf8' });
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(run.stdout, 'built\n');
});

test('build respects plainscript.config.json', () => {
  const directory = sandbox();
  writeFiles(directory, {
    'package.json': JSON.stringify({ name: 'configured', version: '0.0.0' }),
    'plainscript.config.json': JSON.stringify({ compilerOptions: { rootDir: 'lib', outDir: 'build' } }),
    'lib/app.pln': 'import { print } from "std/io"\nprint("ok")\n',
  });
  const result = cli(['build'], directory);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(directory, 'build', 'app.js')));
});

test('new scaffolds a runnable project', () => {
  const directory = sandbox();
  const result = cli(['new', 'demo'], directory);
  assert.strictEqual(result.status, 0, result.stderr);
  const project = path.join(directory, 'demo');
  assert.ok(fs.existsSync(path.join(project, 'src', 'app.pln')));
  const packageJson = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
  assert.strictEqual(packageJson.type, 'module');
  assert.ok(packageJson.devDependencies['plainscript-lang']);
  const run = cli(['run', 'src/app.pln'], project);
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(run.stdout, 'Hello, WORLD!\n');
});

test('new --template scaffolds the bundled fullstack-auth project', () => {
  const directory = sandbox();
  const result = cli(['new', 'auth-app', '--template', 'fullstack-auth'], directory);
  assert.strictEqual(result.status, 0, result.stderr);
  const project = path.join(directory, 'auth-app');
  for (const file of ['src/app.pln', 'src/client.pln', 'src/shared.pln']) {
    assert.ok(fs.existsSync(path.join(project, file)), `missing ${file}`);
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
  assert.strictEqual(packageJson.name, 'auth-app');
  assert.ok(packageJson.devDependencies['plainscript-lang']);
  const check = cli(['check'], project);
  assert.strictEqual(check.status, 0, check.stderr);
});

test('new rejects an unknown template', () => {
  const directory = sandbox();
  const result = cli(['new', 'nope', '--template', 'missing'], directory);
  assert.strictEqual(result.status, 2);
  assert.match(result.stderr, /Unknown template/);
});

test('ir prints the high-level program as JSON', () => {
  const directory = sandbox();
  writeFiles(directory, { 'main.pln': 'let value = 1\n' });
  const result = cli(['ir', 'main.pln'], directory);
  assert.strictEqual(result.status, 0, result.stderr);
  const ir = JSON.parse(result.stdout);
  assert.strictEqual(ir.kind, 'Program');
  assert.strictEqual(ir.body[0].kind, 'VarDecl');
});

test('run forwards termination to the program it started', async () => {
  const directory = sandbox();
  const pidFile = path.join(directory, 'program.pid');
  writeFiles(directory, {
    'main.pln': `import { writeFileSync } from "node:fs"
import { env } from "std/io"
import { setInterval } from "node:timers"

declare const process: any
writeFileSync(env("PID_FILE", "program.pid"), "{process.pid}")
setInterval(() => do
    let alive = 1
end, 1000)
`,
  });

  const child = spawn(process.execPath, [CLI, 'run', 'main.pln'], {
    cwd: directory,
    env: { ...process.env, PID_FILE: pidFile },
    stdio: 'ignore',
  });

  const deadline = Date.now() + 8000;
  while (!fs.existsSync(pidFile) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(fs.existsSync(pidFile), 'the program did not start');
  const programPid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(programPid > 0);

  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve) => child.once('close', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 4000)),
  ]);

  await new Promise((resolve) => setTimeout(resolve, 200));
  let programAlive = true;
  try {
    process.kill(programPid, 0);
  } catch (failure) {
    programAlive = false;
  }
  if (programAlive) {
    try { process.kill(programPid, 'SIGKILL'); } catch (failure) { /* already gone */ }
  }

  assert.ok(exited, 'the CLI did not exit after SIGTERM');
  assert.strictEqual(programAlive, false, 'the program outlived the CLI that started it');
});

test('test runs PlainScript test files', () => {
  const directory = sandbox();
  writeFiles(directory, {
    'tests/math.test.pln': `import { test, equals } from "std/test"
import { upper } from "std/text"

test("upper works", () => do
    equals(upper("abc"), "ABC")
end)

test("arithmetic works", () => do
    equals(1 + 2, 3)
end)
`,
  });
  const result = cli(['test'], directory);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok {2}upper works/);
  assert.match(result.stdout, /2 passed, 0 failed/);
});

test('a failing test file exits non-zero', () => {
  const directory = sandbox();
  writeFiles(directory, {
    'tests/fail.test.pln': `import { test, equals } from "std/test"
test("fails", () => do
    equals(1, 2)
end)
`,
  });
  const result = cli(['test'], directory);
  assert.strictEqual(result.status, 1);
  assert.match(result.stdout, /1 passed|0 passed, 1 failed/);
});
