# Background jobs

`std/jobs` is a scheduler for server work that should not block a request: sending email,
resizing an upload, warming a cache, or retrying a flaky integration. Its scheduler is
in-process; an optional store adapter persists job records so pending and interrupted work
can be recovered after a restart. It is deliberately small and does not pretend to be a
distributed queue.


## Example

```plainscript
import { queue } from "std/jobs"

let jobs = queue({
    concurrency: 4,
    retries: 2,
    retryDelay: 100,
    retryBackoff: 2,
    timeout: 5000,
})

let job = jobs.add("send-welcome", async (payload: any, signal: any) => do
    await sendEmail(payload.email, signal)
end, { email: "ada@example.com" })

jobs.on("failed", (failed) => do
    log("job {failed.name} failed after {failed.attempts} attempt(s)")
end)

try
    await job.promise
catch error
    log("welcome email failed: {error.name}")
end
```

`add(name, work, payload?, options?)` returns a job handle immediately. The handle exposes
`id`, `name`, `state` (`pending`, `running`, `completed`, `failed` or `cancelled`),
`attempts`, `promise` and `cancel(reason)`. A job waiting to retry temporarily returns to
`pending` and is tracked in `stats().delayed`. Options override queue defaults:
`retries`, `retryDelay`, `retryBackoff` and `timeout` (0 means no timeout).

`queue` defaults are `concurrency: 1`, `retries: 0`, `retryDelay: 0`, `retryBackoff: 2`,
`timeout: 0`. Invalid numeric values are clamped rather than producing NaN.

## Lifecycle and shutdown

```plainscript
await jobs.drain()       # wait for pending/running/retry-delayed work
await jobs.close()       # stop accepting work, cancel queued jobs, wait for running ones
```

`drain()` does not close the queue; new work can still be added. `close(reason)` marks the
queue closed, rejects queued and retry-waiting jobs with `JobCancelledError`, and waits for
already-running handlers to settle. A handler that ignores its signal cannot be forced to
stop, so `close()` waits for its promise. Register shutdown on `SIGTERM`/`SIGINT` in the
host process, drain/close there, and let `close()` close the configured store.

Events: `queued`, `recovered`, `completed`, `failed`, `cancelled` and `storage-error`.
Listener exceptions are swallowed so an observer cannot break the queue. `stats()` reports
`pending`, `running`, `delayed`, `closed`, `total` and `recorded`.

## Durable stores

```plainscript
import { queue, sqliteStore } from "std/jobs"

let store = await sqliteStore("./jobs.sqlite")
let jobs = queue({ store, concurrency: 4 })
jobs.handle("send-welcome", async (payload: any) => await sendEmail(payload.email))
await jobs.ready             # recover pending/running/delayed records
jobs.add("send-welcome", async (payload: any) => await sendEmail(payload.email), { email: "ada@example.com" })
```

`memoryStore()` is useful for deterministic tests but is not crash-durable. `sqliteStore(file)`
uses Node 22's `node:sqlite`; it is a single-process store and its write errors are reported
through the `storage-error` event and `queue.storageErrors` rather than silently discarding
the job. A custom store needs `save(record)`, `load()`, `delete(id)` and `close()` methods.

Recovery runs when `queue({ store })` is created. Register a handler with `handle(name,
work)` for every persisted job name before awaiting `jobs.ready`; a record whose name has no
registered handler is marked `failed` instead of disappearing. Recovered jobs keep their
attempt count, payload, retry settings and timestamps. `queue.get(id)` and `queue.list(state?)`
expose the persisted record snapshots.

A function cannot be serialized, which is why handlers are registered by name. `add()` also
registers its handler for convenience, but recovery must not depend on the original call
site still existing.

## Errors

- `JobTimeoutError` — the per-attempt timeout elapsed; the signal is cancelled.
- `JobCancelledError` — `cancel()` or `close()` settled the job before completion.
- `JobError` — the final attempt failed with a non-Error thrown value.

Retries are per job and occur only for handler failures, not for explicit cancellation or
timeout. `retryDelay` is multiplied by `retryBackoff^(attempt-1)`.

## Durability boundary

A store makes records durable, but scheduling is still in-process. There is no distributed
lease, cross-process worker, leader election or exactly-once delivery. A job that was
running when the process died is re-enqueued after restart; its handler may have completed
a side effect before the crash, so make side effects idempotent and persist an idempotency
key. SQLite is a single-process store; use a server-backed custom store for multiple
processes. `std/db` migrations and bound-parameter queries are suitable for application
records; see [DATABASES](DATABASES.md).

Verified by `tests/jobs.test.js` and `tests/durable-jobs.test.js`: bounded concurrency,
retry/final error, timeout cancellation, queued cancellation, close during retry, event
delivery, use from compiled PlainScript, memory-store recovery, SQLite reopen persistence,
retry/failure records and missing-handler failure. The queue is Node/browser-neutral except
for timers; the bundled SQLite store requires Node 22.
