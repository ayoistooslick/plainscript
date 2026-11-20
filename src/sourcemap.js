'use strict';

// Minimal Source Map v3 writer (VLQ + base64). No dependencies, so the
// compiler stays installable with zero runtime packages.

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeVlq(value) {
  let vlq = value < 0 ? ((-value) << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    out += BASE64[digit];
  } while (vlq > 0);
  return out;
}

class SourceMap {
  constructor(file) {
    this.file = file;
    this.mappings = [];
  }

  add(generatedLine, generatedColumn, originalLine, originalColumn, source) {
    this.mappings.push({ generatedLine, generatedColumn, originalLine, originalColumn, source });
  }

  toJSON() {
    const sources = [];
    const sourceIndex = new Map();
    const sorted = [...this.mappings].sort((a, b) =>
      a.generatedLine - b.generatedLine || a.generatedColumn - b.generatedColumn);

    let out = '';
    let previousLine = 1;
    let previousColumn = 0;
    let previousSource = 0;
    let previousOriginalLine = 0;
    let previousOriginalColumn = 0;

    for (const mapping of sorted) {
      if (!sourceIndex.has(mapping.source)) {
        sourceIndex.set(mapping.source, sources.length);
        sources.push(mapping.source);
      }
      const index = sourceIndex.get(mapping.source);
      while (previousLine < mapping.generatedLine) {
        out += ';';
        previousLine += 1;
        previousColumn = 0;
      }
      if (out.length && !out.endsWith(';')) out += ',';
      out += encodeVlq(mapping.generatedColumn - previousColumn);
      out += encodeVlq(index - previousSource);
      out += encodeVlq((mapping.originalLine - 1) - previousOriginalLine);
      out += encodeVlq((mapping.originalColumn - 1) - previousOriginalColumn);
      previousColumn = mapping.generatedColumn;
      previousSource = index;
      previousOriginalLine = mapping.originalLine - 1;
      previousOriginalColumn = mapping.originalColumn - 1;
    }

    return {
      version: 3,
      file: this.file,
      sources,
      sourcesContent: sources.map(() => null),
      names: [],
      mappings: out,
    };
  }

  toString() {
    return JSON.stringify(this.toJSON());
  }
}

function decodeVlq(text, start) {
  let value = 0;
  let shift = 0;
  let index = start;
  while (index < text.length) {
    const digit = BASE64.indexOf(text[index]);
    if (digit < 0) throw new Error(`invalid source-map VLQ character ${JSON.stringify(text[index])}`);
    index += 1;
    value += (digit & 31) << shift;
    if (!(digit & 32)) {
      const negative = value & 1;
      const magnitude = value >>> 1;
      return [negative ? -magnitude : magnitude, index];
    }
    shift += 5;
  }
  throw new Error('unterminated source-map VLQ');
}

// Decode the Source Map v3 mappings string into absolute generated/original
// positions. This is used by the debug adapter for both directions: .pln
// breakpoints -> generated JavaScript, and paused JavaScript stacks -> .pln.
function decodeSourceMap(map) {
  const mappings = [];
  const sources = map.sources || [];
  let generatedLine = 1;
  let generatedColumn = 0;
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  const lines = String(map.mappings || '').split(';');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    generatedColumn = 0;
    const segments = lines[lineIndex] ? lines[lineIndex].split(',') : [];
    for (const segment of segments) {
      if (!segment) continue;
      let position = 0;
      let value;
      [value, position] = decodeVlq(segment, position);
      generatedColumn += value;
      if (position >= segment.length) {
        mappings.push({ generatedLine: lineIndex + 1, generatedColumn, source: null, originalLine: null, originalColumn: null });
        continue;
      }
      [value, position] = decodeVlq(segment, position);
      sourceIndex += value;
      [value, position] = decodeVlq(segment, position);
      originalLine += value;
      [value, position] = decodeVlq(segment, position);
      originalColumn += value;
      mappings.push({
        generatedLine: lineIndex + 1,
        generatedColumn,
        source: sources[sourceIndex] || null,
        originalLine: originalLine + 1,
        originalColumn: originalColumn + 1,
      });
    }
  }
  return mappings;
}

function normalizePath(value) {
  if (!value) return value;
  return String(value).replace(/^file:\/\//, '');
}

function sourceMatches(actual, requested) {
  const left = normalizePath(actual);
  const right = normalizePath(requested);
  if (!left || !right) return false;
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function originalPositionFor(map, generatedLine, generatedColumn = 0) {
  const mappings = map.__decoded || decodeSourceMap(map);
  let best = null;
  for (const mapping of mappings) {
    if (mapping.source === null) continue;
    if (mapping.generatedLine < generatedLine || (mapping.generatedLine === generatedLine && mapping.generatedColumn <= generatedColumn)) {
      best = mapping;
    } else {
      break;
    }
  }
  return best;
}

function generatedPositionFor(map, source, line) {
  const mappings = (map.__decoded || decodeSourceMap(map)).filter((mapping) => mapping.source !== null && sourceMatches(mapping.source, source));
  if (!mappings.length) return null;
  const exact = mappings.filter((mapping) => mapping.originalLine === line);
  if (exact.length) return exact[0];
  // Slide a breakpoint forward to the next mapped statement, but never
  // backward: reporting a breakpoint on an earlier line would stop at the
  // wrong source location.
  const after = mappings.find((mapping) => mapping.originalLine >= line);
  return after || null;
}

function attachDecoded(map) {
  if (map && !map.__decoded) {
    Object.defineProperty(map, '__decoded', { value: decodeSourceMap(map), enumerable: false });
  }
  return map;
}

module.exports = { SourceMap, encodeVlq, decodeVlq, decodeSourceMap, originalPositionFor, generatedPositionFor, attachDecoded };
