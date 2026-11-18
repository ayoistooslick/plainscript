'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compileProject } = require('./helpers');

const shared = `import { object, text, number, operation } from "std/contract"
export const taskInput = object({ id: number() })
export const taskOutput = object({ title: text() })
export const getTask = operation("tasks.get", taskInput, taskOutput)
`;
const server = `import { getTask } from "./shared.pln"
import { implement } from "std/contract"
export const endpoint = implement(getTask, async (request) => ({ title: "task-{request.id}" }))
`;

test('shared schema-derived operation types flow across separate backend and frontend modules', () => {
  const valid = compileProject({
    'shared.pln': shared,
    'server.pln': server,
    'client.pln': `import { getTask } from "./shared.pln"
import { createClient } from "std/contract"
declare function transport(name: text, input: any) -> Promise of any
let client = createClient(getTask, transport)
let result = await client({ id: 12 })
let title: text = result.title
`,
  }, 'client.pln');
  assert.deepEqual(valid.compiler.diagnostics, []);

  const invalid = compileProject({
    'shared.pln': shared,
    'server.pln': server,
    'client.pln': `import { getTask } from "./shared.pln"
import { createClient } from "std/contract"
declare function transport(name: text, input: any) -> Promise of any
let client = createClient(getTask, transport)
let result = await client({ id: "wrong" })
`,
  }, 'client.pln');
  assert.ok(invalid.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3343'),
    `expected client mismatch diagnostic; got ${invalid.compiler.diagnostics.map((item) => item.code).join(', ')}`);
});
