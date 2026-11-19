# Security and production readiness

PlainScript's security-sensitive standard library is intentionally small. This page states
what is verified, what defaults are safe, and what remains application responsibility.

## Passwords

`std/auth.hashPassword` uses Node `scrypt` with a random 16-byte salt and an encoded
`scrypt$N$r$p$salt$hash` string. `verifyPassword` validates the stored parameters, re-derives
the key and compares with `timingSafeEqual`. Defaults are `N=16384`, `r=8`, `p=1`; the
encoded cost is bounded on both hashing and verification to avoid attacker-controlled
resource exhaustion. Hashes are self-describing, so future cost increases can be rolled out
without invalidating old hashes.

- Never log passwords, hashes or derived keys.
- Use a unique application secret and rate-limit login endpoints at the deployment edge.
- `std/auth` is cryptography, not a complete identity product. There is no account lockout,
  password reset, MFA, OIDC or SAML implementation.

## Tokens

`signToken` creates an HS256 JWT-shaped token with `iat`; `expiresIn`, `notBefore`,
`issuer` and `audience` are optional. `verifyToken`:

- rejects a secret shorter than 16 characters;
- accepts only `alg: "HS256"` and rejects other algorithms before checking a signature;
- checks the HMAC with a constant-time comparison;
- validates `exp`, `nbf`, `iss` and `aud` when configured;
- returns `{ valid, payload, error }` instead of throwing for malformed/expired tokens.

`requireBearer` extracts `Authorization: Bearer …` from a Fetch `Headers` object or a plain
header record and throws `AuthError('UNAUTHENTICATED')` for missing/invalid credentials.
Always pass `issuer` and `audience` when tokens cross services, keep the secret in the
deployment secret store, and rotate it deliberately. There is no revocation list or refresh
token flow; applications that need those must add them.

The contracts demo's fallback `AUTH_SECRET` is a development credential. Production startup
should fail closed when the secret is absent:

```plainscript
let secret = process.env.AUTH_SECRET
if secret == nothing or secret == ""
    throw "AUTH_SECRET is required"
end
```

## Authorization

`std/auth.policy` wraps an authorization callback; `authorize` returns a boolean and
`enforce` throws `AuthError('FORBIDDEN')`. Keep policy checks server-side. Do not send
authorization decisions to the client as a substitute for re-checking them on each request.
`std/contract.implementFallible` accepts an `authorize` callback and validates the input
before invoking it; use that hook for resource ownership checks.

## Input validation and serialization

`std/contract` schemas validate untrusted JSON at HTTP, database and client boundaries.
`object` strips unknown keys by default; `strict` rejects them. `parse` throws a
`ContractError` with a path, so a handler can map it to a 400 without exposing internals.
Do not concatenate untrusted strings into SQL, shell commands, HTML or log format strings.
SQLite helpers in `std/db` bind every value; PostgreSQL/MySQL examples use `$1`/`?`
parameters. See [DATABASES](DATABASES.md).

## HTTP boundaries

`std/http.serve` converts Node requests into Fetch `Request` objects and streams responses.
As of this release, an exception inside a handler returns `500 Internal server error` by
default instead of the exception message. Set `{ exposeErrors: true }` only in local
development. Status codes, auth errors and validation errors are the handler's
responsibility.

Things the server does **not** provide automatically:

- CORS, CSRF protection, request-body size limits, rate limiting or TLS termination;
- security headers (CSP, HSTS, frame ancestors);
- cookies or session management;
- origin checks or authentication for WebSocket upgrades.

Put those at a reverse proxy or add explicit middleware. For WebSockets, `std/ws` enforces
client masking, a maximum payload (1 MiB by default) and close/frame basics, and accepts an
`authorize(request)` option that runs before the 101 handshake. A rejected upgrade receives
401 and the socket is destroyed. It does not implement fragmentation or extensions and does
not enforce origin by itself; check `Origin` inside the authorize callback when browsers are
not the only client.

## Migrations

`std/db.migrate` applies each migration inside `BEGIN IMMEDIATE`, rolls the whole migration
back on failure, rejects duplicate versions and refuses to apply around a history gap.
`rollback` requires an explicit `down`; a migration without one cannot be reversed. Treat
migration files as production code: review destructive changes, back up data, and test
forward/rollback paths against a copy.

## Background jobs

`std/jobs` is in-process. It has bounded concurrency, retry backoff, per-job timeouts and
cooperative cancellation, but no durable storage or cross-process delivery. Persist
idempotency keys before side effects and re-enqueue from the database at startup when work
must survive restarts. See [JOBS](JOBS.md).

## Error information

- API handlers should return stable, typed error codes and generic messages.
- `std/http` no longer echoes exception messages by default.
- `AuthError` messages are intentionally coarse (`missing bearer token`, `invalid bearer
  token`, `authorization denied`) so callers do not learn which check failed.
- Do not include secrets, SQL text or stack traces in client responses or structured logs.

## Dependencies

The compiler and bundled runtime have zero npm dependencies. Application dependencies are
your responsibility: pin versions, run `npm audit` in CI, review install scripts, and keep
database/HTTP drivers current. The repository does not vendor a security scanner.

## What is not claimed

No third-party penetration test, SOC 2/ISO certification, OIDC/SAML compatibility, secret
manager integration, CSRF middleware, or enterprise support contract is included. The
authentication and database modules are suitable building blocks and are covered by unit and
integration tests for their documented behavior; production deployment still requires
application-level review.
