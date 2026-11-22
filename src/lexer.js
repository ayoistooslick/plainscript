'use strict';

const { Span, error } = require('./diagnostics');
const { detectDialect, applyDialect } = require('./dialect');

// PlainScript 2.0 has exactly one spelling per concept. This set is the
// complete reserved vocabulary: nothing here is contextual, and nothing
// outside it can introduce a block.
const KEYWORDS = new Set([
  'and', 'as', 'async', 'await', 'break', 'case', 'catch', 'const',
  'continue', 'declare', 'default', 'do', 'element', 'else', 'end', 'export', 'finally',
  'for', 'from', 'function', 'if', 'import', 'in', 'is', 'let', 'match', 'not',
  'new', 'nothing', 'of', 'or', 'otherwise', 'render', 'return', 'throw', 'to',
  'true', 'throw', 'try', 'type', 'when', 'while', 'with', 'false',
]);

// Multi-character operators, longest first.
const OPERATORS = [
  '...', '|>', '->', '=>', '?.', '??', '==', '!=', '<=', '>=',
  '+=', '-=', '*=', '/=', '%=', '**', '+', '-', '*', '/', '%', '<', '>',
  '=', '(', ')', '[', ']', '{', '}', ',', ':', '.', '?', '&',
];

const SIMPLE_ESCAPES = {
  n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'",
  '{': '{', '}': '}', '`': '`', b: '\b', f: '\f', v: '\v',
};

