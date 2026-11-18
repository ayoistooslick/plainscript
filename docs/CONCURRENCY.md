# Concurrency and asynchronous programming

## Implemented

PlainScript supports JavaScript-compatible `async function`, async lambdas, `await` on promise values, top-level await in emitted ES modules, and normal JavaScript promise/error propagation. An async function's declared return type is its resolved value type; a call produces `Promise of T`. The compiler preserves JavaScript event-loop and host-runtime semantics.

This is asynchronous programming support, not a structured-concurrency runtime.

## Not implemented

There are no task groups, cancellation tokens, cancellation propagation, timeout primitive, channels, actor model, worker pool, or compiler-managed resource cleanup. Use JavaScript host APIs or ecosystem packages explicitly; the language does not promise that cancelling one operation cancels its descendants.

## Design constraint for future work

A future task-group primitive must specify parent/child lifetime, fail-fast versus collect-all errors, cancellation delivery, cleanup/finally behavior, and how it maps to browser and Node runtimes. No concurrency keywords are added until those semantics can be implemented and tested coherently.
