# Unified full-stack contracts — design and status

**Status: partial foundation implemented.** PlainScript 2.0 has structural types and module-level type checking, but it does not yet have a language-level RPC declaration, router, generated client, authorization model, or database schema/migration system. This document describes the working boundary-validation primitive without implying that those pieces exist.

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

## Compiler and module behavior

No grammar change was needed: schemas are normal values imported from a standard-library module, and model types use existing `type` declarations. Importers can share model definitions through ordinary `.pln` modules, so incompatible declared function inputs/outputs are checked across the compiled module graph. Runtime checks are only performed where application code calls `parse`/`safeParse`; they are not injected automatically by the compiler.

## Implemented versus not implemented

- **Implemented and tested:** schema constructors and recursive validation; range/length constraints; strict and passthrough object handling; optional nested values; structured errors with paths; std module type declarations; compiling and running a PlainScript module using the API.
- **Partially implemented:** shared model types and runtime schemas can live in the same module, but maintainers must keep them aligned; `Schema<T>` is an annotation, not a proof that a schema's shape equals `T`.
- **Not implemented:** `contract`/`operation` language declarations; generated typed clients; endpoint-specific typed errors; auth/middleware hooks; automatic server response validation; request transport; database mapping, schema comparison or migrations; transaction abstraction; compile-time detection of frontend consumers affected by changed backend responses.

## Validation and extension plan

The next safe increment should derive checker-visible output types from schema shapes, with tests for optional fields, arrays, imported aliases and nested records. Then operation declarations should be represented in the checked module graph, including input/output/error types, before adding any transport-specific client. Database adapters should remain separate packages and consume explicit model metadata; they must not be hard-wired into compiler grammar. These are planned, not available features.

Run `node --test tests/contract.test.js` for focused regression coverage and `npm test` for the full suite.
