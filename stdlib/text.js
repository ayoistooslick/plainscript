// Standard library: std/text
// PlainScript has no magic string methods; text operations are functions so
// they compose with the pipeline operator: `name |> trim |> upper`.

export function split(text, separator) {
  return String(text).split(separator);
}

export function join(parts, separator = '') {
  return parts.join(separator);
}

export function trim(text) {
  return String(text).trim();
}

export function trimStart(text) {
  return String(text).trimStart();
}

export function trimEnd(text) {
  return String(text).trimEnd();
}

export function upper(text) {
  return String(text).toUpperCase();
}

export function lower(text) {
  return String(text).toLowerCase();
}

export function replace(text, search, replacement) {
  return String(text).split(search).join(replacement);
}

export function contains(text, part) {
  return String(text).includes(part);
}

export function startsWith(text, prefix) {
  return String(text).startsWith(prefix);
}

export function endsWith(text, suffix) {
  return String(text).endsWith(suffix);
}

export function slice(text, start, end) {
  return end === undefined ? String(text).slice(start) : String(text).slice(start, end);
}

export function length(text) {
  return String(text).length;
}

export function chars(text) {
  return [...String(text)];
}

export function words(text) {
  return String(text).trim().split(/\s+/).filter(Boolean);
}

export function repeat(text, times) {
  return String(text).repeat(times);
}

export function padStart(text, width, fill = ' ') {
  return String(text).padStart(width, fill);
}

export function padEnd(text, width, fill = ' ') {
  return String(text).padEnd(width, fill);
}

export function indexOf(text, part) {
  return String(text).indexOf(part);
}

export function lines(text) {
  return String(text).split(/\r?\n/);
}

export function parseNumber(text, fallback = 0) {
  const value = Number(String(text).trim());
  return Number.isFinite(value) ? value : fallback;
}
