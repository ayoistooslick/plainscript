'use strict';

// The 2.1 dialect is a surface over the same typed AST. These tests are about
// the contract that makes it safe to ship: 2.1 opt-in is explicit, 2.0 files
// keep their meaning, both dialects interoperate through modules, and the
// English forms normalise to exactly the 2.0 operators and statements.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { runSource, runProject, diagnosticsOf, codesOf, compileProject } = require('./helpers');
const { tokenize } = require('../src/lexer');
const { parse } = require('../src/parser');
const { format } = require('../src/formatter');
const { CompileError } = require('../src/diagnostics');
const { detectDialect } = require('../src/dialect');

const BASIC = `#syntax 2.1
import { print } from "std/io"

value greeting is "Hello"
set count to 0

define label(done: boolean) returns text
    when done
        return "{greeting}: done"
    otherwise
        return "{greeting}: open"
    end
end

for each step in [1, 2, 3]
    change count to count + step
end

print(label(count is greater than 3))
print(count)
`;

test('a file without a pragma stays on the 2.0 dialect', () => {
  assert.strictEqual(detectDialect('let x = 1\n').version, '2.0');
  assert.strictEqual(detectDialect('# ordinary comment\nlet x = 1\n').version, '2.0');
  assert.strictEqual(detectDialect('#syntax 2.1\n').version, '2.1');
  assert.strictEqual(detectDialect('# syntax 2.1\n').version, '2.1');
  assert.strictEqual(detectDialect('\uFEFF#syntax 2.1\n').version, '2.1');
});

test('the pragma must be the first line', () => {
  // A pragma after blank lines or code is an ordinary comment, not an opt-in.
  assert.strictEqual(detectDialect('let x = 1\n#syntax 2.1\n').version, '2.0');
  assert.strictEqual(detectDialect('\n#syntax 2.1\n').version, '2.0');
});

test('an unsupported dialect is reported instead of silently ignored', () => {
  const result = tokenize('#syntax 3.0\nlet x = 1\n', 'future.pln');
  assert.strictEqual(result.dialect, '2.0');
  assert.strictEqual(result.errors.length, 1);
  assert.strictEqual(result.errors[0].code, 'PS1005');
  assert.match(result.errors[0].message, /Supported dialects are 2\.0 and 2\.1/);
});

test('#syntax 2.0 may be written explicitly and behaves like no pragma', () => {
  const result = runSource(`#syntax 2.0
import { print } from "std/io"
let value = 2
print(value)
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '2\n');
});

test('the 2.1 program compiles, type-checks and executes', () => {
  const result = runSource(BASIC);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'Hello: done\n6\n');
});

test('2.0 programs keep running unchanged when 2.1 exists', () => {
  const result = runSource(`import { print } from "std/io"

function classify(value: number) -> text
    if value > 0
        return "positive"
    else if value == 0
        return "zero"
    else
        return "negative"
    end
end

let values = [-1, 0, 1]
for value in values
    print(classify(value))
end
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'negative\nzero\npositive\n');
});

test('2.1 emits ordinary ES modules with the 2.0 vocabulary erased', () => {
  const project = compileProject({ 'main.pln': BASIC });
  assert.strictEqual(project.compiler.diagnostics.filter((d) => d.severity === 'error').length, 0);
  const emitted = fs.readFileSync(path.join(project.outRoot, 'main.js'), 'utf8');
  assert.match(emitted, /const greeting = "Hello";/);
  assert.match(emitted, /let count = 0;/);
  assert.match(emitted, /function label\(done\)/);
  assert.match(emitted, /if \(done\)/);
  assert.doesNotMatch(emitted, /\bvalue\b|\bset\b|\bchange\b|\bdefine\b|\bwhen\b|\botherwise\b|\breturns\b/);
});

test('the 2.1 spellings are rejected inside a 2.1 file', () => {
  const cases = [
    ['let x = 1', 'set'],
    ['const x = 1', 'value'],
    ['function f() -> number\n    return 1\nend', 'define'],
    ['if true\nend', 'when'],
    ['when true\n    print("x")\nelse\nend', 'otherwise'],
  ];
  for (const [source, word] of cases) {
    const codes = codesOf(`#syntax 2.1\nimport { print } from "std/io"\n${source}\n`);
    assert.ok(codes.includes('PS2030'), `expected PS2030 for ${source}, got ${codes.join(', ')}`);
    const diagnostics = diagnosticsOf(`#syntax 2.1\n${source}\n`);
    const diagnostic = diagnostics.find((entry) => entry.code === 'PS2030');
    assert.ok(diagnostic.message.includes(`"${word}"`), diagnostic.message);
  }
});

