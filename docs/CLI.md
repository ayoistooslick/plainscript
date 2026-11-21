# Command line

```
plainscript <command> [options]
```

Exit codes: `0` success, `1` compile or test failure, `2` usage error. Diagnostics go to
stderr; program output and `ir`/`version` output go to stdout.

## Syntax dialects

A `.pln` file selects its surface dialect on the first line:

```plainscript
#syntax 2.1
```

`#syntax 2.0`, or no pragma with no configured default, is the 2.0 dialect. The compiler reads the
pragma per file, so one project can mix both. `check`, `build`, `watch`, `run`,
`fmt`, `lsp` and `dap` all handle either dialect; a 2.0 word inside a 2.1 file is
reported as `PS2030` with the 2.1 spelling in the message. `fmt` preserves the
pragma and formats 2.1 blocks (`define`, `when`, `otherwise`) with the same
indentation rules as 2.0 blocks. See
[Migrating from 2.0](MIGRATION_2_1.md) for the complete mapping.

## Commands

### `plainscript run [file.pln] [args…]`

Compiles the file and its module graph into `.plainscript/run/` and executes it with Node.
With no file, runs `src/main.pln`. Everything after the file name is passed to the program,
where `std/io`'s `args()` returns it.

```
plainscript run demos/cli/src/main.pln add "write the docs"
```

Compilation happens before execution; a type error means nothing runs.

`SIGINT` and `SIGTERM` sent to the CLI are forwarded to the program, so stopping a dev
server releases its port instead of leaving an orphaned process behind.

### `plainscript build [files…]`

Type-checks the project graph and writes one `.js` plus `.js.map` per source into the output
directory (`dist/` by default). With no arguments it compiles every `.pln` under the source
root, skipping the output directory, `node_modules`, dot-directories and `*.d.pln`
declaration files.

A failed build writes nothing. When the project is not already ESM, a
`package.json {"type":"module"}` is written into the output directory so Node loads the
files correctly.

`--declarations` also writes `<name>.d.pln` beside each `<name>.js`: exported types,
`declare function` signatures (inferred return types included), `declare const` values,
re-exports and the imports public signatures need. Private types used by those signatures
are kept without `export`. A consumer resolves `./lib/x.js` and reads `./lib/x.d.pln` for
types, so a library can be published as compiled JavaScript plus declarations.

When the project has a `package.json`, the same build wires the package entry: `types`
and `exports["."].types` point at the emitted declaration, and `exports["."].import` at
the compiled runtime. Existing export keys, conditions and the declared runtime path are
preserved. The entry is the one the manifest already names, the conventional
`dist/index.js`, or the only module nothing else imports; a build with several
independent entry modules leaves `package.json` untouched rather than guessing.

```
plainscript build --declarations
```

`--std-base=<url>` rewrites standard-library imports to `<url>/<name>.js` instead of file
paths or the package name. This is how a browser build points at URLs the server exposes:

```
plainscript build src/client.pln --std-base=/std
```

### `plainscript watch [files…]`

Builds the project, then watches the source root and rebuilds after `.pln` changes. The
in-process module cache is invalidated for the changed module and its reverse dependency
closure; unrelated modules are reused. Outputs whose JavaScript and source map are
byte-identical are not rewritten.

```
plainscript watch
```

Stop it with Ctrl+C or `SIGTERM`.

### `plainscript lsp`

Starts the dependency-free language server over stdio. Advertised capabilities are
diagnostics, completion, hover, definition, references, rename, document symbols,
whole-document formatting, semantic tokens and quick-fix code actions. Workspace references
and rename follow imported PlainScript symbols. See [`editors/vscode`](../editors/vscode)
for the editor extension.

### `plainscript dap`

Starts the Debug Adapter Protocol server over stdio. The adapter launches a compiled
JavaScript entry with Node's inspector, loads its source map, maps `.pln` breakpoints to
generated lines, and reports paused JavaScript frames back as `.pln` locations. It is a
minimal adapter rather than a custom runtime debugger; see [DEBUGGING](DEBUGGING.md) for the
launch configuration and Node WebSocket requirement.

```json
{
  "type": "plainscript",
  "request": "launch",
  "program": "${workspaceFolder}/dist/main.js",
  "cwd": "${workspaceFolder}"
}
```

### `plainscript check [files…]`

Runs the lexer, parser and checker over the graph and prints diagnostics. Emits nothing.
Use it in CI and pre-commit hooks.

### `plainscript fmt [files…]`

Normalises indentation and block layout: block bodies are indented one level, `end`/`else`
keywords line up with their opener, blank-line runs collapse to one, and comment lines are
preserved. It is token-preserving and idempotent; it does not wrap long lines or reorder
code. With `--check`, it reports files that would change and exits `1` instead of writing.

```
plainscript fmt --check
```

A file that does not lex is reported as an error and left untouched.

### `plainscript test [files…]`

Runs `*.test.pln` files (under the working directory) as programs and reports how many test
files failed. Inside a test file, use `std/test`:

```plainscript
import { test, equals, isTrue } from "std/test"

test("addition", () => equals(1 + 1, 2))
```

`std/test` throws on failure, so a failing assertion fails the file and therefore the
command. Async test bodies are awaited.

### `plainscript new <name> [--template <id>]`

Creates `<name>/` with `package.json`, `.gitignore` and `src/app.pln`, then prints the
commands to install and run. Refuses to write into a non-empty directory.

