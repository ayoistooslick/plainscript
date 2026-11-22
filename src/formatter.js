'use strict';

const { tokenize } = require('./lexer');
const { CompileError } = require('./diagnostics');

// The formatter is deliberately conservative: it normalises indentation (four
// spaces per block), trims trailing whitespace, and collapses runs of blank
// lines. It never rewrites tokens, so formatting cannot change a program's
// meaning, and comments survive because lines are preserved verbatim apart
// from their leading indentation.

const OPENER_WORDS = new Set([
  'if', 'else', 'for', 'while', 'match', 'case', 'try', 'catch',
  'finally', 'render', 'element',
]);

const DEDENT_WORDS = new Set(['end', 'else', 'catch', 'finally']);

function tokensByLine(tokens) {
  const byLine = new Map();
  for (const token of tokens) {
    if (token.t === 'eof') continue;
    if (!byLine.has(token.line)) byLine.set(token.line, []);
    byLine.get(token.line).push(token);
  }
  return byLine;
}

function format(source, file, options = {}) {
  const result = tokenize(source, file, options);
  if (result.errors.length) throw new CompileError(result.errors);
  const dialect = result.dialect;

  const byLine = tokensByLine(result.tokens);
  const sourceLines = source.split('\n');
  const output = [];
  let depth = 0;
  let blankRun = 0;

  sourceLines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    const tokens = byLine.get(lineNumber) || [];

    if (!trimmed) {
      blankRun += 1;
      if (blankRun <= 1 && output.length > 0) output.push('');
      return;
    }
    blankRun = 0;

    const words = tokens.filter((token) => token.t === 'kw').map((token) => token.v);
    const firstWord = tokens.length && tokens[0].t === 'kw' ? tokens[0].v : null;
    const dedent = firstWord !== null && DEDENT_WORDS.has(firstWord);
    const indentDepth = Math.max(0, depth - (dedent ? 1 : 0));

    output.push(`${'    '.repeat(indentDepth)}${trimmed}`);

    let openers = 0;
    let closers = 0;
    const hasDeclare = words.includes('declare');
    const hasEquals = tokens.some((token) => token.t === 'punct' && token.v === '=');

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      // `class` is contextual: `class Name` opens a class body, while
      // `let class = 1` is an ordinary name.
      if (token.t === 'ident' && token.v === 'class'
        && tokens[index + 1] && tokens[index + 1].t === 'ident'
        && !tokens.slice(0, index).some((previous) => previous.t === 'punct' && previous.v === '=')) {
        openers += 1;
        continue;
      }
      if (token.t === 'ident' && token.v === 'constructor'
        && tokens[index + 1] && tokens[index + 1].t === 'punct' && tokens[index + 1].v === '(') {
        openers += 1;
        continue;
      }
      if (token.t === 'ident' && dialect === '2.1' && token.v === 'define') { openers += 1; continue; }
      if (token.t !== 'kw') continue;
      if (token.v === 'end') closers += 1;
      else if (OPENER_WORDS.has(token.v)) openers += 1;
      else if (token.v === 'function' && !hasDeclare) openers += 1;
      else if (token.v === 'type' && !hasEquals) openers += 1;
    }
    if (firstWord === 'else' && words.includes('if')) openers -= 1;
    if (firstWord === 'end') {
      depth = indentDepth + openers - Math.max(0, closers - 1);
    } else {
      depth = Math.max(0, indentDepth + openers - closers);
    }
  });

  while (output.length && output[output.length - 1] === '') output.pop();
  return `${output.join('\n')}\n`;
}

module.exports = { format };