test('2.1 loops require each or from, so one loop shape has one spelling', () => {
  assert.ok(codesOf('#syntax 2.1\nfor x in [1, 2]\nend\n').includes('PS2014'));
  assert.deepStrictEqual(codesOf('#syntax 2.1\nfor each x in [1, 2]\nend\n'), []);
  assert.deepStrictEqual(codesOf('#syntax 2.1\nfor i from 0 to 2\nend\n'), []);
  assert.ok(codesOf('#syntax 2.1\nfor i from 0\nend\n').length > 0);
});

test('all six comparison phrases lower to the symbolic operators', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"
print(2 is equal to 2)
print(2 is not equal to 3)
print(3 is greater than 2)
print(1 is less than 2)
print(2 is at least 2)
print(2 is at most 2)
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'true\ntrue\ntrue\ntrue\ntrue\ntrue\n');
});

test('comparison phrases have ordinary operator precedence', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"
print(1 + 1 is equal to 2 and 2 + 2 is equal to 4)
print(not (1 is greater than 2))
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'true\ntrue\n');
});

test('phrases inside text interpolation use the file dialect', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"
value left is 4
value right is 5
print("{left} <= {right}: {left is at most right}")
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '4 <= 5: true\n');
});

test('value bindings are immutable and set bindings are mutable', () => {
  const immutable = diagnosticsOf(`#syntax 2.1
value total = 1
change total to 2
`);
  assert.ok(immutable.some((d) => d.severity === 'error'), 'assignment to value must fail');

  const mutable = runSource(`#syntax 2.1
set total to 1
change total to total + 1
import { print } from "std/io"
print(total)
`);
  assert.strictEqual(mutable.status, 0, mutable.stderr);
  assert.strictEqual(mutable.stdout, '2\n');
});

test('change assigns through members, indexes and destructured set bindings', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"

set user to { name: "Ada", tags: ["one"] }
change user.name to "Grace"
change user.tags[0] to "two"

set { name, tags } to user
print(name)
print(tags[0])
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'Grace\ntwo\n');
});

test('value supports destructuring with the is separator', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"
value { id, title } is { id: 7, title: "seven" }
print("{id}:{title}")
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '7:seven\n');
});

test('otherwise closes a match as the fallback arm', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"

define describe(value: number) returns text
    match value
    case 0
        return "zero"
    case 1
        return "one"
    otherwise
        return "many"
    end
end

print(describe(0))
print(describe(1))
print(describe(9))
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'zero\none\nmany\n');
});

test('when guards inside match arms are the 2.1 spelling', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"
set value to 12
match value
case number when value is greater than 10
    print("big")
otherwise
    print("small")
end
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'big\n');
});

test('async, await, try/catch/finally and generics work in 2.1', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"

async define double(value: number) returns number
    return value * 2
end

define first<T>(values: list of T) returns T or nothing
    for each value in values
        return value
    end
    return nothing
end

async define run() returns nothing
    try
        set doubled to await double(21)
        print("doubled {doubled}")
        print(first([doubled, 0]))
    catch failure
        print("failed: {failure}")
    finally
        print("cleanup")
    end
end

await run()
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'doubled 42\n42\ncleanup\n');
});

test('2.0 and 2.1 modules import one another in the same graph', () => {
  const project = runProject({
    'lib/legacy.pln': `export function shout(text: text) -> text
    return "{text}!"
end
`,
    'lib/modern.pln': `#syntax 2.1
export define whisper(text: text) returns text
    return "{text}..."
end
`,
    'main.pln': `#syntax 2.1
import { print } from "std/io"
import { shout } from "./lib/legacy"
import { whisper } from "./lib/modern"

print(shout(whisper("hello")))
`,
  }, 'main.pln');
  assert.strictEqual(project.status, 0, project.stderr);
  assert.strictEqual(project.stdout, 'hello...!\n');
});

