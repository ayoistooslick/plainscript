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

// ---------------------------------------------------------------------------
// Regular expressions
//
// A regex literal such as /item-(\d+)/ is a native value. These helpers wrap
// the JavaScript RegExp surface in records so captures are easy to consume
// without relying on array-shaped match objects. Every helper clones the
// pattern, so a global regex's lastIndex is never disturbed by a call.

export function matches(text, pattern) {
  const expression = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
  return expression.test(String(text));
}

export function findMatch(text, pattern) {
  const expression = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
  const found = expression.exec(String(text));
  if (!found) return null;
  return {
    text: found[0],
    index: found.index,
    groups: found.slice(1).map((value) => (value === undefined ? '' : value)),
    named: found.groups ? { ...found.groups } : {},
  };
}

export function findAllMatches(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const expression = new RegExp(pattern.source, flags);
  const source = String(text);
  const found = [];
  let current = expression.exec(source);
  while (current) {
    found.push({
      text: current[0],
      index: current.index,
      groups: current.slice(1).map((value) => (value === undefined ? '' : value)),
      named: current.groups ? { ...current.groups } : {},
    });
    // A zero-length match would otherwise leave lastIndex unchanged.
    if (current[0] === '') expression.lastIndex += 1;
    current = expression.exec(source);
  }
  return found;
}

export function matchTexts(text, pattern) {
  return findAllMatches(text, pattern).map((found) => found.text);
}

export function splitMatch(text, pattern) {
  return String(text).split(new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')));
}

export function replaceMatch(text, pattern, replacement) {
  return String(text).replace(new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')), replacement);
}

export function replaceAllMatches(text, pattern, replacement) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return String(text).replace(new RegExp(pattern.source, flags), replacement);
}

export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
