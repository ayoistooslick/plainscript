// tests/telemetry.test.js
// Tests for telemetry engine and automatic usage metrics.

const { test, assert } = require('./compat/_util');
const {
  isTelemetryEnabled,
  getDistinctId,
  sendEvent,
  trackCommand,
  trackError,
  flush
} = require('../compiler/telemetry');

test('telemetry: enabled by default', () => {
  const oldDNT = process.env.DO_NOT_TRACK;
  const oldPLN = process.env.PLAINSCRIPT_TELEMETRY;
  delete process.env.DO_NOT_TRACK;
  delete process.env.PLAINSCRIPT_TELEMETRY;

  assert(isTelemetryEnabled() === true, 'telemetry should be enabled by default');

  if (oldDNT !== undefined) process.env.DO_NOT_TRACK = oldDNT;
  if (oldPLN !== undefined) process.env.PLAINSCRIPT_TELEMETRY = oldPLN;
});

test('telemetry: respects DO_NOT_TRACK and PLAINSCRIPT_TELEMETRY flags', () => {
  const oldDNT = process.env.DO_NOT_TRACK;
  const oldPLN = process.env.PLAINSCRIPT_TELEMETRY;

  process.env.DO_NOT_TRACK = '1';
  assert(isTelemetryEnabled() === false, 'DO_NOT_TRACK=1 should disable telemetry');
  delete process.env.DO_NOT_TRACK;

  process.env.PLAINSCRIPT_TELEMETRY = '0';
  assert(isTelemetryEnabled() === false, 'PLAINSCRIPT_TELEMETRY=0 should disable telemetry');

  if (oldDNT !== undefined) process.env.DO_NOT_TRACK = oldDNT;
  else delete process.env.DO_NOT_TRACK;
  if (oldPLN !== undefined) process.env.PLAINSCRIPT_TELEMETRY = oldPLN;
  else delete process.env.PLAINSCRIPT_TELEMETRY;
});

test('telemetry: generates persistent anonymous distinct ID', () => {
  const id1 = getDistinctId();
  const id2 = getDistinctId();
  assert(typeof id1 === 'string' && id1.length > 0, 'distinct id should be a non-empty string');
  assert(id1 === id2, 'distinct id should be persistent across calls');
});

test('telemetry: trackCommand constructs safe event payload', async () => {
  const oldHost = process.env.PLAINSCRIPT_POSTHOG_HOST;
  process.env.PLAINSCRIPT_POSTHOG_HOST = 'https://127.0.0.1:9'; // unreachable mock port

  try {
    const res = await trackCommand('check', 45, true);
    assert(typeof res === 'boolean', 'trackCommand should return boolean');
  } finally {
    if (oldHost !== undefined) process.env.PLAINSCRIPT_POSTHOG_HOST = oldHost;
    else delete process.env.PLAINSCRIPT_POSTHOG_HOST;
  }
});

test('telemetry: trackError safely handles unknown error codes', async () => {
  const oldHost = process.env.PLAINSCRIPT_POSTHOG_HOST;
  process.env.PLAINSCRIPT_POSTHOG_HOST = 'https://127.0.0.1:9';

  try {
    const res = await trackError('build', 'ERR_SYNTAX', 12);
    assert(typeof res === 'boolean', 'trackError should return boolean');
  } finally {
    if (oldHost !== undefined) process.env.PLAINSCRIPT_POSTHOG_HOST = oldHost;
    else delete process.env.PLAINSCRIPT_POSTHOG_HOST;
  }
});
