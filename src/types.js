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
  regex: { k: 'prim', name: 'regex' },
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
const tupleOf = (elements, rest = null) => ({ k: 'tuple', elements, rest });
const mapOf = (key, value) => ({ k: 'map', key, value });
const promiseOf = (value) => ({ k: 'promise', value });
const fnType = (params, ret, typeParams, predicate = null) => ({ k: 'fn', params, ret, typeParams: typeParams || [], predicate });
const record = (fields, options = {}) => ({ k: 'record', fields, name: options.name, open: options.open !== false });
const variant = (name, fields, unionName) => ({ k: 'variant', name, fields, unionName });
const unitVariant = (name, unionName) => ({ k: 'unit', name, unionName });
// Literal types are used by schema-derived model fields (enumeration/literal).
// They deliberately stay narrow so a model field cannot accept an arbitrary
// text value that the runtime validator would reject.
const literalType = (value, base) => ({ k: 'literal', value, base });
const conditionalType = (check, extendsType, trueType, falseType, distributive = false) => ({ k: 'conditional', check, extends: extendsType, trueType, falseType, distributive });
const keyofType = (target) => ({ k: 'keyof', target });
const indexedAccessType = (target, index) => ({ k: 'indexed', target, index });
const mappedType = (variable, key, value, optional = false) => ({ k: 'mapped', variable, key, value, optional });

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
    case 'tuple': {
      const fixed = t.elements.map((element) => showType(element, seen));
      if (t.rest) fixed.push(`...${showType(t.rest, seen)}`);
      return `[${fixed.join(', ')}]`;
    }
    case 'map':
      return `map of ${showType(t.key, seen)} to ${showType(t.value, seen)}`;
    case 'promise':
      return `Promise of ${showType(t.value, seen)}`;
    case 'var':
      return t.name;
    case 'record': {
      const fields = [...t.fields.entries()]
        .map(([name, field]) => `${field.readonly ? 'readonly ' : ''}${name}${field.optional ? '?' : ''}: ${showType(field.type, seen)}`)
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
    case 'conditional':
      return `${showType(t.check, seen)} extends ${showType(t.extends, seen)} ? ${showType(t.trueType, seen)} : ${showType(t.falseType, seen)}`;
    case 'keyof':
      return `keyof ${showType(t.target, seen)}`;
    case 'indexed':
      return `${showType(t.target, seen)}[${showType(t.index, seen)}]`;
    case 'mapped':
      return `{ [${t.variable} in ${showType(t.key, seen)}]${t.optional ? '?' : ''}: ${showType(t.value, seen)} }`;
    case 'named':
      return t.name;
    default:
      return 'unknown';
  }
}

function sameType(a, b) {
  return showType(a) === showType(b);
}

const DEFERRED_KINDS = new Set(['conditional', 'keyof', 'indexed', 'mapped']);

function isDeferred(t) {
  return Boolean(t) && DEFERRED_KINDS.has(t.k);
}

// Does a type contain an unresolved type variable or a deferred type-level
// expression? Named aliases are followed once, with a seen set so recursive
// aliases terminate.
function containsVariable(t, seen = new Set()) {
  if (!t || typeof t !== 'object') return false;
  if (t.k === 'var') return true;
  if (DEFERRED_KINDS.has(t.k)) return true;
  if (t.k === 'named') {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    const target = aliasRegistry.get(t.name);
    return target ? containsVariable(target, seen) : false;
  }
  if (seen.has(t)) return false;
  seen.add(t);
  switch (t.k) {
    case 'list': return containsVariable(t.elem, seen);
    case 'tuple': return t.elements.some((element) => containsVariable(element, seen)) || containsVariable(t.rest, seen);
    case 'map': return containsVariable(t.key, seen) || containsVariable(t.value, seen);
    case 'promise': return containsVariable(t.value, seen);
    case 'union': return t.members.some((member) => containsVariable(member, seen));
    case 'record': {
      for (const field of t.fields.values()) if (containsVariable(field.type, seen)) return true;
      return false;
    }
    case 'fn': return t.params.some((parameter) => containsVariable(parameter.type, seen)) || containsVariable(t.ret, seen);
    case 'variant': return t.fields.some((field) => containsVariable(field.type, seen));
    default: return false;
  }
}

function literalValueOfKey(t) {
  return t && t.k === 'literal' ? t.value : null;
}

function recordKeys(target) {
  const resolved = deref(target);
  if (resolved.k === 'record') return union([...resolved.fields.keys()].map((name) => literalType(name, PRIM.text)));
  if (resolved.k === 'map') return resolved.key;
  if (resolved.k === 'union') {
    const keys = [];
    for (const member of resolved.members) {
      const memberType = deref(member);
      if (memberType.k === 'record') {
        for (const name of memberType.fields.keys()) keys.push(literalType(name, PRIM.text));
      }
    }
    if (keys.length) return union(keys);
  }
  return null;
}