class Lexer {
  constructor(source, file, options = {}) {
    this.source = source;
    this.file = file || '<input>';
    // A pragma on the first line overrides the project default, so a single
    // legacy module can live in a 2.1 project.
    this.detection = detectDialect(source, this.file, options.dialect || null);
    this.dialect = this.detection.version;
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

      // A slash is a regular-expression literal when the previous token cannot
      // end an expression, and division otherwise. This is the same syntactic
      // position rule JavaScript engines use; keeping it in the lexer means the
      // parser sees one `regex` token and never has to guess.
      if (ch === '/' && this.regexAllowed()) {
        this.readRegex(line, column);
        continue;
      }

      // `<` opens a JSX element only where an expression can start and the
      // next character can begin a tag. `a < b` and `Box<number>` therefore
      // stay comparison/generic syntax.
      if (ch === '<' && this.jsxAllowed()) {
        this.readJSX(line, column);
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
    return {
      tokens: applyDialect(this.tokens, this.dialect),
      comments: this.comments,
      errors: [...this.detection.errors, ...this.errors],
      dialect: this.dialect,
    };
  }

  isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  // True when the next token begins an expression. After a value (a name,
  // literal, or closing bracket) `/` is the division operator instead.
  regexAllowed() {
    const last = this.tokens[this.tokens.length - 1];
    if (!last) return true;
    if (last.t === 'number' || last.t === 'text' || last.t === 'template'
      || last.t === 'regex' || last.t === 'ident') return false;
    if (last.t === 'punct' && (last.v === ')' || last.v === ']' || last.v === '}')) return false;
    if (last.t === 'kw' && (last.v === 'true' || last.v === 'false' || last.v === 'nothing')) return false;
    return true;
  }

  jsxAllowed() {
    if (!this.regexAllowed()) return false;
    const next = this.source[this.i + 1];
    return next === '>' || next === '_' || (next >= 'A' && next <= 'Z') || (next >= 'a' && next <= 'z');
  }

  // Scans one complete JSX element or fragment as a structured token. Keeping
  // the scanner in the lexer means `<` never has to be re-interpreted by the
  // expression parser, and a mismatched closing tag is reported at the tag
  // that fails to close.
  readJSX(line, column) {
    const start = this.i;
    const node = this.scanJSXElement();
    if (!node) {
      // Not JSX after all (for example `<abc` at the start of a comparison).
      this.push('punct', '<', line, column);
      this.advance();
      return;
    }
    this.push('jsx', null, line, column, { node, raw: this.source.slice(start, this.i) });
  }

  scanJSXElement() {
    const line = this.line;
    const column = this.col();
    if (this.source[this.i] !== '<') return null;
    this.advance();

    if (this.source[this.i] === '>') {
      this.advance();
      const children = this.scanJSXChildren(null, line, column);
      return { type: 'fragment', children, line, column };
    }

    const tag = this.scanJSXTagName();
    if (!tag) {
      this.report('PS1009', 'Expected a JSX tag name after "<".', line, column);
      return { type: 'fragment', children: [], line, column };
    }

    const attrs = [];
    let selfClosing = false;
    let closed = false;

    while (this.i < this.source.length) {
      this.skipJSXSpace();
      if (this.source[this.i] === '/' && this.source[this.i + 1] === '>') {
        this.advance(2);
        selfClosing = true;
        closed = true;
        break;
      }
      if (this.source[this.i] === '>') {
        this.advance();
        closed = true;
        break;
      }
      if (this.source[this.i] === '{') {
        const at = { line: this.line, col: this.col() };
        const src = this.scanJSXExpression();
        attrs.push({ kind: 'spread', src, line: at.line, col: at.col });
        continue;
      }
      const nameStart = { line: this.line, col: this.col() };
      let name = '';
      while (this.i < this.source.length && /[A-Za-z0-9_$:-]/.test(this.source[this.i])) {
        name += this.source[this.i];
        this.advance();
      }
      if (!name) {
        this.report('PS1010', 'Expected a JSX attribute name.', this.line, this.col());
        this.advance();
        continue;
      }
      this.skipJSXSpace();
      if (this.source[this.i] === '=') {
        this.advance();
        this.skipJSXSpace();
        const quote = this.source[this.i];
        if (quote === '"' || quote === "'") {
          this.advance();
          let raw = '';
          while (this.i < this.source.length && this.source[this.i] !== quote) {
            if (this.source[this.i] === '\\' && this.source[this.i + 1] === quote) {
              raw += quote;
              this.advance(2);
              continue;
            }
            raw += this.source[this.i];
            this.advance();
          }
          this.advance();
          attrs.push({ kind: 'attr', name, valueKind: 'text', value: decodeJSXEntities(raw), line: nameStart.line, col: nameStart.col });
        } else if (quote === '{') {
          const src = this.scanJSXExpression();
          attrs.push({ kind: 'attr', name, valueKind: 'expression', value: src, line: nameStart.line, col: nameStart.col });
        } else {
          this.report('PS1011', `Expected a quoted text value or an expression for JSX attribute "${name}".`, nameStart.line, nameStart.col);
          attrs.push({ kind: 'attr', name, valueKind: 'text', value: '', line: nameStart.line, col: nameStart.col });
        }
      } else {
        attrs.push({ kind: 'attr', name, valueKind: 'boolean', value: true, line: nameStart.line, col: nameStart.col });
      }
    }

    if (!closed) {
      this.report('PS1012', `Unclosed JSX element <${tag}>.`, line, column);
      return { type: 'element', tag, attrs, children: [], selfClosing: true, line, column };
    }

    if (selfClosing) return { type: 'element', tag, attrs, children: [], selfClosing: true, line, column };

    const children = this.scanJSXChildren(tag, line, column);
    return { type: 'element', tag, attrs, children, selfClosing: false, line, column };
  }

  scanJSXTagName() {
    let name = '';
    while (this.i < this.source.length) {
      const ch = this.source[this.i];
      if (/[A-Za-z0-9_$]/.test(ch) || ch === '.' || ch === ':' || ch === '-') {
        name += ch;
        this.advance();
      } else {
        break;
      }
    }
    if (!name || !/[A-Za-z_$]/.test(name[0])) return null;
    return name;
  }

  scanJSXChildren(tag, openLine, openColumn) {
    const children = [];
    while (this.i < this.source.length) {
      if (this.source[this.i] === '<' && this.source[this.i + 1] === '/') {
        const at = { line: this.line, col: this.col() };
        this.advance(2);
        this.skipJSXSpace();
        const closing = this.scanJSXTagName();
        this.skipJSXSpace();
        if (this.source[this.i] === '>') this.advance();
        if (tag === null) {
          if (closing !== null) {
            this.report('PS1013', 'A JSX fragment closes with "</>", not a tag name.', at.line, at.col);
          }
        } else if (closing !== tag) {
          this.report('PS1013', `JSX element <${tag}> is closed by </${closing || ''}>.`, at.line, at.col);
        }
        return children;
      }

      if (this.source[this.i] === '<') {
        const child = this.scanJSXElement();
        if (child) {
          children.push(child);
        } else {
          // A `<` that cannot begin a tag is literal text, not a loop.
          children.push({ type: 'text', value: '<', line: this.line, column: this.col() });
          this.advance();
        }
        continue;
      }

      if (this.source[this.i] === '{') {
        const at = { line: this.line, col: this.col() };
        const spread = this.source.startsWith('{...', this.i);
        const src = this.scanJSXExpression();
        children.push({ type: spread ? 'spread' : 'expression', src, line: at.line, col: at.col });
        continue;
      }

      const at = { line: this.line, col: this.col() };
      let raw = '';
      while (this.i < this.source.length && this.source[this.i] !== '<' && this.source[this.i] !== '{') {
        raw += this.source[this.i];
        this.advance();
      }
      const value = normaliseJSXText(raw);
      if (value) children.push({ type: 'text', value, line: at.line, column: at.col });
    }

    this.report('PS1012', tag === null ? 'Unclosed JSX fragment.' : `Unclosed JSX element <${tag}>.`, openLine, openColumn);
    return children;
  }

  // Scans `{ ... }` and returns the contained source without the braces. The
  // scanner tracks nested braces, strings, template literals and regexes so an
  // expression such as {items.map((x) => <li>{x}</li>)} is captured whole.
  scanJSXExpression() {
    const startLine = this.line;
    const startColumn = this.col();
    const start = this.i;
    let depth = 0;
    while (this.i < this.source.length) {
      const ch = this.source[this.i];
      if (ch === '"' || ch === "'") {
        const quote = ch;
        this.advance();
        while (this.i < this.source.length && this.source[this.i] !== quote) {
          if (this.source[this.i] === '\\') this.advance();
          this.advance();
        }
        this.advance();
        continue;
      }
      if (ch === '`') {
        this.advance();
        while (this.i < this.source.length && this.source[this.i] !== '`') {
          if (this.source[this.i] === '\\') this.advance();
          this.advance();
        }
        this.advance();
        continue;
      }
      if (ch === '/' && this.regexAllowedInJSX()) {
        this.advance();
        let inClass = false;
        while (this.i < this.source.length) {
          const c = this.source[this.i];
          if (c === '\\') { this.advance(2); continue; }
          if (c === '[') { inClass = true; this.advance(); continue; }
          if (c === ']') { inClass = false; this.advance(); continue; }
          if (c === '/' && !inClass) { this.advance(); break; }
          if (c === '\n') break;
          this.advance();
        }
        while (this.i < this.source.length && /[a-z]/i.test(this.source[this.i])) this.advance();
        continue;
      }
      if (ch === '{') { depth += 1; this.advance(); continue; }
      if (ch === '}') {
        depth -= 1;
        this.advance();
        if (depth === 0) {
          return { src: this.source.slice(start + 1, this.i - 1), line: startLine, col: startColumn };
        }
        continue;
      }
      this.advance();
    }
    this.report('PS1014', 'Unclosed JSX expression container.', startLine, startColumn);
    return { src: this.source.slice(start + 1), line: startLine, col: startColumn };
  }

  regexAllowedInJSX() {
    // `</` is a closing JSX tag, never a regex. This matters inside an
    // expression container that contains JSX, e.g. {xs.map(x => <li>{x}</li>)}.
    if (this.source[this.i + 1] === '>') return false;
    let cursor = this.i - 1;
    while (cursor >= 0 && /\s/.test(this.source[cursor])) cursor -= 1;
    if (cursor < 0) return true;
    if (this.source[cursor] === '<') return false;
    return /[([{,:;=!&|?+\-*%<>~^]/.test(this.source[cursor]);
  }

  skipJSXSpace() {
    while (this.i < this.source.length && /\s/.test(this.source[this.i])) this.advance();
  }

  // Scans /pattern/flags. A slash inside a character class is part of the
  // pattern, so `[/]` is one class and does not terminate the literal. The
  // literal is validated here so a malformed expression is a lexical error at
  // the exact source position instead of a runtime throw.
  readRegex(line, column) {
    const start = this.i;
    this.advance(); // opening slash
    let inClass = false;
    let terminated = false;

    while (this.i < this.source.length) {
      const ch = this.source[this.i];
      if (ch === '\n') break;
      if (ch === '\\') {
        this.advance(2);
        continue;
      }
      if (ch === '[') { inClass = true; this.advance(); continue; }
      if (ch === ']') { inClass = false; this.advance(); continue; }
      if (ch === '/' && !inClass) {
        this.advance();
        terminated = true;
        break;
      }
      this.advance();
    }

    if (!terminated) {
      this.report('PS1006', 'Unterminated regular expression literal.', line, column, Math.max(1, this.i - this.lineStart));
      const raw = this.source.slice(start, this.i);
      this.push('regex', raw, line, column, { pattern: raw.slice(1), flags: '' });
      return;
    }

    const pattern = this.source.slice(start + 1, this.i - 1);
    const flagsStart = this.i;
    while (this.i < this.source.length && this.isIdentPart(this.source[this.i])) this.advance();
    const flags = this.source.slice(flagsStart, this.i);

    if (/[^gimsuyvd]/.test(flags)) {
      this.report('PS1007', `Unsupported regular expression flag in /${pattern}/${flags}.`, line, column, this.i - start);
    }
    try {
      // Construction validates the pattern without using it. Flags are checked
      // above so the message names the offending flag precisely.
      new RegExp(pattern, flags.replace(/[^gimsuyvd]/g, ''));
    } catch (failure) {
      this.report('PS1008', `Invalid regular expression /${pattern}/${flags}: ${failure.message}`, line, column, this.i - start);
    }

    this.push('regex', this.source.slice(start, this.i), line, column, { pattern, flags });
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

// JSX text keeps meaningful words and collapses the indentation that makes a
// multi-line element readable. A text run without a newline is preserved
// exactly, including its spaces.
function normaliseJSXText(raw) {
  if (!raw) return '';
  if (!raw.includes('\n')) return raw;
  const lines = raw.split(/\r?\n/);
  const kept = [];
  lines.forEach((line, index) => {
    let value = line.replace(/\t/g, ' ');
    if (index !== 0) value = value.replace(/^[ ]+/, '');
    if (index !== lines.length - 1) value = value.replace(/[ ]+$/, '');
    if (value) kept.push(value);
  });
  return kept.join(' ');
}

const JSX_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0',
  copy: '\u00A9', reg: '\u00AE', trade: '\u2122', hellip: '\u2026',
  mdash: '\u2014', ndash: '\u2013', lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201C', rdquo: '\u201D', laquo: '\u00AB', raquo: '\u00BB',
  times: '\u00D7', divide: '\u00F7', plusmn: '\u00B1', frac12: '\u00BD',
  deg: '\u00B0', micro: '\u00B5', para: '\u00B6', sect: '\u00A7',
  bull: '\u2022', middot: '\u00B7', dagger: '\u2020', Dagger: '\u2021',
  permil: '\u2030', euro: '\u20AC', pound: '\u00A3', yen: '\u00A5', cent: '\u00A2',
  larr: '\u2190', uarr: '\u2191', rarr: '\u2192', darr: '\u2193', harr: '\u2194',
  lArr: '\u21D0', rArr: '\u21D2', hArr: '\u21D4', crarr: '\u21B5',
  forall: '\u2200', part: '\u2202', exist: '\u2203', empty: '\u2205',
  isin: '\u2208', notin: '\u2209', sum: '\u2211', prod: '\u220F',
  minus: '\u2212', radic: '\u221A', infin: '\u221E', ne: '\u2260',
  le: '\u2264', ge: '\u2265', asymp: '\u2248', equiv: '\u2261',
  cap: '\u2229', cup: '\u222A', sub: '\u2282', sup: '\u2283',
  sube: '\u2286', supe: '\u2287', oplus: '\u2295', otimes: '\u2297',
  perp: '\u22A5', sdot: '\u22C5', lceil: '\u2308', rceil: '\u2309',
  lfloor: '\u230A', rfloor: '\u230B', loz: '\u25CA', star: '\u2606',
  starf: '\u2605', check: '\u2713', cross: '\u2717', spades: '\u2660',
  clubs: '\u2663', hearts: '\u2665', diams: '\u2666', male: '\u2642', female: '\u2640',
};

function decodeJSXEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(JSX_ENTITIES, body) ? JSX_ENTITIES[body] : whole;
  });
}

function tokenize(source, file, options) {
  return new Lexer(source, file, options).tokenize();
}

module.exports = { tokenize, KEYWORDS, Lexer, decodeJSXEntities };
