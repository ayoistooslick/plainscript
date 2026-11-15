'use strict';

const { Span, error } = require('./diagnostics');

// PlainScript 2.0 has exactly one spelling per concept. This set is the
// complete reserved vocabulary: nothing here is contextual, and nothing
// outside it can introduce a block.
const KEYWORDS = new Set([
  'and', 'as', 'async', 'await', 'break', 'case', 'catch', 'const',
  'continue', 'declare', 'default', 'do', 'element', 'end', 'export', 'finally',
  'for', 'from', 'function', 'import', 'in', 'is', 'let', 'match', 'not',
  'new', 'nothing', 'of', 'or', 'otherwise', 'render', 'return', 'throw', 'to',
  'true', 'throw', 'try', 'type', 'when', 'while', 'with', 'false',
]);

// Multi-character operators, longest first.
const OPERATORS = [
  '...', '|>', '->', '=>', '?.', '??', '==', '!=', '<=', '>=',
  '+=', '-=', '*=', '/=', '%=', '**', '+', '-', '*', '/', '%', '<', '>',
  '=', '(', ')', '[', ']', '{', '}', ',', ':', '.', '?',
];

const SIMPLE_ESCAPES = {
  n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'",
  '{': '{', '}': '}', '`': '`', b: '\b', f: '\f', v: '\v',
};

class Lexer {
  constructor(source, file) {
    this.source = source;
    this.file = file || '<input>';
    this.i = 0;
    this.line = 1;
    this.lineStart = 0;
    this.tokens = [];
    this.comments = [];
    this.errors = [];
  }

  col() {
    return this.i - this.lineStart + 1;
  }

  at(offset = 0) {
    return this.source[this.i + offset];
  }

  advance(count = 1) {
    for (let n = 0; n < count; n += 1) {
      if (this.source[this.i] === '\n') {
        this.line += 1;
        this.lineStart = this.i + 1;
      }
      this.i += 1;
    }
  }

  report(code, message, line, column, length = 1, hint) {
    this.errors.push(error(code, message, new Span(this.file, line, column, length), hint ? { hint } : {}));
  }

  push(t, v, line, column, extra) {
    this.tokens.push(Object.assign({ t, v, line, col: column }, extra || {}));
  }

