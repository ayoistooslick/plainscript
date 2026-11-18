# Type system status

PlainScript 2.0 uses structural types. The checker handles primitives, records, optional fields, lists, maps, promises, functions, unions, named aliases, variants, generic functions/types, inference, assignability, narrowing and match exhaustiveness. Types are erased from emitted JavaScript; imported JavaScript boundaries without declarations remain `any`.

## Current limits

Generic constraints, conditional and mapped types, indexed access, tuples, `keyof`/`typeof` queries, declaration-file interoperability with general TypeScript `.d.ts` syntax, and compiler-verified refinement/type predicates are not supported. Generic inference has known limitations for types appearing only in a function result. Function assignability exists but is not a complete model of JavaScript callback variance. `any` remains permissive by design at untyped boundaries.

`std/contract` adds runtime validation, not a new type-system feature: its `Schema<T>` annotation does not prove that the runtime schema's actual shape corresponds to `T`. See [Unified Contracts](UNIFIED_CONTRACTS.md).

## Priorities

1. Schema-derived output types, with explicit optionality and useful diagnostics.
2. Better generic inference for nested records, imports and callback positions.
3. Constraints and type queries only after their assignability and recursion semantics are specified.
4. Broader declaration-file parsing only when backed by real ecosystem fixtures.

The list above is a work queue, not a claim that those capabilities exist.
