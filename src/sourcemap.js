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

module.exports = { SourceMap, encodeVlq };
