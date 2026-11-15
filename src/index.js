'use strict';

const { tokenize } = require('./lexer');
const { parse } = require('./parser');
const { checkModule } = require('./checker');
const { lowerProgram } = require('./hir');
const { generate } = require('./codegen');
const { format } = require('./formatter');
const { Compiler, compileFileOrThrow } = require('./modules');
const { VERSION } = require('./version');
const { CompileError, Diagnostic, Span, formatDiagnostic, formatDiagnostics } = require('./diagnostics');

// Compiles a source string in memory. Import resolution is limited to the
// provided callback; for real projects use Compiler (or the CLI), which
// understands relative paths and the standard library.
function compile(source, options = {}) {
  return compileFileOrThrow(source, options);
}

function version() {
  return VERSION;
}

module.exports = {
  VERSION,
  version,
  compile,
  compileFileOrThrow,
  format,
  parse,
  tokenize,
  checkModule,
  lowerProgram,
  generate,
  Compiler,
  CompileError,
  Diagnostic,
  Span,
  formatDiagnostic,
  formatDiagnostics,
};
