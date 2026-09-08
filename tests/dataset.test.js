// tests/dataset.test.js
// Tests for Phase 6: AI Fine-Tuning Corpus Generator & Evaluation Harness

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  generateSample,
  validateCode,
  formatShareGPT,
  formatAlpaca,
  formatHuggingFace,
  generateDataset,
} = require('../tools/generate-dataset');
const { evaluateSnippet, EVAL_PROMPTS } = require('../tools/eval-agent');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

console.log('\n── Phase 6: AI Fine-Tuning Corpus & Training Dataset Tests ──\n');

test('generateSample produces valid PlainScript code across all 7 categories', () => {
  for (let i = 0; i < 14; i++) {
    const sample = generateSample(i);
    assert.ok(sample.instruction, `Sample #${i} must have an instruction`);
    assert.ok(sample.code, `Sample #${i} must have code`);
    const isValid = validateCode(sample.code);
    assert.strictEqual(isValid, true, `Sample #${i} code must compile with 0 syntax errors:\n${sample.code}`);
  }
});

test('formatShareGPT generates standard conversational structure', () => {
  const sample = generateSample(0);
  const formatted = formatShareGPT(sample, 0);
  assert.ok(formatted.id.startsWith('pln_sample_'));
  assert.strictEqual(formatted.conversations.length, 3);
  assert.strictEqual(formatted.conversations[0].from, 'system');
  assert.strictEqual(formatted.conversations[1].from, 'human');
  assert.strictEqual(formatted.conversations[2].from, 'gpt');
  assert.ok(formatted.conversations[2].value.includes('```plainscript'));
});

test('formatAlpaca generates instruction/input/output structure', () => {
  const sample = generateSample(4); // Python translation sample
  const formatted = formatAlpaca(sample, 4);
  assert.ok(formatted.instruction);
  assert.ok(formatted.output);
});

test('formatHuggingFace generates OpenAI ChatML messages structure', () => {
  const sample = generateSample(1);
  const formatted = formatHuggingFace(sample, 1);
  assert.strictEqual(formatted.messages.length, 3);
  assert.strictEqual(formatted.messages[0].role, 'system');
  assert.strictEqual(formatted.messages[1].role, 'user');
  assert.strictEqual(formatted.messages[2].role, 'assistant');
});

test('generateDataset builds verified JSONL output files without errors', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-dataset-test-'));
  const res = generateDataset({ count: 50, outDir: tempDir, format: 'all' });

  assert.strictEqual(res.validCount, 50);
  assert.ok(fs.existsSync(path.join(tempDir, 'plainscript_sharegpt.jsonl')));
  assert.ok(fs.existsSync(path.join(tempDir, 'plainscript_alpaca.jsonl')));
  assert.ok(fs.existsSync(path.join(tempDir, 'plainscript_chatml.jsonl')));

  // Read back and verify each line is valid JSON and code compiles
  const lines = fs.readFileSync(path.join(tempDir, 'plainscript_alpaca.jsonl'), 'utf8')
    .trim()
    .split('\n');
  assert.strictEqual(lines.length, 50);

  for (const line of lines) {
    const parsed = JSON.parse(line);
    assert.strictEqual(validateCode(parsed.output), true);
  }

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('eval-agent benchmarks canonical prompts with 100% compilation score', () => {
  for (const item of EVAL_PROMPTS) {
    let testCode = '';
    if (item.name === 'Natural Language Counted Loop') {
      testCode = 'repeat 5 times\n  log "tick"\ndone';
    } else if (item.name === 'Natural Language Inverted Loop') {
      testCode = 'repeat until score is 10\n  score becomes score + 1\ndone';
    } else if (item.name === 'Natural Comparison Phrasing') {
      testCode = 'if "admin" is in roles and score is greater than or equal to 50\n  show "ok"\ndone';
    } else if (item.name === 'REST API Endpoint') {
      testCode = 'route get "/api/health"\n  reply json\n    status is "ok"\n  done\ndone';
    } else if (item.name === 'SQLite Database Query') {
      testCode = 'database "app.db"\nmake getActiveUsers()\n  remember rows as query\n    SELECT * FROM users\n  done\n  give rows\ndone';
    }
    const evalRes = evaluateSnippet(item.name, testCode, item.expectedKeywords);
    assert.strictEqual(evalRes.compiles, true, `${item.name} failed: ${evalRes.error}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
