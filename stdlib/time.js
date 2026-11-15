// Standard library: std/time
// All timestamps are Unix milliseconds; ISO strings are UTC.

export function now() {
  return Date.now();
}

export function isoNow() {
  return new Date().toISOString();
}

export function isoOf(milliseconds) {
  return new Date(milliseconds).toISOString();
}

export function parse(text) {
  const value = Date.parse(text);
  if (Number.isNaN(value)) throw new Error(`Invalid date: ${text}`);
  return value;
}

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function elapsed(startedAt) {
  return Date.now() - startedAt;
}
