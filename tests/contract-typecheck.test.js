'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runSource } = require('./helpers');

test('operation implementation rejects an incompatible output model', () => {
  const result = runSource(`import { object, text, number, operation, implement, Schema } from "std/contract"
type Input
    id: number
end
type Output
    title: text
end
let inputSchema: Schema<Input> = object({ id: number() })
let outputSchema: Schema<Output> = object({ title: text() })
let spec = operation("tasks.get", inputSchema, outputSchema)
async function lookup(input: Input) -> Output
    return { title: 42 }
end
let endpoint = implement(spec, lookup)
`);
  assert.ok(result.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3404'),
    `expected output mismatch diagnostic; got ${result.compiler.diagnostics.map((item) => item.code).join(', ')}`);
});
