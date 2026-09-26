// Test suite for PlainScript Expanded Data Structures (Dictionaries, Hash Maps, Sets, Tuples).

const { tokenize } = require('../compiler/lexer');
const { parse }    = require('../compiler/parser');
const { generate } = require('../compiler/generator');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.stack || err}`);
    failed++;
  }
}

function assert(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log('── Expanded Data Structures (Dictionaries, Maps, Sets, Tuples) ──\n');

// ── 1. Dictionaries & Hash Maps ──────────────────────────────────────────────

test('dictionary creation and put statement', () => {
  const code = `
remember userMap as dictionary with "name" is "Ada" and "role" is "admin" done
put "role" as "editor" in userMap
`;
  const js = generate(parse(tokenize(code)));
  assert(js.includes('new Map([["name", "Ada"], ["role", "admin"]])'), true, 'missing Map creation');
  assert(js.includes('userMap.set("role", "editor")'), true, 'missing userMap.set');
});

test('empty map and reflection helpers (keys, values, size)', () => {
  const code = `
remember cache as empty map
remember k as keys of cache
remember v as values of cache
remember s as size of cache
`;
  const js = generate(parse(tokenize(code)));
  assert(js.includes('new Map()'), true, 'missing empty Map creation');
  assert(js.includes('Array.from(cache.keys())'), true, 'missing Array.from(cache.keys())');
  assert(js.includes('Array.from(cache.values())'), true, 'missing Array.from(cache.values())');
  assert(js.includes('cache.size'), true, 'missing cache.size');
});

// ── 2. Sets & Set Algebra ───────────────────────────────────────────────────

test('set literal and set mutators', () => {
  const code = `
remember tags as set with "admin", "editor", "user" done
remember emptyTags as empty set
`;
  const js = generate(parse(tokenize(code)));
  assert(js.includes('new Set(["admin", "editor", "user"])'), true, 'missing Set creation');
  assert(js.includes('new Set()'), true, 'missing empty Set creation');
});

test('set from list and set algebra (union, intersection, difference)', () => {
  const code = `
remember listVar as [1, 2, 3]
remember s1 as set from listVar
remember s2 as set with 2, 3, 4 done
remember u as union of s1 and s2
remember i as intersection of s1 and s2
remember d as difference of s1 and s2
`;
  const js = generate(parse(tokenize(code)));
  assert(js.includes('new Set(listVar)'), true, 'missing set from list');
  assert(js.includes('new Set([...s1, ...s2])'), true, 'missing set union');
  assert(js.includes('filter(__x => s2.has(__x))'), true, 'missing set intersection');
  assert(js.includes('filter(__x => !s2.has(__x))'), true, 'missing set difference');
});

// ── 3. Tuples & Unpacking ───────────────────────────────────────────────────

test('tuple literal and immutability (Object.freeze)', () => {
  const code = `
remember point as tuple with 10, 20, 30 done
remember pair as tuple(100, 200)
`;
  const js = generate(parse(tokenize(code)));
  assert(js.includes('Object.freeze([10, 20, 30])'), true, 'missing Object.freeze tuple');
  assert(js.includes('Object.freeze([100, 200])'), true, 'missing Object.freeze pair');
});

test('tuple unpacking statement', () => {
  const code = `
remember point as tuple with 10, 20, 30 done
unpack point into x, y, z
`;
  const js = generate(parse(tokenize(code)));
  assert(js.includes('let [x, y, z] = point;'), true, 'missing destructuring assignment');
});

// ── 4. End-to-End Runtime Execution Test ────────────────────────────────────

test('end-to-end execution of compound structures in Node.js VM', () => {
  const code = `
remember dict as dictionary with "a" is 1 and "b" is 2 done
put "c" as 3 in dict
remember total as 0
remember s as set with 10, 20 done
remember point as tuple with 100, 200 done
unpack point into px, py
`;
  const js = generate(parse(tokenize(code)));
  // Execute generated JS to ensure zero runtime errors
  const fn = new Function(js + '; return { dictSize: dict.size, point: [px, py] };');
  const result = fn();
  assert(result.dictSize, 3, 'dictSize should be 3');
  assert(result.point[0], 100, 'px should be 100');
  assert(result.point[1], 200, 'py should be 200');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
