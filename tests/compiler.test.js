'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { compileProject, ROOT } = require('./helpers');
const { Compiler } = require('../src/modules');

test('compilation is deterministic', () => {
  const files = {
    'math.pln': `export function double(value: number) -> number
    return value * 2
end
export const LABEL = "double"
`,
    'main.pln': `import { double, LABEL } from "./math"
import { print } from "std/io"
print("{LABEL}: {double(2)}")
`,
  };
  const first = compileProject(files);
  const second = compileProject(files);
  const read = (project) => fs.readFileSync(project.entryOut, 'utf8');
  assert.strictEqual(read(first), read(second));
  assert.strictEqual(first.compiler.diagnostics.length, 0);
});

test('relative imports are rewritten to compiled JavaScript', () => {
  const project = compileProject({
    'util.pln': 'export function id(value: number) -> number\n    return value\nend\n',
    'main.pln': 'import { id } from "./util"\nimport { print } from "std/io"\nprint(id(1))\n',
  });
  const code = fs.readFileSync(project.entryOut, 'utf8');
  assert.match(code, /from "\.\/util\.js"/);
  // v2 emits one module per source file instead of inlining imports.
  const util = fs.readFileSync(path.join(project.outRoot, 'util.js'), 'utf8');
  assert.match(util, /export function id\(value\)/);
});

test('standard library imports resolve to the bundled runtime', () => {
  const project = compileProject({
    'main.pln': 'import { print } from "std/io"\nprint("hello")\n',
  });
  const code = fs.readFileSync(project.entryOut, 'utf8');
  assert.match(code, /from "\.\.\/\.\.\/\.\.\/..\/stdlib\/io\.js"|from ".*stdlib\/io\.js"/);
});

test('npm imports are preserved verbatim', () => {
  const project = compileProject({
    'main.pln': 'import path from "node:path"\nimport { print } from "std/io"\nprint(path.join("a", "b"))\n',
  });
  const code = fs.readFileSync(project.entryOut, 'utf8');
  assert.match(code, /import path from "node:path"/);
  assert.strictEqual(project.compiler.diagnostics.length, 0);
});

