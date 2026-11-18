'use strict';

// PlainScript's type model is structural, with a small number of primitives,
// one generic collection family (list/map), records, function types, and
// unions. Types are erased at runtime; the checker is the only enforcer. That
// is a deliberate trade-off documented in docs/DECISIONS.md: no hidden runtime
// validators, no per-call overhead, and generated JavaScript identical to what
// a careful TypeScript author would write.

const PRIM = Object.freeze({
  number: { k: 'prim', name: 'number' },
  text: { k: 'prim', name: 'text' },
  boolean: { k: 'prim', name: 'boolean' },
  nothing: { k: 'prim', name: 'nothing' },
  any: { k: 'prim', name: 'any' },
  unknown: { k: 'prim', name: 'unknown' },
  never: { k: 'prim', name: 'never' },
  error: { k: 'prim', name: 'error' },
});

let nextVarId = 1;

// Named types are indirections, not expansions. Recursive aliases such as
// `type Json = ... or list of Json` therefore terminate: `deref` follows the
// name once per lookup and every consumer guards with a seen set.
const aliasRegistry = new Map();

function registerAlias(name, type) {
  aliasRegistry.set(name, type);
}

function namedRef(name) {
  return { k: 'named', name };
}

function deref(t, seen = new Set()) {
  let current = t;
  while (current && current.k === 'named') {
    if (seen.has(current.name)) return PRIM.any;
    seen.add(current.name);
    const target = aliasRegistry.get(current.name);
    if (!target) return PRIM.any;
    current = target;
  }
  return current;
}

const typeVar = (name, constraint = null) => ({ k: 'var', name: name || `T${nextVarId}`, id: nextVarId++, constraint });
const listOf = (elem) => ({ k: 'list', elem });
const tupleOf = (elements) => ({ k: 'tuple', elements });
const mapOf = (key, value) => ({ k: 'map', key, value });
const promiseOf = (value) => ({ k: 'promise', value });
const fnType = (params, ret, typeParams) => ({ k: 'fn', params, ret, typeParams: typeParams || [] });
const record = (fields, options = {}) => ({ k: 'record', fields, name: options.name, open: options.open !== false });
const variant = (name, fields, unionName) => ({ k: 'variant', name, fields, unionName });
const unitVariant = (name, unionName) => ({ k: 'unit', name, unionName });
// Literal types are used by schema-derived model fields (enumeration/literal).
// They deliberately stay narrow so a model field cannot accept an arbitrary
// text value that the runtime validator would reject.
const literalType = (value, base) => ({ k: 'literal', value, base });

function union(members) {
  const flat = [];
  const seen = new Set();
  for (const member of members) {
    if (!member) continue;
    const items = member.k === 'union' ? member.members : [member];
    for (const item of items) {
      if (item.k === 'prim' && item.name === 'never') continue;
      if (item.k === 'prim' && item.name === 'any') return PRIM.any;
      const key = showType(item);
      if (seen.has(key)) continue;
      seen.add(key);
      flat.push(item);
    }
  }
  if (flat.some((m) => m.k === 'prim' && m.name === 'any')) return PRIM.any;
  if (flat.length === 0) return PRIM.never;
  if (flat.length === 1) return flat[0];
  return { k: 'union', members: flat };
}

const optionalOf = (t) => union([t, PRIM.nothing]);

function isNothing(t) {
  return Boolean(t) && ((t.k === 'prim' && t.name === 'nothing'));
}

function isAny(t) {
  return Boolean(t) && t.k === 'prim' && (t.name === 'any' || t.name === 'error');
}

function isError(t) {
  return Boolean(t) && t.k === 'prim' && t.name === 'error';
}

function containsNothing(t) {
  if (!t) return false;
  if (isNothing(t)) return true;
  if (t.k === 'union') return t.members.some(containsNothing);
  return false;
}

// Removes `nothing` from a union, used after a null guard has narrowed a value.
function withoutNothing(t) {
  if (!t) return t;
  if (isNothing(t)) return PRIM.never;
  if (t.k === 'union') {
    const kept = t.members.filter((m) => !isNothing(m));
    return kept.length ? union(kept) : PRIM.never;
  }
  return t;
}

