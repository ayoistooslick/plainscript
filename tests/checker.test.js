'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { diagnosticsOf, codesOf } = require('./helpers');
const { parse } = require('../src/parser');
const { checkModule } = require('../src/checker');
const { showType } = require('../src/types');

function check(source) {
  const ast = parse(source, 'test.pln');
  const result = checkModule({ file: 'test.pln', source, program: ast });
  return result;
}

function firstDiagnostic(source) {
  const diagnostics = diagnosticsOf(source);
  return diagnostics[0];
}

test('let infers primitive types', () => {
  const result = check('let count = 1\nlet name = "Ada"\nlet on = true\nlet nothingHere = nothing');
  assert.deepStrictEqual(result.diagnostics, []);
  const types = ['count', 'name', 'on', 'nothingHere'].map((name) => showType(result.checker.global.lookup(name).type));
  assert.deepStrictEqual(types, ['number', 'text', 'boolean', 'nothing']);
});

test('lists infer a union of element types', () => {
  const result = check('let mixed = [1, 2, 3]');
  assert.strictEqual(showType(result.checker.global.lookup('mixed').type), 'list of number');
});

test('const cannot be reassigned', () => {
  const diagnostic = firstDiagnostic('const limit = 3\nlimit = 4');
  assert.strictEqual(diagnostic.code, 'PS3307');
});

test('unknown names get a suggestion', () => {
  const diagnostic = firstDiagnostic('let total = 1\nlet x = totl');
  assert.strictEqual(diagnostic.code, 'PS3301');
  assert.match(diagnostic.hint, /total/);
});

test('argument type mismatches are reported', () => {
  const codes = codesOf('function f(count: number) -> number\n    return count\nend\nf("no")');
  assert.ok(codes.includes('PS3343'));
});

test('too few arguments are reported', () => {
  assert.ok(codesOf('function f(a: number, b: number) -> number\n    return a + b\nend\nf(1)').includes('PS3341'));
});

test('return type mismatches are reported', () => {
  assert.ok(codesOf('function f() -> number\n    return "no"\nend').includes('PS3404'));
});

test('functions that can fall through are reported', () => {
  assert.ok(codesOf('function f(flag: boolean) -> number\n    when flag\n        return 1\n    end\nend').includes('PS3401'));
});

test('fully returning branches satisfy the checker', () => {
  assert.deepStrictEqual(codesOf(`function f(flag: boolean) -> number
    when flag
        return 1
    otherwise
        return 2
    end
end`), []);
});

test('generic functions infer their result type', () => {
  const result = check('function firstOf<T>(items: list of T) -> T?\n    when items is list of text\n        return items[0]\n    end\n    return nothing\nend\nlet value = firstOf(["a"])');
  assert.deepStrictEqual(result.diagnostics, []);
  assert.strictEqual(showType(result.checker.global.lookup('value').type), 'text or nothing');
});

test('structural records are assignable to declared types', () => {
  assert.deepStrictEqual(codesOf(`type User
    id: number
    name: text
    admin?: boolean
end
function describe(user: User) -> text
    return user.name
end
describe({ id: 1, name: "Ada" })`), []);
});

test('unknown fields are reported', () => {
  const diagnostic = firstDiagnostic('let user = { name: "Ada" }\nlet age = user.age');
  assert.strictEqual(diagnostic.code, 'PS3333');
});

test('optional fields read as maybe-values and must be handled', () => {
  const source = `type User
    name: text
    email?: text
end
function read(user: User) -> text
    return user.email
end`;
  assert.ok(codesOf(source).includes('PS3404'));
});

test('optional fields narrow after a guard', () => {
  assert.deepStrictEqual(codesOf(`type User
    name: text
    email?: text
end
function read(user: User) -> text
    when user.email is text
        return user.email
    end
    return ""
end`), []);
});

test('narrowing with is removes nothing', () => {
  const result = check(`function read(value: text?) -> text
    when value is text
        return value
    end
    return ""
end`);
  assert.deepStrictEqual(result.diagnostics, []);
});

test('non-exhaustive match on a union is reported', () => {
  const codes = codesOf(`type Shape = Circle(radius: number) or Empty
function area(shape: Shape) -> number
    match shape
        case Circle(r)
            return r
    end
end`);
  assert.ok(codes.includes('PS3321'));
});

test('exhaustive match passes, including unit variants', () => {
  assert.deepStrictEqual(codesOf(`type Shape = Circle(radius: number) or Empty
function area(shape: Shape) -> number
    match shape
        case Circle(r)
            return r
        case Empty
            return 0
    end
end`), []);
});

test('match can narrow a boolean without a catch-all', () => {
  assert.deepStrictEqual(codesOf(`function label(flag: boolean) -> text
    match flag
        case true
            return "yes"
        case false
            return "no"
    end
end`), []);
});

test('conditions must be boolean', () => {
  assert.ok(codesOf('when "yes"\n    let x = 1\nend').includes('PS3318'));
});

test('arithmetic rejects text operands and points at interpolation', () => {
  const diagnostic = firstDiagnostic('let x = "a" + 1');
  assert.strictEqual(diagnostic.code, 'PS3344');
  assert.match(diagnostic.message, /join text/);
});

test('await outside an async function is reported', () => {
  assert.ok(codesOf('function f() -> nothing\n    await something()\nend').includes('PS3406'));
});

test('await inside an async function is accepted', () => {
  assert.deepStrictEqual(codesOf(`declare function sleep(ms: number) -> Promise of nothing
async function f() -> nothing
    await sleep(1)
end`), []);
});

test('bare returns in non-nothing functions are reported', () => {
  assert.ok(codesOf('function f() -> number\n    return nothing\nend').includes('PS3402'));
});

test('impossible casts are reported', () => {
  assert.ok(codesOf('let value = 1 as text').includes('PS3331'));
});

test('type tests that can never be true are reported', () => {
  assert.ok(codesOf('let value = "text"\nlet check = value is number').includes('PS3330'));
});

test('unknown types are reported with a suggestion', () => {
  const diagnostic = firstDiagnostic('function f(x: numbr) -> nothing\n    return nothing\nend');
  assert.strictEqual(diagnostic.code, 'PS3201');
  assert.match(diagnostic.hint, /number/);
});

test('duplicate declarations in one module are reported', () => {
  assert.ok(codesOf('let a = 1\nlet a = 2').includes('PS3308'));
});

test('pipe results are typed through the call', () => {
  const result = check(`function double(n: number) -> number
    return n * 2
end
let four = 2 |> double`);
  assert.deepStrictEqual(result.diagnostics, []);
  assert.strictEqual(showType(result.checker.global.lookup('four').type), 'number');
});

test('indexing a list by text is reported', () => {
  assert.ok(codesOf('let items = [1, 2]\nlet x = items["a"]').includes('PS3337'));
});

test('breaking outside a loop is reported', () => {
  assert.ok(codesOf('break').includes('PS3309'));
});
