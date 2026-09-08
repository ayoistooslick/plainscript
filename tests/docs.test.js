// Documentation and starter validation.
//
// Every fenced PlainScript block and every real-world template entry point is
// compiled with the same parser/generator used by the CLI. This prevents the
// documentation from drifting into syntax that looks plausible but cannot run.

const fs = require('fs');
const path = require('path');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate } = require('../compiler/generator');

const DOC_FILES = [
  'README.md',
  'knowledge.md',
  'docs/PLAINSCRIPT-SPEC.md',
  'docs/CAPABILITY_GAP_AUDIT.md',
  'docs/GAME-PROMPT.md', // v1.0.36 — browser/game guide
  'plainscript-vscode/README.md',
  'samples/README.md',
];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message}`);
    failed++;
  }
}

function compile(source, label) {
  try {
    generate(parse(tokenize(source)));
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

test('all fenced PlainScript documentation blocks compile', () => {
  let count = 0;
  for (const file of DOC_FILES) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const fences = /```([^\n`]*)\r?\n([\s\S]*?)```/g;
    let match;
    while ((match = fences.exec(source))) {
      if (!['plainscript', 'pln'].includes(match[1].trim().toLowerCase())) continue;
      count++;
      compile(match[2], `${file} PlainScript block ${count}`);
    }
  }
  if (count < 1) throw new Error('no PlainScript documentation blocks found');
  console.log(`        checked ${count} fenced blocks`);
});

test('all fourteen real-world templates compile and old starters are gone', () => {
  const root = path.join(__dirname, '..', 'templates');
  const old = ['idverify', 'oauth'];
  for (const name of old) {
    if (fs.existsSync(path.join(root, name, 'package.json'))) {
      throw new Error(`old template still exists: ${name}`);
    }
  }
  const entries = fs.readdirSync(root)
    .filter(name => name !== 'README.md')
    .filter(name => fs.existsSync(path.join(root, name, 'src', 'app.pln')))
    .sort();
  if (entries.length !== 14) throw new Error(`expected 14 templates, found ${entries.length}`);
  for (const name of entries) {
    compile(
      fs.readFileSync(path.join(root, name, 'src', 'app.pln'), 'utf8'),
      `templates/${name}/src/app.pln`
    );
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);