'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runSource, runProject, sandbox, writeFiles, ROOT } = require('./helpers');

const CLI = path.join(ROOT, 'src', 'cli.js');
function cli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

test('function overloads select by argument type and keep one implementation', () => {
  const result = runProject({
    'main.pln': `import { print } from "std/io"

overload function format(value: text) -> text
overload function format(value: number) -> text
function format(value: any) -> text
    return "value:{value}"
end

print(format("Ada"))
print(format(7))
`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'value:Ada\nvalue:7\n');
});

test('an overloaded call with no matching signature is rejected', () => {
  const result = runSource(`overload function format(value: text) -> text
overload function format(value: number) -> text
function format(value: any) -> text
    return "value"
end
format(true)
`);
  assert.equal(result.status, 1);
  assert.ok(result.compiler.diagnostics.some((diagnostic) =>
    diagnostic.code === 'PS3354' && /No overload matches/.test(diagnostic.message)));
});

test('overload implementations must accept every signature and return type', () => {
  const result = runSource(`overload function f(value: text) -> text
overload function f(value: number) -> number
function f(value: text) -> text
    return value
end
`);
  assert.equal(result.status, 1);
  const messages = result.compiler.diagnostics.filter((diagnostic) => diagnostic.code === 'PS3355');
  assert.equal(messages.length >= 2, true);
});

test('an overload without an implementation is rejected', () => {
  const result = runSource('overload function missing(value: text) -> text\n');
  assert.equal(result.status, 1);
  assert.ok(result.compiler.diagnostics.some((diagnostic) =>
    diagnostic.code === 'PS3355' && /no function implementation/.test(diagnostic.message)));
});

test('declaration files preserve overload signatures for consumers', () => {
  const directory = sandbox();
  writeFiles(directory, {
    'lib.pln': `export overload function label(value: text) -> text
export overload function label(value: number) -> text
export function label(value: any) -> text
    return "label"
end
`,
  });
  const build = cli(['build', '--declarations'], directory);
  assert.equal(build.status, 0, build.stderr);
  const declaration = fs.readFileSync(path.join(directory, 'dist', 'lib.d.pln'), 'utf8');
  assert.match(declaration, /export overload function label\(value: text\)/);
  writeFiles(directory, {
    'ok.pln': `import { label } from "./dist/lib.js"\nlet value = label(4)\n`,
    'bad.pln': `import { label } from "./dist/lib.js"\nlabel(true)\n`,
  });
  const ok = cli(['check', 'ok.pln'], directory);
  assert.equal(ok.status, 0, ok.stderr);
  const bad = cli(['check', 'bad.pln'], directory);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /PS3354/);
});

test('overloads cross an imported module boundary', () => {
  const result = runProject({
    'lib.pln': `export overload function label(value: text) -> text
export overload function label(value: number) -> text
export function label(value: any) -> text
    return "label"
end
`,
    'main.pln': `import { label } from "./lib"
label(true)
`,
  });
  assert.equal(result.status, 1);
  assert.ok(result.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3354'));
});
