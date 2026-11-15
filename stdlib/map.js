// Standard library: std/map
// A PlainScript map is a plain JavaScript object with text keys, so maps are
// JSON-serialisable and interoperate with every npm package.

export function keys(map) {
  return Object.keys(map);
}

export function values(map) {
  return Object.values(map);
}

export function entries(map) {
  return Object.entries(map).map(([key, value]) => ({ key, value }));
}

export function has(map, key) {
  return Object.prototype.hasOwnProperty.call(map, key);
}

export function get(map, key, fallback = null) {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
}

export function set(map, key, value) {
  map[key] = value;
  return map;
}

export function remove(map, key) {
  delete map[key];
  return map;
}

export function size(map) {
  return Object.keys(map).length;
}

export function merge(left, right) {
  return { ...left, ...right };
}

export function fromEntries(pairs) {
  const result = {};
  for (const pair of pairs) result[pair.key] = pair.value;
  return result;
}
