'use strict';

// Diagnostics are the compiler's only user-facing failure channel. Every
// error has a stable code, a source span, and (where possible) a hint. Codes
// are grouped by layer so tooling can classify them:
//
//   PS1xxx  lexical       PS2xxx  syntax        PS3xxx  types
//   PS4xxx  modules       PS5xxx  compiler/internal
//   PS6xxx  configuration and CLI

class Span {
  constructor(file, line, column, length = 1) {
    this.file = file || '<input>';
    this.line = line || 1;
    this.column = column || 1;
    this.length = Math.max(1, length || 1);
  }
}

class Diagnostic {
  constructor(code, message, span, options = {}) {
    this.code = code;
    this.message = message;
    this.span = span instanceof Span ? span : new Span();
    this.severity = options.severity || 'error';
    this.hint = options.hint || null;
  }
}

class CompileError extends Error {
  constructor(diagnostics) {
    const list = Array.isArray(diagnostics) ? diagnostics : [diagnostics];
    super(list.map((d) => `${d.code}: ${d.message}`).join('\n'));
    this.name = 'CompileError';
    this.diagnostics = list;
  }
}

function error(code, message, span, options) {
  return new Diagnostic(code, message, span, options);
}

// Renders one diagnostic with the offending source line and a caret. The
// renderer is deterministic and colour-free so it can be asserted in tests and
// piped into editors.
function formatDiagnostic(diagnostic, sourceText) {
  const { span } = diagnostic;
  const head = `${span.file}:${span.line}:${span.column}: ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
  const lines = [head];

  if (typeof sourceText === 'string') {
    const sourceLines = sourceText.split('\n');
    const lineText = sourceLines[span.line - 1];
    if (lineText !== undefined) {
      const gutter = String(span.line);
      const pad = ' '.repeat(gutter.length);
      lines.push(`${pad} |`);
      lines.push(`${gutter} | ${lineText.replace(/\t/g, '    ')}`);
      const caret = ' '.repeat(Math.max(0, span.column - 1)) + '^'.repeat(Math.min(span.length, Math.max(1, lineText.length - span.column + 1)));
      lines.push(`${pad} | ${caret}`);
    }
  }

  if (diagnostic.hint) lines.push(`hint: ${diagnostic.hint}`);
  return lines.join('\n');
}

function formatDiagnostics(diagnostics, sources = new Map()) {
  return diagnostics
    .map((d) => formatDiagnostic(d, sources.get(d.span.file)))
    .join('\n\n');
}

module.exports = {
  Span,
  Diagnostic,
  CompileError,
  error,
  formatDiagnostic,
  formatDiagnostics,
};