  tokenize() {
    while (this.i < this.source.length) {
      const ch = this.source[this.i];

      if (ch === '\n') { this.advance(); continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') { this.advance(); continue; }

      // A shebang is a comment on the first line, like every other '#'
      // comment; keeping it in the comment list lets the formatter preserve it.
      if (ch === '#') {
        const line = this.line;
        const column = this.col();
        const start = this.i;
        while (this.i < this.source.length && this.source[this.i] !== '\n') this.advance();
        this.comments.push({
          v: this.source.slice(start + 1, this.i),
          line,
          col: column,
          raw: this.source.slice(start, this.i),
        });
        continue;
      }

      const line = this.line;
      const column = this.col();

      if (ch === '"' || ch === "'") {
        this.readString(line, column);
        continue;
      }

      if (this.isDigit(ch)) {
        this.readNumber(line, column);
        continue;
      }

      if (this.isIdentStart(ch)) {
        const start = this.i;
        while (this.i < this.source.length && this.isIdentPart(this.source[this.i])) this.advance();
        const word = this.source.slice(start, this.i);
        this.push(KEYWORDS.has(word) ? 'kw' : 'ident', word, line, column);
        continue;
      }

      let matched = null;
      for (const op of OPERATORS) {
        if (this.source.startsWith(op, this.i)) { matched = op; break; }
      }
      if (!matched) {
        this.report('PS1001', `Unexpected character ${JSON.stringify(ch)}.`, line, column);
        this.advance();
        continue;
      }
      this.advance(matched.length);
      this.push('punct', matched, line, column);
    }

    this.push('eof', '', this.line, this.col());
    return { tokens: this.tokens, comments: this.comments, errors: this.errors };
  }

  isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  isIdentStart(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  isIdentPart(ch) {
    return this.isIdentStart(ch) || this.isDigit(ch);
  }

  readNumber(line, column) {
    const start = this.i;
    if (this.source[this.i] === '0' && (this.source[this.i + 1] === 'x' || this.source[this.i + 1] === 'X')) {
      this.advance(2);
      while (this.i < this.source.length && /[0-9a-fA-F_]/.test(this.source[this.i])) this.advance();
      const text = this.source.slice(start, this.i);
      const value = Number.parseInt(text.slice(2).replace(/_/g, ''), 16);
      if (Number.isNaN(value)) {
        this.report('PS1002', `Invalid hexadecimal literal ${JSON.stringify(text)}.`, line, column, text.length);
        return;
      }
      this.push('number', String(value), line, column);
      return;
    }
    if (this.source[this.i] === '0' && (this.source[this.i + 1] === 'b' || this.source[this.i + 1] === 'B')) {
      this.advance(2);
      while (this.i < this.source.length && /[01_]/.test(this.source[this.i])) this.advance();
      const text = this.source.slice(start, this.i);
      const value = Number.parseInt(text.slice(2).replace(/_/g, ''), 2);
      if (Number.isNaN(value)) {
        this.report('PS1002', `Invalid binary literal ${JSON.stringify(text)}.`, line, column, text.length);
        return;
      }
      this.push('number', String(value), line, column);
      return;
    }

    while (this.i < this.source.length && (this.isDigit(this.source[this.i]) || this.source[this.i] === '_')) this.advance();
    if (this.source[this.i] === '.' && this.isDigit(this.source[this.i + 1])) {
      this.advance();
      while (this.i < this.source.length && (this.isDigit(this.source[this.i]) || this.source[this.i] === '_')) this.advance();
    }
    if (this.source[this.i] === 'e' || this.source[this.i] === 'E') {
      let lookahead = 1;
      if (this.source[this.i + lookahead] === '+' || this.source[this.i + lookahead] === '-') lookahead += 1;
      if (this.isDigit(this.source[this.i + lookahead])) {
        this.advance(lookahead);
        while (this.i < this.source.length && this.isDigit(this.source[this.i])) this.advance();
      }
    }
    const text = this.source.slice(start, this.i).replace(/_/g, '');
    this.push('number', String(Number(text)), line, column);
  }

  // Reads "..." (interpolating), '...' (raw), """...""" (multiline,
  // interpolating) and '''...''' (multiline, raw). Interpolation is `{expr}`;
  // a brace with no matching close is literal text.
  readString(line, column) {
    const quote = this.source[this.i];
    const triple = this.source.startsWith(quote.repeat(3), this.i);
    const delimiter = triple ? quote.repeat(3) : quote;
    const interpolate = quote === '"';
    this.advance(delimiter.length);

    const parts = [];
    let text = '';
    let terminated = false;

    while (this.i < this.source.length) {
      if (this.source.startsWith(delimiter, this.i)) {
        this.advance(delimiter.length);
        terminated = true;
        break;
      }
      const ch = this.source[this.i];

      if (!triple && ch === '\n') break;

      if (ch === '\\') {
        const escaped = this.readEscape(line, column);
        text += escaped;
        continue;
      }

      if (interpolate && ch === '{') {
        const isEscaped = false;
        if (!isEscaped) {
          const part = this.readInterpolation(line, column);
          if (part) {
            if (text) { parts.push({ t: 'text', v: text }); text = ''; }
            parts.push(part);
            continue;
          }
        }
      }

      text += ch;
      this.advance();
    }

    if (!terminated) {
      this.report('PS1003', 'Unterminated string literal.', line, column, Math.max(1, this.i - this.lineStart));
    }

    if (parts.length === 0) {
      const value = triple ? text.replace(/^\r?\n/, '') : text;
      this.push('text', value, line, column, { raw: interpolate ? false : true });
      return;
    }
    if (text) parts.push({ t: 'text', v: text });
    if (triple && parts[0] && parts[0].t === 'text') {
      parts[0] = { t: 'text', v: parts[0].v.replace(/^\r?\n/, '') };
    }
    this.push('template', null, line, column, { parts });
  }

  readEscape(line, column) {
    this.advance(); // backslash
    const ch = this.source[this.i];
    if (ch === undefined) return '';
    if (ch === 'u') {
      if (this.source[this.i + 1] === '{') {
        const close = this.source.indexOf('}', this.i + 2);
        if (close !== -1) {
          const hex = this.source.slice(this.i + 2, close);
          this.advance(close - this.i + 1);
          const code = Number.parseInt(hex, 16);
          if (Number.isNaN(code)) {
            this.report('PS1004', `Invalid unicode escape \\u{${hex}}.`, line, column);
            return '';
          }
          return String.fromCodePoint(code);
        }
      }
      const hex = this.source.slice(this.i + 1, this.i + 5);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        this.advance(5);
        return String.fromCharCode(Number.parseInt(hex, 16));
      }
      this.report('PS1004', 'Invalid unicode escape; expected four hex digits.', line, column);
      this.advance();
      return '';
    }
    this.advance();
    if (Object.prototype.hasOwnProperty.call(SIMPLE_ESCAPES, ch)) return SIMPLE_ESCAPES[ch];
    // Unknown escapes stay literal, like JavaScript. This keeps Windows paths
    // in raw strings predictable instead of silently dropping characters.
    return ch;
  }

  // Scans a balanced { ... } interpolation and returns its expression source.
  readInterpolation(line, column) {
    const start = this.i;
    let depth = 0;
    let cursor = this.i;
    let scanLine = this.line;
    let scanLineStart = this.lineStart;

    const step = () => {
      if (this.source[cursor] === '\n') {
        scanLine += 1;
        scanLineStart = cursor + 1;
      }
      cursor += 1;
    };

    while (cursor < this.source.length) {
      const ch = this.source[cursor];
      if (ch === '{') { depth += 1; step(); continue; }
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const src = this.source.slice(start + 1, cursor);
          const exprLine = scanLine;
          const exprCol = start + 1 - (this.lineStartFor(start) ) + 1;
          this.i = cursor + 1;
          this.line = scanLine;
          this.lineStart = scanLineStart;
          return { t: 'expr', src, line: exprLine, col: Math.max(1, exprCol) };
        }
        step();
        continue;
      }
      if (ch === '"' || ch === "'") {
        const quote = ch;
        step();
        while (cursor < this.source.length && this.source[cursor] !== quote) {
          if (this.source[cursor] === '\\') step();
          step();
        }
        step();
        continue;
      }
      step();
    }

    // No closing brace: treat the '{' as literal text.
    this.i = start;
    this.line = line;
    this.lineStart = this.source.lastIndexOf('\n', start) + 1;
    return null;
  }

  lineStartFor(index) {
    const nl = this.source.lastIndexOf('\n', index - 1);
    return nl + 1;
  }
}

function tokenize(source, file) {
  return new Lexer(source, file).tokenize();
}

module.exports = { tokenize, KEYWORDS, Lexer };
