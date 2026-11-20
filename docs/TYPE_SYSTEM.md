# Type system

PlainScript uses structural types. Types are erased from emitted JavaScript; the checker
is the enforcer, and untyped JavaScript boundaries remain `any` deliberately.

## Implemented and tested

- Primitives, records, optional and readonly fields, lists, maps, promises, functions,
  unions, named aliases, recursive record/variant types, fixed-length tuples and variadic
  tuples (`[text, ...text]`).
- Generic functions and aliases, imported aliases, constraints and structural inference.
  Callback parameters are contextually typed, callback return types are checked against
  the expected result, and generic substitution is recursive.
- Record intersections (`Named & Aged`) merge fields. Concrete indexed access reads a
  record field, tuple element, list element or map value. Missing record fields and
  out-of-range tuple indexes are rejected.
- **Conditional types**: `T extends U ? X : Y`. A concrete check chooses a branch; a check
  that still mentions an unresolved type parameter stays deferred until substitution. A
  conditional whose checked type is a naked type parameter distributes over a union after
  substitution: `Kind<number or text>` becomes `Kind<number> or Kind<text>`.
- **Mapped types**: `{ [K in keyof T]: T[K] }` and `{ [K in keyof T]?: boolean }`.
  Mapped evaluation expands when the key set is concrete; otherwise it remains deferred.
- **Readonly record fields**: `readonly id: number` in record and inline record types.
  Assignment is rejected (`PS3319`); structural assignability still ignores readonly.
  This is a compile-time check, not runtime immutability.
- **Variadic tuples**: a fixed prefix followed by one rest type, such as
  `[text, ...text]`. Assignment checks the prefix and every trailing element; indexing
  after the prefix returns the rest type.
- **Generic deferred indexed access**: `type Elem<T> = T[0]`, `type Field<T> = T[keyof T]`.
  Deferred access is resolved after generic arguments are substituted.
- **Function overloads**:

  ```plainscript
  overload function format(value: text) -> text
  overload function format(value: number) -> text
  function format(value: any) -> text
      return "value:{value}"
  end
  ```

  Calls select the first matching signature by argument inference/assignability. A call
  with no match is `PS3354`; an implementation that cannot accept a signature, or an
  overload with no implementation, is `PS3355`. Overload signatures survive module import
  and `.d.pln` declaration generation.
- **User-defined type predicates**: `function isPerson(value: any) -> value is Person`.
  Positive branch narrowing selects the target type; negative branches remove the target
  from union/optional types. Predicates must name a parameter and cannot be async
  (`PS3353`).
- **Literal types**: text, number and boolean literals are valid types, including in
  unions, mapped values and conditional branches.
- Control-flow narrowing for `is`, predicates, `== nothing`/`!= nothing`, optional chains,
  discriminant checks and literal equality; exhaustiveness checking for booleans, variants
  and literal unions.
- Literal enum unions derived from `std/contract.enumeration`/`literal`. A model field
  inferred as `"open" or "done"` rejects `"maybe"` and is exhaustively matchable.
- `keyof RecordType` produces a literal union of field names. `typeof value` reuses the
  type of a hoisted value.
- Schema-derived records from `std/contract.object`, including nested objects, arrays,
  optional fields, enum fields and operation input/output types.
- Typed operation results: `OperationSuccess<T> or OperationFailure<E>`, built with
  `success`/`failure` and checked by `implementFallible`/`createFallibleClient`.

## Variance

Variance is derived from structure, not declared with `in`/`out` annotations:

- function parameters are contravariant (`(any) -> number` is assignable to
  `(number) -> number`, not the reverse);
- function results are covariant (`() -> number` is assignable to `() -> number or text`);
- records are width-subtyped (extra fields are allowed);
- lists, maps, promises and tuples are covariant in their element/value types;
- a generic alias inherits the variance of its expanded body after substitution.

Containers are covariant even though JavaScript arrays are mutable. PlainScript's
collection functions return new values and the grammar does not provide a mutating array
method surface, so the practical risk is confined to aliasing a JavaScript array at an
`any` boundary. This is a documented structural choice, not a nominal ownership system.

## Conditional and mapped semantics

- A conditional **distributes only when its checked type is a naked type parameter**. After
  generic substitution, `T extends U ? A : B` distributes over each member of a union `T`.
  A written union check is compared as a whole: `list of number or text extends list of
  number ? A : B` chooses `B`. Write a separate alias or overload for each union member
  when the written check is not a naked parameter.
- Mapped types require a concrete key union of text/number literal types (usually
  `keyof` of a known record). A mapped type whose key or value still mentions a type
  variable remains deferred.
- Deferred constructs are permissive while unresolved, as are unresolved generics and
  `any`. Concrete instantiation is the enforcement point; a deferred type must not be
  treated as a proof of assignability in a generic body.
- Conditional, mapped and indexed constructs cannot yet be nested in every combination;
  the checker may leave a construct deferred rather than report a false incompatibility.
  Negative tests cover concrete misuse; deeply deferred combinations remain a limitation.

## Declaration interop

`plainscript interop` translates a conservative TypeScript declaration subset to `.d.pln`:
interfaces, aliases, object/function/tuple types, unions/intersections, mapped types,
generics without defaults, and exported function/value declarations. Unsupported constructs
(such as `infer`, template-literal types, namespaces, classes and signatures with no direct
PlainScript equivalent) produce `PS7001` errors and the affected declaration is not
written; warnings such as an omitted generic default are reported as `PS7004`. It is not an
arbitrary `.d.ts` parser. PlainScript's native declaration format remains `.d.pln`.

## Still absent

Arbitrary intersections of unions/functions, optional tuple elements, general conditional
`infer`, nominal classes/declarations and arbitrary TypeScript `.d.ts` syntax are not
implemented. Unresolved generics and `any` are permissive by design at untyped boundaries.

`std/contract` is a runtime validator in addition to a checker type. The compiler derives
model types from the known constructors; it does not verify arbitrary hand-written
`Schema<T>` values against an unrelated `T`. Use `object(...)`, `enumeration(...)`,
`array(...)`, `optional(...)` and `literal(...)` when you want derivation.

See [Unified Contracts](UNIFIED_CONTRACTS.md) for the end-to-end path and
[tests](../tests/type-level.test.js), [overloads](../tests/overloads.test.js),
[predicates](../tests/predicates.test.js), [variance](../tests/variance.test.js),
[recursive types](../tests/recursive-types.test.js) and
[advanced V2 types](../tests/advanced-v2-types.test.js) for executable coverage.
