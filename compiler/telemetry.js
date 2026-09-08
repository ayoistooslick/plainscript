// compiler/telemetry.js
// Headless, zero-dependency, non-blocking telemetry engine for PlainScript.
// Captures anonymous CLI usage data and compiler diagnostics to PostHog.

const https = require('node:https');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { VERSION } = require('./version');

const POSTHOG_HOST = process.env.PLAINSCRIPT_POSTHOG_HOST || 'https://eu.i.posthog.com';
const POSTHOG_KEY = process.env.PLAINSCRIPT_POSTHOG_KEY || 'phc_wNiRBPnB8Dbphzpc8CAHCaBPfRU96mYEZcu7YgEpJjkd';

let _distinctId = null;

function isTelemetryEnabled() {
  if (process.env.DO_NOT_TRACK === '1') return false;
  if (process.env.PLAINSCRIPT_TELEMETRY === '0') return false;
  return true;
}

function getDistinctId() {
  if (_distinctId) return _distinctId;
  try {
    const configDir = path.join(os.homedir(), '.plainscript');
    const idFile = path.join(configDir, 'anonymous_id');
    if (fs.existsSync(idFile)) {
      _distinctId = fs.readFileSync(idFile, 'utf8').trim();
      if (_distinctId) return _distinctId;
    }
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    _distinctId = crypto.randomUUID();
    fs.writeFileSync(idFile, _distinctId, 'utf8');
    return _distinctId;
  } catch {
    _distinctId = _distinctId || crypto.randomUUID();
    return _distinctId;
  }
}

const pendingRequests = new Set();

/**
 * Dispatches an event payload to PostHog asynchronously.
 * Guarantees zero blocking on CLI exit by unreferencing request sockets.
 */
function sendEvent(event, properties = {}) {
  if (!isTelemetryEnabled()) return Promise.resolve(false);

  return new Promise((resolve) => {
    try {
      const distinctId = getDistinctId();
      const payload = JSON.stringify({
        api_key: POSTHOG_KEY,
        event,
        distinct_id: distinctId,
        properties: {
          $lib: 'plainscript-cli',
          $lib_version: VERSION,
          $os: os.platform(),
          $os_version: os.release(),
          $arch: os.arch(),
          node_version: process.version,
          ...properties
        }
      });

      const url = new URL('/capture/', POSTHOG_HOST);
      const req = https.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 1500
      }, (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      });

      pendingRequests.add(req);
      const cleanup = () => pendingRequests.delete(req);
      req.on('close', cleanup);
      req.on('error', (err) => { cleanup(); resolve(false); });
      req.on('timeout', () => {
        req.destroy();
        cleanup();
        resolve(false);
      });

      if (req.socket) req.socket.unref();
      req.on('socket', (socket) => socket.unref());

      req.write(payload);
      req.end();
    } catch {
      resolve(false);
    }
  });
}

function flush(timeoutMs = 300) {
  if (pendingRequests.size === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const checkInterval = setInterval(() => {
      if (pendingRequests.size === 0) {
        clearInterval(checkInterval);
        clearTimeout(timer);
        resolve();
      }
    }, 25);
  });
}

function trackCommand(command, durationMs, success = true, extraProps = {}) {
  return sendEvent('cli_command_executed', {
    command,
    duration_ms: Math.round(durationMs),
    success: Boolean(success),
    ...extraProps
  });
}

function trackError(command, errorCode, lineCount = 0, extraProps = {}) {
  return sendEvent('compilation_failed', {
    command,
    error_code: String(errorCode || 'UNKNOWN_ERROR'),
    line_count: Number(lineCount) || 0,
    ...extraProps
  });
}

module.exports = {
  isTelemetryEnabled,
  getDistinctId,
  sendEvent,
  flush,
  trackCommand,
  trackError,
  POSTHOG_HOST,
  POSTHOG_KEY
};
