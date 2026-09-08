// tests/ai.test.js
// Tests for Phase 4: The Strategic AI Wedge (Self-Healing, LLM Benchmarks, Agent Tooling)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { healSource, fixFile } = require('../compiler/fixer');
const { runBenchmarks } = require('../tools/benchmark-llm');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('\n── Phase 4: The Strategic AI Wedge Tests ─────────────────────────────\n');

test('fixer: heals let with "=" into let ... is', () => {
  const bad = 'let count = 42\n';
  const result = healSource(bad);
  if (!result.healedText.includes('let count is 42')) {
    throw new Error(`Expected "let count is 42", got:\n${result.healedText}`);
  }
});

test('fixer: heals variable re-assignment "=" into becomes', () => {
  const bad = 'count = count + 1\n';
  const result = healSource(bad);
  if (!result.healedText.includes('count becomes count + 1')) {
    throw new Error(`Expected "count becomes count + 1", got:\n${result.healedText}`);
  }
});

test('fixer: heals Python def, print, and return habits into make, show, and give', () => {
  const bad = `def calc(n)
  print(n)
  return n * 2
`;
  const result = healSource(bad);
  if (!result.healedText.includes('make calc(n)')) {
    throw new Error(`Expected "make calc(n)", got:\n${result.healedText}`);
  }
  if (!result.healedText.includes('show n')) {
    throw new Error(`Expected "show n", got:\n${result.healedText}`);
  }
  if (!result.healedText.includes('give n * 2')) {
    throw new Error(`Expected "give n * 2", got:\n${result.healedText}`);
  }
  if (!result.healedText.includes('done')) {
    throw new Error(`Expected auto-appended "done", got:\n${result.healedText}`);
  }
});

test('fixer: heals unclosed nested blocks by appending done', () => {
  const bad = `make process(items)
  for each item in items
    if item is above 10
      show item
`;
  const result = healSource(bad);
  const doneCount = (result.healedText.match(/\bdone\b/g) || []).length;
  if (doneCount < 3) {
    throw new Error(`Expected at least 3 "done" delimiters for 3 unclosed blocks, got ${doneCount}`);
  }
  // Verify healed code tokenizes and parses cleanly!
  const ast = parse(tokenize(result.healedText));
  if (!ast || ast.type !== 'Program') {
    throw new Error('Healed code failed to parse into valid Program AST');
  }
});

test('benchmark: runBenchmarks calculates token savings and punctuation metrics', () => {
  const data = runBenchmarks();
  if (!data.summary || !data.results || data.results.length === 0) {
    throw new Error('Benchmark data missing results or summary');
  }
  if (!data.summary.tokenSavingsVsTypeScript.endsWith('%')) {
    throw new Error(`Invalid token savings format: ${data.summary.tokenSavingsVsTypeScript}`);
  }
  const pct = parseInt(data.summary.tokenSavingsVsTypeScript, 10);
  if (pct < 20) {
    throw new Error(`Expected at least 20% token savings vs TypeScript, got ${pct}%`);
  }
});
