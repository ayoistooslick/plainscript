'use strict';

// `build --declarations` should leave a library consumable without manual
// package.json edits: `types` and `exports["."]` point at the emitted
// declaration and runtime, existing exports are preserved, and ambiguous builds
// are left alone.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { ROOT, sandbox, writeFiles } = require('./helpers');

const CLI = path.join(ROOT, 'src', 'cli.js');

function cli(args, cwd) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

function manifest(directory) {
  return JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
}

test('a library build points types and exports at the emitted files', () => {
  const directory = sandbox();
  writeFiles(directory, {
    'package.json': `${JSON.stringify({ name: 'wire-lib', version: '1.0.0', type: 'module' }, null, 2)}\n`,
    'src/models.pln': `export type Task
    id: number
    title: text
end
`,
    'src/index.pln': `import { Task } from "./models"

export function makeTask(title: text) -> Task
    return { id: 1, title: title }
end
`,
  });

  const build = cli(['build', '--declarations'], directory);
  assert.strictEqual(build.status, 0, build.stderr);

  const packageJson = manifest(directory);
  assert.strictEqual(packageJson.types, './dist/index.d.pln');
  assert.deepStrictEqual(packageJson.exports['.'], {
    types: './dist/index.d.pln',
    import: './dist/index.js',
  });
  assert.strictEqual(packageJson.name, 'wire-lib');
});

test('existing export subpaths and conditions are preserved', () => {
  const directory = sandbox();
  writeFiles(directory, {
    'package.json': `${JSON.stringify({
      name: 'kit',
      type: 'module',
      exports: { './extra': { types: './dist/extra.d.pln', import: './dist/extra.js' }, './package.json': './package.json' },
    }, null, 2)}\n`,
    'src/index.pln': 'export const BASE = 1\n',
    'src/extra.pln': 'export const EXTRA = 2\n',
  });

  const build = cli(['build', '--declarations'], directory);
  assert.strictEqual(build.status, 0, build.stderr);

  const packageJson = manifest(directory);
  assert.strictEqual(packageJson.exports['.'].types, './dist/index.d.pln');
  assert.strictEqual(packageJson.exports['.'].import, './dist/index.js');
  assert.deepStrictEqual(packageJson.exports['./extra'], {
    types: './dist/extra.d.pln',
    import: './dist/extra.js',
  });
  assert.strictEqual(packageJson.exports['./package.json'], './package.json');
});

test('an existing exports "." entry keeps its runtime path and gains types', () => {
  const directory = sandbox();
  writeFiles(directory, {
    'package.json': `${JSON.stringify({
      name: 'existing',
      type: 'module',
      exports: { '.': { import: './dist/index.js', default: './dist/index.js' } },
    }, null, 2)}\n`,
    'src/index.pln': 'export const VALUE = 1\n',
  });

  assert.strictEqual(cli(['build', '--declarations'], directory).status, 0);
  const packageJson = manifest(directory);
  assert.strictEqual(packageJson.exports['.'].types, './dist/index.d.pln');
  assert.strictEqual(packageJson.exports['.'].import, './dist/index.js');
  assert.strictEqual(packageJson.exports['.'].default, './dist/index.js');
});

test('an ambiguous build (several entry modules) leaves package.json untouched', () => {
  const directory = sandbox();
  const original = `${JSON.stringify({ name: 'multi', type: 'module' }, null, 2)}\n`;
  writeFiles(directory, {
    'package.json': original,
    'src/alpha.pln': 'export const ALPHA = 1\n',
    'src/beta.pln': 'export const BETA = 2\n',
  });

  const build = cli(['build', '--declarations'], directory);
  assert.strictEqual(build.status, 0, build.stderr);
  assert.strictEqual(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'), original);
  assert.strictEqual(fs.existsSync(path.join(directory, 'dist/alpha.d.pln')), true);
});

test('a project without package.json is not given one', () => {
  const directory = sandbox();
  writeFiles(directory, { 'src/main.pln': 'export const VALUE = 1\n' });

  const build = cli(['build', '--declarations'], directory);
  assert.strictEqual(build.status, 0, build.stderr);
  assert.strictEqual(fs.existsSync(path.join(directory, 'package.json')), false);
  assert.strictEqual(fs.existsSync(path.join(directory, 'dist/main.d.pln')), true);
});

test('a wired package is consumable from node_modules', () => {
  const directory = sandbox();
  const library = path.join(directory, 'lib');
  fs.mkdirSync(path.join(library, 'src'), { recursive: true });
  fs.writeFileSync(path.join(library, 'package.json'), `${JSON.stringify({
    name: 'wired-lib', version: '1.0.0', type: 'module',
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(library, 'src/models.pln'), `export type Task
    id: number
    title: text
end
`);
  fs.writeFileSync(path.join(library, 'src/index.pln'), `import { Task } from "./models"

export function makeTask(title: text) -> Task
    return { id: 1, title: title }
end
`);

  const build = cli(['build', '--declarations'], library);
  assert.strictEqual(build.status, 0, build.stderr);

  const consumer = path.join(directory, 'consumer');
  fs.mkdirSync(path.join(consumer, 'node_modules'), { recursive: true });
  fs.symlinkSync(path.relative(path.join(consumer, 'node_modules'), library), path.join(consumer, 'node_modules/wired-lib'));
  fs.writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify({ name: 'consumer', type: 'module' }, null, 2)}\n`);

  writeFiles(consumer, {
    'app.pln': `import { makeTask } from "wired-lib"
import { print } from "std/io"

let task = makeTask("wired")
print("{task.title} {task.id}")
`,
    'bad.pln': `import { makeTask } from "wired-lib"

let task = makeTask(1)
`,
  });

  const run = cli(['run', 'app.pln'], consumer);
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(run.stdout, 'wired 1\n');

  const bad = cli(['check', 'bad.pln'], consumer);
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /PS3343/);
});
