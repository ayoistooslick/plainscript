'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

async function auth() {
  return import(pathToFileURL(path.join(ROOT, 'stdlib', 'auth.js')).toString());
}

test('passwords are salted, hashed and verified without exposing plaintext', async () => {
  const module = await auth();
  const first = await module.hashPassword('correct horse battery staple');
  const second = await module.hashPassword('correct horse battery staple');
  assert.notEqual(first, second);
  assert.equal(await module.verifyPassword('correct horse battery staple', first), true);
  assert.equal(await module.verifyPassword('wrong', first), false);
  assert.equal(await module.verifyPassword('anything', 'not-a-hash'), false);
  assert.equal(await module.verifyPassword('anything', 'scrypt$bad$params$here$x$y'), false);
});

test('signed tokens validate claims, expiry, issuer, audience and tampering', async () => {
  const module = await auth();
  const secret = 'a sufficiently long test secret';
  const token = module.signToken({ sub: 'user-1', role: 'admin' }, secret, {
    expiresIn: 60,
    issuer: 'plainscript-tests',
    audience: 'api',
  });
  const valid = module.verifyToken(token, secret, { issuer: 'plainscript-tests', audience: 'api' });
  assert.equal(valid.valid, true);
  assert.equal(valid.payload.sub, 'user-1');

  const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
  assert.equal(module.verifyToken(tampered, secret).valid, false);
  assert.equal(module.verifyToken(token, 'another sufficiently long secret').valid, false);
  assert.equal(module.verifyToken(token, secret, { issuer: 'other' }).valid, false);
  assert.equal(module.verifyToken(token, secret, { audience: 'other' }).valid, false);

  const expired = module.signToken({ sub: 'old' }, secret, { expiresIn: -1 });
  assert.match(module.verifyToken(expired, secret).error, /expired/);
  assert.throws(() => module.signToken({}, 'short'), /at least 16/);
});

test('bearer extraction, policies and roles work with plain headers and Headers objects', async () => {
  const module = await auth();
  const token = module.signToken({ sub: 'u1' }, 'a sufficiently long test secret');
  assert.equal(module.bearer({ headers: { Authorization: `Bearer ${token}` } }), token);
  assert.equal(module.bearer({ headers: new Headers({ authorization: `Bearer ${token}` }) }), token);
  assert.equal(module.bearer({ headers: {} }), null);
  assert.throws(
    () => module.requireBearer({ headers: { authorization: 'Basic abc' } }, 'a sufficiently long test secret'),
    (error) => error.code === 'UNAUTHENTICATED',
  );
  const adminOnly = module.policy(async (context) => module.hasRole(context, 'admin'));
  assert.equal(await module.authorize(adminOnly, { user: { role: 'admin' } }), true);
  assert.equal(await module.authorize(adminOnly, { user: { role: 'member' } }), false);
  await assert.rejects(module.enforce(adminOnly, { user: { role: 'member' } }), /authorization denied/);
});
