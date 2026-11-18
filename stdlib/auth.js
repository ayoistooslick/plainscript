// Password hashing, signed bearer tokens and authorization policies.
//
// This module uses only Node's built-in crypto. Tokens are JWT-shaped but are
// intentionally validated locally (HS256, exp/nbf/iss/aud) rather than exposing
// an algorithm-confusion surface. Passwords use scrypt with a random salt.

import { randomBytes, scrypt, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export class AuthError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'AuthError';
    this.code = code;
  }
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64url(value) {
  return Buffer.from(value, 'base64url');
}

function assertSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new AuthError('INVALID_SECRET', 'token secret must be at least 16 characters');
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export async function hashPassword(password, options = {}) {
  if (typeof password !== 'string' || password.length < 1) throw new AuthError('INVALID_PASSWORD', 'password must be non-empty text');
  const N = Math.max(1024, Math.min(1 << 20, Number(options.cost) || 16384));
  const r = Math.max(1, Math.min(32, Number(options.blockSize) || 8));
  const p = Math.max(1, Math.min(16, Number(options.parallelization) || 1));
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64, { N, r, p, maxmem: 128 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || N < 1024 || N > (1 << 20) || r < 1 || r > 32 || p < 1 || p > 16) return false;
  let expected;
  try { expected = fromBase64url(parts[5]); } catch { return false; }
  try {
    const actual = await scryptAsync(password, fromBase64url(parts[4]), expected.length, { N, r, p, maxmem: 128 * 1024 * 1024 });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function signToken(payload, secret, options = {}) {
  assertSecret(secret);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AuthError('INVALID_PAYLOAD', 'token payload must be a record');
  }
  const issuedAt = nowSeconds();
  const claims = { ...payload, iat: issuedAt };
  if (options.expiresIn !== undefined) claims.exp = issuedAt + Math.max(0, Number(options.expiresIn) || 0);
  if (options.notBefore !== undefined) claims.nbf = issuedAt + Math.max(0, Number(options.notBefore) || 0);
  if (options.issuer) claims.iss = options.issuer;
  if (options.audience) claims.aud = options.audience;
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(claims));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token, secret, options = {}) {
  try {
    assertSecret(secret);
    if (typeof token !== 'string') return { valid: false, payload: null, error: 'token is not text' };
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, payload: null, error: 'malformed token' };
    const [headerPart, bodyPart, signaturePart] = parts;
    const header = JSON.parse(fromBase64url(headerPart).toString('utf8'));
    if (!header || header.alg !== 'HS256') return { valid: false, payload: null, error: 'unsupported token algorithm' };
    const expected = createHmac('sha256', secret).update(`${headerPart}.${bodyPart}`).digest();
    const actual = fromBase64url(signaturePart);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { valid: false, payload: null, error: 'invalid token signature' };
    }
    const payload = JSON.parse(fromBase64url(bodyPart).toString('utf8'));
    const now = nowSeconds();
    if (payload.exp !== undefined && (!Number.isFinite(payload.exp) || now >= payload.exp)) {
      return { valid: false, payload: null, error: 'token expired' };
    }
    if (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || now < payload.nbf)) {
      return { valid: false, payload: null, error: 'token not active' };
    }
    if (options.issuer && payload.iss !== options.issuer) return { valid: false, payload: null, error: 'token issuer mismatch' };
    if (options.audience && payload.aud !== options.audience) return { valid: false, payload: null, error: 'token audience mismatch' };
    return { valid: true, payload, error: null };
  } catch {
    return { valid: false, payload: null, error: 'malformed token' };
  }
}

export function bearer(request) {
  if (!request) return null;
  let header = null;
  const headers = request.headers;
  if (headers) {
    if (typeof headers.get === 'function') header = headers.get('authorization');
    else if (typeof headers === 'object') {
      for (const [name, value] of Object.entries(headers)) {
        if (name.toLowerCase() === 'authorization') { header = value; break; }
      }
    }
  }
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export function requireBearer(request, secret, options = {}) {
  const token = bearer(request);
  if (!token) throw new AuthError('UNAUTHENTICATED', 'missing bearer token');
  const check = verifyToken(token, secret, options);
  if (!check.valid) throw new AuthError('UNAUTHENTICATED', check.error || 'invalid bearer token');
  return check.payload;
}

export function policy(callback) {
  if (typeof callback !== 'function') throw new AuthError('INVALID_POLICY', 'policy expects a function');
  return callback;
}

export async function authorize(policyCallback, context, input) {
  if (typeof policyCallback !== 'function') return false;
  return Boolean(await policyCallback(context, input));
}

export async function enforce(policyCallback, context, input) {
  if (!(await authorize(policyCallback, context, input))) {
    throw new AuthError('FORBIDDEN', 'authorization denied');
  }
  return true;
}

export function hasRole(context, role) {
  if (!context || typeof context !== 'object') return false;
  const user = context.user || context;
  return Boolean(user && (user.role === role || (Array.isArray(user.roles) && user.roles.includes(role))));
}
