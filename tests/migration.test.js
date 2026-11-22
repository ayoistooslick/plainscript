'use strict';

// Migration analysis, conservative conversion, generated boundaries and the
// CLI workflow. The converter is intentionally gated: unsupported syntax must
// leave a working boundary behind rather than a broken translation.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { ROOT, sandbox, writeFiles, compileProject, runProject } = require('./helpers');
const {
  analyseProject,
  convertJavaScript,
  boundaryPlan,
  writeBoundaries,
} = require('../src/migrate');

const CLI = path.join(ROOT, 'src', 'cli.js');

function project() {
  const directory = sandbox();
  writeFiles(directory, {
    'package.json': JSON.stringify({
      name: 'migration-fixture',
      dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
      devDependencies: { vite: '^6.0.0', typescript: '^5.6.0' },
    }, null, 2),
    'src/util.js': `export function add(a, b) {
  return a + b;
}

export const label = "migrated";

export function classify(n) {
  if (n > 0) {
    return "positive";
  }
  return "other";
}
`,
    'src/App.jsx': `import { useState } from "react";

export function App() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
`,
    'src/service.cjs': `function run(value) {
  return value * 2;
}
module.exports = { run };
`,
    'tools/report.py': `def summarise(rows):\n    return len(rows)\n`,
    'native/lib.rs': `pub fn double(value: i32) -> i32 { value * 2 }\n`,
  });
  return directory;
}

test('analysis discovers languages, frameworks, exports and migration phases', () => {
  const directory = project();
  const result = analyseProject(directory);
  const paths = result.files.map((file) => file.path);
  assert.ok(paths.includes('src/util.js'));
  assert.ok(paths.includes('src/App.jsx'));
  assert.ok(paths.includes('tools/report.py'));
  assert.ok(paths.includes('native/lib.rs'));

  assert.ok(result.stack.languages.javascript >= 1);
  assert.ok(result.stack.languages.python >= 1);
  assert.ok(result.stack.languages.rust >= 1);
  assert.ok(result.stack.frameworks.includes('React'));
  assert.ok(result.stack.frameworks.includes('Vite'));
  assert.ok(result.stack.frameworks.includes('TypeScript'));
  assert.strictEqual(result.summary.jsx, 1);
  assert.strictEqual(result.summary.convertible, 1);
  assert.strictEqual(result.summary.boundaries, 2);
  assert.strictEqual(result.summary.manual, 2);

  const util = result.files.find((file) => file.path === 'src/util.js');
  assert.strictEqual(util.strategy, 'auto-convert');
  assert.strictEqual(util.phase, 'modules-with-public-api');
  assert.deepStrictEqual(util.exports, ['add', 'classify', 'label']);

  const app = result.files.find((file) => file.path === 'src/App.jsx');
  assert.strictEqual(app.strategy, 'interop-boundary');
  assert.strictEqual(app.phase, 'ui-components');
  assert.strictEqual(app.jsx, true);

  const service = result.files.find((file) => file.path === 'src/service.cjs');
  assert.strictEqual(service.strategy, 'interop-boundary');
  assert.deepStrictEqual(service.exports, ['run']);

  const python = result.files.find((file) => file.path === 'tools/report.py');
  assert.strictEqual(python.strategy, 'manual');
  assert.deepStrictEqual(python.exports, ['summarise']);
  assert.ok(python.notes.some((note) => note.code === 'CROSS_LANGUAGE'));

  const rust = result.files.find((file) => file.path === 'native/lib.rs');
  assert.deepStrictEqual(rust.exports, ['double']);

  const order = result.phases.map((phase) => phase.phase);
  assert.ok(order.indexOf('modules-with-public-api') < order.indexOf('ui-components'));
  assert.ok(order.indexOf('ui-components') < order.indexOf('entrypoints') || !order.includes('entrypoints'));
});

