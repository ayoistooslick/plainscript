'use strict';

// Bare package imports: an installed PlainScript library declares its types in
// a `.d.pln` file named by package.json (`exports` conditions or `types`), and
// a JavaScript package without declarations stays untyped instead of failing.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const { ROOT, sandbox, writeFiles } = require('./helpers');

const CLI = path.join(ROOT, 'src', 'cli.js');

function cli(args, cwd) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

function project(files) {
  const directory = sandbox();
  writeFiles(directory, {
    'package.json': `${JSON.stringify({ name: 'consumer', private: true, type: 'module' }, null, 2)}\n`,
    ...files,
  });
  return directory;
}

test('exports conditions supply the declaration for a bare import', () => {
  const directory = project({
    'node_modules/fake-lib/package.json': JSON.stringify({
      name: 'fake-lib',
      version: '1.2.3',
      type: 'module',
      exports: { '.': { types: './dist/index.d.pln', import: './dist/index.js' } },
    }),
    'node_modules/fake-lib/dist/index.js': `export const VERSION = "1.2.3";
export function makeTask(title) {
    return { id: 1, title, done: false };
}
`,
    'node_modules/fake-lib/dist/index.d.pln': `export type Task
    id: number
    title: text
    done: boolean
end

export declare function makeTask(title: text) -> Task
export declare const VERSION: text
`,
    'app.pln': `import { Task, makeTask, VERSION } from "fake-lib"
import { print } from "std/io"

let task: Task = makeTask("from a package")
print("{task.title} {VERSION} {task.done}")
`,
    'bad.pln': `import { makeTask } from "fake-lib"

let task = makeTask(42)
`,
  });

  const run = cli(['run', 'app.pln'], directory);
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(run.stdout, 'from a package 1.2.3 false\n');

  const bad = cli(['check', 'bad.pln'], directory);
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /PS3343/);
  assert.match(bad.stderr, /expected text/);
});

test('a package-level "types" entry is used when there is no exports map', () => {
  const directory = project({
    'node_modules/simple-lib/package.json': JSON.stringify({
      name: 'simple-lib', version: '1.0.0', type: 'module', main: 'index.js', types: 'index.d.pln',
    }),
    'node_modules/simple-lib/index.js': 'export function shout(text) { return text.toUpperCase(); }\n',
    'node_modules/simple-lib/index.d.pln': 'export declare function shout(text: text) -> text\n',
    'app.pln': `import { shout } from "simple-lib"
import { print } from "std/io"
print(shout("hello"))
`,
  });

  const run = cli(['run', 'app.pln'], directory);
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(run.stdout, 'HELLO\n');
});

test('a subpath export resolves its own declaration', () => {
  const directory = project({
    'node_modules/kit/package.json': JSON.stringify({
      name: 'kit',
      type: 'module',
      exports: {
        '.': { types: './dist/index.d.pln', import: './dist/index.js' },
        './extra': { types: './dist/extra.d.pln', import: './dist/extra.js' },
      },
    }),
    'node_modules/kit/dist/index.js': 'export const BASE = 1;\n',
    'node_modules/kit/dist/index.d.pln': 'export declare const BASE: number\n',
    'node_modules/kit/dist/extra.js': 'export function twice(value) { return value * 2; }\n',
    'node_modules/kit/dist/extra.d.pln': 'export declare function twice(value: number) -> number\n',
    'app.pln': `import { twice } from "kit/extra"
import { print } from "std/io"
print(twice(21))
`,
    'bad.pln': `import { twice } from "kit/extra"

let wrong = twice("nope")
`,
  });

  const run = cli(['run', 'app.pln'], directory);
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(run.stdout, '42\n');

  const bad = cli(['check', 'bad.pln'], directory);
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /PS3343/);
});

test('a scoped package is resolved the same way', () => {
  const directory = project({
    'node_modules/@acme/tools/package.json': JSON.stringify({
      name: '@acme/tools',
      type: 'module',
      exports: { '.': { types: './dist/index.d.pln', import: './dist/index.js' } },
    }),
    'node_modules/@acme/tools/dist/index.js': 'export const label = "acme";\n',
    'node_modules/@acme/tools/dist/index.d.pln': 'export declare const label: text\n',
    'app.pln': `import { label } from "@acme/tools"
import { print } from "std/io"
print(label)
`,
  });

  const run = cli(['run', 'app.pln'], directory);
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(run.stdout, 'acme\n');
});

test('an installed JavaScript package without declarations stays untyped', () => {
  const directory = project({
    'node_modules/plain-js/package.json': JSON.stringify({ name: 'plain-js', type: 'module', main: 'index.js' }),
    'node_modules/plain-js/index.js': 'export default function double(value) { return value * 2; }\n',
    'app.pln': `import double from "plain-js"
import { print } from "std/io"
print(double(21))
`,
  });

  const run = cli(['run', 'app.pln'], directory);
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(run.stdout, '42\n');
});
