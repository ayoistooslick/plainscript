// PlainScript  -  binary/bytes capability suite.
//
// Verifies the stdlib byte helpers: textToBytes, bytesToText, base64Encode,
// base64Decode and sha256, by RUNNING snippets and checking deterministic output.

const { test, assert, run } = require('./_util');

test('bytes: textToBytes/bytesToText round-trip', () => {
  const out = run(`
remember b as textToBytes("hi")
show length(b)
show bytesToText(b)
`);
  assert(out.includes('2') && out.includes('hi'), `expected round-trip:\n${out}`);
});

test('bytes: base64Encode is stable', () => {
  const out = run(`
show base64Encode("hello")
show base64Encode("hello world")
`);
  assert(out.includes('aGVsbG8=') && out.includes('aGVsbG8gd29ybGQ='),
    `expected known base64 values:\n${out}`);
});

test('bytes: base64Decode reverses base64Encode', () => {
  const out = run(`
remember textVal as bytesToText(textToBytes("world"))
show base64Decode(base64Encode(textVal))
`);
  assert(out.includes('world'), `expected decoded text:\n${out}`);
});

test('hash: sha256 of known input is deterministic', () => {
  const out = run(`
show sha256("abc")
show sha256("")
`);
  assert(out.includes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
    `expected sha256("abc"):\n${out}`);
  assert(out.includes('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
    `expected sha256(""):\n${out}`);
});

test('hash: hashing raw bytes via textToBytes input', () => {
  const out = run(`
remember b as textToBytes("abc")
show sha256(bytesToText(b))
`);
  assert(out.includes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
    `expected hash of bytes:\n${out}`);
});

const { summary } = require('./_util');
summary();