test('safe conversion produces compiling PlainScript with preserved behaviour', () => {
  const source = fs.readFileSync(path.join(project(), 'src', 'util.js'), 'utf8');
  const converted = convertJavaScript(source, 'util.js');
  assert.strictEqual(converted.ok, true, JSON.stringify(converted.diagnostics));
  assert.match(converted.code, /^#syntax 2\.1/m);
  assert.match(converted.code, /export define add\(a: any, b: any\) returns any/);
  assert.match(converted.code, /when n > 0/);
  assert.doesNotMatch(converted.code, /\breturn .*;\s*$/m);

  const runnable = converted.code.replace('#syntax 2.1\n', '#syntax 2.1\nimport { print } from "std/io"\n');
  const run = runSource(`${runnable}\nprint(add(2, 3))\nprint(classify(1))\nprint(classify(-1))\nprint(label)\n`);
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(run.stdout, '5\npositive\nother\nmigrated\n');
});

function runSource(source) {
  return runProject({ 'main.pln': source });
}

test('the converter refuses syntax it cannot preserve', () => {
  for (const [source, reason] of [
    ['export class Thing {}\n', /classes are not converted/],
    ['export function App() { return <div />; }\n', /JSX is not converted/],
    ['module.exports = { run() {} };\n', /CommonJS/],
    ['export default function main() {}\n', /default exports are not converted/],
  ]) {
    const result = convertJavaScript(source, 'refused.js');
    assert.strictEqual(result.ok, false, source);
    assert.ok(result.diagnostics.some((diagnostic) => reason.test(diagnostic.message)), JSON.stringify(result.diagnostics));
  }
});

test('JSX and CommonJS files produce complete boundary triplets', () => {
  const directory = project();
  const analysis = analyseProject(directory);
  const app = analysis.files.find((file) => file.path === 'src/App.jsx');
  const appBoundary = boundaryPlan(analysis, app);
  assert.ok(appBoundary);
  assert.deepStrictEqual(appBoundary.names, ['App']);
  assert.match(appBoundary.declaration, /export declare function App\(\) -> any/);
  assert.match(appBoundary.runtime, /export \{ App \} from "\.\.\/src\/App\.jsx"/);
  assert.match(appBoundary.wrapper, /export \{ App \} from "\.\/App\.js"/);
  assert.match(appBoundary.wrapper, /#syntax 2\.1/);

  const service = analysis.files.find((file) => file.path === 'src/service.cjs');
  const serviceBoundary = boundaryPlan(analysis, service);
  assert.ok(serviceBoundary);
  assert.deepStrictEqual(serviceBoundary.names, ['run']);
  assert.match(serviceBoundary.runtime, /import namespace from "\.\.\/src\/service\.cjs"/);
  assert.match(serviceBoundary.runtime, /export const run = namespace\["run"\]/);

  const written = writeBoundaries(analysis, [appBoundary, serviceBoundary]);
  assert.strictEqual(written.length, 2);
  assert.ok(fs.existsSync(path.join(directory, 'bridges', 'App.pln')));
  assert.ok(fs.existsSync(path.join(directory, 'bridges', 'App.runtime.d.pln')));
  assert.ok(fs.existsSync(path.join(directory, 'bridges', 'App.runtime.js')));
  assert.ok(fs.existsSync(path.join(directory, 'bridges', 'service.pln')));
});

test('a generated-style boundary type-checks and runs against a JS runtime', () => {
  const run = runProject({
    'bridges/util.runtime.d.pln': `#syntax 2.1
export declare function greet(name: text) -> text
export declare function double(value: number) -> number
`,
    'bridges/util.runtime.js': `export function greet(name) { return \`Hello, \${name}!\`; }
export function double(value) { return value * 2; }
`,
    'bridges/util.pln': `#syntax 2.1
export { greet, double } from "./util.runtime.js"
`,
    'main.pln': `#syntax 2.1
import { greet, double } from "./bridges/util"
import { print } from "std/io"
print(greet("boundary"))
print(double(21))
`,
  });
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(run.stdout, 'Hello, boundary!\n42\n');
});

test('the CLI prints JSON, writes conversions and boundaries, and reports unresolved work', () => {
  const directory = project();

  const json = spawnSync(process.execPath, [CLI, 'migrate', directory, '--json'], { encoding: 'utf8' });
  assert.strictEqual(json.status, 0, json.stderr);
  const plan = JSON.parse(json.stdout);
  assert.strictEqual(plan.summary.files, 5);
  assert.strictEqual(plan.summary.convertible, 1);
  assert.strictEqual(plan.summary.boundaries, 2);
  assert.ok(plan.boundaries.some((boundary) => boundary.source === 'src/App.jsx'));
  assert.ok(plan.boundaries.some((boundary) => boundary.source === 'src/service.cjs'));

  const markdown = spawnSync(process.execPath, [CLI, 'migrate', directory], { encoding: 'utf8' });
  assert.strictEqual(markdown.status, 0, markdown.stderr);
  assert.match(markdown.stdout, /# PlainScript migration plan/);
  assert.match(markdown.stdout, /ui-components/);
  assert.match(markdown.stdout, /Re-run with --write/);

  const reportPath = path.join(directory, 'migration-report.json');
  const written = spawnSync(process.execPath, [CLI, 'migrate', directory, '--write', `--report=${reportPath}`], { encoding: 'utf8' });
  assert.strictEqual(written.status, 0, written.stderr);
  assert.match(written.stdout, /Wrote 1 converted module\(s\) and 2 boundary pair\(s\)/);
  assert.ok(fs.existsSync(path.join(directory, 'src', 'util.pln')));
  assert.ok(fs.existsSync(path.join(directory, 'bridges', 'App.pln')));
  assert.ok(fs.existsSync(reportPath));
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.deepStrictEqual(report.conversions, ['src/util.js']);
  assert.ok(report.failures.some((failure) => failure.path === 'native/lib.rs'));
  assert.ok(report.failures.some((failure) => failure.path === 'tools/report.py'));

  const converted = fs.readFileSync(path.join(directory, 'src', 'util.pln'), 'utf8');
  assert.match(converted, /export define add/);

  const checked = spawnSync(process.execPath, [CLI, 'check', path.join(directory, 'src', 'util.pln')], { encoding: 'utf8' });
  assert.strictEqual(checked.status, 0, checked.stderr);
  assert.match(checked.stderr, /ok/);

  const strict = spawnSync(process.execPath, [CLI, 'migrate', directory, '--check'], { encoding: 'utf8' });
  assert.strictEqual(strict.status, 1, 'unresolved native modules make --check fail');
});
