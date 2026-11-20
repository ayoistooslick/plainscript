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
  password reset, MFA or user directory. `std/oidc` and `std/saml` are optional
  service-provider helpers, described below; applications still own account linking,
  sessions and authorization.

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

## OIDC and SAML

`std/oidc` wraps `openid-client` and `std/saml` wraps `@node-saml/node-saml`; neither
library is a compiler dependency. Install the relevant package in the application.

- OIDC configuration requires HTTPS (loopback HTTP is allowed only for local development).
  `beginLogin` generates state, nonce and PKCE values; keep the returned session server-side
  and never put the verifier in a URL. `completeLogin` checks state before the code
  exchange, then validates issuer, audience/azp, expiry, nonce and optional subject.
  `extraParams` cannot override state, nonce, PKCE or the redirect URI.
- SAML requires an IdP signing certificate and HTTPS endpoints. `validateCallback` accepts
  only the HTTP-POST binding, verifies the RelayState against the pre-login session, and
  delegates XML signature/assertion validation to `@node-saml/node-saml`. `extra` cannot
  override security-critical options. Applications must still reject replayed assertions,
  map the NameID to a local user and create/rotate their own session.

The repository tests these wrappers with library-shaped fakes. No live identity provider,
protocol conformance suite or browser SSO flow is part of the test environment, so review
provider metadata, clocks, certificate rotation and replay handling before production.

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
SQLite, PostgreSQL and MySQL helpers in `std/db` bind every value; the PostgreSQL adapter
translates `?` placeholders to `$1` parameters outside quoted strings/comments, while MySQL
keeps bound `?` parameters. See [DATABASES](DATABASES.md).

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
- automatic origin checks or authentication for WebSocket upgrades (supply an
  `authorize(request)` callback to `std/ws`; it runs before the handshake).

Put those at a reverse proxy or add explicit middleware. For WebSockets, `std/ws` enforces
client masking, UTF-8 validation for text, a maximum payload (1 MiB by default), fragmented
message assembly, control-frame limits and close/protocol-error handling. Its
`authorize(request)` option runs before the 101 handshake; a rejected upgrade receives 401
and the socket is destroyed. Extensions are not implemented and origin is not enforced by
the library itself; check `Origin` inside the authorize callback when browsers are not the
only client.

## Migrations

`std/db.migrate` applies each migration inside `BEGIN IMMEDIATE`, rolls the whole migration
back on failure, rejects duplicate versions and refuses to apply around a history gap.
`rollback` requires an explicit `down`; a migration without one cannot be reversed. Treat
migration files as production code: review destructive changes, back up data, and test
forward/rollback paths against a copy.

## Background jobs

`std/jobs` schedules in-process and has bounded concurrency, retry backoff, per-job
timeouts and cooperative cancellation. An optional `memoryStore`/`sqliteStore` persists job
records and recovers pending or interrupted work at startup, but there is no cross-process
lease, worker pool or exactly-once delivery. Persist idempotency keys before side effects;
treat a recovered running job as at-least-once. See [JOBS](JOBS.md).

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

No third-party penetration test, SOC 2/ISO certification, live provider conformance,
secret-manager integration, CSRF middleware or enterprise support contract is included.
The authentication, OIDC/SAML wrapper and database modules are suitable building blocks and
are covered by unit/integration tests for their documented behavior; production deployment
still requires application-level review and provider-specific testing.
