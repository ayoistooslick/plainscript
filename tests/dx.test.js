// Tests for Phase 1 DX: Rich Diagnostics and Interactive REPL.

const { test, assert } = require('./compat/_util');
const { formatDiagnostic, parseLocation } = require('../compiler/diagnostics');
const { needsMoreInput, evaluateSnippet } = require('../compiler/repl');
const vm = require('vm');

test('diagnostics: parses location from standard error strings', () => {
  const loc = parseLocation('test.pln — Line 4, Column 7: Unknown keyword "foo"');
  assert(loc.filePath === 'test.pln', `expected test.pln, got ${loc.filePath}`);
  assert(loc.line === 4, `expected line 4, got ${loc.line}`);
  assert(loc.col === 7, `expected col 7, got ${loc.col}`);
  assert(loc.message.includes('Unknown keyword "foo"'), `unexpected message: ${loc.message}`);
});

test('diagnostics: formats source line snippet with pointer caret', () => {
  const source = 'remember x as 10\nremembr y as 20\nshow y\n';
  const out = formatDiagnostic('test.pln — Line 2, Column 1: Unknown keyword "remembr" (did you mean "remember"?)', {
    filePath: 'test.pln',
    source,
    useColor: false,
  });

  assert(out.includes('error:'), `missing error banner: ${out}`);
  assert(out.includes('--> test.pln:2:1'), `missing file location: ${out}`);
  assert(out.includes('remembr y as 20'), `missing target line: ${out}`);
  assert(out.includes('^^^^^^^'), `missing pointer carets: ${out}`);
  assert(out.includes('= help:'), `missing help section: ${out}`);
  assert(out.includes('did you mean "remember"?'), `missing suggestion: ${out}`);
});

test('diagnostics: graceful fallback when source is unavailable', () => {
  const out = formatDiagnostic('Line 10, Column 2: Syntax error', { useColor: false });
  assert(out.includes('error: Syntax error'), `unexpected fallback: ${out}`);
});

test('repl: needsMoreInput detects unclosed blocks', () => {
  assert(needsMoreInput('make add(a, b)') === true, 'function without done should need more');
  assert(needsMoreInput('make add(a, b)\n  give a + b\ndone') === false, 'closed function should be complete');
  assert(needsMoreInput('if score is at least 50') === true, 'if without done should need more');
  assert(needsMoreInput('if score is at least 50\n  show "pass"\ndone') === false, 'closed if should be complete');
  assert(needsMoreInput('remember arr as [1, 2,') === true, 'unclosed bracket should need more');
});

test('repl: evaluateSnippet runs statements and stores state', () => {
  const ctx = vm.createContext({ console, process });
  evaluateSnippet('remember points as 100', ctx);
  assert(ctx.points === 100, `expected points 100, got ${ctx.points}`);

  evaluateSnippet('points becomes points + 50', ctx);
  assert(ctx.points === 150, `expected points 150, got ${ctx.points}`);
});

const { summary } = require('./compat/_util');
summary();
