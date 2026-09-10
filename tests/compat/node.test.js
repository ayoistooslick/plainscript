// PlainScript  -  Node built-in interop capability suite.
//
// Verifies `use fs`, `use path`, `use crypto` and method/member calls
// (receiver.method(args), receiver.property) by running snippets against real
// Node built-ins in a scratch directory.

const path = require('path');
const { test, assert, run, runFile, tmpDir, write } = require('./_util');

test('use path: join/basename via method calls', () => {
  const out = run(`
use path
remember p as path.join("a", "b", "c.txt")
show path.basename(p)
show path.dirname(p)
`);
  assert(out.includes('c.txt') && (out.includes('a/b') || out.includes('a\\b')), `expected path ops:\n${out}`);
});

test('use fs: existsSync/readFileSync against a real file', () => {
  const dir = tmpDir();
  write(dir, 'data.txt', 'payload-123\n');
  write(dir, 'main.pln', `
use fs
if fs.existsSync("data.txt") is true
    show fs.readFileSync("data.txt", "utf8")
otherwise
    show "missing"
done
`);
  const out = runFile(path.join(dir, 'main.pln'), { cwd: dir });
  assert(out.includes('payload-123'), `expected file contents:\n${out}`);
});

test('use crypto: chained hashing methods produce a real digest', () => {
  const out = run(`
use crypto
show crypto.createHash("sha256").update("abc").digest("hex")
`);
  assert(out.includes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
    `expected sha256("abc"):\n${out}`);
});

test('use crypto: property access on a hash object', () => {
  const out = run(`
use crypto
remember h as crypto.createHash("sha256")
show h.update("x").digest("hex").length
`);
  assert(out.includes('64'), `sha256 hex digest has 64 chars:\n${out}`);
});

test('string methods: chained method calls on values', () => {
  const out = run(`
remember s as "  Hello World  "
show s.trim().toUpperCase()
show "a,b,c".split(",").length
`);
  assert(out.includes('HELLO WORLD') && out.includes('3'), `expected string ops:\n${out}`);
});

const { summary } = require('./_util');
summary();
