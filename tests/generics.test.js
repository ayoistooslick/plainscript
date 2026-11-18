'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runProject, runSource } = require('./helpers');

test('generic constraints provide field access and accept matching records', () => {
  const result = runProject({
    'main.pln': `import { print } from "std/io"

type Named
    name: text
end

function label<T: Named>(value: T) -> text
    return value.name
end

print(label({ name: "Ada" }))
`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Ada\n');
});

test('a generic constraint rejects an argument that lacks the required field', () => {
  const result = runSource(`type Named
    name: text
end
function label<T: Named>(value: T) -> text
    return value.name
end
label({ age: 37 })
`);
  assert.equal(result.status, 1);
  assert.ok(result.compiler.diagnostics.some((diagnostic) =>
    diagnostic.code === 'PS3343' && /generic constraint/.test(diagnostic.message)));
});
