// OpenID Connect / OAuth 2.0 helpers built on openid-client.
//
// PlainScript owns configuration validation, state/nonce/PKCE plumbing and
// claim checks. openid-client owns discovery, protocol messages, token
// exchange, signature verification and provider-specific response handling.
// Applications own the user/session store, cookie flags and authorization
// policy after the identity is established.

import { createHash } from 'node:crypto';

export class OidcError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = 'OidcError';
    this.code = code;
    this.cause = cause;
  }
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function secureUrl(value, name) {
  let url;
  try { url = new URL(value); } catch (cause) {
    throw new OidcError('INVALID_CONFIG', `${name} must be an absolute URL`, cause);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new OidcError('INVALID_CONFIG', `${name} must use HTTPS (HTTP is allowed only for loopback development)`);
  }
  return url;
}

function validateConfig(options) {
  if (!options || typeof options !== 'object') throw new OidcError('INVALID_CONFIG', 'OIDC configuration is required');
  if (!options.issuer) throw new OidcError('INVALID_CONFIG', 'issuer is required');
  if (!options.clientId) throw new OidcError('INVALID_CONFIG', 'clientId is required');
  if (!options.redirectUri) throw new OidcError('INVALID_CONFIG', 'redirectUri is required');
  secureUrl(options.issuer, 'issuer');
  secureUrl(options.redirectUri, 'redirectUri');
  return {
    issuer: String(options.issuer).replace(/\/$/, ''),
    clientId: String(options.clientId),
    clientSecret: options.clientSecret ? String(options.clientSecret) : undefined,
    redirectUri: String(options.redirectUri),
    scopes: options.scopes || 'openid profile email',
    clockTolerance: Number(options.clockTolerance) || 60,
    clientOptions: options.clientOptions || {},
  };
}

async function loadLibrary(injected) {
  if (injected) return injected.default || injected;
  try {
    return await import('openid-client');
  } catch (cause) {
    throw new OidcError('MISSING_DEPENDENCY', 'the OIDC adapter requires the "openid-client" package', cause);
  }
}

function randomValue(client, name) {
  const fn = client[name];
  if (typeof fn !== 'function') throw new OidcError('LIBRARY_VERSION', `openid-client does not expose ${name}()`);
  return fn();
}

export async function createClient(options = {}, library = null) {
  const config = validateConfig(options);
  const oidc = await loadLibrary(library);
  if (typeof oidc.discovery !== 'function') throw new OidcError('LIBRARY_VERSION', 'openid-client does not expose discovery()');
  try {
    const client = await oidc.discovery(
      new URL(config.issuer),
      config.clientId,
      config.clientSecret,
      config.clientOptions,
    );
    return { config, client, library: oidc };
  } catch (cause) {
    throw new OidcError('DISCOVERY_FAILED', `OIDC discovery failed for ${config.issuer}`, cause);
  }
}

// Creates a login URL plus the server-side values the application must keep in
// its session before redirecting the browser. Never put the verifier in a URL.
export async function beginLogin(connection, options = {}) {
  const { config, client, library } = connection;
  const state = options.state || randomValue(library, 'randomState');
  const nonce = options.nonce || randomValue(library, 'randomNonce');
  const codeVerifier = options.codeVerifier || randomValue(library, 'randomPKCECodeVerifier');
  const codeChallenge = options.codeChallenge || (typeof library.calculatePKCECodeChallenge === 'function'
    ? await library.calculatePKCECodeChallenge(codeVerifier)
    : createHash('sha256').update(codeVerifier).digest('base64url'));
  const extraParams = options.extraParams || {};
  const reserved = ['redirect_uri', 'scope', 'state', 'nonce', 'code_challenge', 'code_challenge_method'];
  for (const name of reserved) {
    if (Object.hasOwn(extraParams, name)) {
      throw new OidcError('INVALID_CONFIG', `extraParams must not override the security parameter "${name}"`);
    }
  }
  const params = {
    redirect_uri: config.redirectUri,
    scope: options.scope || config.scopes,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    ...(options.prompt ? { prompt: options.prompt } : {}),
    ...(options.loginHint ? { login_hint: options.loginHint } : {}),
    ...extraParams,
  };
  if (typeof library.buildAuthorizationUrl !== 'function') {
    throw new OidcError('LIBRARY_VERSION', 'openid-client does not expose buildAuthorizationUrl()');
  }
  let url;
  try {
    url = library.buildAuthorizationUrl(client, params);
  } catch (cause) {
    throw new OidcError('AUTHORIZATION_URL_FAILED', 'could not build the OIDC authorization URL', cause);
  }
  return {
    url: url instanceof URL ? url.href : String(url),
    session: { state, nonce, codeVerifier, redirectUri: config.redirectUri, createdAt: Date.now() },
  };
}

