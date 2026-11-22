// Reflection maps JavaScript's runtime vocabulary onto PlainScript's type
// names. It never pretends to recover generic arguments, which do not exist at
// run time, and it reports null and undefined as `nothing`.

export function typeOf(value) {
  if (value === null || value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'list';
  if (value instanceof RegExp) return 'regex';
  if (value instanceof Error) return 'error';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'bigint') return 'bigint';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'function') return 'function';
  if (typeof value.then === 'function') return 'promise';
  if (typeof value.next === 'function') return 'iterator';
  if (value instanceof Map) return 'map';
  // A class instance has its own prototype; a record literal inherits from
  // Object.prototype. This is the same distinction the type system draws
  // between `record` and an instance of a class.
  const prototype = Object.getPrototypeOf(value);
  if (prototype && prototype !== Object.prototype) return 'instance';
  return 'record';
}

export function className(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return typeof value;
  if (Array.isArray(value)) return 'list';
  if (value.$kind) return value.$kind;
  const constructor = value.constructor;
  return constructor && constructor.name ? constructor.name : 'record';
}

export function fieldsOf(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map((_, index) => String(index));
  if (value instanceof Map) return Array.from(value.keys()).map(String);
  if (typeof value !== 'object') return [];
  const names = new Set();
  let cursor = value;
  while (cursor && cursor !== Object.prototype && cursor !== Function.prototype) {
    for (const name of Object.getOwnPropertyNames(cursor)) {
      if (name !== 'constructor') names.add(name);
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  return [...names];
}

export function hasField(value, name) {
  if (value === null || value === undefined) return false;
  if (value instanceof Map) return value.has(name);
  return name in Object(value);
}

export function isError(value) {
  return value instanceof Error || Boolean(value && typeof value === 'object' && typeof value.message === 'string' && typeof value.name === 'string');
}

export function isIterator(value) {
  return Boolean(value && typeof value.next === 'function');
}

export function isPromise(value) {
  return Boolean(value && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function');
}

export function describe(value) {
  const kind = typeOf(value);
  if (kind === 'nothing') return 'nothing';
  if (kind === 'record' || kind === 'error') {
    const name = className(value);
    const fields = fieldsOf(value);
    return fields.length ? `${name} { ${fields.join(', ')} }` : name;
  }
  if (kind === 'list') return `list of ${value.length ? typeOf(value[0]) : 'any'}`;
  if (kind === 'map') return 'map';
  if (kind === 'function') return value.name ? `function ${value.name}` : 'function';
  return kind;
}
