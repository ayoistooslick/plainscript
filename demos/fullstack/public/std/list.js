// Standard library: std/list
// List operations are functions, not methods, so they pipe:
// `users |> filter(active) |> map(nameOf)`.

export function count(items) {
  return items.length;
}

export function isEmpty(items) {
  return items.length === 0;
}

export function map(items, transform) {
  return items.map((value, index) => transform(value, index));
}

export function filter(items, predicate) {
  return items.filter((value, index) => predicate(value, index));
}

export function reduce(items, initial, combine) {
  return items.reduce((accumulator, value, index) => combine(accumulator, value, index), initial);
}

export function find(items, predicate) {
  const index = items.findIndex((value, position) => predicate(value, position));
  return index === -1 ? null : items[index];
}

export function findIndex(items, predicate) {
  return items.findIndex((value, position) => predicate(value, position));
}

export function any(items, predicate) {
  return items.some((value, index) => predicate(value, index));
}

export function all(items, predicate) {
  return items.every((value, index) => predicate(value, index));
}

export function each(items, action) {
  items.forEach((value, index) => action(value, index));
}

export function sort(items, compare) {
  const copy = [...items];
  copy.sort(compare);
  return copy;
}

export function sortBy(items, key) {
  return [...items].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
}

export function reverse(items) {
  return [...items].reverse();
}

export function slice(items, start, end) {
  return end === undefined ? items.slice(start) : items.slice(start, end);
}

export function append(items, value) {
  return [...items, value];
}

export function concat(items, other) {
  return [...items, ...other];
}

export function first(items) {
  return items.length ? items[0] : null;
}

export function last(items) {
  return items.length ? items[items.length - 1] : null;
}

export function range(from, to) {
  const values = [];
  for (let value = from; value <= to; value += 1) values.push(value);
  return values;
}

export function zip(left, right) {
  const length = Math.min(left.length, right.length);
  const result = [];
  for (let index = 0; index < length; index += 1) result.push([left[index], right[index]]);
  return result;
}

export function flatten(items) {
  return items.flat();
}

export function flatMap(items, transform) {
  return items.flatMap((value, index) => transform(value, index));
}

export function unique(items) {
  return [...new Set(items)];
}

export function sum(items) {
  return items.reduce((total, value) => total + value, 0);
}

export function take(items, count) {
  return items.slice(0, Math.max(0, count));
}

export function drop(items, count) {
  return items.slice(Math.max(0, count));
}

export function chunk(items, size) {
  if (size < 1) return [];
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}