function claimAudience(claims, clientId) {
  const audience = claims && claims.aud;
  if (Array.isArray(audience)) {
    if (!audience.includes(clientId)) return false;
    // OIDC Core 3.1.3.7: when the audience has multiple values, azp identifies
    // the party the token was issued to and must match this client.
    return audience.length === 1 || claims.azp === clientId;
  }
  return audience === clientId;
}

export function validateClaims(claims, config, expected = {}) {
  if (!claims || typeof claims !== 'object') return { valid: false, error: 'missing ID token claims' };
  if (claims.iss !== config.issuer) return { valid: false, error: 'ID token issuer mismatch' };
  if (!claimAudience(claims, config.clientId)) return { valid: false, error: 'ID token audience mismatch' };
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + config.clockTolerance < now) return { valid: false, error: 'ID token expired' };
  if (typeof claims.iat === 'number' && claims.iat > now + config.clockTolerance) return { valid: false, error: 'ID token issued in the future' };
  if (expected.nonce && claims.nonce !== expected.nonce) return { valid: false, error: 'ID token nonce mismatch' };
  if (expected.subject && claims.sub !== expected.subject) return { valid: false, error: 'ID token subject mismatch' };
  return { valid: true, error: null };
}

// Completes the authorization-code flow. `callbackUrl` must be the exact URL
// the identity provider redirected to, including code and state.
export async function completeLogin(connection, callbackUrl, session) {
  if (!session || !session.state || !session.nonce || !session.codeVerifier) {
    throw new OidcError('INVALID_SESSION', 'the login session is missing state, nonce, or PKCE verifier');
  }
  let url;
  try { url = new URL(String(callbackUrl)); } catch (cause) {
    throw new OidcError('INVALID_CALLBACK', 'callbackUrl must be an absolute URL', cause);
  }
  if (url.searchParams.get('state') !== session.state) throw new OidcError('STATE_MISMATCH', 'OIDC state does not match the login session');
  if (!url.searchParams.get('code')) throw new OidcError('MISSING_CODE', 'OIDC callback has no authorization code');
  const { config, client, library } = connection;
  let tokens;
  try {
    tokens = await library.authorizationCodeGrant(
      client,
      url,
      { expectedState: session.state, expectedNonce: session.nonce, pkceCodeVerifier: session.codeVerifier },
      { redirect_uri: config.redirectUri },
    );
  } catch (cause) {
    throw new OidcError('TOKEN_EXCHANGE_FAILED', 'OIDC authorization-code exchange failed', cause);
  }
  let claims;
  try {
    claims = typeof tokens.claims === 'function' ? tokens.claims() : tokens.claims;
  } catch (cause) {
    throw new OidcError('INVALID_ID_TOKEN', 'the ID token has no readable claims', cause);
  }
  const check = validateClaims(claims, config, { nonce: session.nonce });
  if (!check.valid) throw new OidcError('INVALID_ID_TOKEN', check.error);
  return {
    claims,
    accessToken: tokens.access_token || tokens.accessToken || null,
    idToken: tokens.id_token || tokens.idToken || null,
    refreshToken: tokens.refresh_token || tokens.refreshToken || null,
    expiresAt: typeof tokens.expiresIn === 'number' ? Date.now() + tokens.expiresIn * 1000 : null,
  };
}

export async function refreshAccessToken(connection, refreshToken) {
  if (!refreshToken) throw new OidcError('MISSING_REFRESH_TOKEN', 'refreshToken is required');
  const { client, library } = connection;
  if (typeof library.refreshTokenGrant !== 'function') throw new OidcError('LIBRARY_VERSION', 'openid-client does not expose refreshTokenGrant()');
  try {
    const tokens = await library.refreshTokenGrant(client, refreshToken);
    return { accessToken: tokens.access_token || tokens.accessToken || null, refreshToken: tokens.refresh_token || refreshToken, expiresAt: typeof tokens.expiresIn === 'number' ? Date.now() + tokens.expiresIn * 1000 : null };
  } catch (cause) {
    throw new OidcError('REFRESH_FAILED', 'OIDC token refresh failed', cause);
  }
}

export async function clientCredentials(connection, scope) {
  const { client, library } = connection;
  if (typeof library.clientCredentialsGrant !== 'function') throw new OidcError('LIBRARY_VERSION', 'openid-client does not expose clientCredentialsGrant()');
  try {
    const tokens = await library.clientCredentialsGrant(client, scope);
    return { accessToken: tokens.access_token || tokens.accessToken || null, expiresAt: typeof tokens.expiresIn === 'number' ? Date.now() + tokens.expiresIn * 1000 : null };
  } catch (cause) {
    throw new OidcError('CLIENT_CREDENTIALS_FAILED', 'OIDC client-credentials grant failed', cause);
  }
}
