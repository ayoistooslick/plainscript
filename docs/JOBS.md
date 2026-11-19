# Background jobs

`std/jobs` is an in-process scheduler for server work that should not block a request:
sending email, resizing an upload, warming a cache, or retrying a flaky integration. It is
deliberately small and does not pretend to be a distributed queue.

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
host process and call `close()` there.

Events: `queued`, `completed`, `failed`, `cancelled`. Listener exceptions are swallowed so
an observer cannot break the queue. `stats()` reports `pending`, `running`, `delayed`,
`closed` and `total`.

## Errors

- `JobTimeoutError` — the per-attempt timeout elapsed; the signal is cancelled.
- `JobCancelledError` — `cancel()` or `close()` settled the job before completion.
- `JobError` — the final attempt failed with a non-Error thrown value.

Retries are per job and occur only for handler failures, not for explicit cancellation or
timeout. `retryDelay` is multiplied by `retryBackoff^(attempt-1)`.

## Durability boundary

The queue lives in memory. A process exit loses pending and retry-waiting jobs, and there is
no cross-process worker or leader election. For work that must survive restarts:

1. persist the job record and payload in your database (for example a `jobs` table) before
   returning success to the caller;
2. enqueue it again at startup from that table;
3. mark completion idempotently in the same database;
4. use a unique key/idempotency token so a redelivered job does not repeat side effects.

`std/db` migrations and bound-parameter queries are suitable for that record. This is
explicitly an application responsibility in 2.0; see [DATABASES](DATABASES.md).

Verified by `tests/jobs.test.js`: bounded concurrency, retry/final error, timeout
cancellation, queued cancellation, close during retry, event delivery and use from compiled
PlainScript. The queue is Node/browser-neutral except for timers; durable scheduling is not
implemented.