function indexOnce(target, index) {
  const source = deref(target);
  if (source.k === 'record' && isDeferred(index)) {
    if (index.k === 'keyof') return union([...source.fields.values()].map((field) => field.optional ? union([field.type, PRIM.nothing]) : field.type));
  }
  if (source.k === 'record') {
    const value = literalValueOfKey(index);
    if (value !== null) {
      const field = source.fields.get(String(value));
      if (!field) return PRIM.never;
      return field.optional ? union([field.type, PRIM.nothing]) : field.type;
    }
    if (index.k === 'keyof') return union([...source.fields.values()].map((field) => field.optional ? union([field.type, PRIM.nothing]) : field.type));
    if (index.k === 'prim' && index.name === 'text') return union([...source.fields.values()].map((field) => field.type));
  }
  if (source.k === 'tuple') {
    const value = literalValueOfKey(index);
    if (typeof value === 'number') return source.elements[value] || source.rest || PRIM.never;
    if (index.k === 'prim' && index.name === 'number') return union([...source.elements, source.rest || PRIM.nothing, PRIM.nothing]);
  }
  if (source.k === 'list' && index.k === 'prim' && index.name === 'number') return union([source.elem, PRIM.nothing]);
  if (source.k === 'map') {
    if (index.k === 'prim' && index.name === 'text') return source.value;
    if (literalValueOfKey(index) !== null) return source.value;
  }
  return null;
}

// Evaluate the deferred type-level constructs introduced by conditional,
// mapped and indexed-access syntax. Types that still mention an unresolved
// variable stay deferred until generic arguments are substituted.
function evaluate(t, seen = new Set()) {
  if (!t || typeof t !== 'object') return t;
  if (!containsVariable(t) && !isDeferred(t)) return t;
  if (t.k === 'named') return evaluate(deref(t), seen);
  if (t.k === 'var') return t;
  if (seen.has(t)) return t;
  seen.add(t);

  if (t.k === 'keyof') {
    const target = evaluate(t.target, seen);
    const keys = recordKeys(target);
    if (keys) return keys;
    if (target.k === 'var' && target.constraint) return evaluate(keyofType(target.constraint), seen);
    return keyofType(target);
  }

  if (t.k === 'indexed') {
    const target = evaluate(t.target, seen);
    const index = evaluate(t.index, seen);
    if (index.k === 'union') return union(index.members.map((member) => evaluate(indexedAccessType(target, member), seen)));
    const direct = indexOnce(target, index);
    if (direct !== null) return evaluate(direct, seen);
    if (target.k === 'var' && target.constraint) return evaluate(indexedAccessType(target.constraint, index), seen);
    return indexedAccessType(target, index);
  }

  if (t.k === 'conditional') {
    const check = evaluate(t.check, seen);
    const extendsType = evaluate(t.extends, seen);
    // A conditional whose checked type is a naked type parameter distributes
    // over a union after substitution: `T extends U ? A : B` becomes
    // `(T1 extends U ? A : B) or (T2 extends U ? A : B)`.
    if (t.distributive && check.k === 'union') {
      return union(check.members.map((member) => evaluate(conditionalType(member, extendsType, t.trueType, t.falseType, false), seen)));
    }
    if (!containsVariable(check) && !containsVariable(extendsType)) {
      return evaluate(assignable(check, extendsType) ? t.trueType : t.falseType, seen);
    }
    return conditionalType(check, extendsType, evaluate(t.trueType, seen), evaluate(t.falseType, seen), Boolean(t.distributive));
  }

  if (t.k === 'mapped') {
    const key = evaluate(t.key, seen);
    let members = [];
    if (key.k === 'union') members = key.members;
    else if (key.k === 'literal') members = [key];
    if (members.length && members.every((member) => literalValueOfKey(member) !== null)) {
      const fields = new Map();
      for (const member of members) {
        const keyValue = literalValueOfKey(member);
        const replacement = new Map([[t.variable, member]]);
        fields.set(String(keyValue), { type: evaluate(substituteRaw(t.value, replacement), seen), optional: Boolean(t.optional) });
      }
      return record(fields);
    }
    return mappedType(t.variable, key, t.value, t.optional);
  }

  if (t.k === 'union') return union(t.members.map((member) => evaluate(member, seen)));
  if (t.k === 'list') return listOf(evaluate(t.elem, seen));
  if (t.k === 'tuple') return tupleOf(t.elements.map((element) => evaluate(element, seen)), t.rest ? evaluate(t.rest, seen) : null);
  if (t.k === 'map') return mapOf(evaluate(t.key, seen), evaluate(t.value, seen));
  if (t.k === 'promise') return promiseOf(evaluate(t.value, seen));
  if (t.k === 'fn') {
    return fnType(
      t.params.map((parameter) => ({ ...parameter, type: evaluate(parameter.type, seen) })),
      evaluate(t.ret, seen),
      t.typeParams,
      t.predicate ? { ...t.predicate, type: evaluate(t.predicate.type, seen) } : null,
    );
  }
  if (t.k === 'record') {
    const fields = new Map();
    for (const [name, field] of t.fields) fields.set(name, { type: evaluate(field.type, seen), optional: field.optional, readonly: Boolean(field.readonly) });
    return record(fields, { name: t.name, open: t.open });
  }
  if (t.k === 'variant') return variant(t.name, t.fields.map((field) => ({ name: field.name, type: evaluate(field.type, seen) })), t.unionName);
  return t;
}

