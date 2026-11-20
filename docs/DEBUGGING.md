# Debugging

PlainScript emits ordinary JavaScript with source maps. Debugging therefore uses the
JavaScript ecosystem's tools rather than a custom runtime.

## Compile, then inspect

```bash
plainscript build
node --inspect-brk dist/main.js
```

Open `chrome://inspect` (or your editor's Node debugger), attach to the process, and set
breakpoints in the emitted `.js`. The adjacent `.js.map` maps statements back to `.pln`
sources in capable debuggers. `plainscript run` compiles into `.plainscript/run/`; that is a
convenient place to inspect generated code, but use `build` for a stable path.

VS Code's built-in Node debugger can launch a compiled entry:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug PlainScript",
  "program": "${workspaceFolder}/dist/main.js",
  "preLaunchTask": "plainscript: build",
  "sourceMaps": true,
  "outFiles": ["${workspaceFolder}/dist/**/*.js"]
}
```

## Debug Adapter Protocol

`plainscript dap` speaks DAP over stdio. It launches a compiled JavaScript entry with
`node --inspect-brk`, connects to the inspector, loads its `.js.map`, and translates
breakpoints and paused frames through that map. The VS Code extension registers a
`plainscript` debug type, so a workspace launch configuration is:

```json
{
  "type": "plainscript",
  "request": "launch",
  "name": "PlainScript: Debug current file",
  "program": "${workspaceFolder}/dist/main.js",
  "cwd": "${workspaceFolder}",
  "args": [],
  "env": {}
}
```

The adapter supports setBreakpoints, stackTrace, scopes, variables, evaluate, continue,
next, stepIn, stepOut, pause, terminate and disconnect. Additional `sourceMaps` paths may
be supplied for maps not beside the entry. `attach` accepts `inspectorUrl` when you already
have an inspector WebSocket URL.

Limits: the adapter is intentionally small (no conditional breakpoints, watch expressions,
data breakpoints or multi-process debugging). It needs a Node runtime with a global
`WebSocket` client (Node 22 provides one) and a generated `.js.map`; without a map,
breakpoints use generated JavaScript lines. The repository exercises the flow through
`tests/dap.test.js`; it does not automate the VS Code UI. The language server
(`plainscript lsp`) still provides editing features only and does not attach to a running
process.

## Language server logs

The VS Code extension starts `plainscript lsp` over stdio. If completion or diagnostics
stop updating:

1. run `plainscript lsp` manually and confirm it starts without a stack trace;
2. check the extension's Output channel for the server stderr;
3. run `plainscript check <file>` in the same workspace root to distinguish a compiler
   diagnostic from an editor transport issue;
4. reload the window after changing the extension or compiler path.

The server is dependency-free and workspace-aware for imports and references. It advertises
diagnostics, completion, hover, definition, references, rename, document symbols, formatting,
semantic tokens and quick-fix code actions. It does not run a browser preview; debugging is
handled by the separate `plainscript dap` process registered by the extension.

## Diagnosing type errors

Use `plainscript check --verbose` to see stage timing, and `plainscript ir <file>` to inspect
the lowered typed HIR. A diagnostic with a stable `PS` code can be matched to the diagnostics section of
[SPEC.md](SPEC.md); the source excerpt points at the rejected expression.
Deferred conditional/mapped types are permissive until instantiation, so if a generic
program compiles unexpectedly, add a concrete call site that instantiates the type and check
that path.

## Runtime failures

Unhandled promise rejections and process exits come from Node, not a PlainScript runtime.
Use `process.on('unhandledRejection')` only at the top level of a server entry point after
declaring `process: any`. `std/task` errors have stable `name`/`code` fields
(`CancellationError`, `TaskTimeoutError`, `ChannelClosedError`) and `std/jobs` adds
`JobTimeoutError`, `JobCancelledError` and `JobError`.

For HTTP failures, `std/http` returns a generic 500 body by default; log the exception
server-side with your own logger, or pass `{ exposeErrors: true }` only in a trusted local
environment.
