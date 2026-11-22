// Cryptography uses Node's audited OpenSSL bindings. Ciphertext is a
// self-describing base64 envelope: salt(16) || iv(12) || tag(16) || body.
// Passwords are stretched with scrypt; keys never leave this module as bytes.

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function algorithmName(name) {
  const value = String(name).toLowerCase();
  const allowed = ['sha1', 'sha256', 'sha384', 'sha512', 'md5'];
  if (!allowed.includes(value)) throw new Error(`Unsupported digest algorithm "${name}".`);
  return value;
}

export function digest(algorithm, text) {
  return crypto.createHash(algorithmName(algorithm)).update(text, 'utf8').digest('hex');
}

export function sha256(text) { return digest('sha256', text); }
export function sha512(text) { return digest('sha512', text); }
export function sha1(text) { return digest('sha1', text); }

export function hmac(algorithm, secret, text) {
  return crypto.createHmac(algorithmName(algorithm), secret).update(text, 'utf8').digest('hex');
}

export function hmacSha256(secret, text) { return hmac('sha256', secret, text); }

export function randomBytes(count) {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('std/crypto.randomBytes: count must be a non-negative integer');
  return Array.from(crypto.randomBytes(count));
}

export function randomText(count) {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('std/crypto.randomText: count must be a non-negative integer');
  return crypto.randomBytes(count).toString('base64url').slice(0, count);
}

export function randomUUID() { return crypto.randomUUID(); }

export function base64Encode(text) { return Buffer.from(text, 'utf8').toString('base64'); }

export function base64Decode(text) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(String(text).trim())) {
    throw new Error('Invalid base64 input.');
  }
  return Buffer.from(text, 'base64').toString('utf8');
}

export function hexEncode(text) { return Buffer.from(text, 'utf8').toString('hex'); }

export function hexDecode(text) {
  if (!/^[0-9a-fA-F]*$/.test(text) || text.length % 2 !== 0) {
    throw new Error('Invalid hexadecimal input.');
  }
  return Buffer.from(text, 'hex').toString('utf8');
}

export function timingSafeEqual(left, right) {
  // Hash both values first so the comparison is constant-time even when the
  // inputs have different lengths, which crypto.timingSafeEqual rejects.
  const a = crypto.createHash('sha256').update(String(left), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(right), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

export function pbkdf2(password, salt, iterations, length = 32) {
  if (!Number.isInteger(iterations) || iterations < 1) throw new RangeError('std/crypto.pbkdf2: iterations must be a positive integer');
  if (!Number.isInteger(length) || length < 1 || length > 1024) throw new RangeError('std/crypto.pbkdf2: length must be between 1 and 1024');
  return crypto.pbkdf2Sync(password, salt, iterations, length, 'sha256').toString('hex');
}

export function deriveKey(password, salt, length = 32) {
  return crypto.scryptSync(password, salt, length).toString('hex');
}

export function encrypt(plaintext, password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, body]).toString('base64');
}

export function decrypt(ciphertext, password) {
  let envelope;
  try {
    envelope = Buffer.from(ciphertext, 'base64');
  } catch {
    throw new Error('Invalid encrypted payload.');
  }
  if (envelope.length < SALT_BYTES + IV_BYTES + TAG_BYTES) {
    throw new Error('Encrypted payload is truncated.');
  }
  const salt = envelope.subarray(0, SALT_BYTES);
  const iv = envelope.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const tag = envelope.subarray(SALT_BYTES + IV_BYTES, SALT_BYTES + IV_BYTES + TAG_BYTES);
  const body = envelope.subarray(SALT_BYTES + IV_BYTES + TAG_BYTES);
  const key = crypto.scryptSync(password, salt, 32);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Decryption failed: the payload or password is wrong.');
  }
}
