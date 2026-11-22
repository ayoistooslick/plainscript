// Environment access is explicit and typed. Missing values are `nothing`;
// parsing helpers report the variable name in their error instead of silently
// turning a typo into NaN.

export function get(name) {
  const value = process.env[name];
  return value === undefined ? null : value;
}

export function require(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable "${name}".`);
  }
  return value;
}

function parsed(name, fallback, parse, expectation) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Environment variable "${name}" is not set; expected ${expectation}.`);
  }
  const value = parse(raw);
  if (value === null || Number.isNaN(value)) {
    throw new Error(`Environment variable "${name}" is ${JSON.stringify(raw)}; expected ${expectation}.`);
  }
  return value;
}

export function number(name, fallback) {
  return parsed(name, fallback, (raw) => Number(raw), 'a number');
}

export function integer(name, fallback) {
  return parsed(name, fallback, (raw) => (/^[+-]?\d+$/.test(raw.trim()) ? Number(raw) : null), 'an integer');
}

export function boolean(name, fallback) {
  return parsed(name, fallback, (raw) => {
    const value = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'off'].includes(value)) return false;
    return null;
  }, 'a boolean (true/false, yes/no, on/off, 1/0)');
}

export function list(name, separator = ',') {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return [];
  return raw.split(separator).map((item) => item.trim()).filter(Boolean);
}

export function all() {
  return { ...process.env };
}

export function set(name, value) {
  process.env[name] = value;
}

export function unset(name) {
  delete process.env[name];
}

export function has(name) {
  return Object.prototype.hasOwnProperty.call(process.env, name);
}
