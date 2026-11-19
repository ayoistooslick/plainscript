'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runSource } = require('./helpers');

test('recursive records and recursive variants are supported', () => {
  const result = runSource(`type Node
    value: number
    next: Node or nothing
end

let chain: Node = { value: 1, next: { value: 2, next: nothing } }

type Tree = Leaf(value: number) or Branch(children: list of Tree)
let tree: Tree = Branch([Leaf(1), Branch([Leaf(2)])])
`);
  assert.equal(result.status, 0, result.stderr);
});

test('recursive types still reject incompatible leaves', () => {
  const result = runSource(`type Node
    value: number
    next: Node or nothing
end
let chain: Node = { value: "not a number", next: nothing }
`);
  assert.equal(result.status, 1);
  assert.ok(result.compiler.diagnostics.some((diagnostic) => diagnostic.code === 'PS3311'));
});
