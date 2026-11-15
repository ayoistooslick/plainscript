// Standard library: std/test
// A deliberately small test runner. Tests register with `test()` and run in
// order once the importing module has finished evaluating.
import process from 'node:process';

const registered = [];
let scheduled = false;
let failures = 0;
let passed = 0;

function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(async () => {
    while (registered.length) {
      const entry = registered.shift();
      try {
        await entry.body();
        passed += 1;
        process.stdout.write(`ok  ${entry.name}\n`);
      } catch (failure) {
        failures += 1;
        process.stdout.write(`FAIL ${entry.name}\n     ${failure && failure.message ? failure.message : String(failure)}\n`);
      }
    }
    process.stdout.write(`\n${passed} passed, ${failures} failed\n`);
    if (failures > 0) process.exitCode = 1;
  });
}

export function test(name, body) {
  registered.push({ name, body });
  schedule();
}

export function equals(actual, expected, message) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(message || `expected ${right}, got ${left}`);
  }
}

export function isTrue(value, message) {
  if (value !== true) throw new Error(message || `expected true, got ${JSON.stringify(value)}`);
}

export function isFalse(value, message) {
  if (value !== false) throw new Error(message || `expected false, got ${JSON.stringify(value)}`);
}

export function contains(haystack, needle, message) {
  const found = typeof haystack === 'string' ? haystack.includes(needle) : haystack.includes(needle);
  if (!found) throw new Error(message || `expected ${JSON.stringify(haystack)} to contain ${JSON.stringify(needle)}`);
}

export function throws(body, messagePart) {
  try {
    body();
  } catch (failure) {
    const message = failure && failure.message ? failure.message : String(failure);
    if (messagePart && !message.includes(messagePart)) {
      throw new Error(`expected error containing ${JSON.stringify(messagePart)}, got ${JSON.stringify(message)}`);
    }
    return;
  }
  throw new Error('expected the function to throw');
}

export async function rejects(body, messagePart) {
  try {
    await body();
  } catch (failure) {
    const message = failure && failure.message ? failure.message : String(failure);
    if (messagePart && !messagePart.includes(messagePart)) {
      throw new Error(`expected rejection containing ${JSON.stringify(messagePart)}, got ${JSON.stringify(message)}`);
    }
    return;
  }
  throw new Error('expected the function to reject');
}

export function fail(message) {
  throw new Error(message || 'explicit failure');
}
