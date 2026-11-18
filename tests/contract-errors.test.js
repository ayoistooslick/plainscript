'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runSource, runProject } = require('./helpers');

test('enumeration schemas infer literal unions for model fields and match exhaustiveness', () => {
  const result = runProject({
    'main.pln': `import { object, enumeration, parse } from "std/contract"
import { print } from "std/io"

let task = object({ status: enumeration(["open", "done"]) })
let value = parse(task, { status: "open" })
match value.status
    case "open"
        print("open")
    case "done"
        print("done")
end
`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'open\n');

  const incomplete = runSource(`import { object, enumeration, parse } from "std/contract"
let task = object({ status: enumeration(["open", "done"]) })
let value = parse(task, { status: "open" })
match value.status
    case "open"
        return nothing
end
`);
  assert.ok(incomplete.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3321'));
});

test('enum model fields reject an unknown literal before runtime', () => {
  const result = runSource(`import { object, boolean, enumeration, operation, createClient } from "std/contract"
let input = object({ status: enumeration(["open", "done"]) })
let spec = operation("tasks.status", input, object({ ok: boolean() }))
let client = createClient(spec, async (name: text, value: any) => ({ ok: true }))
await client({ status: "maybe" })
`);
  assert.equal(result.status, 1);
  assert.ok(result.compiler.diagnostics.some((diagnostic) =>
    diagnostic.code === 'PS3343' && /"open" or "done"/.test(diagnostic.message)));
});

test('typed operation results construct, validate and dispatch through a router', () => {
  const result = runProject({
    'main.pln': `import { object, text, number, literal, oneOf, fallibleOperation, implementFallible, createFallibleClient, router, resultToWire, success, failure } from "std/contract"
import { print } from "std/io"

let input = object({ id: number() })
let output = object({ id: number(), title: text() })
let errors = oneOf([
    object({ code: literal("NOT_FOUND"), message: text() }),
    object({ code: literal("FORBIDDEN"), message: text() }),
])
let spec = fallibleOperation("tasks.get", input, output, errors)
let endpoint = implementFallible(spec, async (request) => do
    if request.id == 0
        return failure({ code: "NOT_FOUND", message: "missing" })
    end
    return success({ id: request.id, title: "task-{request.id}" })
end)
let routes = router({ "tasks.get": endpoint })
let wire = resultToWire(await routes.handle("tasks.get", { id: 2 }, {}))
print("{wire.ok}:{wire.value.title}")
let client = createFallibleClient(spec, async (name: text, value: any) => await routes.handle(name, value, {}))
let result = await client({ id: 0 })
match result
    case Success(value)
        print("success:{value.title}")
    case Failure(error)
        print("failure:{error.code}")
end
`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'true:task-2\nfailure:NOT_FOUND\n');
});

test('typed error union rejects a handler that constructs the wrong error code', () => {
  const result = runSource(`import { object, text, number, literal, oneOf, fallibleOperation, implementFallible, failure, success } from "std/contract"
let input = object({ id: number() })
let output = object({ id: number(), title: text() })
let errors = oneOf([object({ code: literal("NOT_FOUND"), message: text() })])
let spec = fallibleOperation("tasks.get", input, output, errors)
let endpoint = implementFallible(spec, async (request) => do
    return failure({ code: "INVALID", message: "wrong" })
end)
`);
  assert.equal(result.status, 1);
  assert.ok(result.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3404' || diagnostic.code === 'PS3343'));
});

test('authorization failures are validated against the declared error schema', () => {
  const result = runSource(`import { object, text, number, literal, oneOf, fallibleOperation, implementFallible, success } from "std/contract"
import { print } from "std/io"
let input = object({ id: number() })
let output = object({ id: number() })
let errors = oneOf([object({ code: literal("FORBIDDEN"), message: text() })])
let spec = fallibleOperation("tasks.secure", input, output, errors)
let endpoint = implementFallible(spec, async (request) => success(request), { authorize: async () => false })
let result = await endpoint({ id: 1 })
match result
    case Success(value)
        print("unexpected success")
    case Failure(error)
        print(error.code)
end
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'FORBIDDEN\n');
});
