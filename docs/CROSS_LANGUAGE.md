<!-- compile-examples -->

# Cross-language interoperability

PlainScript runs on JavaScript, so JavaScript and TypeScript are the native
interoperability story: import an npm package, a Node builtin, a browser API or a
local `.js` module and the emitted ESM uses it directly. Projects in other
languages need a boundary that crosses a process. PlainScript 2.2 standardised
that boundary, and 2.3 adds a typed TypeScript client and deeper verification,
instead of inventing a different integration for every language.

The boundary is **newline-delimited JSON-RPC 2.0**. A PlainScript module is
served by `plainscript bridge`; generated clients in Python, JavaScript,
TypeScript, Java, Kotlin, C, C++, Go, Rust, Ruby, PHP, C#, Swift and Dart call
it over stdio or HTTP. `std/bridge` is the same protocol in the other direction,
so PlainScript can call a Python service.

This is deliberately a process boundary, not a foreign-function interface (FFI)
or a native embedding API. It works wherever the participating runtimes work,
keeps crashes and memory ownership apart, and requires no compiler plugin for
each host language. The trade-off is serialisation cost and no shared mutable
memory; use it at module boundaries, not inside a hot loop.

## Expose PlainScript to another language

Export typed functions from a module:

```plainscript
#syntax 2.1

import { count } from "std/list"

export type Totals
    count: number
    total: number
end

export define add(a: number, b: number) returns number
    return a + b
end

export define greet(name: text) returns text
    return "Hello, {name}!"
end

export define totals(values: list of number) returns Totals
    set sum to 0
    for each value in values
        change sum to sum + value
    end
    return { count: count(values), total: sum }
end

export async define later(ms: number) returns number
    return ms * 2
end
```

The bridge builds a manifest from the checker's exports. Parameters, return
types, optionality, records, lists, maps and async functions are described, so a
generated client knows which arguments to send and what shape to expect.

### Serve it

```bash
# one call, useful in a shell or another program
plainscript bridge src/service.pln --call=add --args='[2, 3]'
# 5

# inspect the manifest
plainscript bridge src/service.pln --manifest

# newline-delimited JSON-RPC over stdio
plainscript bridge src/service.pln

# the same messages over HTTP: POST /rpc, GET /health, GET /manifest
plainscript bridge src/service.pln --http=8787
```

A request is one JSON object per line:

```json
{"jsonrpc":"2.0","id":1,"method":"add","params":[2,3]}
```

The response is one object per line:

```json
{"jsonrpc":"2.0","id":1,"result":5}
```

Batches, notifications (requests without an id), positional parameters, named
parameters, `__ping` and `__manifest` are supported. Errors use the standard
JSON-RPC codes plus an execution code for a thrown PlainScript value:

| Code | Meaning |
| --- | --- |
| `-32700` | Parse error |
| `-32600` | Invalid request |
| `-32601` | Unknown method |
| `-32602` | Invalid params |
| `-32603` | Internal error |
| `-32000` | The PlainScript function threw |

The bridge serialises results with JSON; `nothing` becomes `null`, and a
non-serialisable value is reported as an execution error.

### Generated bindings

```bash
plainscript bindings src/service.pln --out=bindings
plainscript bindings src/service.pln --lang=python,go --out=bindings
```

The output contains the manifest, protocol notes and one client per requested
language. Generated clients are small and dependency-free where the language
allows it; C and C++ use a header plus a generated implementation that calls the
CLI, while JVM, Go, Rust, Ruby, PHP, C#, Swift and Dart clients are source files
with the same request/response shape.

