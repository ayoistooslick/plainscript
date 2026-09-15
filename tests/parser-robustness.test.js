// Parser robustness suite (v1.0.364): the parser must never hang, never
// overflow the stack, and never leak a raw RangeError — every failure must be
// a clean PlainScript error, positionally anchored wherever a token exists.
//
// Run with: node tests/parser-robustness.test.js

const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

// A robust parser fails "well": not a RangeError ("Maximum call stack size
// exceeded" leaks Node internals), not a hang, and positional when possible.
function parseExpectClean(label, src, opts = {}) {
  const t0 = Date.now();
  try {
    parse(tokenize(src));
    const ms = Date.now() - t0;
    if (opts.expectError) {
      throw new Error(`${label}: expected a parse error but compilation succeeded (${ms}ms)`);
    }
    if (ms > 5000) {
      throw new Error(`${label}: valid program took ${ms}ms to parse (pathological)`);
    }
    return { ok: true, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    if (e instanceof RangeError) {
      throw new Error(`${label}: raw RangeError leaked (${ms}ms) — stack overflow must become a clean PlainScript error`);
    }
    if (!opts.expectError) {
      throw new Error(`${label}: unexpected parse failure (${ms}ms): ${e.message.slice(0, 200)}`);
    }
    if (ms > 5000) {
      throw new Error(`${label}: error took ${ms}ms (pathological)`);
    }
    if (opts.expectPositional && !/Line \d+, Column \d+/.test(e.message)) {
      throw new Error(`${label}: expected a positional error, got: ${e.message.slice(0, 200)}`);
    }
    return { ok: false, ms, message: e.message };
  }
}

// ── Deep nesting: invalid ────────────────────────────────────────────────────
// These used to crash with "Maximum call stack size exceeded" (no position).

test('depth: 1000 nested parentheses fails cleanly and positionally', () => {
  const r = parseExpectClean('parens-1000', 'remember x as ' + '('.repeat(1000) + '1' + ')'.repeat(1000), { expectError: true, expectPositional: true });
  if (!r.message.includes('nested more than')) throw new Error('expected a depth message, got: ' + r.message.slice(0, 120));
});

test('depth: 50000 unbalanced open parens fails cleanly and fast', () => {
  const r = parseExpectClean('parens-50000-unbal', 'remember x as ' + '('.repeat(50000), { expectError: true, expectPositional: true });
  if (r.ms > 2000) throw new Error('unbalanced input should fail fast, took ' + r.ms + 'ms');
});

test('depth: 1000 nested array literals fails cleanly and positionally', () => {
  parseExpectClean('arrays-1000', 'remember x as ' + '['.repeat(1000) + ']'.repeat(1000), { expectError: true, expectPositional: true });
});

test('depth: 50000 unbalanced open brackets fails cleanly', () => {
  parseExpectClean('arrays-50000-unbal', 'remember x as ' + '['.repeat(50000), { expectError: true, expectPositional: true });
});

test('depth: 1000 nested if blocks fails cleanly and positionally', () => {
  const r = parseExpectClean('if-1000', 'if 1\n'.repeat(1000) + 'show 1\n' + 'done\n'.repeat(1000), { expectError: true, expectPositional: true });
  if (!r.message.includes('nested more than')) throw new Error('expected a depth message, got: ' + r.message.slice(0, 120));
});

test('depth: 5000 unbalanced if blocks fails cleanly', () => {
  parseExpectClean('if-5000-unbal', 'if 1\n'.repeat(5000) + 'show 1\n', { expectError: true, expectPositional: true });
});

// ── Deep nesting: valid (must parse, and parse fast) ────────────────────────
// Before v1.0.364 the condition typo-probe re-parsed the whole remainder at
// every level: 150 nested ifs took ~3.2s, 200 took ~35s.

test('depth: 150 valid nested ifs parse in milliseconds', () => {
  const r = parseExpectClean('if-150-valid', 'if 1\n'.repeat(150) + 'show 1\n' + 'done\n'.repeat(150));
  if (r.ms > 2000) throw new Error('probe blowup is back: 150 ifs took ' + r.ms + 'ms');
});

test('depth: 200 valid nested ifs (at the limit) parse in milliseconds', () => {
  const r = parseExpectClean('if-200-valid', 'if 1\n'.repeat(200) + 'show 1\n' + 'done\n'.repeat(200));
  if (r.ms > 2000) throw new Error('probe blowup is back: 200 ifs took ' + r.ms + 'ms');
});

test('depth: 100 valid nested parentheses parse', () => {
  parseExpectClean('parens-100-valid', 'remember x as ' + '('.repeat(100) + '1' + ')'.repeat(100));
});

test('depth: long flat expression (1MB line) parses', () => {
  parseExpectClean('long-line', 'remember x as ' + '1+'.repeat(200000) + '1');
});

// ── Typo probes still teach (the probe must not be disabled into uselessness)

test('probe: typo comparison is still caught with the teaching error', () => {
  const r = parseExpectClean('typo-simple', 'if x bigger 1\n  show 1\ndone', { expectError: true, expectPositional: true });
  if (!r.message.includes('Expected a comparison')) throw new Error('expected the teaching error, got: ' + r.message.slice(0, 120));
});

test('probe: typo comparison still caught when body contains a while block', () => {
  const r = parseExpectClean('typo-with-block', 'if x bigger 1\n  while y\n  done\ndone', { expectError: true, expectPositional: true });
  if (!r.message.includes('Expected a comparison')) throw new Error('expected the teaching error, got: ' + r.message.slice(0, 120));
});

// ── Random token soups: deterministic, finite, clean ────────────────────────
// A seeded LCG keeps failures reproducible. Every soup must terminate quickly
// and either parse or throw a clean error — never a RangeError, never a hang.

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const SOUP_TOKENS = [
  'remember', 'show', 'if', 'otherwise', 'done', 'together', 'make', 'give',
  'x', 'y', 'foo', '1', '2.5', '"str"', '`tpl ${x}`', 'is', 'becomes', 'as',
  '(', ')', '[', ']', '{', '}', '+', '-', '*', '/', ',', 'and', 'or', 'not',
  'while', 'for', 'each', 'in', 'repeat', 'times', 'try', 'recover', 'raise',
  'when', 'happens', 'match', 'against', 'gather', 'filter', 'total', 'set',
  'use', 'bring', 'test', 'check', 'equals', 'contains', 'start', 'end',
];

test('fuzz: 200 seeded soups (templates + noise) terminate cleanly and fast', () => {
  const rand = lcg(20260915);
  // Structured soups: a valid statement template with random noise tokens
  // spliced in at random spots. Pure word salad almost never forms a valid
  // statement, so templates guarantee the "parses OK" path is exercised too.
  const templates = [
    (r) => `show ${1 + Math.floor(r() * 100)}`,
    (r) => `remember v${Math.floor(r() * 5)} as ${1 + Math.floor(r() * 100)}`,
    (r) => `if v${Math.floor(r() * 5)} is ${1 + Math.floor(r() * 100)}\n  show 1\ndone`,
    (r) => `make f${Math.floor(r() * 5)}()\n  give ${1 + Math.floor(r() * 10)}\ndone`,
    (r) => `remember lst${Math.floor(r() * 5)} as [1, 2, 3]`,
    (r) => `show v${Math.floor(r() * 5)} is above ${1 + Math.floor(r() * 50)}`,
    (r) => `repeat ${1 + Math.floor(r() * 5)} times\n  show 1\ndone`,
    (r) => `try\n  raise "x"\nrecover as e\n  show message of e\ndone`,
  ];
  let parsedCount = 0;
  let errorCount = 0;
  for (let i = 0; i < 200; i++) {
    let finalSrc = templates[Math.floor(rand() * templates.length)](rand);
    const noiseCount = Math.floor(rand() * 4);
    for (let j = 0; j < noiseCount; j++) {
      const noise = SOUP_TOKENS[Math.floor(rand() * SOUP_TOKENS.length)];
      const words = finalSrc.split(' ');
      words.splice(Math.floor(rand() * (words.length + 1)), 0, noise);
      finalSrc = words.join(' ');
    }
    const t0 = Date.now();
    try {
      parse(tokenize(finalSrc));
      parsedCount++;
    } catch (e) {
      if (e instanceof RangeError) {
        throw new Error(`soup #${i} leaked a RangeError: ${finalSrc.slice(0, 80)}`);
      }
      errorCount++;
    }
    const ms = Date.now() - t0;
    if (ms > 3000) {
      throw new Error(`soup #${i} took ${ms}ms (parser hang): ${finalSrc.slice(0, 80)}`);
    }
  }
  // Both outcomes must occur for the soup to be doing real work.
  if (parsedCount === 0) throw new Error('every soup failed — soup generator is broken');
  if (errorCount === 0) throw new Error('every soup parsed — soup generator is not exercising errors');
});

test('fuzz: soups with block starters still terminate (no exponential replay)', () => {
  const rand = lcg(42);
  for (let i = 0; i < 100; i++) {
    const n = 5 + Math.floor(rand() * 30);
    const parts = [];
    for (let j = 0; j < n; j++) {
      parts.push(['if', 'while', 'repeat', 'done', 'otherwise', 'show', 'x', '1', 'is'][Math.floor(rand() * 9)]);
    }
    const src = parts.join(' ');
    const t0 = Date.now();
    try {
      parse(tokenize(src));
    } catch (e) {
      if (e instanceof RangeError) {
        throw new Error(`block soup #${i} leaked a RangeError: ${src.slice(0, 80)}`);
      }
    }
    const ms = Date.now() - t0;
    if (ms > 3000) {
      throw new Error(`block soup #${i} took ${ms}ms (exponential replay): ${src.slice(0, 80)}`);
    }
  }
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