test('a 2.0 entry module can import a 2.1 module', () => {
  const project = runProject({
    'lib/modern.pln': `#syntax 2.1
export define greet(name: text) returns text
    return "Hi {name}"
end
`,
    'main.pln': `import { print } from "std/io"
import { greet } from "./lib/modern"
print(greet("Ada"))
`,
  }, 'main.pln');
  assert.strictEqual(project.status, 0, project.stderr);
  assert.strictEqual(project.stdout, 'Hi Ada\n');
});

test('the formatter preserves 2.1 keywords and indents their blocks', () => {
  const source = `#syntax 2.1
define greet(name: text) returns text
when name is equal to ""
return "nobody"
otherwise
return name
end
end
`;
  const formatted = format(source, 'g.pln');
  assert.strictEqual(formatted, `#syntax 2.1
define greet(name: text) returns text
    when name is equal to ""
        return "nobody"
    otherwise
        return name
    end
end
`);
  assert.strictEqual(format(formatted, 'g.pln'), formatted);
  const tokens = tokenize(formatted, 'g.pln');
  assert.strictEqual(tokens.dialect, '2.1');
  assert.deepStrictEqual(tokens.errors, []);
  assert.doesNotThrow(() => parse(formatted, 'g.pln'));
});

test('contextual 2.1 words stay usable as identifiers', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"

define describe(value: text, each: number, define: boolean) returns text
    set change to "changed"
    change change to "{value}/{each}/{define}"
    return change
end

print(describe("value", 2, true))
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'value/2/true\n');
});

test('when and otherwise remain reserved words in 2.1', () => {
  assert.ok(codesOf('#syntax 2.1\nvalue when is 1\n').length > 0);
  assert.ok(codesOf('#syntax 2.1\nvalue otherwise is 1\n').length > 0);
});

test('declare functions accept returns in 2.1 and reject it in 2.0', () => {
  assert.deepStrictEqual(codesOf(`#syntax 2.1
declare function greet(name: text) returns text
value greeting is greet("Ada")
`), []);
  assert.ok(codesOf('declare function greet(name: text) returns text\n').length > 0);
});

test('parse and tokenize expose the dialect they used', () => {
  const result = tokenize('#syntax 2.1\nvalue x is 1\n', 'd.pln');
  assert.strictEqual(result.dialect, '2.1');
  const program = parse('#syntax 2.1\nvalue x is 1\n', 'd.pln');
  assert.strictEqual(program.body[0].kind, 'VarDecl');
  assert.strictEqual(program.body[0].declKind, 'const');
});

test('a 2.1 syntax error still points at the offending source line', () => {
  try {
    parse('#syntax 2.1\nvalue x is )\n', 'broken.pln');
    assert.fail('expected a CompileError');
  } catch (failure) {
    assert.ok(failure instanceof CompileError);
    assert.strictEqual(failure.diagnostics[0].span.file, 'broken.pln');
    assert.strictEqual(failure.diagnostics[0].span.line, 2);
  }
});

// ---------------------------------------------------------------- project config

const CLI = path.join(__dirname, '..', 'src', 'cli.js');

function projectDirectory(files) {
  const root = fs.mkdtempSync(path.join(__dirname, '..', '.plainscript', 'config-'));
  // A package.json marks the project root, exactly as it does for a real app.
  if (!Object.prototype.hasOwnProperty.call(files, 'package.json')) {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true, type: 'module' }));
  }
  for (const [name, source] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  }
  return root;
}

function runCli(root, args) {
  const child = require('child_process').spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

test('a project-level syntax default compiles files that carry no pragma', () => {
  const root = projectDirectory({
    'plainscript.config.json': JSON.stringify({ compilerOptions: { syntax: '2.1' } }),
    'src/main.pln': `import { print } from "std/io"
value greeting is "hello"
define shout(message: text) returns text
    return "{message}!"
end
print(shout(greeting))
`,
  });
  const result = runCli(root, ['run']);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout.trim(), 'hello!');
});

test('a top-level syntax key behaves like compilerOptions.syntax', () => {
  const root = projectDirectory({
    'plainscript.config.json': JSON.stringify({ syntax: '2.1' }),
    'src/main.pln': 'import { print } from "std/io"\nvalue answer is 42\nprint(answer)\n',
  });
  const result = runCli(root, ['run']);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout.trim(), '42');
});

