'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const load = (name) => import(pathToFileURL(path.join(ROOT, 'stdlib', name)).toString());

function fakeOidc(overrides = {}) {
  const calls = { grants: [], refreshes: [], credentials: [] };
  const library = {
    async discovery(issuer, clientId, clientSecret, options) {
      calls.discovery = { issuer: issuer.href, clientId, clientSecret, options };
      return { issuer: issuer.href, clientId };
    },
    randomState: () => 'state-123',
    randomNonce: () => 'nonce-456',
    randomPKCECodeVerifier: () => 'verifier-789',
    async calculatePKCECodeChallenge() { return 'challenge-abc'; },
    buildAuthorizationUrl(client, params) {
      const url = new URL('https://idp.example/authorize');
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      return url;
    },
    async authorizationCodeGrant(client, callbackUrl, checks) {
      calls.grants.push({ client, callbackUrl: callbackUrl.href, checks });
      const claims = overrides.claims || {
        iss: 'https://idp.example', aud: 'client-id', sub: 'user-1',
        exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000), nonce: 'nonce-456',
      };
      return { claims: () => claims, access_token: 'access-token', id_token: 'id-token', refresh_token: 'refresh-token', expiresIn: 300 };
    },
    async refreshTokenGrant(client, refreshToken) {
      calls.refreshes.push({ client, refreshToken });
      return { access_token: 'new-access', refresh_token: 'new-refresh', expiresIn: 60 };
    },
    async clientCredentialsGrant(client, scope) {
      calls.credentials.push({ client, scope });
      return { access_token: 'service-token', expiresIn: 60 };
    },
  };
  return { library, calls };
}

test('OIDC authorization-code + PKCE flow validates state and nonce and returns tokens', async () => {
  const oidc = await load('oidc.js');
  const { library, calls } = fakeOidc();
  const connection = await oidc.createClient({
    issuer: 'https://idp.example', clientId: 'client-id', clientSecret: 'secret', redirectUri: 'https://app.example/callback',
  }, library);
  assert.equal(connection.config.issuer, 'https://idp.example');
  const login = await oidc.beginLogin(connection, { prompt: 'login' });
  assert.equal(login.session.state, 'state-123');
  assert.equal(login.session.nonce, 'nonce-456');
  assert.equal(login.session.codeVerifier, 'verifier-789');
  assert.match(login.url, /code_challenge=challenge-abc/);
  assert.match(login.url, /state=state-123/);
  const callback = 'https://app.example/callback?code=auth-code&state=state-123';
  const result = await oidc.completeLogin(connection, callback, login.session);
  assert.equal(result.claims.sub, 'user-1');
  assert.equal(result.accessToken, 'access-token');
  assert.equal(calls.grants.length, 1);
  assert.deepEqual(calls.grants[0].checks, { expectedState: 'state-123', expectedNonce: 'nonce-456', pkceCodeVerifier: 'verifier-789' });
  await assert.rejects(oidc.completeLogin(connection, 'https://app.example/callback?code=x&state=wrong', login.session), /state/);
  const refreshed = await oidc.refreshAccessToken(connection, 'refresh-token');
  assert.equal(refreshed.accessToken, 'new-access');
  const service = await oidc.clientCredentials(connection, 'read');
  assert.equal(service.accessToken, 'service-token');
});

