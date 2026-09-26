const path = require('path');
const fs = require('fs');
const { test, assert, tmpDir, write, runFile, checkDir } = require('./_util');

test('npm: use <pkg> compiles to require and runs against a local package', () => {
  const dir = tmpDir();
  const pkgDir = path.join(dir, 'node_modules', 'fakenpmpkg');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: 'fakenpmpkg', main: 'index.js' }));
  fs.writeFileSync(path.join(pkgDir, 'index.js'),
    'module.exports = function () { return "resolved-ok"; }');
  write(dir, 'main.pln', 'use fakenpmpkg\nshow fakenpmpkg()\n');
  const out = runFile(path.join(dir, 'main.pln'), { cwd: dir });
  assert(out.includes('resolved-ok'), `expected local require result:\n${out}`);
});

test('npm: dependency detection flags npm deps but not node builtins', () => {
  const dir = tmpDir();
  write(dir, 'app.pln', 'use fakedetectpkg\nremember x as 1\nshow "built"\n');
  write(dir, 'b.pln', 'use fs\nuse path\nshow "builtin"\n');
  const r = checkDir(dir);
  assert(r.ok, `check should pass:\n${JSON.stringify(r)}`);
  const names = (r.deps || []).map((d) => d.package);
  assert(names.includes('fakedetectpkg'), `missing fabrication dep: ${names}`);
  assert(!names.includes('fs') && !names.includes('path'),
    `builtins must not be reported as deps: ${names}`);
});

const { summary } = require('./_util');
summary();
