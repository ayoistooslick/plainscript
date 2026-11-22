<!-- compile-examples -->

# Migrating to PlainScript 2.2

PlainScript 2.2 adds a migration tool that analyses an existing project and
produces a phased plan, safe conversions, interoperability boundaries and a
machine-readable report. It is designed for incremental adoption: a mixed
project is a valid end state. You do not need to rewrite an application before
PlainScript is useful.

The tool is `plainscript migrate`. It complements, rather than replaces,
`plainscript interop` (TypeScript declaration translation) and
`plainscript bindings` (cross-language clients).

## Run an analysis first

```bash
plainscript migrate .
plainscript migrate . --json
plainscript migrate . --report=migration-report.json
```

The Markdown report contains:

- the detected languages, module system, package manager, frameworks and
  ecosystem markers;
- every analysed source file with its language, line count, exports, imports,
  JSX flag and migration phase;
- a phased plan;
- mechanical scan findings with stable codes;
- unresolved transformations and the reason each one needs attention.

The JSON report contains the same analysis plus a `findings` array compatible
with 2.1's migration scan and the new `summary`, `stack`, `phases`,
`boundaries`, `conversions` and `failures` fields.

### Phases

| Phase | What belongs here | Strategy |
| --- | --- | --- |
| `leaf-utilities` | Modules with no dependants | Convert first; run tests |
| `modules-with-public-api` | Exported functions and values | Convert or wrap; point dependants at the result |
| `ui-components` | JSX/TSX and React imports | Keep behind a boundary, or rewrite with native PlainScript JSX |
| `entrypoints` | `main`, `server`, `app`, `cli` | Move last, after the mixed build is green |

Entrypoints move last because they exercise the whole graph. A leaf conversion
that passes its tests is a safe checkpoint; a broken entrypoint blocks
everything.

## Safe conversion

For JavaScript files that pass a conservative gate, `--write` emits a `.pln`
module beside the source:

```bash
plainscript migrate src --write
```

```plainscript
#syntax 2.1

# Converted from util.js by plainscript migrate.
# Review the result and run the project tests before deleting the source.

export define add(a: number, b: number) returns number
    return a + b
end
```

The converter preserves exports, function bodies, records, lists, ordinary
control flow and string interpolation. It infers no types it cannot prove: a
parameter without an annotation is `any`, and the original tests remain the
behavioural oracle. The converted file is a starting point for review, not a
claim that the whole module is idiomatic PlainScript.

The converter refuses, rather than mistranslates:

- classes and `this`-bound methods;
- JSX;
- CommonJS `require`/`module.exports`;
- default exports and wildcard re-exports;
- generators, decorators, dynamic `import()` and `eval`.

A refusal produces a finding with a reason. The original file stays untouched.

## Interoperability boundaries

When a JavaScript, JSX, TypeScript or TSX module cannot be safely converted,
`--write` generates a boundary triplet:

```text
bridges/App.pln            PlainScript-facing wrapper
bridges/App.runtime.js     runtime adapter for the original module
bridges/App.runtime.d.pln  declaration consumed by the checker
```

Import the wrapper from PlainScript:

```text
#syntax 2.1

import { App } from "./bridges/App"
```

The wrapper re-exports the adapter, the adapter points at the original source,
and the declaration supplies types. The original module remains authoritative:
editing and testing it continues exactly as before, while PlainScript gains a
checked import. Boundaries are generated for ESM and CommonJS modules; the
CommonJS adapter imports the module namespace and re-exports its named values.

The runtime file has a distinct name from the wrapper's emitted JavaScript so a
`plainscript build` cannot overwrite the adapter. The declaration is named to
match the adapter, because that is what the resolver looks up.

## Incremental workflow

1. Run `plainscript migrate . --json > migration.json` and keep the report.
2. Convert one leaf module with `--write`.
3. Run `plainscript check` on the converted file and the project's test suite.
4. Import the converted module from one dependant, leaving the rest untouched.
5. For UI or CommonJS modules, import the generated boundary instead.
6. Repeat by phase. Use `--check` in CI once the remaining unresolved list is
   accepted; it exits non-zero while findings or manual modules remain.

`plainscript migrate --check .` is a ratchet, not a release gate for a mixed
project. It reports what is left; a project can ship with a documented boundary
list.

## Extending to other languages

Source conversion for 2.2 is deliberately limited to JavaScript and the
JavaScript-family syntax. Other languages are analysed (public declarations are
detected for Python, Rust, Go, Java, Kotlin, Ruby, PHP, C#, Swift and Dart) and
reported as `manual`: their native module stays authoritative and is connected
through the JSON-RPC bridge or the generated bindings rather than translated
line by line.

This is an honest boundary. A Python or Go function can be exposed as a service
without rewriting it, and a PlainScript module can call it with `std/bridge`.
The migration tool does not claim to preserve Python semantics in PlainScript
source, because it does not translate Python.

## Migrating a React application

A JSX/TSX component is detected as a UI module. Two routes are supported:

- **Boundary first.** Generate `bridges/App.*`, import `App` from PlainScript,
  and keep the component in its existing React/Vite build. This is the fastest
  route for an application with a large component tree.
- **Native rewrite.** Move the component to `.pln` with native JSX. Props are
  checked where they are declared; hooks, events and custom runtimes work. See
  [JSX and React](JSX.md).

The `integrations/react-vite` project uses the native route and is rendered in
the test suite. A React application can contain both routes during migration.

## Migrating from 2.1

There is no source break between 2.1 and 2.2. Existing 2.1 modules compile
unchanged. New files can use JSX and regex literals without opt-in flags.

Recommended order:

1. Upgrade the package to 2.2.0.
2. Run `plainscript check` and `npm test`; both should pass before adopting new
   syntax.
3. Add regex literals where string workarounds exist, and native JSX where a
   separate JSX layer exists.
4. Run `plainscript migrate` to find remaining JavaScript modules that can be
   wrapped or converted.
5. Publish the generated boundaries or converted modules as one reviewable
   change.

## Verification checklist

- `plainscript check` on every converted file.
- The original project's tests, unchanged, on the mixed project.
- A production build using the existing bundler or build script.
- A cross-language round trip for every bridge boundary.
- A rollback path: deleting `bridges/` and the converted `.pln` files restores
  the original project.

## Limitations

- The converter is line-oriented and gated; it is not a full JavaScript parser
  and does not handle every expression.
- Type and data-model translation is intentionally conservative. TypeScript
  annotations are not inferred from `.d.ts` during conversion; use
  `plainscript interop` for declarations.
- Automated execution of the project's tests is not performed by the tool. The
  report lists the checks to run; your CI runs them.
- Only the JavaScript family gets source boundaries. Other languages use the
  process bridge or stay native.
- Names that collide after conversion (for example a value and a type with the
  same name) require review.
