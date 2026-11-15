# Architectural Decisions — PlainScript 2.0

This document captures the key design decisions behind the PlainScript 2.0 rebuild. It is intended to explain the "why" behind the language changes, not just the "what".

## 1. Breaking release, not incremental

**Decision:** PlainScript 2.0 is a ground-up rebuild with incompatible changes, not a v1.x increment.

**Rationale:** The v1 compiler had accumulated technical debt, inconsistent semantics, and an "alias soup" of keyword synonyms. A breaking release allows a clean-slate design with one spelling per concept, a consistent type system, and a well-defined compilation pipeline. The audit (docs/AUDIT.md) documents the v1 issues that motivated this decision.

## 2. One spelling per concept

**Decision:** Every language concept has exactly one spelling/construct. No synonyms, no optional syntax that changes meaning.

**Examples:**
- Block closers: only `end`, no `done`, `together`, or combinations
- Variables: `let` for mutable, `const` for immutable (no `var`, no `set`)
- Conditions: `when`/`otherwise` (no `if`/`else` at the expression level; `if` is reserved for JS interop)
- Loops: `for … in` and `for i in a to b` (no `while` as a primary construct; `while` exists but is limited)

**Rationale:** Multiple spellings for the same concept cause confusion, bloat the compiler, and make the language harder to learn and teach. One spelling means one mental model, one parser rule, one codegen path.

## 3. JavaScript as the compilation target, not TypeScript

**Decision:** The compiler emits plain ES modules for the JavaScript runtime. Types are erased at runtime.

**Rationale:** 
- The target audience is JavaScript developers and ecosystems.
- Emitting TypeScript would add a build step and dependency that most projects don't need.
- Source maps allow debugging in the original PlainScript source.
- Runtime type tests (`is`) and casts (`as`) exist where needed but types don't persist.

## 4. Standard library as explicit, focused modules

**Decision:** The standard library consists of 11 small, focused modules (`std/io`, `std/text`, `std/list`, `std/map`, `std/math`, `std/json`, `std/time`, `std/fs`, `std/http`, `std/test`, `std/dom`).

**Rationale:**
- Each module does one thing well, following the Unix philosophy.
- No "kitchen sink" modules that try to do everything.
- Easy to audit, test, and individually replace.
- No hidden runtime magic — everything is explicit imports.

## 5. Types erased at runtime, except `is` and `as`

**Decision:** Type information is used for compile-time checking and source map generation, but is erased before JavaScript emission. The `is` operator and `as` cast erode to runtime checks.

**Rationale:**
- Keeps the generated JavaScript lean and compatible with any runtime.
- Avoids the performance overhead of reified types.
- `is` provides controlled nominal checking where needed; other type checks rely on structural compatibility.

## 6. `render`/`element` blocks lower to `createElement`, not JSX

**Decision:** `render` blocks compile to `createElement("tag", {prop: value}, ...)` calls from module scope. No JSX transform, no custom runtime.

**Rationale:**
- Avoids the complexity of a JSX pragma/runtime.
- The generated JavaScript is plain and debuggable via source maps.
- Users import React (or their UI library) and use the `createElement` API directly.
- The `render` keyword is reserved but only meaningful inside `render ... end` blocks.

## 7. One ES module per source file

**Decision:** `build` emits a single `.js` file per `.pln` source file. No bundling, no combined output.

**Rationale:**
- Simplifies the compiler (no dependency resolution or code deduplication in the emitter).
- Leverages the host bundler (Vite, webpack, Rollup, Next.js) for production builds.
- Makes source mapping straightforward: one source file → one output file.
- Developers can use `importmap`, ES module interop, or their bundler of choice.

## 8. No intrinsic methods on primitives/collections

**Decision:** Functions like `list.map`, `map.reduce`, `text.format` are in the standard library, not on the values themselves.

**Rationale:**
- Keeps the language runtime minimal.
- Enables pipeline (`|>`) composition: `list |> std/list/map ...` or `text |> std/text/transform ...`.
- Matches the intent-oriented design: you describe *what* you want, not *how* to traverse a data structure.

## 9. Async: `async function`, declared return type is resolved value

**Decision:** `async function name<T>(a: T) -> R ... end` — the declared return type `R` is the type of the resolved value. `await` inside functions suspends computation.

**Rationale:**
- Clear separation between the suspension point (`await`) and the resolved type.
- The type system tracks the async flow through the HIR and emits proper async/await in the JavaScript output.
- Top-level `await` is allowed for module-level initialization.

## 10. Diagnostics code range: PS1001-PS5001

**Decision:** Compiler diagnostic codes follow a structured range:
- PS1xxx: lexer
- PS2xxx: parser
- PS3xxx: types, names, control flow
- PS4xxx: modules, imports, cycles
- PS5xxx: internal, standard library

**Rationale:** Predictable diagnostic codes make it easier for tooling (LSP, IDE, formatter) to categorize and suppress specific warnings.

---

## Related documents

- `docs/SPEC.md` — complete language specification
- `docs/AUDIT.md` — v1 audit that motivated these decisions
- `docs/ARCHITECTURE.md` — compiler architecture overview
- `docs/CLI.md` — CLI command reference
- `docs/INTEROP.md` — JavaScript interop guide