// Structural assignability. `from` is the value's type, `to` the expected one.
// Any at the boundary is bidirectional on purpose: npm and browser APIs are
// untyped, and PlainScript refuses to pretend otherwise.
function assignable(from, to, seen = new Set()) {
  if (!from || !to) return true;
  from = deref(evaluate(from), new Set());
  to = deref(evaluate(to), new Set());
  if (isDeferred(from) || isDeferred(to)) return true;
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
    for (let index = 0; index < to.elements.length; index += 1) {
      if (index < from.elements.length) {
        if (!assignable(from.elements[index], to.elements[index], seen)) return false;
      } else if (from.rest) {
        if (!assignable(from.rest, to.elements[index], seen)) return false;
      } else {
        return false;
      }
    }
    for (let index = to.elements.length; index < from.elements.length; index += 1) {
      if (!to.rest || !assignable(from.elements[index], to.rest, seen)) return false;
    }
    if (from.rest) {
      if (!to.rest) return false;
      if (!assignable(from.rest, to.rest, seen)) return false;
    }
    return true;
  }
  if (from.k === 'tuple' && to.k === 'list') {
    return from.elements.every((element) => assignable(element, to.elem, seen))
      && (!from.rest || assignable(from.rest, to.elem, seen));
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
  pattern = deref(evaluate(pattern), new Set());
  actual = deref(evaluate(actual), new Set());
  if (isDeferred(pattern) || isDeferred(actual)) return true;
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
    if (pattern.rest) {
      for (let i = pattern.elements.length; i < actual.elements.length; i += 1) {
        ok = infer(pattern.rest, actual.elements[i], subst, depth + 1) && ok;
      }
      if (actual.rest) ok = infer(pattern.rest, actual.rest, subst, depth + 1) && ok;
    } else if (actual.rest && actual.elements.length <= pattern.elements.length) {
      ok = infer(pattern.elements[actual.elements.length], actual.rest, subst, depth + 1) && ok;
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

function substituteRaw(t, subst) {
  if (!t) return t;
  switch (t.k) {
    case 'var':
      return subst.has(t.name) ? subst.get(t.name) : (t.constraint ? { ...t, constraint: substituteRaw(t.constraint, subst) } : t);
    case 'list':
      return listOf(substituteRaw(t.elem, subst));
    case 'tuple':
      return tupleOf(t.elements.map((element) => substituteRaw(element, subst)), t.rest ? substituteRaw(t.rest, subst) : null);
    case 'map':
      return mapOf(substituteRaw(t.key, subst), substituteRaw(t.value, subst));
    case 'promise':
      return promiseOf(substituteRaw(t.value, subst));
    case 'union':
      return union(t.members.map((m) => substituteRaw(m, subst)));
    case 'conditional':
      return conditionalType(
        substituteRaw(t.check, subst),
        substituteRaw(t.extends, subst),
        substituteRaw(t.trueType, subst),
        substituteRaw(t.falseType, subst),
        Boolean(t.distributive),
      );
    case 'keyof':
      return keyofType(substituteRaw(t.target, subst));
    case 'indexed':
      return indexedAccessType(substituteRaw(t.target, subst), substituteRaw(t.index, subst));
    case 'mapped':
      return mappedType(t.variable, substituteRaw(t.key, subst), substituteRaw(t.value, subst), t.optional);
    case 'record': {
      const fields = new Map();
      for (const [name, field] of t.fields) {
        fields.set(name, { type: substituteRaw(field.type, subst), optional: field.optional, readonly: Boolean(field.readonly) });
      }
      return record(fields, { name: t.name, open: t.open });
    }
    case 'fn':
      return fnType(
        t.params.map((p) => ({ ...p, type: substituteRaw(p.type, subst) })),
        substituteRaw(t.ret, subst),
        t.typeParams,
        t.predicate ? { ...t.predicate, type: substituteRaw(t.predicate.type, subst) } : null,
      );
    case 'variant':
      return variant(t.name, t.fields.map((f) => ({ name: f.name, type: substituteRaw(f.type, subst) })), t.unionName);
    case 'literal':
      return t;
    default:
      return t;
  }
}

function substitute(t, subst) {
  return evaluate(substituteRaw(t, subst));
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
  conditionalType,
  keyofType,
  indexedAccessType,
  mappedType,
  isDeferred,
  containsVariable,
  evaluate,
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
