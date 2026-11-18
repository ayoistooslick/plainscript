# Unified full-stack contracts — design and status

**Status: partial foundation implemented.** PlainScript 2.0 now derives a record model from `std/contract.object` schema fields and threads it through generic operation/client signatures. Compiler regressions verify that an incompatible client input and an incompatible declared handler output are rejected. Runtime operation wrappers provide validation, an authorization callback and a supplied-transport client. There is still no compiler-owned operation syntax, generated network transport, typed error union, or database mapping/migration system.

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

For `std/contract.object`, the checker derives the model type directly from the schema shape, so a separate `type User` declaration or `Schema<User>` annotation is not required. Nested object schemas, arrays and optional schema values are supported. Runtime parsing validates untrusted values. See `docs/SPEC.md` §5.5 for the supported inference boundary.

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

- **Implemented and tested:** schema constructors and recursive validation; strict/passthrough object handling; structured paths/errors; inferred nested record/array/optional output shapes for object schemas; operation descriptor; server input/output validation; authorization callback; client-side input/output validation around a supplied transport; imported generic alias substitution; contextual typing for callbacks after generic substitutions; compile-time rejection of incompatible inferred client inputs and backend handler outputs; shared operation types flowing across separate compiled server/client modules.
- **Partially implemented:** enum schema values widen to their primitive type; compiler inference is attached to the `std/contract.object` import and only supports known schema constructs. Auth and transport are callbacks only. Operation descriptors do not yet carry a typed error union.
- **Not implemented:** compiler-owned operation declarations; generated HTTP/router transport; typed error unions; database mapping, migrations or transactions; enum literal-union inference; detection of affected frontend consumers on backend contract changes across a complete application build.

## Validation and extension plan

The next increment should type errors in operation contracts and make schema inference robust through aliases/re-exports and enum literal values. Then build a database-backed React application using the inferred operation/client types and demonstrate a contract change breaking both server and frontend compilation. The compiler currently proves cross-module type compatibility but does not itself run a separate “change model” mutation test; the negative client and handler fixtures are the regression proof. No flagship app, React integration, migration workflow, transaction API, or typed error union is claimed.

Run `node --test tests/contract.test.js` for focused regression coverage and `npm test` for the full suite.
