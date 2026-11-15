// Standard library: std/math

export function abs(value) { return Math.abs(value); }
export function floor(value) { return Math.floor(value); }
export function ceil(value) { return Math.ceil(value); }
export function round(value) { return Math.round(value); }
export function trunc(value) { return Math.trunc(value); }
export function sqrt(value) { return Math.sqrt(value); }
export function pow(base, exponent) { return base ** exponent; }
export function log(value) { return Math.log(value); }
export function exp(value) { return Math.exp(value); }
export function min(left, right) { return Math.min(left, right); }
export function max(left, right) { return Math.max(left, right); }
export function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }

export function random() {
  return Math.random();
}

export function randomInt(minimum, maximum) {
  return minimum + Math.floor(Math.random() * (maximum - minimum + 1));
}

export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

export function mean(values) {
  return values.length ? sum(values) / values.length : 0;
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function deviation(values) {
  if (!values.length) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}