function showType(t, seen = new Set()) {
  if (!t) return 'unknown';
  if (t.k === 'named') {
    if (seen.has(t.name)) return t.name;
    const target = aliasRegistry.get(t.name);
    if (!target) return t.name;
    return showType(target, new Set([...seen, t.name]));
  }
  switch (t.k) {
    case 'prim':
      return t.name;
    case 'list':
      return `list of ${showType(t.elem, seen)}`;
    case 'tuple':
      return `[${t.elements.map((element) => showType(element, seen)).join(', ')}]`;
    case 'map':
      return `map of ${showType(t.key, seen)} to ${showType(t.value, seen)}`;
    case 'promise':
      return `Promise of ${showType(t.value, seen)}`;
    case 'var':
      return t.name;
    case 'record': {
      const fields = [...t.fields.entries()]
        .map(([name, field]) => `${name}${field.optional ? '?' : ''}: ${showType(field.type, seen)}`)
        .join(', ');
      return t.name ? t.name : `{ ${fields} }`;
    }
    case 'fn': {
      const params = t.params
        .map((p) => `${p.name ? `${p.name}: ` : ''}${showType(p.type, seen)}`)
        .join(', ');
      return `(${params}) -> ${showType(t.ret, seen)}`;
    }
    case 'union':
      return t.members.map((m) => showType(m, seen)).join(' or ');
    case 'variant': {
      const fields = t.fields.map((f) => `${f.name}: ${showType(f.type, seen)}`).join(', ');
      return `${t.name}(${fields})`;
    }
    case 'unit':
      return t.name;
    case 'literal':
      return typeof t.value === 'string' ? JSON.stringify(t.value) : String(t.value);
    case 'named':
      return t.name;
    default:
      return 'unknown';
  }
}

function sameType(a, b) {
  return showType(a) === showType(b);
}

// Structural assignability. `from` is the value's type, `to` the expected one.
// Any at the boundary is bidirectional on purpose: npm and browser APIs are
// untyped, and PlainScript refuses to pretend otherwise.
function assignable(from, to, seen = new Set()) {
  if (!from || !to) return true;
  from = deref(from, new Set());
  to = deref(to, new Set());
  if (isError(from) || isError(to)) return true;
  if (isAny(from) || isAny(to)) return true;
  if (to.k === 'prim' && to.name === 'unknown') return true;
  if (from.k === 'prim' && from.name === 'unknown') return to.k === 'prim' && to.name === 'unknown';
  if (from.k === 'prim' && from.name === 'never') return true;
  if (from.k === 'var' || to.k === 'var') return true; // unresolved generics are permissive
  if (from.k === 'literal') {
    if (to.k === 'literal') return from.value === to.value;
    if (to.k === 'prim') return assignable(from.base, to, seen);
  }
  if (to.k === 'literal') return from.k === 'literal' && from.value === to.value;

  const key = `${showType(from)}=>${showType(to)}`;
  if (seen.has(key)) return true;
  seen.add(key);

  // A source union must fit the whole target (including its union), so this
  // check comes first: `A or B or nothing` is assignable to `A or B or nothing`
  // instead of demanding that each member match one target member in isolation.
  if (from.k === 'union') return from.members.every((m) => assignable(m, to, seen));
  if (to.k === 'union') return to.members.some((m) => assignable(from, m, seen));

  if (from.k === 'prim' && to.k === 'prim') {
    if (from.name === to.name) return true;
    if (from.name === 'nothing') return to.name === 'nothing' || to.name === 'unknown' || to.name === 'any';
    return false;
  }

  if (from.k === 'list' && to.k === 'list') return assignable(from.elem, to.elem, seen);
  if (from.k === 'tuple' && to.k === 'tuple') {
    return from.elements.length === to.elements.length
      && from.elements.every((element, index) => assignable(element, to.elements[index], seen));
  }
  if (from.k === 'tuple' && to.k === 'list') {
    return from.elements.every((element) => assignable(element, to.elem, seen));
  }
  if (from.k === 'map' && to.k === 'map') {
    return assignable(from.key, to.key, seen) && assignable(from.value, to.value, seen);
  }
  if (from.k === 'promise' && to.k === 'promise') return assignable(from.value, to.value, seen);

  if (to.k === 'record' && (from.k === 'record' || from.k === 'variant' || from.k === 'unit')) {
    if (from.k === 'unit') return from.unionName === to.name && to.fields.size === 0;
    const sourceFields = from.k === 'variant'
      ? new Map(from.fields.map((f) => [f.name, { type: f.type, optional: false }]))
      : from.fields;
    if (from.k === 'variant' && to.name && from.name !== to.name) return false;
    for (const [name, field] of to.fields) {
      if (!field.optional) {
        const actual = sourceFields.get(name);
        if (!actual) return false;
      }
      const actual = sourceFields.get(name);
      if (actual && !assignable(actual.type, field.type, seen)) return false;
    }
    return true;
  }

  if (from.k === 'record' && to.k === 'map' && to.key.k === 'prim' && to.key.name === 'text') {
    for (const field of from.fields.values()) {
      if (!assignable(field.type, to.value, seen)) return false;
    }
    return true;
  }

  if (from.k === 'variant' && to.k === 'variant') {
    return from.name === to.name && from.fields.every((f, index) =>
      assignable(f.type, to.fields[index] && to.fields[index].type, seen));
  }
  if (from.k === 'unit' && to.k === 'unit') return from.name === to.name;
  if (from.k === 'unit' && to.k === 'variant') return false;

  if (from.k === 'fn' && to.k === 'fn') {
    const required = to.params.filter((p) => !p.optional).length;
    if (from.params.filter((p) => !p.optional).length > required) return false;
    for (let i = 0; i < Math.min(from.params.length, to.params.length); i += 1) {
      if (!assignable(to.params[i].type, from.params[i].type, seen)) return false;
    }
    return assignable(from.ret, to.ret, seen);
  }

  return false;
}