test('OIDC rejects mismatched nonce, expired tokens, wrong issuer/audience and insecure configuration', async () => {
  const oidc = await load('oidc.js');
  const { library } = fakeOidc({ claims: {
    iss: 'https://idp.example', aud: ['other-client'], sub: 'user-1',
    exp: Math.floor(Date.now() / 1000) - 1, iat: Math.floor(Date.now() / 1000), nonce: 'wrong',
  } });
  const connection = await oidc.createClient({
    issuer: 'https://idp.example', clientId: 'client-id', redirectUri: 'https://app.example/callback',
  }, library);
  const login = await oidc.beginLogin(connection);
  await assert.rejects(
    oidc.completeLogin(connection, 'https://app.example/callback?code=x&state=state-123', login.session),
    /audience|expired/,
  );
  const base = { iss: 'https://idp.example', aud: 'client-id', exp: Math.floor(Date.now() / 1000) + 300, nonce: 'nonce-456' };
  assert.equal(oidc.validateClaims({ ...base, nonce: 'bad' }, connection.config, { nonce: 'nonce-456' }).valid, false);
  assert.equal(oidc.validateClaims({ ...base, iss: 'https://evil.example' }, connection.config, { nonce: 'nonce-456' }).valid, false);
  await assert.rejects(oidc.createClient({ issuer: 'http://idp.example', clientId: 'x', redirectUri: 'https://app.example/cb' }, library), /HTTPS/);
  await assert.rejects(oidc.beginLogin(connection, { extraParams: { state: 'attacker' } }), /security parameter/);
  assert.equal(oidc.validateClaims({ ...base, aud: ['client-id', 'other-client'], azp: 'other-client' }, connection.config, { nonce: 'nonce-456' }).valid, false);
});

function fakeSaml() {
  const calls = { constructed: null, validated: [] };
  class FakeSAML {
    constructor(options) { calls.constructed = options; }
    async getAuthorizeUrlAsync(relayState, host, options) {
      calls.login = { relayState, host, options };
      return `https://idp.example/sso?RelayState=${encodeURIComponent(relayState)}`;
    }
    async validatePostResponseAsync(payload) {
      calls.validated.push(payload);
      return { profile: { nameID: 'user@example.com', attributes: { email: ['user@example.com'] }, sessionIndex: 'session-1' } };
    }
    generateServiceProviderMetadata(decryptionCert, signingCert) {
      calls.metadata = { decryptionCert, signingCert };
      return '<EntityDescriptor />';
    }
    async getLogoutUrlAsync(profile, relayState) {
      calls.logout = { profile, relayState };
      return 'https://idp.example/logout';
    }
  }
  return { library: { SAML: FakeSAML }, calls };
}

test('SAML service-provider flow checks RelayState and requires POST callbacks', async () => {
  const saml = await load('saml.js');
  const { library, calls } = fakeSaml();
  const connection = await saml.createServiceProvider({
    entryPoint: 'https://idp.example/sso', issuer: 'https://app.example/metadata', callbackUrl: 'https://app.example/saml/callback', idpCert: 'certificate',
  }, library);
  const login = await saml.beginLogin(connection);
  assert.match(login.url, /RelayState=/);
  assert.equal(calls.constructed.wantAssertionsSigned, true);
  const result = await saml.validateCallback(connection, {
    method: 'POST',
    body: { SAMLResponse: '<Response />', RelayState: login.relayState },
  }, login.session);
  assert.equal(result.nameID, 'user@example.com');
  assert.equal(result.sessionIndex, 'session-1');
  assert.equal(calls.validated.length, 1);
  await assert.rejects(saml.validateCallback(connection, { method: 'POST', body: { SAMLResponse: '<Response />', RelayState: 'wrong' } }, login.session), /RelayState/);
  await assert.rejects(saml.validateCallback(connection, { method: 'GET', query: { SAMLResponse: '<Response />' } }, login.session), /POST/);
  assert.match(saml.metadata(connection), /EntityDescriptor/);
  assert.equal(await saml.beginLogout(connection, result.profile), 'https://idp.example/logout');
  await assert.rejects(saml.createServiceProvider({
    entryPoint: 'http://idp.example/sso', issuer: 'https://app.example', callbackUrl: 'https://app.example/cb', idpCert: 'cert',
  }, library), /HTTPS/);
  await assert.rejects(saml.createServiceProvider({
    entryPoint: 'https://idp.example/sso', issuer: 'https://app.example', callbackUrl: 'https://app.example/cb', idpCert: 'cert',
    extra: { wantAssertionsSigned: false },
  }, library), /security option/);
});
