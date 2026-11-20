'use strict';

// Documentation is part of the product: a guide that compiles in prose but not
// in the compiler is a bug. Every fenced ```plainscript block in a document
// marked `<!-- compile-examples -->` is compiled as a real project here.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { ROOT, compileProject } = require('./helpers');

const DOCUMENTS = [
  'README.md',
  'docs/GETTING_STARTED.md',
  'docs/LANGUAGE_REFERENCE.md',
  'docs/COMPILER.md',
  'docs/INTEGRATIONS.md',
  'docs/MIGRATION_2_1.md',
];

function examplesIn(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  assert.ok(source.includes('<!-- compile-examples -->'), `${file} must declare that its examples are compile-tested`);
  const blocks = [];
  const pattern = /```plainscript\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(source)) !== null) blocks.push(match[1]);
  return blocks;
}

for (const file of DOCUMENTS) {
  test(`every PlainScript example in ${file} compiles`, () => {
    const blocks = examplesIn(file);
    assert.ok(blocks.length > 0, `${file} should contain at least one example`);
    blocks.forEach((block, index) => {
      const project = compileProject({ 'main.pln': block }, 'main.pln');
      const errors = project.compiler.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
      assert.deepStrictEqual(
        errors.map((diagnostic) => `${diagnostic.code} ${diagnostic.message} (${diagnostic.span.file}:${diagnostic.span.line})`),
        [],
        `${file}, example ${index + 1}:\n${block}`,
      );
    });
  });
}
