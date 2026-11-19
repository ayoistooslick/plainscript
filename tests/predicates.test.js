'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runSource, runProject } = require('./helpers');

test('user-defined type predicates narrow positive and negative branches', () => {
  const result = runProject({
    'main.pln': `import { print } from "std/io"

function isText(value: any) -> value is text
    return value is text
end

function takesNumber(value: number) -> text
    return "number:{value}"
end

function describe(value: text or number) -> text
    if isText(value)
        return "text:{value}"
    else
        return takesNumber(value)
    end
end

function describeNegative(value: text or number) -> text
    if not isText(value)
        return takesNumber(value)
    end
    return "text:{value}"
end

print(describe("Ada"))
print(describe(7))
print(describeNegative(8))
print(describeNegative("Grace"))
`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'text:Ada\nnumber:7\nnumber:8\ntext:Grace\n');
});

test('a predicate must name a real parameter and cannot be async', () => {
  const missing = runSource(`function isText(value: any) -> other is text
    return value is text
end
`);
  assert.equal(missing.status, 1);
  assert.ok(missing.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3353'));

  const asyncPredicate = runSource(`async function isText(value: any) -> value is text
    return value is text
end
`);
  assert.equal(asyncPredicate.status, 1);
  assert.ok(asyncPredicate.compiler.diagnostics.some((diagnostic) =>
    diagnostic.code === 'PS3353' && /cannot be async/.test(diagnostic.message)));
});
