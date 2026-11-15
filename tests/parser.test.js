'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { parse } = require('../src/parser');
const { CompileError } = require('../src/diagnostics');

function parseSource(source) {
  return parse(source, 'test.pln');
}

function codes(source) {
  try {
    parseSource(source);
    return [];
  } catch (failure) {
    if (failure instanceof CompileError) return failure.diagnostics.map((diagnostic) => diagnostic.code);
    throw failure;
  }
}

test('multiplication binds tighter than addition', () => {
  const program = parseSource('let x = 1 + 2 * 3');
  const init = program.body[0].init;
  assert.strictEqual(init.kind, 'Binary');
  assert.strictEqual(init.operator, '+');
  assert.strictEqual(init.right.operator, '*');
});

test('or is lower precedence than and', () => {
  const program = parseSource('let x = a or b and c');
  const init = program.body[0].init;
  assert.strictEqual(init.operator, 'or');
  assert.strictEqual(init.right.operator, 'and');
});

test('pipeline is the lowest-precedence operator', () => {
  const program = parseSource('let x = a + 1 |> f');
  const init = program.body[0].init;
  assert.strictEqual(init.kind, 'Pipe');
  assert.strictEqual(init.left.operator, '+');
});

test('function declarations carry parameters, defaults and generics', () => {
  const program = parseSource('function id<T>(value: T, fallback: text = "x") -> T\n    return value\nend');
  const declaration = program.body[0];
  assert.strictEqual(declaration.kind, 'FunctionDecl');
  assert.deepStrictEqual(declaration.typeParams, ['T']);
  assert.strictEqual(declaration.params.length, 2);
  assert.strictEqual(declaration.params[0].type.name, 'T');
  assert.strictEqual(declaration.params[1].defaultValue.value, 'x');
  assert.strictEqual(declaration.returnType.name, 'T');
});

test('record and variant types parse', () => {
  const program = parseSource(`type User
    id: number
    nickname?: text
end
type Shape = Circle(radius: number) or Empty`);
  assert.strictEqual(program.body[0].kind, 'TypeDecl');
  assert.strictEqual(program.body[0].recordFields.length, 2);
  assert.strictEqual(program.body[0].recordFields[1].optional, true);
  assert.strictEqual(program.body[1].value.kind, 'UnionType');
  assert.strictEqual(program.body[1].value.members[0].kind, 'VariantType');
  assert.strictEqual(program.body[1].value.members[1].kind, 'NamedType');
});

test('collection types parse with of/to', () => {
  const program = parseSource('function f(items: list of map of text to number) -> list of text\n    return []\nend');
  const type = program.body[0].params[0].type;
  assert.strictEqual(type.kind, 'ListType');
  assert.strictEqual(type.elem.kind, 'MapType');
  assert.strictEqual(type.elem.key.name, 'text');
});

test('match parses patterns, bindings, rest and guards', () => {
  const program = parseSource(`function f(value: any) -> number
    match value
        case [first, ...rest]
            return 1
        case { name, age: years }
            return 2
        case Circle(r) if r > 0
            return 3
        case _
            return 0
    end
end`);
  const match = program.body[0].body[0];
  assert.strictEqual(match.kind, 'Match');
  assert.strictEqual(match.cases.length, 4);
  assert.strictEqual(match.cases[0].pattern.kind, 'ListPattern');
  assert.strictEqual(match.cases[0].pattern.rest, 'rest');
  assert.strictEqual(match.cases[1].pattern.fields[1].key, 'age');
  assert.ok(match.cases[2].guard);
  assert.strictEqual(match.cases[3].pattern.kind, 'WildcardPattern');
});

test('conditional branches parse without eating the final end', () => {
  const program = parseSource(`if a
    let x = 1
else if b
    let y = 2
else
    let z = 3
end`);
  const conditional = program.body[0];
  assert.strictEqual(conditional.branches.length, 2);
  assert.strictEqual(conditional.otherwise.length, 1);
});

test('legacy conditional spellings are no longer statement syntax', () => {
  assert.ok(codes('when flag\n    return 1\nend').some((code) => code.startsWith('PS2')));
  assert.ok(codes('otherwise\n    return 1\nend').some((code) => code.startsWith('PS2')));
  assert.ok(codes('match value\n    case item when item.ok\n        return item\nend').some((code) => code.startsWith('PS2')));
});

test('try/catch/finally parse', () => {
  const program = parseSource('try\n    let x = 1\ncatch err\n    let y = 2\nfinally\n    let z = 3\nend');
  const statement = program.body[0];
  assert.strictEqual(statement.kind, 'Try');
  assert.strictEqual(statement.errorName, 'err');
  assert.strictEqual(statement.body.length, 1);
  assert.strictEqual(statement.handler.length, 1);
  assert.strictEqual(statement.finalizer.length, 1);
});

test('render blocks and elements parse into trees', () => {
  const program = parseSource(`function view(count: number) -> any
    render
        element "div" with className: "card"
            "{count}"
            element "br" end
        end
    end
end`);
  const render = program.body[0].body[0];
  assert.strictEqual(render.kind, 'Render');
  assert.strictEqual(render.children.length, 1);
  assert.strictEqual(render.children[0].kind, 'Element');
  assert.strictEqual(render.children[0].props[0].key, 'className');
  assert.strictEqual(render.children[0].children.length, 2);
});

test('destructuring bindings parse', () => {
  const program = parseSource('let (first, second) = pair\nlet { name, age: years } = user');
  assert.strictEqual(program.body[0].pattern.kind, 'TuplePattern');
  assert.strictEqual(program.body[1].pattern.fields[0].target.name, 'name');
  assert.strictEqual(program.body[1].pattern.fields[1].key, 'age');
});

test('lambdas parse in expression and block form', () => {
  const program = parseSource('let f = (x: number) => x * 2\nlet g = () => do\n    return 1\nend');
  assert.strictEqual(program.body[0].init.kind, 'FunctionExpression');
  assert.ok(program.body[0].init.expression);
  assert.strictEqual(program.body[1].init.body.length, 1);
});

test('imports parse every supported form', () => {
  const program = parseSource(`import "./side"
import { a, b as c } from "pkg"
import defaultThing from "pkg"
import * as ns from "pkg"`);
  assert.strictEqual(program.body[0].spec, './side');
  assert.deepStrictEqual(program.body[1].names, [{ imported: 'a', local: 'a' }, { imported: 'b', local: 'c' }]);
  assert.strictEqual(program.body[2].defaultName, 'defaultThing');
  assert.strictEqual(program.body[3].namespace, 'ns');
});

test('missing end reports PS2010', () => {
  assert.ok(codes('function f() -> nothing\n    return nothing\n').includes('PS2010'));
});

test('unexpected tokens report a syntax error', () => {
  assert.ok(codes('let = 5').some((code) => code.startsWith('PS2')));
});

test('reserved words cannot be used as parameters', () => {
  assert.ok(codes('function f(end: text) -> text\n    return end\nend').some((code) => code.startsWith('PS2')));
});

test('return requires a value', () => {
  assert.ok(codes('function f() -> nothing\n    return\nend').some((code) => code.startsWith('PS2')));
});
