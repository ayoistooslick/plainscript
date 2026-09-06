// Browser-interop compatibility guard for PlainScript v1.0.36.
//
// Dogfoods the browser/game canon in docs/GAME-PROMPT.md: every fenced
// PlainScript block must compile, and the canonical snippet keeps the emitted
// JS shapes documented in section 16 (addEventListener, self-scheduling rAF,
// scaled setTimeout, async IIFE for promise builtins). Pure compile-time string
// checks — deterministic and fast, no network or timers.

const fs = require('fs');
const path = require('path');
const { tokenize } = require('../../compiler/lexer');
const { parse } = require('../../compiler/parser');
const { generate, createGenerationContext, wrapAsync } = require('../../compiler/generator');
const { test, assert, summary } = require('./_util');

function assertIncludes(actual, expected) {
  assert(String(actual).includes(expected),
    `Expected to include:\n        ${expected}\n        Got:\n        ${String(actual).trim()}`);
}

function compileProgram(source) {
  const context = createGenerationContext();
  let js = generate(parse(tokenize(source)), context);
  if (context.needsAsync) js = wrapAsync(js);
  return js;
}

const GAME_PROMPT = path.join(__dirname, '..', '..', 'docs', 'GAME-PROMPT.md');

test('every fenced PlainScript block in docs/GAME-PROMPT.md compiles', () => {
  const source = fs.readFileSync(GAME_PROMPT, 'utf8');
  const fences = /```([^\n`]*)\r?\n([\s\S]*?)```/g;
  let count = 0;
  let match;
  while ((match = fences.exec(source))) {
    if (!['plainscript', 'pln'].includes(match[1].trim().toLowerCase())) continue;
    count++;
    try {
      compileProgram(match[2]);
    } catch (e) {
      throw new Error(`docs/GAME-PROMPT.md PlainScript block ${count}: ${e.message}`);
    }
  }
  if (count < 1) throw new Error('no PlainScript documentation blocks found in GAME-PROMPT.md');
  console.log(`        checked ${count} fenced blocks`);
});

test('browser builtins do not shadow the text stdlib', () => {
  assertIncludes(compileProgram('show text(5)'), 'String(5)');
  assertIncludes(compileProgram('show text(0x40c463)'), 'String(4244579)');
});

test('canonical GAME-PROMPT.md snippet keeps its documented JS shape', () => {
  const js = compileProgram([
    'remember s as new THREE.Scene()',
    'remember canvas as document.getElementById("game")',
    'remember ctx as canvas.getContext("2d")',
    'when document "keydown" happens as ke',
    '    show ke.key',
    'done',
    'every frame',
    '    ctx.clearRect(0, 0, 640, 480)',
    'done',
    'after 0.5 seconds',
    '    show "tick"',
    'done',
    'remember bg as loadImage("img.png")',
  ].join('\n'));
  for (const shape of [
    '(async () => {',
    'new THREE.Scene()',
    'document.addEventListener("keydown", function (ke) {',
    'console.log(ke.key);',
    'requestAnimationFrame(function __frame(__frameTime) {',
    'requestAnimationFrame(__frame);',
    'setTimeout(() => {',
    '0.5 * 1000',
    '(await __loadImage("img.png"))',
  ]) assertIncludes(js, shape);
});

summary();