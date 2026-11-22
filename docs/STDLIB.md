<!-- compile-examples -->

# Standard library

Every module is imported by name and resolved by the compiler:

```plainscript
import { print } from "std/io"
import { map, filter } from "std/iter"
```

The `.d.pln` declaration next to each module is the source of truth for types;
the `.js` file is the runtime. Browser builds can rewrite `std/*` imports with
`--std-base=<url>`.

## Core modules

| Module | Purpose | Main exports |
| --- | --- | --- |
| `std/io` | Terminal and process I/O | `print`, `readLine`, `readAll`, `write`, `cwd`, `env`, `exit` |
| `std/fs` | Files and directories | `readText`, `writeText`, `appendText`, `readJson`, `writeJson`, `list`, `exists`, `mkdir`, `remove`, `stat` |
| `std/http` | HTTP server and client | `serve`, `request`, `json`, `text`, `html`, route helpers |
| `std/ws` | WebSockets | `serve`, `connect` |
| `std/json` | JSON values | `parse`, `stringify`, `tryParse`, `get`, `set` |
| `std/list` | Eager list operations | `count`, `map`, `filter`, `reduce`, `find`, `sort`, `append`, `concat`, `range`, `zip`, `flatten`, `sum`, `take`, `chunk` |
| `std/map` | String-keyed maps | `get`, `set`, `has`, `delete`, `keys`, `values`, `entries`, `merge` |
| `std/math` | Numeric helpers | `abs`, `min`, `max`, `floor`, `ceil`, `round`, `sqrt`, `pow`, `random` |
| `std/text` | Text and regex | `length`, `upper`, `lower`, `trim`, `split`, `join`, `replace`, `contains`, regex helpers |
| `std/time` | Clocks and durations | `now`, `sleep`, `iso`, `format`, duration helpers |
| `std/db` | SQLite/PostgreSQL/MySQL | `open`, `query`, `run`, `exec`, `transaction` |
| `std/auth` | Sessions and tokens | password hashing, sessions, JWT helpers |
| `std/task` | Async coordination | `spawn`, `all`, `race`, `retry`, cancellation helpers |
| `std/jobs` | Durable background jobs | queues, workers, retries, schedules |
| `std/contract` | Runtime contracts | object, function and schema validation |
| `std/bridge` | Python/JSON-RPC bridge | `open`, `close`, process clients |
| `std/test` | Test runner | `test`, `equals`, `isTrue`, `throws`, reporting |

## 2.3 additions

### `std/iter` — lazy iterators

Works with generator values and any object that has `next()`. Every function
returns an `Iterator`, so pipelines stay lazy until `toList` or `reduce`.

`range(first, last, step?)`, `repeat(value, count)`, `fromList`, `toList`,
`map`, `filter`, `take`, `drop`, `chain`, `enumerate`, `zip`, `reduce`, `count`,
`some`, `every`, `find`, `forEach`.

### `std/reflect` — runtime inspection

`typeOf`, `className`, `fieldsOf`, `hasField`, `isError`, `isIterator`,
`isPromise`, `describe`. Reflection reports runtime facts; it does not recover
generic type arguments, which do not exist after compilation.

### `std/bigint` — BigInt helpers

`parse`, `tryParse`, `fromNumber`, `toNumber`, `toText`, `abs`, `min`, `max`,
`gcd`, `pow`, `modPow`, `isEven`, `compare`.

```plainscript
import { print } from "std/io"
import { parse, toText } from "std/bigint"
let value = parse("12345678901234567890")
print(toText(value))
```

### `std/env` — typed environment access

`get`, `require`, `number`, `integer`, `boolean`, `list`, `all`, `set`, `unset`,
`has`. `require` throws when the variable is absent; `number`, `integer` and
`boolean` validate the value instead of silently coercing it.

### `std/process` — child processes and signals

`run`, `runSync`, `shell`, `start`, `which`, `cwd`, `chdir`, `pid`, `ppid`,
`platform`, `arch`, `argv`, `uptime`, `memoryUsage`, `onSignal`. `run` waits for
completion and returns `{ code, stdout, stderr }`; `start` returns a running
child process.

### `std/crypto` — hashing, HMAC and random bytes

`digest`, `sha256`, `sha512`, `sha1`, `hmac`, `hmacSha256`, `randomBytes`,
`randomText`, `randomUUID`, `base64Encode`, `base64Decode`, `hexEncode`,
`hexDecode`, `timingSafeEqual`, `pbkdf2`, `deriveKey`, `encrypt`, `decrypt`.

### `std/compress` — gzip, deflate and brotli

`gzip`, `gunzip`, `deflate`, `inflate`, `brotli`, `unbrotli`, `compress`,
`decompress`.

### `std/stream` — streams as values

`fromText`, `fromBytes`, `collect`, `collectBytes`, `writeAll`, `pipeline`,
`transform` (plus the `Readable`, `Writable` and `Transform` types).

`collect` returns a `Promise of text`; `writeAll` returns `Promise of nothing`.
`pipeline` connects two streams and resolves with the destination.

### `std/worker` — worker threads

`runInWorker`, `workerMain`, `isMainThread`, `threadId`. A worker module is loaded
by its compiled JavaScript path, so build the project before starting a worker
in production.

### `std/net` — TCP and UDP sockets

`connectTcp`, `listenTcp`, `sendUdp`, `listenUdp`. TCP sockets expose `write`,
`end`, `destroy` and event handlers; the server calls a handler for each
connection.

## Platform boundaries

`std/worker` and `std/net` require Node.js; they are not available in the
browser. `std/process`, `std/crypto` and `std/compress` are Node-backed too.
Browser builds should stay on `std/io`, `std/http`, `std/ws`, `std/json`,
`std/list`, `std/map`, `std/math`, `std/text`, `std/time`, `std/task`,
`std/contract` and `std/iter`.
