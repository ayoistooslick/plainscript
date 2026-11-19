# Concurrency and asynchronous programming

PlainScript keeps JavaScript's event loop and promise semantics. `std/task` adds a
structured layer on top of that runtime; it does not introduce a second scheduler.

## Semantics

- **Task group ownership.** `group()` creates an owner. Every `run(group, task)` registers
  a task. `close(group)` waits for all started tasks, rejects with the first failure after
  siblings have observed cancellation, or returns results in start order. `close` is
  idempotent and rejects new work once closing begins. `group({ parent: outer })` accepts
  either a signal or another group and inherits its cancellation.
- **Cooperative cancellation.** `cancel(signal, reason)` is idempotent, runs registered
  callbacks synchronously and propagates to child signals. `throwIfCancelled` throws
  `CancellationError`. Cancellation cannot preempt synchronous user code or host promises
  that ignore the signal; that boundary is explicit.
- **Failure propagation.** The first task failure cancels the group and its siblings; later
  failures do not replace the first error. `close` still waits for cleanup before
  rejecting.
- **Timeouts.** `timeout(ms, task)` supplies a cancellable signal, clears its timer in all
  paths, rejects with `TaskTimeoutError`, and attaches a rejection handler so late task
  failure does not become an unhandled rejection.
- **Channels.** `channel(capacity)` supports buffered and unbuffered sends, cancellation of
  pending send/receive operations, and `ChannelClosedError` on closed operations. A
  capacity of zero is a rendezvous. Closing preserves already-buffered values for normal
  receives; later receives fail once the buffer is empty.
- **Workers.** `spawnWorker(source)` uses the browser `Worker` when present and Node's
  `worker_threads` otherwise. The handle exposes `post`, `onMessage`, `onError`,
  `terminate` and `join`.

## Example

```plainscript
import { group, run, close, delay, timeout, channel, cancellation } from "std/task"

let tasks = group("import")
run(tasks, async (signal) => await load("a", signal))
run(tasks, async (signal) => await load("b", signal))
let results = await close(tasks)

try
    await timeout(250, async (signal) => await fetchSlow(signal))
catch error
    print("timed out: {error.name}")
end
```

## Verified

`tests/task.test.js` covers ordered completion, failure-triggered sibling cancellation,
cancellation idempotence/listener behavior, timeouts, buffered backpressure, buffered close
delivery, nested-group cancellation, worker startup failure and a real Node worker
message/termination round trip. The language-level tests compile and run these programs.

Background work has a separate in-process scheduler: see [JOBS](JOBS.md).

## Limits

There is no task-group syntax in the grammar, no work stealing, no actor model and no
persistent queue. `timeout` cannot force a task that ignores its signal to stop. Channels
are in-memory and are not a distributed messaging system. WebSocket support lives in
`std/ws` and is independent of `std/task`.