// One-pass inference for generic functions: matches a declared parameter type
// (which may contain type variables) against an argument type, recording
// substitutions. Conflicting bindings are joined into a union.
function infer(pattern, actual, subst, depth = 0) {
  if (!pattern || !actual || depth > 40) return true;
  pattern = deref(pattern, new Set());
  actual = deref(actual, new Set());
  if (pattern.k === 'var') {
    if (pattern.constraint && !assignable(actual, substitute(pattern.constraint, subst))) return false;
    const existing = subst.get(pattern.name);
    if (!existing) subst.set(pattern.name, actual);
    else if (!assignable(actual, existing)) subst.set(pattern.name, union([existing, actual]));
    return true;
  }
  if (actual.k === 'var') {
    const existing = subst.get(actual.name);
    if (!existing) subst.set(actual.name, pattern);
    return true;
  }
  if (pattern.k === 'list' && actual.k === 'list') return infer(pattern.elem, actual.elem, subst, depth + 1);
  if (pattern.k === 'tuple' && actual.k === 'tuple') {
    let ok = true;
    for (let i = 0; i < Math.min(pattern.elements.length, actual.elements.length); i += 1) {
      ok = infer(pattern.elements[i], actual.elements[i], subst, depth + 1) && ok;
    }
    return ok;
  }
  if (pattern.k === 'map' && actual.k === 'map') {
    return infer(pattern.key, actual.key, subst, depth + 1) && infer(pattern.value, actual.value, subst, depth + 1);
  }
  if (pattern.k === 'promise' && actual.k === 'promise') return infer(pattern.value, actual.value, subst, depth + 1);
  if (pattern.k === 'fn' && actual.k === 'fn') {
    let ok = true;
    for (let i = 0; i < Math.min(pattern.params.length, actual.params.length); i += 1) {
      ok = infer(pattern.params[i].type, actual.params[i].type, subst, depth + 1) && ok;
    }
    return infer(pattern.ret, actual.ret, subst, depth + 1) && ok;
  }
  if (pattern.k === 'union') {
    return pattern.members.some((m) => infer(m, actual, subst, depth + 1));
  }
  if (pattern.k === 'record' && (actual.k === 'record' || actual.k === 'variant')) {
    const fields = actual.k === 'variant'
      ? new Map(actual.fields.map((f) => [f.name, { type: f.type, optional: false }]))
      : actual.fields;
    let ok = true;
    for (const [name, field] of pattern.fields) {
      const found = fields.get(name);
      if (!found) continue;
      ok = infer(field.type, found.type, subst, depth + 1) && ok;
    }
    return ok;
  }
  return true;
}

function substitute(t, subst) {
  if (!t) return t;
  switch (t.k) {
    case 'var':
      return subst.has(t.name) ? subst.get(t.name) : (t.constraint ? { ...t, constraint: substitute(t.constraint, subst) } : t);
    case 'list':
      return listOf(substitute(t.elem, subst));
    case 'tuple':
      return tupleOf(t.elements.map((element) => substitute(element, subst)));
    case 'map':
      return mapOf(substitute(t.key, subst), substitute(t.value, subst));
    case 'promise':
      return promiseOf(substitute(t.value, subst));
    case 'union':
      return union(t.members.map((m) => substitute(m, subst)));
    case 'record': {
      const fields = new Map();
      for (const [name, field] of t.fields) {
        fields.set(name, { type: substitute(field.type, subst), optional: field.optional });
      }
      return record(fields, { name: t.name, open: t.open });
    }
    case 'fn':
      return fnType(
        t.params.map((p) => ({ ...p, type: substitute(p.type, subst) })),
        substitute(t.ret, subst),
      );
    case 'variant':
      return variant(t.name, t.fields.map((f) => ({ name: f.name, type: substitute(f.type, subst) })), t.unionName);
    case 'literal':
      return t;
    default:
      return t;
  }
}

module.exports = {
  PRIM,
  typeVar,
  listOf,
  tupleOf,
  mapOf,
  promiseOf,
  fnType,
  record,
  variant,
  unitVariant,
  literalType,
  union,
  optionalOf,
  isNothing,
  isAny,
  isError,
  registerAlias,
  namedRef,
  deref,
  containsNothing,
  withoutNothing,
  showType,
  sameType,
  assignable,
  infer,
  substitute,
};