test('missing exports are reported', () => {
  const project = compileProject({
    'util.pln': 'export function present() -> nothing\n    return nothing\nend\n',
    'main.pln': 'import { absent } from "./util"\n',
  });
  assert.ok(project.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3205'));
});

test('circular imports are reported and do not hang', () => {
  const project = compileProject({
    'a.pln': 'import { b } from "./b"\nexport function a() -> nothing\n    return nothing\nend\n',
    'b.pln': 'import { a } from "./a"\nexport function b() -> nothing\n    return nothing\nend\n',
  }, 'a.pln');
  assert.ok(project.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS4001'));
});

test('unresolved imports are reported with a hint', () => {
  const project = compileProject({
    'main.pln': 'import "./nowhere"\n',
  });
  const diagnostic = project.compiler.diagnostics.find((entry) => entry.code === 'PS4002');
  assert.ok(diagnostic);
  assert.ok(diagnostic.hint);
});

test('variants compile to tagged records and units compile to names', () => {
  const project = compileProject({
    'main.pln': `import { print } from "std/io"
type Shape = Circle(radius: number) or Empty
print("{Circle(2).radius}")
print("{Empty}")
`,
  });
  const code = fs.readFileSync(project.entryOut, 'utf8');
  assert.match(code, /\(\{ \$kind: "Circle", radius: 2 \}\)\.radius/);
  assert.match(code, /\$\{"Empty"\}/);
});

test('render blocks compile to createElement calls', () => {
  const project = compileProject({
    'main.pln': `import { print } from "std/io"
function createElement(tag: any, props: any, ...children: list of any) -> any
    return tag
end
function view() -> any
    render
        element "div" with className: "card"
            "hello"
        end
    end
end
print(view())
`,
  });
  assert.deepStrictEqual(project.compiler.diagnostics, []);
  const code = fs.readFileSync(project.entryOut, 'utf8');
  assert.match(code, /createElement\("div", \{ className: "card" \}, "hello"\)/);
});

test('match compiles to guarded branches with bindings', () => {
  const project = compileProject({
    'main.pln': `import { print } from "std/io"
function label(value: boolean) -> text
    match value
        case true
            return "yes"
        case false
            return "no"
    end
end
print(label(true))
`,
  });
  const code = fs.readFileSync(project.entryOut, 'utf8');
  assert.match(code, /\$arm1: \{/);
  assert.match(code, /if \(\$match1 === true\)/);
});

test('Python and JavaScript reserved words are escaped in generated bindings', () => {
  const project = compileProject({
    'main.pln': 'import { print } from "std/io"\nlet class = 1\nprint(class)\n',
  });
  const code = fs.readFileSync(project.entryOut, 'utf8');
  assert.match(code, /let \$class = 1;/);
  assert.match(code, /print\(\$class\)/);
});

test('template text escapes backticks and keeps literal braces', () => {
  const project = compileProject({
    'main.pln': 'import { print } from "std/io"\nlet value = 1\nprint("a `b` \\{literal\\} {value}")\n',
  });
  assert.deepStrictEqual(project.compiler.diagnostics, []);
  const code = fs.readFileSync(project.entryOut, 'utf8');
  assert.match(code, /`a \\`b\\` \{literal\} \$\{value\}`/);
});

test('source maps describe generated lines and the original file', () => {
  const project = compileProject({
    'main.pln': 'import { print } from "std/io"\nprint("one")\nprint("two")\n',
  });
  const record = project.compiler.modules.get(path.join(project.directory, 'main.pln'));
  assert.ok(record.map.mappings.length > 0);
  assert.strictEqual(record.map.sources.length, 1);
  assert.match(record.map.sources[0], /main\.pln$/);
  assert.strictEqual(record.map.version, 3);
  const written = fs.readFileSync(`${project.entryOut}.map`, 'utf8');
  assert.doesNotThrow(() => JSON.parse(written));
});

test('the high-level IR is JSON serialisable and reflects lowering', () => {
  const project = compileProject({
    'main.pln': 'import { print } from "std/io"\ntype Color = Red or Blue\nprint(Red)\n',
  });
  const record = project.compiler.modules.get(path.join(project.directory, 'main.pln'));
  const serialised = JSON.stringify(record.hir);
  assert.match(serialised, /"kind":"Program"/);
  assert.match(serialised, /"value":"Red"/);
  assert.ok(!serialised.includes('Red('), 'unit variants have no call form in the IR');
});

test('every discovered source file is emitted by build', () => {
  const project = compileProject({
    'lib/a.pln': 'export function a() -> number\n    return 1\nend\n',
    'lib/b.pln': 'export function b() -> number\n    return 2\nend\n',
    'main.pln': 'import { a } from "./lib/a"\nimport { b } from "./lib/b"\nimport { print } from "std/io"\nprint(a() + b())\n',
  });
  assert.ok(fs.existsSync(path.join(project.outRoot, 'lib', 'a.js')));
  assert.ok(fs.existsSync(path.join(project.outRoot, 'lib', 'b.js')));
  assert.ok(fs.existsSync(path.join(project.outRoot, 'main.js')));
});

test('nothing is written when compilation fails', () => {
  const directory = path.join(ROOT, '.plainscript', 'tests', `fail-${Date.now()}`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'main.pln'), 'let x: number = "no"\n');
  const compiler = new Compiler({ root: ROOT });
  const outRoot = path.join(directory, 'out');
  compiler.compileGraph(path.join(directory, 'main.pln'), outRoot, directory);
  assert.ok(compiler.diagnostics.length > 0);
  assert.ok(!fs.existsSync(path.join(outRoot, 'main.js')));
});
