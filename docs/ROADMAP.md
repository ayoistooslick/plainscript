# Roadmap

This roadmap reports status, not promises or release dates.

## Available now

PlainScript 2.0 compiler pipeline (lexer, parser, checker, typed HIR and JavaScript emitter); modules, structural types, generics, unions, narrowing and match checking; ES modules and source maps; CLI; standard library; JavaScript/npm interoperability; app templates; and the initial `std/contract` runtime validator. See the [specification](SPEC.md) and [contract status](UNIFIED_CONTRACTS.md).

## Next engineering priorities

1. Make schema definitions produce checker-verified types and mismatches diagnosable.
2. Model backend operation declarations in the module graph and generate type-safe clients from those same declarations.
3. Add a concrete end-to-end project-management slice with a persistent adapter, typed backend procedure and frontend consumer.
4. Improve generic inference and then implement a genuine LSP (diagnostics, hover, completion, navigation) before advertising editor features.
5. Specify and test a concurrency abstraction before exposing task-group or cancellation syntax.

## Explicit non-goals for the current implementation

The compiler does not yet generate database migrations, enforce authorization, generate RPC clients, provide structured concurrency, or ship an LSP. Existing templates demonstrate JavaScript interoperability and app scaffolding, not proof that these features exist.