`--template <id>` (or `--template=<id>`) copies a bundled application instead of the default
starter. The available templates are:

- `project-management` — SQLite-backed projects, tasks, dashboard API, and browser client.
- `ecommerce` — SQLite-backed catalogue, inventory-safe simulated checkout, orders, and browser client.
- `realtime-chat` — SQLite-backed conversations/messages and live Server-Sent Events delivery.
- `react-vite` — React component written in PlainScript, bundled by Vite.
- `next` — Next.js App Router page rendered by a PlainScript server component.
- `express` — Express-compatible HTTP API using the real `express` package.
- `cli` — command-line program using `std/io.args`.
- `library` — typed package built with `.d.pln` declarations.

For example: `plainscript new my-store --template ecommerce`. An unknown id lists the
available templates and exits with the usage code.

### `plainscript migrate [files…]`

Scans JavaScript and TypeScript files for constructs that cannot be renamed to `.pln`
safely: CommonJS `require`/`module.exports`, TypeScript interfaces/enums/namespaces,
classes, JSX and `//` comments. It reports file, line, code and a suggested replacement. It
**does not rewrite source files**; conversion remains a reviewable manual step.

```bash
plainscript migrate src --check     # exit 1 when any finding exists
plainscript migrate src --json      # machine-readable report
```

With no paths it scans the current directory, skipping `node_modules`, `dist`, `legacy` and
dot-directories. `--check` is a CI gate; without it the command reports findings and exits
0. Transform one file at a time, keep JavaScript modules at the boundary, and run
`plainscript check` after each conversion. See [MIGRATION](MIGRATION.md).

### `plainscript interop [files…]`

Translates supported TypeScript `.d.ts` declarations into `.d.pln` declarations. With no
paths it recursively scans the current directory, skipping `node_modules`, `dist`, `.git`
and `.plainscript`. Relative imports that resolve to a `.d.ts` file are translated too.

Supported: interfaces (with declaration merging), type aliases, object/function/tuple
types, unions, intersections, `keyof`, indexed access, mapped types, generics with
constraints, exported function/value declarations, re-exports, `declare class` and
finite template-literal types. A class is written as an instance record plus a
`declare const` binding; statics are omitted and a generic method widens to its
constraint, both with a `PS7005` warning. Unsupported constructs — `infer`, namespaces,
ambient `declare module` blocks, `export * from`, optional tuple elements, index
signatures and signatures with no direct PlainScript equivalent — produce `PS7001`
diagnostics; the affected file is **not** written. Generic defaults are omitted with a
`PS7004` warning. The command never substitutes `any` for an unsupported type.

```bash
plainscript interop types
plainscript interop types/api.d.ts --json
```

Without `--json` the command prints a write/error summary. With `--json` it prints the
per-file diagnostics as machine-readable output. A declaration that already has errors is
left untouched; review warnings before relying on the output.

### `plainscript ir <file.pln>`

Prints the lowered, typed HIR as JSON. Useful when working on the emitter or reporting a
codegen bug.

### `plainscript version` / `plainscript help`

Print the compiler version and the help text.

### `npm run bench`

Runs the reproducible synthetic compiler benchmark in `scripts/benchmark.js`. It reports
cold compile and typecheck timings and makes no TypeScript comparison unless a pinned
TypeScript toolchain is installed separately; see [BENCHMARKS](BENCHMARKS.md).

## Options

| Option | Meaning |
| --- | --- |
| `--quiet` | Suppress progress output; errors still print. |
| `--verbose` | Print each compilation stage. |
| `--check` | With `fmt`: report instead of write; with `migrate`: exit 1 on findings. |
| `--declarations` | With `build`: also emit `<name>.d.pln`. |
| `--json` | With `migrate` or `interop`: print a JSON report. |
| `--template=<id>`, `-t <id>` | With `new`: select a bundled starter. |
| `--std-base=<url>` | With `build`: browser base URL for `std` imports. |
| `--syntax=<v>` | Compile files without a pragma as `2.0` or `2.1` for this run. |
| `--help`, `-h` | Show help. |

## Project layout and configuration

Defaults: sources under `src/` when it exists (otherwise the current directory), output in
`dist/`. Override with `plainscript.config.json` in the project root:

```json
{
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "exclude": ["src/legacy"],
    "syntax": "2.1"
  }
}
```

`syntax` is the default dialect for files without a pragma. It may also appear at
the top level of the file. A `#syntax 2.0` or `#syntax 2.1` line in a file takes
precedence, and `--syntax` overrides the configuration for one command.

Paths are relative to the config file's directory (`rootDir`, `outDir`, `exclude` entries).
`rootDir` determines output paths: `src/api/server.pln` becomes `dist/api/server.js`.

Run directories (`.plainscript/`) and build output (`dist/`) should be ignored by version
control; `plainscript new` writes a `.gitignore` that does this.

## Using the compiler as a library

```js
const { Compiler } = require('plainscript-lang/src/modules');

const compiler = new Compiler({ root: process.cwd() });
const result = compiler.compile('/abs/path/main.pln', { outFile: '/abs/path/out/main.js' });
if (!result.ok) {
  for (const diagnostic of compiler.diagnostics) console.error(diagnostic.message);
}
```

`src/index.js` re-exports the documented API: `compileFile`, `Compiler`, `format`,
`diagnostics` helpers and `VERSION`.
