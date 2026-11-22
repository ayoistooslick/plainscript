'use strict';

const path = require('path');
const T = require('../types');
const { VERSION } = require('../version');

// A manifest is the contract every generated client is built from. It is
// intentionally data-only (no JavaScript function references) so it can be
// emitted as JSON and consumed by any language.
function typeInfo(type) {
  const resolved = T.deref(type);
  if (!resolved) return { kind: 'any', display: 'any' };
  switch (resolved.k) {
    case 'prim':
      return { kind: resolved.name, display: resolved.name };
    case 'literal':
      return { kind: 'literal', display: JSON.stringify(resolved.value), base: typeInfo(resolved.base) };
    case 'list':
      return { kind: 'list', display: T.showType(resolved), element: typeInfo(resolved.elem) };
    case 'tuple':
      return { kind: 'list', display: T.showType(resolved), element: { kind: 'any', display: 'any' } };
    case 'map':
      return {
        kind: 'map',
        display: T.showType(resolved),
        key: typeInfo(resolved.key),
        value: typeInfo(resolved.value),
      };
    case 'promise':
      return { kind: 'promise', display: T.showType(resolved), element: typeInfo(resolved.value) };
    case 'record': {
      const fields = {};
      for (const [name, field] of resolved.fields) {
        fields[name] = {
          type: typeInfo(field.type),
          optional: Boolean(field.optional),
          readonly: Boolean(field.readonly),
        };
      }
      return { kind: 'record', display: T.showType(resolved), fields };
    }
    case 'variant':
      return { kind: 'record', display: T.showType(resolved), fields: Object.fromEntries(resolved.fields.map((field) => [field.name, { type: typeInfo(field.type), optional: false }])) };
    case 'unit':
      return { kind: 'text', display: T.showType(resolved) };
    case 'union': {
      const members = resolved.members.map(typeInfo);
      const optional = members.some((member) => member.kind === 'nothing');
      const kept = members.filter((member) => member.kind !== 'nothing');
      if (kept.length === 1) return { ...kept[0], optional };
      return { kind: 'union', display: T.showType(resolved), members: kept, optional };
    }
    case 'fn':
      return { kind: 'function', display: T.showType(resolved) };
    default:
      return { kind: 'any', display: T.showType(resolved) };
  }
}

function parameterInfo(parameter) {
  return {
    name: parameter.name,
    optional: Boolean(parameter.optional),
    rest: Boolean(parameter.rest),
    type: typeInfo(parameter.type),
  };
}

function describeModule(record) {
  const checker = record.check && record.check.checker;
  const exports = (record.check && record.check.exports && record.check.exports.values) || new Map();
  const functions = [];
  const values = [];

  for (const [name, entry] of exports) {
    if (name === 'default') continue;
    const resolved = entry && entry.type ? T.deref(entry.type) : null;
    if (entry.kind === 'function' && resolved && resolved.k === 'fn') {
      const symbol = checker ? checker.lookup(name) : null;
      const asyncFunction = Boolean(symbol && symbol.node && symbol.node.async)
        || (resolved.ret && resolved.ret.k === 'promise');
      functions.push({
        name,
        async: asyncFunction,
        params: resolved.params.map(parameterInfo),
        returns: typeInfo(resolved.ret),
      });
      continue;
    }
    values.push({ name, type: typeInfo(entry && entry.type) });
  }

  functions.sort((a, b) => a.name.localeCompare(b.name));
  values.sort((a, b) => a.name.localeCompare(b.name));

  return {
    protocol: 'plainscript-jsonrpc/1',
    module: path.basename(record.file, '.pln'),
    entry: record.file,
    version: VERSION,
    functions,
    values,
  };
}

module.exports = { describeModule, typeInfo, parameterInfo };
