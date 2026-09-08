// Diagnostics: Rust/Elm-style terminal error reporting for PlainScript.
// Provides source line context, line/column coordinates, ASCII underline pointers,
// and actionable help / "did you mean?" notes.

const fs   = require('fs');
const path = require('path');

function hasColorSupport(options) {
  if (options && typeof options.useColor === 'boolean') return options.useColor;
  return Boolean(process.stdout && process.stdout.isTTY);
}

function parseLocation(err, fallbackPath) {
  let filePath = fallbackPath || null;
  let line = null;
  let col = null;
  let rawMessage = typeof err === 'string' ? err : (err && err.message) || String(err);

  // Pattern: "path/to/file.pln — Line 3, Column 5: message"
  const prefixMatch = rawMessage.match(/^(.+?\.pln)\s+[—\-]\s+(.*)$/);
  if (prefixMatch) {
    filePath = prefixMatch[1].trim();
    rawMessage = prefixMatch[2].trim();
  }

  // Pattern: "Line 12, Column 5: message" or "Line 12: message"
  const lineColMatch = rawMessage.match(/Line\s+(\d+)(?:,\s*Column\s+(\d+))?[:\s]+(.*)$/i);
  if (lineColMatch) {
    line = parseInt(lineColMatch[1], 10);
    col = lineColMatch[2] ? parseInt(lineColMatch[2], 10) : 1;
    rawMessage = lineColMatch[3].trim();
  }

  // Direct error object properties if present
  if (err && typeof err === 'object') {
    if (typeof err.line === 'number') line = err.line;
    if (typeof err.col === 'number') col = err.col;
    if (err.filePath) filePath = err.filePath;
  }

  return { filePath, line, col, message: rawMessage };
}

function extractHelp(message) {
  // Extract "did you mean ..." suggestion
  const dymMatch = message.match(/\(?(did you mean [^?)]+\??)\)?/i);
  if (dymMatch) {
    return dymMatch[1].replace(/^\(/, '').replace(/\)$/, '').trim();
  }
  if (/missing (?:closing )?["']?done["']?/i.test(message) || /expected ["']?done["']?/i.test(message)) {
    return 'Ensure every "make", "if", "for", "while", or "route" block is closed with "done".';
  }
  return null;
}

function formatDiagnostic(err, options = {}) {
  const useColor = hasColorSupport(options);
  const c = (code, str) => useColor ? `\x1b[${code}m${str}\x1b[0m` : str;
  const boldRed  = (s) => c('1;31', s);
  const boldCyan = (s) => c('1;36', s);
  const cyan     = (s) => c('36',   s);
  const boldGreen= (s) => c('1;32', s);
  const dim      = (s) => c('2',    s);

  const { filePath, line, col, message } = parseLocation(err, options.filePath);
  let source = options.source || null;

  if (!source && filePath && fs.existsSync(filePath)) {
    try {
      source = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      source = null;
    }
  }

  const helpNote = extractHelp(message);
  const displayFile = filePath
    ? (path.relative(process.cwd(), filePath) || path.basename(filePath))
    : '<source>';

  // If no source code or line number available, output formatted error banner
  if (!source || !line) {
    const loc = filePath ? ` [${displayFile}]` : '';
    let out = `${boldRed('error:')} ${message}${loc}`;
    if (helpNote) {
      out += `\n  ${boldGreen('= help:')} ${helpNote}`;
    }
    return out;
  }

  const lines = source.split(/\r?\n/);
  if (line < 1 || line > lines.length) {
    return `${boldRed('error:')} ${message} (${displayFile}:${line}:${col || 1})`;
  }

  const targetLineText = lines[line - 1];
  const colNum = (col && col > 0) ? col : 1;

  // Determine span of the error token on the line
  let span = 1;
  const restOfLine = targetLineText.slice(colNum - 1);
  const tokenMatch = restOfLine.match(/^[A-Za-z0-9_]+/);
  if (tokenMatch && tokenMatch[0].length > 0) {
    span = tokenMatch[0].length;
  }

  const lineNumStr = String(line);
  const gutterWidth = Math.max(lineNumStr.length, 2);
  const pad = (n) => String(n).padStart(gutterWidth, ' ');
  const emptyGutter = ' '.repeat(gutterWidth);

  const pointerSpaces = ' '.repeat(Math.max(0, colNum - 1));
  const pointers = '^'.repeat(Math.max(1, span));

  const output = [];
  output.push(`${boldRed('error:')} ${message}`);
  output.push(`  ${boldCyan('-->')} ${displayFile}:${line}:${colNum} [line ${line}, col ${colNum}]`);
  output.push(`  ${cyan(emptyGutter + ' |')}`);

  // Optional: 1 line of preceding context
  if (line > 1 && options.context !== false) {
    output.push(`  ${cyan(pad(line - 1) + ' |')} ${dim(lines[line - 2])}`);
  }

  // Target error line
  output.push(`  ${cyan(pad(line) + ' |')} ${targetLineText}`);
  output.push(`  ${cyan(emptyGutter + ' |')} ${pointerSpaces}${boldRed(pointers)}`);

  // Help note
  if (helpNote) {
    output.push(`  ${cyan(emptyGutter + ' |')}`);
    output.push(`  ${boldGreen('= help:')} ${helpNote}`);
  }

  return output.join('\n');
}

module.exports = { formatDiagnostic, parseLocation };
