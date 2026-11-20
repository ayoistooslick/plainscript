// SAML 2.0 service-provider integration built on @node-saml/node-saml.
//
// The library performs XML-DSig verification, assertion-condition and audience
// validation. PlainScript validates the callback shape and RelayState and
// returns a profile; applications remain responsible for mapping the NameID to
// a local user and creating an authenticated session.

import { randomBytes } from 'node:crypto';

export class SamlError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = 'SamlError';
    this.code = code;
    this.cause = cause;
  }
}

function requireHttps(value, name) {
  let url;
  try { url = new URL(value); } catch (cause) {
    throw new SamlError('INVALID_CONFIG', `${name} must be an absolute URL`, cause);
  }
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new SamlError('INVALID_CONFIG', `${name} must use HTTPS (HTTP is allowed only for loopback development)`);
  }
  return url;
}

function validateConfig(options) {
  if (!options || typeof options !== 'object') throw new SamlError('INVALID_CONFIG', 'SAML configuration is required');
  if (!options.entryPoint) throw new SamlError('INVALID_CONFIG', 'entryPoint is required');
  if (!options.issuer) throw new SamlError('INVALID_CONFIG', 'issuer (Service Provider entity ID) is required');
  if (!options.callbackUrl) throw new SamlError('INVALID_CONFIG', 'callbackUrl is required');
  requireHttps(options.entryPoint, 'entryPoint');
  requireHttps(options.callbackUrl, 'callbackUrl');
  if (!options.idpCert) {
    throw new SamlError('INVALID_CONFIG', 'idpCert (identity-provider signing certificate) is required; cert is for this service provider');
  }
  const extra = options.extra || {};
  const reserved = [
    'entryPoint', 'issuer', 'callbackUrl', 'idpCert', 'cert', 'privateKey', 'decryptionPvk',
    'identifierFormat', 'acceptedClockSkewMs', 'wantAssertionsSigned', 'wantAuthnResponseSigned',
    'signatureAlgorithm', 'digestAlgorithm',
  ];
  for (const name of reserved) {
    if (Object.hasOwn(extra, name)) {
      throw new SamlError('INVALID_CONFIG', `extra must not override the security option "${name}"`);
    }
  }
  return {
    entryPoint: options.entryPoint,
    issuer: options.issuer,
    callbackUrl: options.callbackUrl,
    idpCert: options.idpCert,
    cert: options.cert,
    privateKey: options.privateKey,
    decryptionPvk: options.decryptionPvk,
    identifierFormat: options.identifierFormat,
    acceptedClockSkewMs: options.acceptedClockSkewMs === undefined ? 5000 : options.acceptedClockSkewMs,
    wantAssertionsSigned: options.wantAssertionsSigned !== false,
    wantAuthnResponseSigned: options.wantAuthnResponseSigned !== false,
    signatureAlgorithm: options.signatureAlgorithm || 'sha256',
    digestAlgorithm: options.digestAlgorithm || 'sha256',
    ...extra,
  };
}

async function loadLibrary(injected) {
  if (injected) return injected.default || injected;
  try {
    return await import('@node-saml/node-saml');
  } catch (cause) {
    throw new SamlError('MISSING_DEPENDENCY', 'the SAML adapter requires the "@node-saml/node-saml" package', cause);
  }
}

export async function createServiceProvider(options = {}, library = null) {
  const config = validateConfig(options);
  const samlLibrary = await loadLibrary(library);
  const SamlClass = samlLibrary.SAML || samlLibrary.default?.SAML;
  if (typeof SamlClass !== 'function') throw new SamlError('LIBRARY_VERSION', '@node-saml/node-saml does not expose a SAML class');
  try {
    const saml = new SamlClass({ ...config, callbackUrl: config.callbackUrl });
    return { config, saml, library: samlLibrary };
  } catch (cause) {
    throw new SamlError('INITIALIZATION_FAILED', 'could not initialize the SAML service provider', cause);
  }
}

// Returns an AuthnRequest URL and the RelayState to store in the pre-login
// session. The caller must verify that RelayState on the callback.
export async function beginLogin(connection, options = {}) {
  const { config, saml } = connection;
  const relayState = options.relayState || randomBytes(24).toString('base64url');
  if (typeof saml.getAuthorizeUrlAsync !== 'function') throw new SamlError('LIBRARY_VERSION', 'the SAML library does not expose getAuthorizeUrlAsync()');
  try {
    const url = await saml.getAuthorizeUrlAsync(relayState, options.host || new URL(config.callbackUrl).host, options.authnRequest || {});
    return { url, relayState, session: { relayState, createdAt: Date.now() } };
  } catch (cause) {
    throw new SamlError('AUTHORIZATION_URL_FAILED', 'could not build the SAML AuthnRequest URL', cause);
  }
}

// Validates an HTTP-POST SAML response. GET callbacks are rejected because the
// POST binding carries the signed assertion; accepting either silently would
// weaken the protocol contract.
export async function validateCallback(connection, request, session = null) {
  if (!request || typeof request !== 'object') throw new SamlError('INVALID_CALLBACK', 'request is required');
  const method = String(request.method || 'POST').toUpperCase();
  if (method !== 'POST') throw new SamlError('INVALID_CALLBACK', 'SAML responses must use the HTTP-POST binding');
  const body = request.body || {};
  const response = body.SAMLResponse;
  if (!response || typeof response !== 'string') throw new SamlError('INVALID_CALLBACK', 'SAMLResponse is missing');
  const relayState = body.RelayState || '';
  if (session && session.relayState && relayState !== session.relayState) {
    throw new SamlError('RELAY_STATE_MISMATCH', 'SAML RelayState does not match the login session');
  }
  const { saml } = connection;
  if (typeof saml.validatePostResponseAsync !== 'function') throw new SamlError('LIBRARY_VERSION', 'the SAML library does not expose validatePostResponseAsync()');
  let result;
  try {
    result = await saml.validatePostResponseAsync({ SAMLResponse: response, RelayState: relayState });
  } catch (cause) {
    throw new SamlError('ASSERTION_INVALID', 'SAML assertion validation failed', cause);
  }
  if (!result || !result.profile) throw new SamlError('ASSERTION_INVALID', 'SAML assertion did not contain a profile');
  return {
    profile: result.profile,
    nameID: result.profile.nameID || result.profile.nameId || null,
    attributes: result.profile.attributes || {},
    sessionIndex: result.profile.sessionIndex || result.profile.session_index || null,
  };
}

export function metadata(connection, options = {}) {
  const { saml } = connection;
  if (typeof saml.generateServiceProviderMetadata !== 'function') throw new SamlError('LIBRARY_VERSION', 'the SAML library does not expose generateServiceProviderMetadata()');
  try {
    return saml.generateServiceProviderMetadata(options.decryptionCert || null, options.signingCert || null);
  } catch (cause) {
    throw new SamlError('METADATA_FAILED', 'could not generate SAML service-provider metadata', cause);
  }
}

export async function beginLogout(connection, profile, options = {}) {
  const { saml } = connection;
  if (typeof saml.getLogoutUrlAsync !== 'function') throw new SamlError('LIBRARY_VERSION', 'the SAML library does not expose getLogoutUrlAsync()');
  try {
    return await saml.getLogoutUrlAsync(profile || {}, options.relayState || '', options.options || {});
  } catch (cause) {
    throw new SamlError('LOGOUT_URL_FAILED', 'could not build the SAML logout URL', cause);
  }
}