| Language | Generated | End-to-end verified here |
| --- | --- | --- |
| JavaScript | `.mjs` client | Yes, against a live bridge |
| TypeScript | `*_bridge.ts` typed client | Yes, strict `tsc` and live bridge |
| Python | `*_bridge.py` client and `python_server.py` | Yes, both directions |
| C | header + helpers | Yes, compiled with GCC and executed |
| C++ | header | Compiles, one-shot call verified |
| Java, Kotlin | `BridgeClient.java` / `.kt` | Compiled by the all-language CI job |
| Go | `*_bridge.go` | Compiled and executed by the all-language CI job |
| Rust | `*_bridge.rs` | Compiled by the all-language CI job |
| C# | `BridgeClient.cs` | Compiled by the all-language CI job |
| Ruby, PHP | one client each | Executed against a live bridge by the all-language CI job |
| Swift, Dart | one client each | Compiled by the all-language CI job |

The repository ships `scripts/verify-bindings.js`, which generates every client,
compiles it with the language toolchain and runs a live bridge call where the
toolchain allows it. This checkout has Node, Python, C and C++ toolchains, so
those are executed locally; Go, Rust, Ruby, PHP, C#, Java, Kotlin, Swift and
Dart are compiled or executed by the dedicated CI job that installs them. A
client that cannot be executed in a given environment is reported as skipped
with the missing toolchain, never counted as a pass.

## Call another language from PlainScript

`std/bridge` starts a child process and speaks the same protocol:

```plainscript
#syntax 2.1

import { open, close } from "std/bridge"
import { print } from "std/io"

set python to open("python3", ["service.py"])
print(await python.request("add", [2, 3]))
print(await python.request("greet", ["PlainScript"]))
close(python)
```

`open` returns a `BridgeProcess` with:

| Member | Meaning |
| --- | --- |
| `request(method, params)` | Send a request, await its result |
| `notify(method, params)` | Send a notification; no result |
| `pid` | Child process id |
| `close()` | Close stdin and terminate the child |

A Python service is ordinary Python. Export functions at module scope; the
bundled server (`src/interop/python_server.py`) reads one JSON request per line
and writes one response per line:

```python
def add(a, b):
    return a + b

def greet(name):
    return f"Hello from Python, {name}!"
```

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"add","params":[2,3]}' | python3 src/interop/python_server.py service.py
```

The server returns a structured error when the Python function raises. The
PlainScript client surfaces it as a `BridgeError` whose `message` is the remote
message; a `try … catch` around `request` handles it.

## Choosing a boundary

| Situation | Recommended boundary |
| --- | --- |
| JavaScript, TypeScript, React, Node | Direct ESM import; generated `.d.pln` for declarations |
| Python service or script | `plainscript bridge` + Python client, or `std/bridge` |
| C / C++ library | Keep the library in C/C++, expose a narrow process or HTTP service; generated C client for calling PlainScript |
| Java / Kotlin / Go / Rust service | Run it as a service and call over HTTP JSON-RPC; generated client |
| Data pipeline across languages | JSON-RPC process boundary with a versioned manifest |
| Hot path inside a native library | Not solved by 2.3; native FFI/WASM embedding is a future adapter |

The architecture is extensible by adding a generator to
`src/interop/bindings.js` and a small client runtime for the language. The
protocol and manifest are stable across generators; adding a language does not
change the compiler.

## Security and operations

- A bridge is a local process. `--http` binds to `127.0.0.1` by default; put an
  authenticated reverse proxy in front of it before exposing it to a network.
- The bridge executes the module. Do not point it at untrusted source.
- Params are validated against the manifest's arity and names, but a dynamic
  language client can still send values of the wrong JSON shape. Validate
  business input inside the PlainScript function.
- The child process is terminated when the client closes or exits; a crashed
  bridge surfaces as a connection error in the client.
- JSON has no distinction between a missing optional value and `null`. Model
  absence as `null` or use a record with an explicit flag.

## JavaScript interoperability remains the native path

Cross-language JSON-RPC does not replace direct JavaScript interop. The same
release continues to support:

- ESM and CommonJS packages through Node's resolver.
- Node builtins and browser APIs via `declare`.
- TypeScript declarations through `plainscript interop`.
- React and Vite through emitted ESM and source maps.
- Local JavaScript modules through `.d.pln` declarations and generated
  boundaries.

See [JavaScript interoperability](INTEROP.md) for the native path, and
[JSX and React](JSX.md) for components.
