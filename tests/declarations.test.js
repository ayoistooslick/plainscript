'use strict';

// Declaration files: `plainscript build --declarations` must describe a
// library's public surface well enough for another PlainScript project to
// compile and run against the built JavaScript alone.

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

function library() {
  return {
    'src/models.pln': `export type Task
    id: number
    title: text
end

export type Status = Draft or Published(views: number)

export function publish(views: number) -> Status
    return Published(views)
end

export function draft() -> Status
    return Draft
end
`,
    'src/store.pln': `import { Task, Status } from "./models"

export const MAX_TASKS: number = 100

type Entry = { task: Task }

export function addTask(title: text, done?: boolean) -> Task
    return { id: 1, title: title }
end

export function describe(status: Status) -> text
    match status
    case Draft
        return "draft"
    case Published(views)
        return "published {views}"
    end
end
`,
  };
}

test('build --declarations emits a .d.pln beside every compiled module', () => {
  const directory = sandbox();
  writeFiles(directory, library());

  const build = cli(['build', '--declarations'], directory);
  assert.strictEqual(build.status, 0, build.stderr);

  const models = fs.readFileSync(path.join(directory, 'dist/models.d.pln'), 'utf8');
  assert.match(models, /export type Task\n {4}id: number/);
  assert.match(models, /export type Status = Draft or Published\(views: number\)/);
  assert.match(models, /export declare function publish\(views: number\) -> Status/);
  assert.match(models, /export declare function draft\(\) -> Status/);

  const store = fs.readFileSync(path.join(directory, 'dist/store.d.pln'), 'utf8');
  // Types used by public signatures are imported, not duplicated.
  assert.match(store, /import \{ Task, Status \} from "\.\/models"/);
  // A private type still referenced by the module's own declarations is kept,
  // without being exported.
  assert.match(store, /^type Entry = \{ task: Task \}$/m);
  assert.ok(!/export type Entry/.test(store));
  assert.match(store, /export declare function addTask\(title: text, done\?: boolean\) -> Task/);
  assert.match(store, /export declare const MAX_TASKS: number/);
  // Bodies and inferred-only helpers never appear.
  assert.ok(!store.includes('$match'));
});

test('build without the flag writes no declarations', () => {
  const directory = sandbox();
  writeFiles(directory, library());
  const build = cli(['build'], directory);
  assert.strictEqual(build.status, 0, build.stderr);
  assert.strictEqual(fs.existsSync(path.join(directory, 'dist/models.d.pln')), false);
});

test('a consumer compiles and runs against built JavaScript and declarations only', () => {
  const directory = sandbox();
  writeFiles(directory, library());
  assert.strictEqual(cli(['build', '--declarations'], directory).status, 0);

  writeFiles(directory, {
    'consumer.pln': `import { addTask, describe, MAX_TASKS } from "./dist/store.js"
import { publish, draft, Task, Status } from "./dist/models.js"
import { print } from "std/io"

let task: Task = addTask("write declarations")
print("{task.title} {MAX_TASKS}")
print(describe(publish(3)))
print(describe(draft()))
print(describe(Published(7)))
let status: Status = Published(9)
print(describe(status))
`,
  });

  const run = cli(['run', 'consumer.pln'], directory);
  assert.strictEqual(run.status, 0, run.stderr);
  assert.deepStrictEqual(run.stdout.trim().split('\n'), [
    'write declarations 100',
    'published 3',
    'draft',
    'published 7',
    'published 9',
  ]);
});

test('declarations reject a wrong call and a wrong result type', () => {
  const directory = sandbox();
  writeFiles(directory, library());
  assert.strictEqual(cli(['build', '--declarations'], directory).status, 0);

  writeFiles(directory, {
    'bad.pln': `import { addTask } from "./dist/store.js"

let wrong: text = addTask(42)
`,
  });

  const check = cli(['check', 'bad.pln'], directory);
  assert.strictEqual(check.status, 1);
  assert.match(check.stderr, /PS3343/);
  assert.match(check.stderr, /expected text/);
});

test('type declarations may name types imported from another module', () => {
  const directory = sandbox();
  writeFiles(directory, {
    'src/models.pln': `export type Task
    id: number
    title: text
end
`,
    'src/store.pln': `import { Task } from "./models"

type Entry = { task: Task, at: text }

export function entryFor(task: Task) -> Entry
    return { task: task, at: "now" }
end
`,
  });

  const check = cli(['check'], directory);
  assert.strictEqual(check.status, 0, check.stderr);
});
