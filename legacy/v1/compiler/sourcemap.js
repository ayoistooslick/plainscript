// SourceMap: V3 Source Map generator for PlainScript compiler.
// Zero external dependencies  -  implements VLQ Base64 encoding.

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeVlq(value) {
  let vlq = value < 0 ? ((-value) << 1) | 1 : (value << 1);
  let encoded = '';
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) {
      digit |= 32;
    }
    encoded += BASE64_CHARS[digit];
  } while (vlq > 0);
  return encoded;
}

function decodeVlq(str, state = { index: 0 }) {
  let result = 0;
  let shift = 0;
  let continuation = true;
  while (continuation && state.index < str.length) {
    const char = str[state.index++];
    const digit = BASE64_CHARS.indexOf(char);
    if (digit === -1) throw new Error(`Invalid Base64 character: ${char}`);
    continuation = (digit & 32) !== 0;
    result += (digit & 31) << shift;
    shift += 5;
  }
  const isNegative = (result & 1) === 1;
  const value = result >> 1;
  return isNegative ? -value : value;
}

class SourceMapGenerator {
  constructor(options = {}) {
    this.file = options.file || '';
    this.sourceRoot = options.sourceRoot || '';
    this.sources = [];
    this.sourcesContent = [];
    this.mappings = [];
  }

  addSource(sourcePath, content = null) {
    let idx = this.sources.indexOf(sourcePath);
    if (idx === -1) {
      idx = this.sources.length;
      this.sources.push(sourcePath);
      this.sourcesContent.push(content);
    } else if (content !== null && this.sourcesContent[idx] === null) {
      this.sourcesContent[idx] = content;
    }
    return idx;
  }

  addMapping({ generated, original, source }) {
    if (!generated || generated.line == null || generated.column == null) return;
    if (!original || original.line == null || original.column == null) return;

    const sourceIdx = source ? this.addSource(source) : 0;
    this.mappings.push({
      generatedLine: generated.line,
      generatedColumn: generated.column,
      originalLine: original.line,
      originalColumn: original.column,
      sourceIdx,
    });
  }

  toJSON() {
    // Sort mappings by generated line, then generated column
    const sorted = [...this.mappings].sort((a, b) => {
      if (a.generatedLine !== b.generatedLine) return a.generatedLine - b.generatedLine;
      return a.generatedColumn - b.generatedColumn;
    });

    let mappingsStr = '';
    let prevGenLine = 1;
    let prevGenCol = 0;
    let prevOrigLine = 0;
    let prevOrigCol = 0;
    let prevSourceIdx = 0;

    for (const m of sorted) {
      while (prevGenLine < m.generatedLine) {
        mappingsStr += ';';
        prevGenLine++;
        prevGenCol = 0;
      }

      if (mappingsStr.length > 0 && !mappingsStr.endsWith(';')) {
        mappingsStr += ',';
      }

      const genColDiff = m.generatedColumn - prevGenCol;
      const sourceIdxDiff = m.sourceIdx - prevSourceIdx;
      const origLineDiff = (m.originalLine - 1) - prevOrigLine;
      const origColDiff = (m.originalColumn - 1) - prevOrigCol;

      mappingsStr += encodeVlq(genColDiff);
      mappingsStr += encodeVlq(sourceIdxDiff);
      mappingsStr += encodeVlq(origLineDiff);
      mappingsStr += encodeVlq(origColDiff);

      prevGenCol = m.generatedColumn;
      prevSourceIdx = m.sourceIdx;
      prevOrigLine = m.originalLine - 1;
      prevOrigCol = m.originalColumn - 1;
    }

    const mapObj = {
      version: 3,
      file: this.file,
      sources: this.sources,
      mappings: mappingsStr,
    };

    if (this.sourcesContent.some(c => c !== null)) {
      mapObj.sourcesContent = this.sourcesContent;
    }

    return mapObj;
  }

  toString() {
    return JSON.stringify(this.toJSON());
  }

  toInlineDataUrl() {
    const json = this.toString();
    const base64 = Buffer.from(json, 'utf8').toString('base64');
    return `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}`;
  }
}

module.exports = {
  SourceMapGenerator,
  encodeVlq,
  decodeVlq,
};
