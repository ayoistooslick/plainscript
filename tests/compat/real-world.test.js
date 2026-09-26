const path = require('path');
const { test, assert, checkDir, runFile, runNode, build, ROOT } = require('./_util');

const FIXTURE = path.join(ROOT, 'fixtures', 'idverify');
const SRC = path.join(FIXTURE, 'src');

test('fixture: all idverify sources pass check', () => {
  const r = checkDir(SRC);
  assert(r.ok, `fixture check failed:\n${JSON.stringify(r)}`);
  assert(r.sources && r.sources.length === 5,
    `expected 5 sources, got ${r.sources && r.sources.length}`);
});

test('fixture: dependency detection lists npm deps, not builtins', () => {
  const r = checkDir(SRC);
  const names = (r.deps || []).map((d) => d.package);
  assert(names.includes('mrz') && names.includes('sharp') && names.includes('express'),
    `missing npm deps: ${names}`);
  assert(!names.includes('fs') && !names.includes('path') && !names.includes('crypto'),
    `builtins leaked into deps: ${names}`);
});

test('fixture: verify.pln builds and produces a deterministic verification result', () => {
  build(FIXTURE, 'src/verify.pln');
  const out = runNode(path.join(FIXTURE, 'dist', 'verify.js'), FIXTURE);
  assert(out.includes('ADA LOVELACE') && out.includes('"ok":true'),
    `expected verification output:\n${out}`);
});

const { summary } = require('./_util');
summary();
