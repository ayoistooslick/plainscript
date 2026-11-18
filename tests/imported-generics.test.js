'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compileProject } = require('./helpers');

test('imported generic record aliases substitute nested and optional type arguments', () => {
  const valid = compileProject({
    'models.pln': `export type Box<T>
    value: T
    values: list of T
    maybe?: T
end
`,
    'main.pln': `import { Box } from "./models.pln"
let good: Box<number> = { value: 3, values: [1, 2], maybe: 4 }
`,
  });
  assert.deepEqual(valid.compiler.diagnostics, []);
});

test('imported generic record aliases reject an incompatible nested field', () => {
  const invalid = compileProject({
    'models.pln': `export type Box<T>
    value: T
    values: list of T
    maybe?: T
end
`,
    'main.pln': `import { Box } from "./models.pln"
let bad: Box<number> = { value: "wrong", values: [1, 2] }
`,
  });
  assert.ok(invalid.compiler.diagnostics.length > 0, 'incompatible generic field must fail compilation');
  assert.match(invalid.compiler.diagnostics.map((item) => item.message).join('\n'), /assign|expected|compatible|type/i);
});

test('imported generic standard-library Schema substitutes its model argument', () => {
  const project = compileProject({
    'main.pln': `import { object, number, Schema } from "std/contract"
type Input
    id: number
end
let input: Schema<Input> = object({ id: number() })
let parsed: Input = input.parse({ id: 4 })
`,
  });
  assert.deepEqual(project.compiler.diagnostics, []);
});