test('a per-file pragma overrides the project default dialect', () => {
  const root = projectDirectory({
    'plainscript.config.json': JSON.stringify({ syntax: '2.1' }),
    'src/main.pln': `#syntax 2.0
import { print } from "std/io"
const greeting = "legacy"
print(greeting)
`,
  });
  const result = runCli(root, ['run']);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout.trim(), 'legacy');
});

test('the project default applies to every module in the graph', () => {
  const root = projectDirectory({
    'plainscript.config.json': JSON.stringify({ syntax: '2.1' }),
    'src/main.pln': `import { print } from "std/io"
import { label } from "./label.pln"
print(label(3))
`,
    'src/label.pln': `export define label(count: number) returns text
    when count is greater than 2
        return "many"
    otherwise
        return "few"
    end
end
`,
  });
  const result = runCli(root, ['run']);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout.trim(), 'many');
});

test('an unsupported project dialect is rejected with a usage error', () => {
  const root = projectDirectory({
    'plainscript.config.json': JSON.stringify({ syntax: '3.0' }),
    'src/main.pln': 'import { print } from "std/io"\nprint("x")\n',
  });
  const result = runCli(root, ['check']);
  assert.strictEqual(result.status, 2);
  assert.match(result.stderr, /unsupported syntax "3\.0"/);
});

test('--syntax overrides the project configuration for one command', () => {
  const root = projectDirectory({
    'src/main.pln': 'import { print } from "std/io"\nvalue answer is 7\nprint(answer)\n',
  });
  assert.strictEqual(runCli(root, ['check']).status, 1);
  const result = runCli(root, ['--syntax=2.1', 'run']);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout.trim(), '7');
});

test('the compiler accepts a dialect default and reports an invalid one', () => {
  const compiled = runSource('import { print } from "std/io"\nvalue x is 1\nprint(x)\n', [], { dialect: '2.1' });
  assert.strictEqual(compiled.status, 0, compiled.stderr);
  assert.strictEqual(compiled.stdout.trim(), '1');

  const result = tokenize('value x is 1\n', 'a.pln', { dialect: '9.9' });
  assert.strictEqual(result.errors[0].code, 'PS1005');
});

test('the formatter follows the project dialect', () => {
  assert.strictEqual(
    format('value x is 1\n', 'a.pln', { dialect: '2.1' }),
    'value x is 1\n',
  );
  // The pragma survives formatting, so a formatted file keeps its dialect.
  assert.strictEqual(
    format('#syntax 2.1\nvalue x is 1\n', 'a.pln'),
    '#syntax 2.1\nvalue x is 1\n',
  );
});

// ------------------------------------------------------------ contextual `each`

test('each remains usable as an identifier in a foreach loop', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"

set each to 0
for each in [1, 2, 3]
    print(each)
end

define double(each: number) returns number
    return each * 2
end

print(double(5))
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '1\n2\n3\n10\n');
});

test('each can still name a range-loop variable and a destructured element', () => {
  const result = runSource(`#syntax 2.1
import { print } from "std/io"

for each from 1 to 2
    print(each)
end

for each { name } in [{ name: "a" }, { name: "b" }]
    print(name)
end
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '1\n2\na\nb\n');
});

test('plainscript new writes a 2.1 project configuration', () => {
  const parent = fs.mkdtempSync(path.join(__dirname, '..', '.plainscript', 'new-'));
  const created = runCli(parent, ['new', 'demo-app']);
  assert.strictEqual(created.status, 0, created.stderr);

  const config = JSON.parse(fs.readFileSync(path.join(parent, 'demo-app', 'plainscript.config.json'), 'utf8'));
  assert.deepStrictEqual(config.compilerOptions, { rootDir: 'src', outDir: 'dist', syntax: '2.1' });

  // The scaffolded file carries no pragma; the configuration supplies 2.1.
  const source = fs.readFileSync(path.join(parent, 'demo-app', 'src', 'app.pln'), 'utf8');
  assert.ok(!source.startsWith('#syntax'));

  const ran = runCli(path.join(parent, 'demo-app'), ['run', 'src/app.pln']);
  assert.strictEqual(ran.status, 0, ran.stderr);
  assert.strictEqual(ran.stdout.trim(), 'Hello, WORLD!');
});
