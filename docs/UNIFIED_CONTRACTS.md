# Unified full-stack contracts — design and status

**Status: partial foundation implemented.** PlainScript 2.0 has structural types and module-level type checking, but it does not yet have compiler-owned contract declarations, a router, generated network client, authorization policy model, or database schema/migration system. The runtime does now provide operation descriptors, validated handlers, an authorization callback, and a transport-backed client factory. Its generic output inference is not yet reliable enough to claim end-to-end static guarantees.

## Design principle

A domain type in a shared `.pln` module remains the compile-time source of truth imported by both server and UI modules. Runtime validation is a separate, explicit requirement: compiler types are erased and must never be treated as validators for JSON, database rows, environment variables, or JavaScript packages. At each trust boundary, a runtime schema must validate data before application code uses it.

The first implementation is `std/contract` (`stdlib/contract.js` plus `stdlib/contract.d.pln`). It supplies schemas for text, finite numbers, booleans, literals, enumerations, optional values, arrays, and objects. Validators support text/number constraints, array minimum length, strict/passthrough object key policies, nested paths, `parse` (throws `ContractError`) and `safeParse` (returns a discriminated-by-boolean result). Object parsing constructs a fresh object from declared fields by default; unknown keys are stripped unless configured otherwise.

```plainscript
import { object, text, number, parse } from "std/contract"
export type User
    name: text
    age: number
end
let userSchema: Schema<User> = object({
    name: text({ minLength: 1 })
    age: number({ min: 0 })
})
let user: User = parse(userSchema, untrustedJson)
```

The annotation makes the intended domain type visible to the checker; runtime schema parsing does the actual validation. Schema/type equivalence is not mechanically proven in this release. Treat edits to a shared type and its runtime schema as a coupled change and test both.

An operation can be described and wrapped without new syntax:

```plainscript
let lookup = operation("tasks.get", requestSchema, responseSchema)
let endpoint = implement(lookup, loadTask, { authorize: canReadTask })
let clientCall = createClient(lookup, transport)
```

`implement` validates request data before the handler and validates the handler result. `createClient` validates its local input and remote result. The transport is an ordinary function and must be supplied by the application. Errors identify the operation and failed stage. This is a useful runtime composition API, not a generated HTTP/router stack or a typed error union.

## Compiler and module behavior

No grammar change was needed: schemas are normal values imported from a standard-library module, and model types use existing `type` declarations. Importers can share model definitions through ordinary `.pln` modules, so incompatible declared function inputs/outputs are checked across the compiled module graph. Runtime checks are only performed where application code calls `parse`/`safeParse`; they are not injected automatically by the compiler.

## Implemented versus not implemented

- **Implemented and tested:** schema constructors and recursive validation; strict/passthrough object handling; structured paths/errors; operation descriptor; server input/output validation; authorization callback; client-side input/output validation around a supplied transport; compiling/running a consumer.
- **Partially implemented:** shared model/schema annotations and generic operation/client signatures exist, but schemas do not derive their output type, and generic output inference can report the wrong record type in downstream code. Auth and transport are callbacks only. This does not yet meet the compile-time consistency requirement.
- **Not implemented:** compiler-owned contract declarations; generated HTTP/router transport; typed error unions; database mapping, migrations or transactions; automatic model/schema equivalence; reliable static inference through schema → operation → client; detection of affected frontend consumers on backend contract changes.

## Validation and extension plan

The next increment must fix checker-visible schema output types and generic inference through imported aliases, then add mismatch tests that prove an incompatible frontend caller fails compilation. Only after this is reliable should operation declarations enter the checked module graph with input/output/error types. A persistent database-backed React demo remains necessary evidence; the existing templates have not yet been adapted to this API. These are planned, not available features.

Run `node --test tests/contract.test.js` for focused regression coverage and `npm test` for the full suite.
