# Type system

PlainScript uses structural types. Types are erased from emitted JavaScript; the checker
is the enforcer, and untyped JavaScript boundaries remain `any` deliberately.

## Implemented and tested

- Primitives, records, optional fields, lists, maps, promises, functions, unions, named
  aliases and recursive variant types.
- Generic functions and generic type aliases, including imported aliases. Arguments are
  inferred structurally, callback parameters are contextually typed, and callback return
  types are checked against the expected result.
- Generic constraints: `function label<T: Named>(value: T) -> text`. Constraint fields are
  available in the function body, and a non-matching argument is rejected.
- Control-flow narrowing for `is`, `== nothing`/`!= nothing`, optional chains and
  discriminant checks; exhaustiveness checking for booleans, variants and literal unions.
- Literal enum unions derived from `std/contract.enumeration`/`literal`. A model field
  inferred as `"open" or "done"` rejects `"maybe"` at compile time and is exhaustively
  matched with `case "open"` / `case "done"`.
- Tuple types with fixed elements, precise literal indexes, destructuring and assignment
  checking: `[number, text]`.
- `keyof RecordType` produces a literal union of field names. `typeof value` reuses the
  type of a value (function/import/value declarations are hoisted before type resolution).
- Schema-derived records from `std/contract.object`, including nested objects, arrays,
  optional fields, enum literal fields and operation input/output types.
- Typed operation results: `OperationSuccess<T> or OperationFailure<E>`, built with
  `success`/`failure` and checked by `implementFallible`/`createFallibleClient`.

## Still absent

Conditional types, mapped types, indexed-access types (`T[K]`), general function
overloads, user-defined type predicates/refinement signatures and a complete model of
function variance remain future work. Declaration interoperability is PlainScript's
`.d.pln` format; arbitrary TypeScript `.d.ts` syntax is not parsed. Unresolved generics and
`any` are permissive by design at untyped boundaries.

`std/contract` is a runtime validator in addition to a checker type. The compiler derives
model types from the known constructors; it does not verify arbitrary hand-written
`Schema<T>` values against an unrelated `T`. Use `object(...)`, `enumeration(...)`,
`array(...)`, `optional(...)` and `literal(...)` when you want derivation.

See [Unified Contracts](UNIFIED_CONTRACTS.md) for the end-to-end path.
