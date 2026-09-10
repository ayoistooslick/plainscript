// Tests for the PlainScript compiler

const fs   = require('fs');
const path = require('path');
const { tokenize, TOKEN } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate } = require('../compiler/generator');
const { bundle, resolveDependencies } = require('../compiler/bundler');
const { detectDependencies, splitPackageSpec } = require('../compiler/dependency-detector');
const { format } = require('../compiler/formatter');

// Helper: bundle a fixture file and return the generated JS
function bundleFixture(name) {
  return bundle(path.join(__dirname, 'fixtures', name));
}

// Helper: expect a bundle to throw with a message matching substr
function bundleThrows(label, fixtureName, substr) {
  test(label, () => {
    try {
      bundleFixture(fixtureName);
      throw new Error('expected an error but none was thrown');
    } catch (e) {
      if (!e.message.toLowerCase().includes(substr.toLowerCase())) {
        throw new Error(`Expected error to include "${substr}" but got: ${e.message}`);
      }
    }
  });
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

function assert(actual, expected) {
  const a = actual.trim();
  const e = expected.trim();
  if (a !== e) {
    throw new Error(`Expected:\n        ${e}\n        Got:\n        ${a}`);
  }
}

function compile(source) {
  return generate(parse(tokenize(source)));
}

// â”€â”€ Runtime dependency detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nRuntime dependency detection');

test('detects express as an npm dependency', () => {
  assert(JSON.stringify(detectDependencies('use express')), '["express"]');
});

test('maps sqlite to better-sqlite3', () => {
  assert(JSON.stringify(detectDependencies('use sqlite')), '["better-sqlite3"]');
});

test('ignores Node built-in modules', () => {
  assert(JSON.stringify(detectDependencies('use fs\nuse path')), '[]');
});

test('removes duplicate runtime dependencies', () => {
  assert(
    JSON.stringify(detectDependencies('use express\nuse sqlite\nuse express\nuse sqlite')),
    '["express","better-sqlite3"]'
  );
});

test('returns an empty list for a project without use statements', () => {
  assert(JSON.stringify(detectDependencies('show "Hello"')), '[]');
});

test('detects better-sqlite3 from database shorthand', () => {
  // v2.1.1 — the portable engine chain installs both engines: native first,
  // WebAssembly fallback second.
  assert(JSON.stringify(detectDependencies('database "app.db"')),
    '["better-sqlite3","sql.js"]');
});

test('database using "wasm" detects only sql.js', () => {
  assert(JSON.stringify(detectDependencies('database "app.db" using "wasm"')),
    '["sql.js"]');
});

test('database using "native" detects only better-sqlite3', () => {
  assert(JSON.stringify(detectDependencies('database "app.db" using "native"')),
    '["better-sqlite3"]');
});

test('detects Express from web app shorthand', () => {
  assert(JSON.stringify(detectDependencies('web app')), '["express"]');
});

test('deduplicates shorthand and explicit runtime dependencies', () => {
  assert(JSON.stringify(detectDependencies('web app\nuse express\ndatabase "app.db"\nuse sqlite')),
    '["express","better-sqlite3","sql.js"]');
});

// â”€â”€ Lexer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nLexer');

test('tokenizes remember keyword', () => {
  const tokens = tokenize('remember');
  if (tokens[0].type !== TOKEN.REMEMBER) throw new Error('wrong type');
});

test('tokenizes show keyword', () => {
  const tokens = tokenize('show');
  if (tokens[0].type !== TOKEN.SHOW) throw new Error('wrong type');
});

test('tokenizes string literal', () => {
  const tokens = tokenize('"Hello"');
  if (tokens[0].type !== TOKEN.STRING) throw new Error('wrong type');
  if (tokens[0].value !== 'Hello') throw new Error('wrong value');
});

test('tokenizes number literal', () => {
  const tokens = tokenize('42');
  if (tokens[0].type !== TOKEN.NUMBER) throw new Error('wrong type');
  if (tokens[0].value !== 42) throw new Error('wrong value');
});

test('tokenizes if / otherwise / done keywords', () => {
  const tokens = tokenize('if otherwise done');
  if (tokens[0].type !== TOKEN.IF)        throw new Error('if wrong');
  if (tokens[1].type !== TOKEN.OTHERWISE) throw new Error('otherwise wrong');
  if (tokens[2].type !== TOKEN.DONE)      throw new Error('done wrong');
});

test('tokenizes is / greater / than / less keywords', () => {
  const tokens = tokenize('is greater than less');
  if (tokens[0].type !== TOKEN.IS)      throw new Error('is wrong');
  if (tokens[1].type !== TOKEN.GREATER) throw new Error('greater wrong');
  if (tokens[2].type !== TOKEN.THAN)    throw new Error('than wrong');
  if (tokens[3].type !== TOKEN.LESS)    throw new Error('less wrong');
});

test('throws on unterminated string', () => {
  try {
    tokenize('"oops');
    throw new Error('should have thrown');
  } catch (e) {
    if (!e.message.includes('Unterminated')) throw e;
  }
});

test('skips single-line comments', () => {
  const tokens = tokenize('// comment\nshow "Hi"');
  if (tokens[0].type !== TOKEN.SHOW) throw new Error('wrong token after comment');
});

// â”€â”€ Day 1: remember + show â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nDay 1 â€” remember + show');

test('remember string compiles to let', () => {
  assert(compile('remember name as "Ayokunle"'), 'let name = "Ayokunle";');
});

test('show identifier compiles to console.log', () => {
  assert(compile('show name'), 'console.log(name);');
});

test('show string literal', () => {
  assert(compile('show "Hello"'), 'console.log("Hello");');
});

test('show("text") call form compiles identically', () => {
  assert(compile('show("Hello")'), 'console.log("Hello");');
});

test('show("expr") call form with expression', () => {
  assert(
    compile('remember name as "World"\nshow("Hello " + name)'),
    'let name = "World";\nconsole.log("Hello " + name);'
  );
});

test('show(call) call form with function argument', () => {
  assert(compile('show(add(5, 7))'), 'console.log(add(5, 7));');
});

test('remember then show (day1 example)', () => {
  assert(
    compile('remember name as "Ayokunle"\nshow name'),
    'let name = "Ayokunle";\nconsole.log(name);'
  );
});

// â”€â”€ Day 2: if / otherwise / done â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nDay 2 â€” if / otherwise / done');

test('"is" compiles to ===', () => {
  const src = 'remember x as "a"\nif x is "a"\n  show "yes"\ndone';
  const js = compile(src);
  if (!js.includes('===')) throw new Error('expected ===');
});

test('"is greater than" compiles to >', () => {
  const src = 'remember age as 16\nif age is greater than 12\n  show "yes"\ndone';
  const js = compile(src);
  if (!js.includes('>')) throw new Error('expected >');
});

test('"is less than" compiles to <', () => {
  const src = 'remember age as 5\nif age is less than 12\n  show "young"\ndone';
  const js = compile(src);
  if (!js.includes('<')) throw new Error('expected <');
});

test('if/otherwise/done compiles to if/else block', () => {
  const src = [
    'remember age as 16',
    'if age is greater than 12',
    '  show "Teenager"',
    'otherwise',
    '  show "Child"',
    'done',
  ].join('\n');
  const js = compile(src);
  if (!js.includes('if (age > 12)'))   throw new Error('missing if condition');
  if (!js.includes('"Teenager"'))       throw new Error('missing consequent');
  if (!js.includes('} else {'))         throw new Error('missing else');
  if (!js.includes('"Child"'))          throw new Error('missing alternate');
});

test('if without otherwise compiles to if without else', () => {
  const src = 'remember x as 5\nif x is less than 10\n  show "small"\ndone';
  const js = compile(src);
  if (!js.includes('if (x < 10)')) throw new Error('missing if');
  if (js.includes('else'))         throw new Error('unexpected else');
});

test('throws on missing done', () => {
  try {
    compile('remember x as 1\nif x is 1\n  show "oops"');
    throw new Error('should have thrown');
  } catch (e) {
    if (!e.message.toLowerCase().includes('done')) throw e;
  }
});

// â”€â”€ Day 3: make / give / function calls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nDay 3 â€” make / give / function calls');

test('tokenizes make and give keywords', () => {
  const tokens = tokenize('make give');
  if (tokens[0].type !== TOKEN.MAKE) throw new Error('make wrong');
  if (tokens[1].type !== TOKEN.GIVE) throw new Error('give wrong');
});

test('tokenizes parentheses and comma', () => {
  const tokens = tokenize('( , )');
  if (tokens[0].type !== TOKEN.LPAREN) throw new Error('( wrong');
  if (tokens[1].type !== TOKEN.COMMA)  throw new Error(', wrong');
  if (tokens[2].type !== TOKEN.RPAREN) throw new Error(') wrong');
});

test('tokenizes plus', () => {
  const tokens = tokenize('+');
  if (tokens[0].type !== TOKEN.PLUS) throw new Error('+ wrong');
});

test('no-param function compiles to JS function', () => {
  const src = 'make greet()\n    show "Hello"\ndone';
  const js = compile(src);
  if (!js.includes('function greet()')) throw new Error('missing function declaration');
  if (!js.includes('console.log("Hello")')) throw new Error('missing body');
});

test('function with params compiles correctly', () => {
  const src = 'make add(a, b)\n    give a + b\ndone';
  const js = compile(src);
  if (!js.includes('function add(a, b)')) throw new Error('missing params');
  if (!js.includes('return a + b'))       throw new Error('missing return');
});

test('give compiles to return', () => {
  const src = 'make double(x)\n    give x + x\ndone';
  const js = compile(src);
  if (!js.includes('return x + x')) throw new Error('missing return');
});

test('bare function call compiles to call statement', () => {
  const src = 'make greet()\n    show "Hello"\ndone\ngreet()';
  const js = compile(src);
  if (!js.includes('greet();')) throw new Error('missing call statement');
});

test('function call as argument to show', () => {
  const src = 'make add(a, b)\n    give a + b\ndone\nshow add(5, 7)';
  const js = compile(src);
  if (!js.includes('console.log(add(5, 7))')) throw new Error('missing show call');
});

test('day3 example: greet and add end-to-end', () => {
  const src = [
    'make greet()',
    '    show "Hello"',
    'done',
    'greet()',
    'make add(a, b)',
    '    give a + b',
    'done',
    'show add(5, 7)',
  ].join('\n');
  const js = compile(src);
  if (!js.includes('function greet()'))   throw new Error('missing greet');
  if (!js.includes('greet();'))           throw new Error('missing greet call');
  if (!js.includes('function add(a, b)')) throw new Error('missing add');
  if (!js.includes('return a + b'))       throw new Error('missing return');
  if (!js.includes('console.log(add(5, 7))')) throw new Error('missing show add');
});

test('throws on missing done in function', () => {
  try {
    compile('make greet()\n    show "Hello"');
    throw new Error('should have thrown');
  } catch (e) {
    if (!e.message.toLowerCase().includes('done')) throw e;
  }
});

// â”€â”€ Error messages (Phase 2) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nPhase 2 â€” Error messages');

function throws(name, src, expectedFragment) {
  test(name, () => {
    try {
      compile(src);
      throw new Error('should have thrown');
    } catch (e) {
      if (!e.message.toLowerCase().includes(expectedFragment.toLowerCase())) {
        throw new Error(
          `Expected message to include "${expectedFragment}", got:\n        ${e.message}`
        );
      }
    }
  });
}

// Missing "done"
throws(
  'missing done in if block mentions "done"',
  'remember x as 1\nif x is 1\n  show "oops"',
  'done'
);

throws(
  'missing done in otherwise block mentions "done"',
  'remember x as 1\nif x is 1\n  show "a"\notherwise\n  show "b"',
  'done'
);

throws(
  'missing done in function mentions "done"',
  'make greet()\n  show "Hello"',
  'done'
);

// Unexpected "otherwise"
throws(
  'unexpected "otherwise" at top level gives helpful message',
  'otherwise',
  'otherwise'
);

// Unknown / misspelled keyword with "did you mean"
throws(
  'misspelled "remembr" suggests "remember"',
  'remembr name as "Ayokunle"',
  'did you mean'
);

throws(
  'misspelled "shwo" suggests "show"',
  'shwo "Hello"',
  'did you mean'
);

// Missing identifier after "remember"
throws(
  'missing variable name after "remember"',
  'remember as 16',
  'variable name'
);

// Missing value after "as"
throws(
  'missing value after "as"',
  'remember age as',
  'value'
);

// Unterminated string
throws(
  'unterminated string',
  'show "hello',
  'unterminated'
);

// Invalid comparison
throws(
  'invalid comparison keyword gives helpful message',
  'remember x as 1\nif x bigger 1\n  show "a"\ndone',
  'comparison'
);

// Unexpected end of file (bare expression)
throws(
  'unexpected end of file in expression',
  'remember x as',
  'value'
);

// Invalid function declaration â€” missing name
throws(
  'missing function name after "make"',
  'make ()\n  show "hi"\ndone',
  'function name'
);

// Invalid function call â€” missing closing paren
throws(
  'missing closing paren in function call',
  'make greet()\n  show "hi"\ndone\ngreet(',
  '")"'
);

// Invalid return (give) â€” missing value
throws(
  'give with no value',
  'make f()\n  give\ndone',
  'value'
);

// â”€â”€ v0.2 â€” Arrays â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.2 â€” Arrays');

test('tokenizes [ and ]', () => {
  const tokens = tokenize('[ ]');
  if (tokens[0].type !== TOKEN.LBRACKET) throw new Error('[ wrong');
  if (tokens[1].type !== TOKEN.RBRACKET) throw new Error('] wrong');
});

test('array literal compiles to JS array', () => {
  const src = 'remember players as ["Haaland", "Foden", "Rodri"]';
  const js = compile(src);
  if (!js.includes('["Haaland", "Foden", "Rodri"]')) throw new Error('missing array literal');
});

test('array index compiles to bracket access', () => {
  const src = 'remember players as ["Haaland", "Foden"]\nshow players[0]';
  const js = compile(src);
  if (!js.includes('players[0]')) throw new Error('missing index access');
});

test('array index assignment (becomes) compiles correctly', () => {
  const src = 'remember players as ["Haaland", "Foden"]\nplayers[1] becomes "Palmer"';
  const js = compile(src);
  if (!js.includes('players[1] = "Palmer"')) throw new Error('missing index assignment');
});

test('length() compiles to .length', () => {
  const src = 'remember a as [1, 2, 3]\nshow length(a)';
  const js = compile(src);
  if (!js.includes('(a).length')) throw new Error('missing .length');
});

test('throws on unclosed array bracket', () => {
  try {
    compile('remember a as [1, 2');
    throw new Error('should have thrown');
  } catch (e) {
    if (!e.message.includes(']')) throw e;
  }
});

// â”€â”€ v0.2 â€” Objects â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.2 â€” Objects');

test('tokenizes dot', () => {
  const tokens = tokenize('user.name');
  if (tokens[1].type !== TOKEN.DOT) throw new Error('. wrong');
});

test('object literal compiles to JS object', () => {
  const src = 'remember user as\n  name is "Ayokunle"\n  age is 17\ndone';
  const js = compile(src);
  if (!js.includes('"name": "Ayokunle"')) throw new Error('missing name property');
  if (!js.includes('"age": 17'))          throw new Error('missing age property');
});

test('property access compiles to dot notation', () => {
  const src = 'remember user as\n  name is "Ayokunle"\ndone\nshow user.name';
  const js = compile(src);
  if (!js.includes('user.name')) throw new Error('missing member access');
});

test('property assignment (becomes) compiles correctly', () => {
  const src = 'remember user as\n  age is 17\ndone\nuser.age becomes 18';
  const js = compile(src);
  if (!js.includes('user.age = 18')) throw new Error('missing member assignment');
});

test('throws on unclosed object literal', () => {
  try {
    compile('remember user as\n  name is "Ayokunle"');
    throw new Error('should have thrown');
  } catch (e) {
    if (!e.message.toLowerCase().includes('done')) throw e;
  }
});

// â”€â”€ v0.2 â€” becomes (reassignment) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.2 â€” becomes');

test('simple becomes compiles to assignment', () => {
  const src = 'remember age as 16\nage becomes 17';
  const js = compile(src);
  if (!js.includes('age = 17')) throw new Error('missing assignment');
});

test('remember compiles to let (supports reassignment)', () => {
  const src = 'remember x as 1';
  const js = compile(src);
  if (!js.includes('let x = 1')) throw new Error('expected let');
});

// â”€â”€ v0.2 â€” Loops â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.2 â€” Loops');

test('tokenizes for / each / in keywords', () => {
  const tokens = tokenize('for each item in players');
  if (tokens[0].type !== TOKEN.FOR)        throw new Error('for wrong');
  if (tokens[1].type !== TOKEN.EACH)       throw new Error('each wrong');
  if (tokens[2].type !== TOKEN.IDENTIFIER) throw new Error('item wrong');
  if (tokens[3].type !== TOKEN.IN)         throw new Error('in wrong');
});

test('for each compiles to for-of loop', () => {
  const src = 'remember players as ["a", "b"]\nfor each player in players\n  show player\ndone';
  const js = compile(src);
  if (!js.includes('for (const player of players)')) throw new Error('missing for-of');
  if (!js.includes('console.log(player)'))           throw new Error('missing body');
});

test('throws on missing done in for each', () => {
  try {
    compile('remember a as [1]\nfor each x in a\n  show x');
    throw new Error('should have thrown');
  } catch (e) {
    if (!e.message.toLowerCase().includes('done')) throw e;
  }
});

// â”€â”€ v0.2 â€” While â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.2 â€” While');

test('tokenizes while keyword', () => {
  const tokens = tokenize('while');
  if (tokens[0].type !== TOKEN.WHILE) throw new Error('while wrong');
});

test('while loop compiles to JS while', () => {
  const src = 'remember age as 0\nwhile age is less than 18\n  age becomes age + 1\ndone';
  const js = compile(src);
  if (!js.includes('while (age < 18)'))   throw new Error('missing while condition');
  if (!js.includes('age = age + 1'))      throw new Error('missing body');
});

test('while with is compiles to === condition', () => {
  const src = 'remember x as 0\nwhile x is 0\n  x becomes 1\ndone';
  const js = compile(src);
  if (!js.includes('while (x === 0)')) throw new Error('missing while ===');
});

test('throws on missing done in while', () => {
  try {
    compile('remember x as 0\nwhile x is less than 5\n  x becomes x + 1');
    throw new Error('should have thrown');
  } catch (e) {
    if (!e.message.toLowerCase().includes('done')) throw e;
  }
});

// â”€â”€ v0.2 â€” Standard library â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.2 â€” Standard library');

test('uppercase() compiles to toUpperCase()', () => {
  const js = compile('show uppercase("hello")');
  if (!js.includes('.toUpperCase()')) throw new Error('missing toUpperCase');
});

test('lowercase() compiles to toLowerCase()', () => {
  const js = compile('show lowercase("HELLO")');
  if (!js.includes('.toLowerCase()')) throw new Error('missing toLowerCase');
});

// ── v2.5 — natural string/collection verbs ──────────────────────────────

test('lowercase statement transforms a variable in place', () => {
  const js = compile('remember x as "HELLO"\nlowercase x');
  if (!js.includes('x = String(x).toLowerCase();')) throw new Error('missing lowercase transform');
});

test('uppercase statement transforms a variable in place', () => {
  const js = compile('remember x as "hello"\nuppercase x');
  if (!js.includes('x = String(x).toUpperCase();')) throw new Error('missing uppercase transform');
});

test('trim statement transforms a variable in place', () => {
  const js = compile('remember x as "  hi "\ntrim x');
  if (!js.includes('x = String(x).trim();')) throw new Error('missing trim transform');
});

test('split statement transforms a string into a list', () => {
  const js = compile('remember x as "a b c"\nsplit x by " "');
  if (!js.includes('x = String(x).split(" ");')) throw new Error('missing split transform');
});

test('join statement transforms a list into a string', () => {
  const js = compile('split x by ","\nremember x as list with "a", "b"\njoin x by ","');
  if (!js.includes('(x) = (x).join(",");')) throw new Error('missing join transform');
});

test('uppercase first letter of each word transforms each word', () => {
  const js = compile('split title by " "\nuppercase first letter of each word in title');
  if (!js.includes('charAt(0).toUpperCase()')) throw new Error('missing capitalize transform');
});

test('toString-like verbs do not break function calls', () => {
  const js = compile('split(a, ",")');
  if (!js.includes('.split(",")')) throw new Error('split() call must still work');
});

test('random() compiles to Math.random()', () => {
  const js = compile('show random()');
  if (!js.includes('Math.random()')) throw new Error('missing Math.random');
});

test('round() compiles to Math.round()', () => {
  const js = compile('show round(3)');
  if (!js.includes('Math.round(3)')) throw new Error('missing Math.round');
});

// â”€â”€ v0.2 â€” Imports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.2 â€” Imports');

test('tokenizes use keyword', () => {
  const tokens = tokenize('use express');
  if (tokens[0].type !== TOKEN.USE) throw new Error('use wrong');
});

test('use express compiles to require', () => {
  const js = compile('use express');
  if (!js.includes("require('express')")) throw new Error('missing require express');
});

test('use fs compiles to require', () => {
  const js = compile('use fs');
  if (!js.includes("require('fs')")) throw new Error('missing require fs');
});

test('multiple known imports compile', () => {
  const js = compile('use express\nuse fs');
  if (!js.includes("require('express')")) throw new Error('missing express');
  if (!js.includes("require('fs')"))      throw new Error('missing fs');
});

// â”€â”€ v0.3 â€” Runtime package system â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.3 â€” Runtime packages');

test('use sqlite compiles to require better-sqlite3', () => {
  const js = compile('use sqlite');
  if (!js.includes("require('better-sqlite3')")) throw new Error('missing sqlite require');
});

test('use path compiles to require path', () => {
  const js = compile('use path');
  if (!js.includes("require('path')")) throw new Error('missing path require');
});

test('generic npm package compiles to require (RFC-0011)', () => {
  const js = compile('use math');
  if (!js.includes("require('math')")) throw new Error('missing require math');
});

test('use node-fetch compiles to a bare require (not a valid identifier)', () => {
  const js = compile('use node-fetch');
  if (!js.includes("require('node-fetch')")) throw new Error('missing require node-fetch');
  if (js.includes('const node-fetch')) throw new Error('node-fetch must not become a const binding');
});

// â”€â”€ v0.3 â€” Express runtime â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.3 â€” Express runtime');

test('tokenizes when / someone / visits keywords', () => {
  const tokens = tokenize('when someone visits "/"');
  if (tokens[0].type !== TOKEN.WHEN)    throw new Error('when wrong');
  if (tokens[1].type !== TOKEN.SOMEONE) throw new Error('someone wrong');
  if (tokens[2].type !== TOKEN.VISITS)  throw new Error('visits wrong');
});

test('tokenizes listen / on keywords', () => {
  const tokens = tokenize('listen on 3000');
  if (tokens[0].type !== TOKEN.LISTEN) throw new Error('listen wrong');
  if (tokens[1].type !== TOKEN.ON)     throw new Error('on wrong');
});

test('tokenizes reply keyword', () => {
  const tokens = tokenize('reply');
  if (tokens[0].type !== TOKEN.REPLY) throw new Error('reply wrong');
});

test('tokenizes json keyword', () => {
  const tokens = tokenize('json');
  if (tokens[0].type !== TOKEN.JSON_KW) throw new Error('json wrong');
});

test('tokenizes serve / folder keywords', () => {
  const tokens = tokenize('serve folder "public"');
  if (tokens[0].type !== TOKEN.SERVE)  throw new Error('serve wrong');
  if (tokens[1].type !== TOKEN.FOLDER) throw new Error('folder wrong');
});

test('listen on port compiles to app.listen', () => {
  const src = 'listen on 3000\n  show "Running"\ndone';
  const js = compile(src);
  if (!js.includes('app.listen(3000')) throw new Error('missing app.listen');
  if (!js.includes('console.log("Running")')) throw new Error('missing body');
});

test('route compiles to app.get', () => {
  const src = 'when someone visits "/"\n  reply "Hello"\ndone';
  const js = compile(src);
  if (!js.includes('app.get("/",'))   throw new Error('missing app.get');
  if (!js.includes('(req, res) =>'))  throw new Error('missing callback');
  if (!js.includes('res.send("Hello")')) throw new Error('missing reply');
});

test('reply compiles to res.send', () => {
  const src = 'when someone visits "/"\n  reply "Hi"\ndone';
  const js = compile(src);
  if (!js.includes('res.send("Hi")')) throw new Error('missing res.send');
});

test('reply json compiles to res.json', () => {
  const src = 'when someone visits "/api"\n  reply json\n    status is "ok"\n  done\ndone';
  const js = compile(src);
  if (!js.includes('res.json({'))                  throw new Error('missing res.json');
  if (!js.includes('"status": "ok"'))              throw new Error('missing property');
});

test('serve folder compiles to app.use(express.static)', () => {
  const src = 'serve folder "public"';
  const js = compile(src);
  if (!js.includes('app.use(express.static("public"))')) throw new Error('missing static');
});

test('request identifier remaps to req inside route', () => {
  const src = 'when someone visits "/"\n  show request.method\ndone';
  const js = compile(src);
  if (!js.includes('req.method')) throw new Error('missing req.method');
});

test('response identifier remaps to res inside route', () => {
  const src = 'when someone visits "/"\n  show response\ndone';
  const js = compile(src);
  if (!js.includes('console.log(res)')) throw new Error('missing res');
});

test('multiple routes compile independently', () => {
  const src = [
    'when someone visits "/"\n  reply "Home"\ndone',
    'when someone visits "/about"\n  reply "About"\ndone',
  ].join('\n');
  const js = compile(src);
  if (!js.includes('app.get("/",'))      throw new Error('missing / route');
  if (!js.includes('app.get("/about",')) throw new Error('missing /about route');
});

test('throws on missing done in route', () => {
  try {
    compile('when someone visits "/"\n  reply "Hello"');
    throw new Error('should have thrown');
  } catch (e) {
    if (!e.message.toLowerCase().includes('done')) throw e;
  }
});

// â”€â”€ v0.3 â€” SQLite runtime â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.3 â€” SQLite runtime');

test('sqlite() call compiles to new Database()', () => {
  const src = 'use sqlite\nremember db as sqlite("app.db")';
  const js = compile(src);
  if (!js.includes('new Database("app.db")')) throw new Error('missing new Database');
});

// â”€â”€ Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// â”€â”€ v0.4.1 â€” Multi-file Package System â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.4.1 â€” Multi-file imports');

test('tokenizes import keyword', () => {
  const tokens = tokenize('import "./math.pln"');
  if (tokens[0].type !== TOKEN.IMPORT) throw new Error('import token wrong');
  if (tokens[1].type !== TOKEN.STRING) throw new Error('path token wrong');
  if (tokens[1].value !== './math.pln') throw new Error('path value wrong');
});

test('import parses to ImportStatement', () => {
  const tokens = tokenize('import "./math.pln"');
  const ast    = parse(tokens);
  const node   = ast.body[0];
  if (node.type !== 'ImportStatement')   throw new Error('wrong node type');
  if (node.path !== './math.pln')        throw new Error('wrong path');
});

test('ImportStatement generates no output', () => {
  const js = generate(parse(tokenize('import "./math.pln"')));
  if (js.trim() !== '') throw new Error('import should generate empty string');
});

test('simple import â€” imported file compiles first', () => {
  const js = bundleFixture('uses_math.pln');
  // PI must be declared before it is used in show
  const piIdx   = js.indexOf('let PI');
  const showIdx = js.indexOf('console.log(PI)');
  if (piIdx === -1)     throw new Error('PI not declared');
  if (showIdx === -1)   throw new Error('show PI missing');
  if (piIdx > showIdx)  throw new Error('PI declared after show â€” wrong order');
});

test('simple import â€” output contains imported code', () => {
  const js = bundleFixture('uses_math.pln');
  if (!js.includes('let PI = 3.14'))  throw new Error('PI missing');
  if (!js.includes('let TAU = 6.28')) throw new Error('TAU missing');
});

test('two imports â€” both files included in output', () => {
  const js = bundleFixture('uses_both.pln');
  if (!js.includes('let PI'))        throw new Error('PI missing');
  if (!js.includes('function double')) throw new Error('double missing');
});

test('nested imports â€” deepest dependency compiled first', () => {
  const js = bundleFixture('nested_a.pln');
  // nested_c defines deepValue, must appear before nested_b and nested_a output
  const deepIdx = js.indexOf('let deepValue');
  const aIdx    = js.indexOf('"a loaded"');
  const bIdx    = js.indexOf('"b loaded"');
  if (deepIdx === -1) throw new Error('deepValue missing');
  if (bIdx === -1)    throw new Error('b loaded missing');
  if (aIdx === -1)    throw new Error('a loaded missing');
  if (deepIdx > bIdx) throw new Error('deepValue should come before b');
  if (bIdx > aIdx)    throw new Error('b should come before a');
});

test('duplicate imports â€” code included exactly once', () => {
  const js = bundleFixture('duplicate_a.pln');
  // PI should appear only once in the output
  const firstIdx  = js.indexOf('let PI');
  const secondIdx = js.indexOf('let PI', firstIdx + 1);
  if (firstIdx === -1)  throw new Error('PI not declared at all');
  if (secondIdx !== -1) throw new Error('PI declared more than once â€” duplicate import not de-duped');
});

test('diamond imports â€” shared file included exactly once', () => {
  const js = bundleFixture('diamond_top.pln');
  const firstIdx  = js.indexOf('let sharedValue');
  const secondIdx = js.indexOf('let sharedValue', firstIdx + 1);
  if (firstIdx === -1)  throw new Error('sharedValue missing');
  if (secondIdx !== -1) throw new Error('sharedValue declared twice â€” diamond not handled');
  if (!js.includes('"left"'))  throw new Error('left missing');
  if (!js.includes('"right"')) throw new Error('right missing');
  if (!js.includes('"top"'))   throw new Error('top missing');
});

bundleThrows(
  'circular imports give friendly error',
  'circular_a.pln',
  'circular'
);

bundleThrows(
  'circular import error mentions the file name',
  'circular_a.pln',
  'circular_a'
);

test('missing imported file gives friendly error', () => {
  const tokens = tokenize('import "./does_not_exist.pln"');
  const ast = parse(tokens);
  // Write a temp entry file referencing a non-existent file
  const tmpPath = path.join(__dirname, 'fixtures', 'missing_import_entry.pln');
  require('fs').writeFileSync(tmpPath, 'import "./no_such_file_xyz.pln"\n');
  try {
    bundle(tmpPath);
    require('fs').unlinkSync(tmpPath);
    throw new Error('expected an error but none was thrown');
  } catch (e) {
    require('fs').unlinkSync(tmpPath);
    if (!e.message.toLowerCase().includes('cannot find')) {
      throw new Error(`Expected "cannot find" in error but got: ${e.message}`);
    }
  }
});

test('import path preserved correctly in AST', () => {
  const ast = parse(tokenize('import "./sub/module.pln"'));
  if (ast.body[0].path !== './sub/module.pln') throw new Error('wrong path');
});

// â”€â”€ v0.4.2 â€” Package Manager & Project Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.4.2 â€” plainscript init');

const os  = require('os');
const { execFileSync: _execFileSync } = require('child_process');
const CLI = path.join(__dirname, '..', 'compiler', 'cli.js');

// Run the CLI in a temporary directory.
// Returns combined stdout+stderr as a string; never throws.
function runCli(args, cwd) {
  try {
    return _execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env },
    });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

// Create a fresh temp directory for a test.
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-test-'));
}

test('plainscript init is not a recognized command', () => {
  const dir = tmpDir();
  const out = runCli(['init'], dir);
  if (!out.toLowerCase().includes('unknown command')) {
    throw new Error(`Expected "Unknown command" for init but got: ${out}`);
  }
});

console.log('\nv0.4.2 â€” plainscript add / remove');

test('plainscript add installs a package without requiring any setup', () => {
  const dir = tmpDir();
  const out = runCli(['add', 'semver'], dir);
  if (!out.includes('Installed') && !out.includes('installed')) {
    throw new Error(`Expected install success but got: ${out}`);
  }
});

test('plainscript remove uninstalls a package', () => {
  const dir = tmpDir();
  runCli(['add', 'semver'], dir);
  const out = runCli(['remove', 'semver'], dir);
  if (!out.includes('Removed') && !out.includes('removed')) {
    throw new Error(`Expected uninstall success but got: ${out}`);
  }
});

test('plainscript add without package name shows usage', () => {
  const dir = tmpDir();
  const out = runCli(['add'], dir);
  if (!out.toLowerCase().includes('usage')) {
    throw new Error(`Expected usage hint but got: ${out}`);
  }
});

test('plainscript remove without package name shows usage', () => {
  const dir = tmpDir();
  const out = runCli(['remove'], dir);
  if (!out.toLowerCase().includes('usage')) {
    throw new Error(`Expected usage hint but got: ${out}`);
  }
});

test('plainscript add rejects invalid package name (shell injection attempt)', () => {
  const dir = tmpDir();
  // A name containing shell metacharacters must be rejected before npm is called.
  const out = runCli(['add', 'express; rm -rf /'], dir);
  if (!out.toLowerCase().includes('invalid package name')) {
    throw new Error(`Expected "Invalid package name" error but got: ${out}`);
  }
});

test('plainscript remove rejects invalid package name', () => {
  const dir = tmpDir();
  const out = runCli(['remove', '$(evil)'], dir);
  if (!out.toLowerCase().includes('invalid package name')) {
    throw new Error(`Expected "Invalid package name" error but got: ${out}`);
  }
});

console.log('\nv0.4.2 â€” plainscript install (RFC-0009.2)');

test('plainscript install reports no sources when src/ is empty', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const out = runCli(['install'], dir);
  if (!out.toLowerCase().includes('no .pln source files')) {
    throw new Error(`Expected "no .pln source files" error but got: ${out}`);
  }
});

test('plainscript install with no external dependencies shows correct message', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.pln'), 'show "hello"\n');
  const out = runCli(['install'], dir);
  if (!out.includes('This project has no external dependencies.')) {
    throw new Error(`Expected "This project has no external dependencies." but got: ${out}`);
  }
});

test('plainscript install with built-in modules only shows no external dependencies', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.pln'), 'use fs\nuse path\nshow "ok"\n');
  const out = runCli(['install'], dir);
  if (!out.includes('This project has no external dependencies.')) {
    throw new Error(`Expected "This project has no external dependencies." but got: ${out}`);
  }
});

test('plainscript install installs missing dependencies and reports success', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.pln'), 'use semver\nshow "ok"\n');
  const out = runCli(['install'], dir);
  // Check that it found and installed the package
  if (!out.includes('Found 1 required package(s).')) {
    throw new Error(`Expected "Found 1 required package(s)." but got: ${out}`);
  }
  if (!out.includes('Installing semver...')) {
    throw new Error(`Expected "Installing semver..." but got: ${out}`);
  }
  if (!out.includes('Done.')) {
    throw new Error(`Expected "Done." but got: ${out}`);
  }
  // Verify package is actually installed
  const nodeModules = path.join(dir, 'node_modules');
  if (!fs.existsSync(nodeModules)) throw new Error('node_modules not created');
  const pkgDir = path.join(nodeModules, 'semver');
  if (!fs.existsSync(pkgDir)) throw new Error('semver package not installed');
});

test('plainscript install skips already installed dependencies', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.pln'), 'use semver\nshow "ok"\n');
  // First install
  runCli(['install'], dir);
  // Second install should say all installed
  const out = runCli(['install'], dir);
  if (!out.includes('All dependencies are already installed.')) {
    throw new Error(`Expected "All dependencies are already installed." but got: ${out}`);
  }
});

test('plainscript install handles multiple dependencies', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.pln'), 'use semver\nuse express\nshow "ok"\n');
  const out = runCli(['install'], dir);
  if (!out.includes('Found 2 required package(s).')) {
    throw new Error(`Expected "Found 2 required package(s)." but got: ${out}`);
  }
  if (!out.includes('Installing semver...')) throw new Error('semver install missing');
  if (!out.includes('Installing express...')) throw new Error('express install missing');
});

test('plainscript install fails when no source files found', () => {
  const dir = tmpDir();
  const out = runCli(['install'], dir);
  if (!out.toLowerCase().includes('no .pln source files')) {
    throw new Error(`Expected no-sources error but got: ${out}`);
  }
});

test('plainscript install parses source files directly (no entry-file resolution)', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  // write two files that both declare deps; install scans every source file
  fs.writeFileSync(path.join(dir, 'src', 'app.pln'), 'use semver\nshow "ok"\n');
  fs.writeFileSync(path.join(dir, 'src', 'util.pln'), 'use lodash\nshow "ok"\n');
  const out = runCli(['install'], dir);
  if (!out.includes('semver')) throw new Error(`Expected semver in output but got: ${out}`);
  if (!out.includes('lodash')) throw new Error(`Expected lodash in output but got: ${out}`);
});

// â”€â”€ End of install tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.4.2 â€” CLI help');

test('plainscript help does not mention "plainscript init"', () => {
  const out = runCli(['help'], process.cwd());
  if (out.includes('plainscript init')) throw new Error(`"plainscript init" must no longer appear in help. Got:\n${out}`);
});

test('plainscript help includes "plainscript install"', () => {
  const out = runCli(['help'], process.cwd());
  if (!out.includes('plainscript install')) throw new Error(`"plainscript install" missing from help. Got:\n${out}`);
});

test('plainscript help includes "plainscript add"', () => {
  const out = runCli(['help'], process.cwd());
  if (!out.includes('plainscript add')) throw new Error(`"plainscript add" missing from help. Got:\n${out}`);
});

test('plainscript help includes "plainscript remove"', () => {
  const out = runCli(['help'], process.cwd());
  if (!out.includes('plainscript remove')) throw new Error(`"plainscript remove" missing from help. Got:\n${out}`);
});

test('plainscript help includes "plainscript update"', () => {
  const out = runCli(['help'], process.cwd());
  if (!out.includes('plainscript update')) throw new Error(`"plainscript update" missing from help. Got:\n${out}`);
});

test('plainscript version shows the compiler version', () => {
  const out = runCli(['version'], process.cwd());
  const { VERSION } = require('../compiler/version');
  if (!out.includes(VERSION)) throw new Error(`Expected version ${VERSION} but got: ${out}`);
});

// â”€â”€ v0.5 â€” Formatter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.5 â€” Formatter');

test('format: removes trailing whitespace', () => {
  const result = format('remember x as 1   \nshow x   ');
  if (result.includes('   ')) throw new Error('trailing whitespace not removed');
});

test('format: normalises indentation inside a function', () => {
  const src = 'make add(a, b)\ngive a + b\ndone';
  const result = format(src);
  if (!result.includes('    give a + b')) throw new Error('body not indented with 4 spaces');
});

test('format: normalises indentation inside an if block', () => {
  const src = 'remember x as 1\nif x is 1\nshow "yes"\ndone';
  const result = format(src);
  if (!result.includes('    show "yes"')) throw new Error('if body not indented');
});

test('format: collapses multiple blank lines into one', () => {
  const src = 'show "a"\n\n\n\nshow "b"';
  const result = format(src);
  const doubled = result.includes('\n\n\n');
  if (doubled) throw new Error('multiple blank lines not collapsed');
});

test('format: one blank line between top-level blocks', () => {
  const src = 'make greet()\nshow "hi"\ndone\nmake bye()\nshow "bye"\ndone';
  const result = format(src);
  if (!result.includes('done\n\nmake')) throw new Error('missing blank line between functions');
});

test('format: dedents "otherwise" keyword', () => {
  const src = 'if x is 1\nshow "yes"\notherwise\nshow "no"\ndone';
  const result = format(src);
  if (!result.match(/^otherwise/m)) throw new Error('"otherwise" not at depth 0');
});

test('format: dedents "done" keyword', () => {
  const src = 'make f()\nshow "hi"\ndone';
  const result = format(src);
  if (!result.match(/^done/m)) throw new Error('"done" not at depth 0');
});

test('format: output ends with a single newline', () => {
  const result = format('show "hello"');
  if (!result.endsWith('\n'))   throw new Error('output does not end with newline');
  if (result.endsWith('\n\n')) throw new Error('output ends with double newline');
});

test('format: strips leading blank lines', () => {
  const result = format('\n\nshow "hi"');
  if (result.startsWith('\n')) throw new Error('leading blank lines not stripped');
});

test('format: idempotent â€” formatting twice gives the same result', () => {
  const src = 'make add(a, b)\ngive a + b\ndone\nremember x as 1\nshow x';
  const once  = format(src);
  const twice = format(once);
  if (once !== twice) throw new Error('format is not idempotent');
});

test('format: no blank lines inserted between consecutive non-block statements', () => {
  const src = 'remember x as 1\nremember y as 2\nshow x\nshow y';
  const result = format(src);
  // None of the lines should be separated by blank lines
  if (result.includes('\n\n')) {
    throw new Error(`Unexpected blank line between simple statements:\n${result}`);
  }
});

test('format: array elements are indented', () => {
  const src = 'remember players as [\n"Haaland",\n"Foden",\n]';
  const result = format(src);
  if (!result.includes('    "Haaland"')) {
    throw new Error(`Array elements not indented:\n${result}`);
  }
  if (!result.includes('    "Foden"')) {
    throw new Error(`Array elements not indented:\n${result}`);
  }
});

test('format: closing bracket is not indented', () => {
  const src = 'remember players as [\n"Haaland",\n"Foden",\n]';
  const result = format(src);
  if (!result.match(/^\]/m)) {
    throw new Error(`Closing bracket should be at column 0:\n${result}`);
  }
});

test('format: no blank lines between array elements', () => {
  const src = 'remember players as [\n"Haaland",\n"Foden",\n"Rodri",\n]';
  const result = format(src);
  if (result.includes('"Haaland",\n\n') || result.includes('"Foden",\n\n')) {
    throw new Error(`Blank lines found between array elements:\n${result}`);
  }
});

// â”€â”€ v0.5 â€” plainscript check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.5 â€” plainscript check');

test('plainscript check exits 0 on valid file', () => {
  const dir = tmpDir();
  const plnFile = path.join(dir, 'ok.pln');
  fs.writeFileSync(plnFile, 'remember x as 1\nshow x\n');
  const out = runCli(['check', plnFile], dir);
  if (!out.includes('ok.pln') || !out.toLowerCase().includes('validated')) {
    throw new Error(`Expected success report but got: ${out}`);
  }
});

test('plainscript check validates a whole directory', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.pln'), 'remember x as 1\n');
  fs.writeFileSync(path.join(dir, 'src', 'b.pln'), 'show "hi"\n');
  const out = runCli(['check', path.join(dir, 'src')], dir);
  if (!out.includes('a.pln') || !out.includes('b.pln')) {
    throw new Error(`Expected both files reported but got: ${out}`);
  }
});

test('plainscript check --json emits deterministic machine-readable output', () => {
  const dir = tmpDir();
  const plnFile = path.join(dir, 'ok.pln');
  fs.writeFileSync(plnFile, 'remember x as 1\nshow x\n');
  const out = runCli(['check', '--json', plnFile], dir);
  const parsed = JSON.parse(out);
  if (!parsed.ok || parsed.summary.total !== 1 || parsed.summary.passed !== 1 || parsed.summary.failed !== 0) {
    throw new Error(`Expected a passing JSON summary but got: ${out}`);
  }
  if (!parsed.sources[0] || !parsed.sources[0].ok) {
    throw new Error(`Expected ok source record but got: ${out}`);
  }
});

test('plainscript check reports error on invalid file', () => {
  const dir = tmpDir();
  const plnFile = path.join(dir, 'bad.pln');
  fs.writeFileSync(plnFile, 'remembr x as 1\n');
  const out = runCli(['check', plnFile], dir);
  if (!out.toLowerCase().includes('did you mean')) {
    throw new Error(`Expected "did you mean" suggestion but got: ${out}`);
  }
});

test('plainscript check includes line number in error', () => {
  const dir = tmpDir();
  const plnFile = path.join(dir, 'bad.pln');
  fs.writeFileSync(plnFile, 'remember x as 1\nremembr y as 2\n');
  const out = runCli(['check', plnFile], dir);
  if (!out.toLowerCase().includes('line')) {
    throw new Error(`Expected line info in error but got: ${out}`);
  }
});

test('plainscript check includes filename in error', () => {
  const dir = tmpDir();
  const plnFile = path.join(dir, 'bad.pln');
  fs.writeFileSync(plnFile, 'remember x as 1\nremembr y as 2\n');
  const out = runCli(['check', plnFile], dir);
  if (!out.includes('bad.pln')) {
    throw new Error(`Expected filename "bad.pln" in error but got: ${out}`);
  }
});

test('plainscript check with no argument scans the project sources', () => {
  const dir = tmpDir();
  // An empty project (no src/, no .pln in the root) reports no sources.
  const out = runCli(['check'], dir);
  if (!out.toLowerCase().includes('no .pln files found')) {
    throw new Error(`Expected a project-scan report but got: ${out}`);
  }
});

test('plainscript check errors on missing file', () => {
  const dir = tmpDir();
  const out = runCli(['check', 'does_not_exist.pln'], dir);
  if (!out.toLowerCase().includes('not found')) {
    throw new Error(`Expected "not found" error but got: ${out}`);
  }
});

// â”€â”€ v0.5 â€” plainscript fmt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.5 â€” plainscript fmt');

test('plainscript fmt formats file in-place', () => {
  const dir = tmpDir();
  const plnFile = path.join(dir, 'app.pln');
  fs.writeFileSync(plnFile, 'make add(a, b)\ngive a + b\ndone\n');
  runCli(['fmt', plnFile], dir);
  const result = fs.readFileSync(plnFile, 'utf8');
  if (!result.includes('    give a + b')) {
    throw new Error(`Expected indented body after fmt but got:\n${result}`);
  }
});

test('plainscript fmt reports success message', () => {
  const dir = tmpDir();
  const plnFile = path.join(dir, 'app.pln');
  fs.writeFileSync(plnFile, 'show "hello"\n');
  const out = runCli(['fmt', plnFile], dir);
  if (!out.toLowerCase().includes('formatted')) {
    throw new Error(`Expected "formatted" in output but got: ${out}`);
  }
});

test('plainscript fmt errors without file argument', () => {
  const dir = tmpDir();
  const out = runCli(['fmt'], dir);
  if (!out.toLowerCase().includes('usage')) {
    throw new Error(`Expected usage message but got: ${out}`);
  }
});

test('plainscript fmt errors on missing file', () => {
  const dir = tmpDir();
  const out = runCli(['fmt', 'does_not_exist.pln'], dir);
  if (!out.toLowerCase().includes('not found')) {
    throw new Error(`Expected "not found" error but got: ${out}`);
  }
});

// â”€â”€ v0.5 â€” Diagnostics (line + column in errors) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.5 â€” Diagnostics');

test('parse error includes Line N', () => {
  try {
    compile('remember x as 1\nif x is 1\nshow "oops"');
    throw new Error('expected error');
  } catch (e) {
    if (!e.message.match(/Line \d+/)) {
      throw new Error(`Expected "Line N" in error but got: ${e.message}`);
    }
  }
});

test('parse error includes Column N', () => {
  try {
    compile('remember x as 1\nif x is 1\nshow "oops"');
    throw new Error('expected error');
  } catch (e) {
    if (!e.message.match(/Column \d+/)) {
      throw new Error(`Expected "Column N" in error but got: ${e.message}`);
    }
  }
});

test('misspelled keyword error includes line number', () => {
  try {
    compile('remember x as 1\nshwo x');
    throw new Error('expected error');
  } catch (e) {
    if (!e.message.match(/Line \d+/)) {
      throw new Error(`Expected "Line N" in error but got: ${e.message}`);
    }
  }
});

test('unknown keyword suggestion includes "Did you mean"', () => {
  try {
    compile('remembr x as 1');
    throw new Error('expected error');
  } catch (e) {
    if (!e.message.includes('Did you mean')) {
      throw new Error(`Expected "Did you mean" but got: ${e.message}`);
    }
  }
});

// â”€â”€ v0.5 â€” CLI help & version â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.5 â€” CLI help & version');

test('plainscript help includes "plainscript check"', () => {
  const out = runCli(['help'], process.cwd());
  if (!out.includes('plainscript check')) throw new Error(`"plainscript check" missing from help. Got:\n${out}`);
});

test('plainscript help includes "plainscript fmt"', () => {
  const out = runCli(['help'], process.cwd());
  if (!out.includes('plainscript fmt')) throw new Error(`"plainscript fmt" missing from help. Got:\n${out}`);
});

test('plainscript version shows the compiler version', () => {
  const out = runCli(['version'], process.cwd());
  const { VERSION } = require('../compiler/version');
  if (!out.includes(VERSION)) throw new Error(`Expected version ${VERSION} but got: ${out}`);
});

test('package.json exposes a plainscript bin with a node shebang', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  if (!pkg.bin || pkg.bin.plainscript !== './compiler/cli.js') throw new Error('missing "plainscript" bin');
  if (Object.keys(pkg.bin).length !== 1) throw new Error('package.json must expose exactly one bin');
  if (pkg.preferGlobal) throw new Error('preferGlobal must be false: plainscript installs locally as a devDependency');
  if (pkg.name !== 'plainscript-lang') throw new Error('package name must be "plainscript-lang"');
  const firstLine = fs.readFileSync(path.join(__dirname, '..', 'compiler', 'cli.js'), 'utf8').split('\n')[0];
  if (firstLine.trim() !== '#!/usr/bin/env node') {
    throw new Error('compiler/cli.js must start with a node shebang for global installs');
  }
});

// â”€â”€ v0.6 â€” Extended comparisons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.6 â€” Extended comparisons (lexer)');

test('tokenizes "above" keyword', () => {
  const tokens = tokenize('is above');
  if (tokens[1].type !== TOKEN.ABOVE) throw new Error('above wrong');
});

test('tokenizes "below" keyword', () => {
  const tokens = tokenize('is below');
  if (tokens[1].type !== TOKEN.BELOW) throw new Error('below wrong');
});

test('tokenizes "between" keyword', () => {
  const tokens = tokenize('between');
  if (tokens[0].type !== TOKEN.BETWEEN) throw new Error('between wrong');
});

test('tokenizes "and" keyword', () => {
  const tokens = tokenize('and');
  if (tokens[0].type !== TOKEN.AND) throw new Error('and wrong');
});

test('tokenizes "contains" keyword', () => {
  const tokens = tokenize('contains');
  if (tokens[0].type !== TOKEN.CONTAINS) throw new Error('contains wrong');
});

test('tokenizes "every" as EACH token', () => {
  const tokens = tokenize('every');
  if (tokens[0].type !== TOKEN.EACH) throw new Error('every should be EACH token');
});

test('tokenizes "not" keyword', () => {
  const tokens = tokenize('not');
  if (tokens[0].type !== TOKEN.NOT) throw new Error('not wrong');
});

test('tokenizes "empty" keyword', () => {
  const tokens = tokenize('empty');
  if (tokens[0].type !== TOKEN.EMPTY) throw new Error('empty wrong');
});

console.log('\nv0.6 â€” Extended comparisons (compiler)');

test('"is above" compiles to >', () => {
  const src = 'remember age as 20\nif age is above 18\n  show "adult"\ndone';
  const js = compile(src);
  if (!js.includes('age > 18')) throw new Error('expected age > 18');
});

test('"is below" compiles to <', () => {
  const src = 'remember age as 5\nif age is below 13\n  show "child"\ndone';
  const js = compile(src);
  if (!js.includes('age < 13')) throw new Error('expected age < 13');
});

test('"is at least" compiles to >=', () => {
  const src = 'remember age as 18\nif age is at least 18\n  show "ok"\ndone';
  const js = compile(src);
  if (!js.includes('age >= 18')) throw new Error('expected age >= 18');
});

test('"is at most" compiles to <=', () => {
  const src = 'remember x as 5\nif x is at most 10\n  show "ok"\ndone';
  const js = compile(src);
  if (!js.includes('x <= 10')) throw new Error('expected x <= 10');
});

test('"is not" compiles to !==', () => {
  const src = 'remember x as 5\nif x is not 3\n  show "different"\ndone';
  const js = compile(src);
  if (!js.includes('x !== 3')) throw new Error('expected x !== 3');
});

test('"is empty" compiles to .length === 0', () => {
  const src = 'if x is empty\n  show "empty"\ndone';
  const js = compile(src);
  if (!js.includes('(x).length === 0')) throw new Error('expected .length === 0');
});

test('"is not empty" compiles to .length > 0', () => {
  const src = 'if x is not empty\n  show "has content"\ndone';
  const js = compile(src);
  if (!js.includes('(x).length > 0')) throw new Error('expected .length > 0');
});

test('"contains" compiles to .includes()', () => {
  const src = 'if name contains "PlainScript"\n  show "yes"\ndone';
  const js = compile(src);
  if (!js.includes('.includes(')) throw new Error('expected .includes()');
  if (!js.includes('"PlainScript"')) throw new Error('expected search value');
});

test('"starts with" compiles to .startsWith()', () => {
  const src = 'if name starts with "Hello"\n  show "yes"\ndone';
  const js = compile(src);
  if (!js.includes('.startsWith(')) throw new Error('expected .startsWith()');
});

test('"ends with" compiles to .endsWith()', () => {
  const src = 'if name ends with "!"\n  show "yes"\ndone';
  const js = compile(src);
  if (!js.includes('.endsWith(')) throw new Error('expected .endsWith()');
});

test('"between X and Y" compiles to >= X && <= Y', () => {
  const src = 'if age between 13 and 19\n  show "teenager"\ndone';
  const js = compile(src);
  if (!js.includes('age >= 13 && age <= 19')) throw new Error('expected between condition');
});

test('"between" wraps in if (...) correctly', () => {
  const src = 'if age between 1 and 100\n  show "alive"\ndone';
  const js = compile(src);
  if (!js.includes('if (age >= 1 && age <= 100)')) throw new Error('expected wrapped between');
});

test('"is above" works in while loop', () => {
  const src = 'remember x as 10\nwhile x is above 0\n  x becomes x + 1\ndone';
  const js = compile(src);
  if (!js.includes('while (x > 0)')) throw new Error('expected while (x > 0)');
});

test('error: "is at" without least/most gives helpful message', () => {
  try {
    compile('if x is at 5\n  show "ok"\ndone');
    throw new Error('should have thrown');
  } catch (e) {
    if (!e.message.toLowerCase().includes('least') && !e.message.toLowerCase().includes('most')) {
      throw new Error(`Expected "least" or "most" in error but got: ${e.message}`);
    }
  }
});

// â”€â”€ v0.6 â€” Runtime Standard Library â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.6 â€” Runtime stdlib');

test('print() compiles to console.log', () => {
  const js = compile('print("hello")');
  if (!js.includes('console.log("hello")')) throw new Error('missing console.log');
});

test('print() with multiple args compiles correctly', () => {
  const js = compile('print("a")');
  if (!js.includes('console.log(')) throw new Error('missing console.log call');
});

test('readFile() compiles to readFileSync', () => {
  const js = compile('remember content as readFile("file.txt")');
  if (!js.includes('readFileSync')) throw new Error('missing readFileSync');
  if (!js.includes('"file.txt"')) throw new Error('missing filename');
});

test('writeFile() compiles to writeFileSync', () => {
  const js = compile('writeFile("out.txt", "hello")');
  if (!js.includes('writeFileSync')) throw new Error('missing writeFileSync');
});

test('fileExists() compiles to existsSync', () => {
  const js = compile('remember exists as fileExists("file.txt")');
  if (!js.includes('existsSync')) throw new Error('missing existsSync');
});

test('sleep() compiles to Atomics.wait', () => {
  const js = compile('sleep(1000)');
  if (!js.includes('Atomics.wait')) throw new Error('missing Atomics.wait');
  if (!js.includes('1000')) throw new Error('missing duration');
});

test('time() compiles to Date.now()', () => {
  const js = compile('remember t as time()');
  if (!js.includes('Date.now()')) throw new Error('missing Date.now()');
});

test('date() compiles to new Date().toISOString()', () => {
  const js = compile('remember d as date()');
  if (!js.includes('new Date().toISOString()')) throw new Error('missing toISOString');
});

test('jsonEncode() compiles to JSON.stringify', () => {
  const js = compile('remember s as jsonEncode(x)');
  if (!js.includes('JSON.stringify(x)')) throw new Error('missing JSON.stringify');
});

test('jsonDecode() compiles to JSON.parse', () => {
  const js = compile('remember obj as jsonDecode(s)');
  if (!js.includes('JSON.parse(s)')) throw new Error('missing JSON.parse');
});

test('env() compiles to process.env', () => {
  const js = compile('remember val as env("KEY")');
  if (!js.includes('process.env[')) throw new Error('missing process.env');
  if (!js.includes('"KEY"')) throw new Error('missing env key');
});

test('exit() compiles to process.exit', () => {
  const js = compile('exit(0)');
  if (!js.includes('process.exit(0)')) throw new Error('missing process.exit(0)');
});

test('uuid() compiles to randomUUID', () => {
  const js = compile('remember id as uuid()');
  if (!js.includes('randomUUID()')) throw new Error('missing randomUUID');
});

test('uuid() uses require("crypto")', () => {
  const js = compile('remember id as uuid()');
  if (!js.includes("require('crypto')")) throw new Error('missing require crypto');
});

// â”€â”€ v0.6 â€” Express DX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.6 â€” Express DX');

test('tokenizes "web" as WEB', () => {
  const tokens = tokenize('web');
  if (tokens[0].type !== TOKEN.WEB) throw new Error('web wrong');
});

test('tokenizes "route" as ROUTE_KW', () => {
  const tokens = tokenize('route');
  if (tokens[0].type !== TOKEN.ROUTE_KW) throw new Error('route wrong');
});

test('tokenizes "start" as START_KW', () => {
  const tokens = tokenize('start');
  if (tokens[0].type !== TOKEN.START_KW) throw new Error('start wrong');
});

test('"web app" compiles to Express require and app setup', () => {
  const js = compile('web app');
  if (!js.includes("require('express')")) throw new Error('missing require express');
  if (!js.includes('const app = express()')) throw new Error('missing const app');
});

test('"web app" generates const express', () => {
  const js = compile('web app');
  if (!js.includes('const express')) throw new Error('missing const express');
});

test('duplicate runtime requires are emitted once', () => {
  const js = compile('use express\nuse express\nweb app');
  if ((js.match(/require\('express'\)/g) || []).length !== 1) {
    throw new Error(`expected one express require, got:\n${js}`);
  }
});

test('"route" shorthand compiles to app.get', () => {
  const src = 'route "/"\n  reply "Hello"\ndone';
  const js = compile(src);
  if (!js.includes('app.get("/",')) throw new Error('missing app.get');
  if (!js.includes('(req, res) =>')) throw new Error('missing callback');
});

test('"route" reply compiles to res.send', () => {
  const src = 'route "/home"\n  reply "Home"\ndone';
  const js = compile(src);
  if (!js.includes('res.send("Home")')) throw new Error('missing res.send');
});

test('"start" compiles to app.listen without body', () => {
  const src = 'start 3000';
  const js = compile(src);
  if (!js.includes('app.listen(3000)')) throw new Error('missing app.listen(3000)');
  if (js.includes('() =>')) throw new Error('start should not have callback');
});

test('"start" works with a variable port', () => {
  const src = 'remember port as 8080\nstart port';
  const js = compile(src);
  if (!js.includes('app.listen(port)')) throw new Error('missing app.listen(port)');
});

// â”€â”€ v0.6 â€” SQLite DX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.6 â€” SQLite DX');

test('tokenizes "database" as DATABASE_KW', () => {
  const tokens = tokenize('database');
  if (tokens[0].type !== TOKEN.DATABASE_KW) throw new Error('database wrong');
});

test('tokenizes "query" block as QUERY_KW + SQL_BODY + DONE', () => {
  const tokens = tokenize('query\n    SELECT * FROM users\ndone');
  if (tokens[0].type !== TOKEN.QUERY_KW)  throw new Error('QUERY_KW wrong');
  if (tokens[1].type !== TOKEN.SQL_BODY)  throw new Error('SQL_BODY wrong');
  if (tokens[2].type !== TOKEN.DONE)      throw new Error('DONE wrong');
});

test('"query" SQL_BODY contains the SQL text', () => {
  const tokens = tokenize('query\n    SELECT 1\ndone');
  if (!tokens[1].value.includes('SELECT 1')) throw new Error('SQL content missing');
});

test('"database" compiles to the portable engine chain', () => {
  // v2.1.1 — opening a database awaits __dbOpen, which probes better-sqlite3
  // and falls back to sql.js when the native binding is unusable.
  const js = compile('database "app.db"');
  if (!js.includes('await __dbOpen("app.db", null)')) throw new Error('missing await __dbOpen');
});

test('"database using wasm" forces the WebAssembly engine', () => {
  const js = compile('database "app.db" using "wasm"');
  if (!js.includes('await __dbOpen("app.db", "wasm")')) throw new Error('missing wasm driver');
  if (!js.includes("require('sql.js')")) throw new Error('missing sql.js require');
});

test('"database using native" forbids the wasm fallback', () => {
  const js = compile('database "app.db" using "native"');
  if (!js.includes('await __dbOpen("app.db", "native")')) throw new Error('missing native driver');
});

test('unknown database driver fails at compile time', () => {
  let threw = false;
  try { compile('database "app.db" using "oracle"'); } catch (_) { threw = true; }
  if (!threw) throw new Error('expected unknown-driver error');
});

test('"database" generates const db', () => {
  const js = compile('database "app.db"');
  if (!js.includes('const db')) throw new Error('missing const db');
});

test('"query" block compiles to db.prepare().all()', () => {
  const src = 'query\n    SELECT * FROM users\ndone';
  const js = compile(src);
  if (!js.includes('db.prepare(')) throw new Error('missing db.prepare');
  if (!js.includes('.all()'))       throw new Error('missing .all()');
  if (!js.includes('SELECT * FROM users')) throw new Error('missing SQL');
});

test('"insert" block compiles to db.prepare().run()', () => {
  const src = 'insert\n    INSERT INTO users (name) VALUES ("Alice")\ndone';
  const js = compile(src);
  if (!js.includes('db.prepare(')) throw new Error('missing db.prepare');
  if (!js.includes('.run()'))       throw new Error('missing .run()');
});

test('"update" block compiles to db.prepare().run()', () => {
  const src = 'update\n    UPDATE users SET name = "Bob" WHERE id = 1\ndone';
  const js = compile(src);
  if (!js.includes('.run()')) throw new Error('missing .run()');
});

test('"delete" block compiles to db.prepare().run()', () => {
  const src = 'delete\n    DELETE FROM users WHERE id = 1\ndone';
  const js = compile(src);
  if (!js.includes('.run()')) throw new Error('missing .run()');
});

test('"execute" block compiles to db.exec()', () => {
  const src = 'execute\n    CREATE TABLE users (id INTEGER PRIMARY KEY)\ndone';
  const js = compile(src);
  if (!js.includes('db.exec(')) throw new Error('missing db.exec');
});

// â”€â”€ v0.6 â€” CLI updates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv0.6 â€” CLI updates');

test('plainscript version shows the compiler version (CLI)', () => {
  const out = runCli(['version'], process.cwd());
  const { VERSION } = require('../compiler/version');
  if (!out.includes(VERSION)) throw new Error(`Expected ${VERSION} but got: ${out}`);
});

test('plainscript help mentions v1.0 features', () => {
  const out = runCli(['help'], process.cwd());
  if (!out.includes('1.0')) throw new Error('"1.0" missing from help');
});

test('plainscript help mentions v1.1 PlainScript Expressions', () => {
  const out = runCli(['help'], process.cwd());
  if (!out.includes('PlainScript Expressions')) throw new Error('"PlainScript Expressions" missing from help');
});

test('plainscript help includes "route"', () => {
  const out = runCli(['help'], process.cwd());
  if (!out.includes('route')) throw new Error('"route" missing from help');
});

// â”€â”€ v1.0.2 â€” Lexer edge cases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv1.0 â€” Lexer edge cases');

test('token carries line number', () => {
  const tokens = tokenize('remember\nshow');
  if (tokens[0].line !== 1) throw new Error(`Expected line 1 but got ${tokens[0].line}`);
  if (tokens[1].line !== 2) throw new Error(`Expected line 2 but got ${tokens[1].line}`);
});

test('token carries column number', () => {
  const tokens = tokenize('  remember x as 1');
  if (tokens[0].col !== 3) throw new Error(`Expected col 3 but got ${tokens[0].col}`);
});

test('tokenizes decimal number', () => {
  const tokens = tokenize('3.14');
  if (tokens[0].type !== TOKEN.NUMBER) throw new Error('wrong type');
  if (tokens[0].value !== 3.14) throw new Error(`wrong value: ${tokens[0].value}`);
});

test('tokenizes identifier with underscore', () => {
  const tokens = tokenize('my_var');
  if (tokens[0].type !== TOKEN.IDENTIFIER) throw new Error('wrong type');
  if (tokens[0].value !== 'my_var') throw new Error('wrong value');
});

test('tokenizes identifier with digits', () => {
  const tokens = tokenize('item2');
  if (tokens[0].type !== TOKEN.IDENTIFIER) throw new Error('wrong type');
  if (tokens[0].value !== 'item2') throw new Error('wrong value');
});

test('throws on unexpected character', () => {
  try {
    tokenize('@invalid');
    throw new Error('should have thrown');
  } catch (e) {
    if (!e.message.toLowerCase().includes('unexpected')) throw e;
  }
});

// â”€â”€ v1.0.2 â€” Compiler expression edge cases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv1.0 â€” Expression edge cases');

test('empty array literal compiles to []', () => {
  const js = compile('remember items as []');
  if (!js.includes('= []')) throw new Error('missing empty array');
});

test('decimal number literal compiles correctly', () => {
  const js = compile('remember pi as 3.14');
  if (!js.includes('3.14')) throw new Error('missing decimal');
});

test('nested member access compiles correctly', () => {
  const js = compile('show user.profile.name');
  if (!js.includes('user.profile.name')) throw new Error('missing nested member access');
});

test('chained index access compiles correctly', () => {
  const js = compile('show matrix[0][1]');
  if (!js.includes('matrix[0][1]')) throw new Error('missing chained index access');
});

test('member access becomes compiles to assignment', () => {
  const js = compile('user.profile.age becomes 18');
  if (!js.includes('user.profile.age = 18')) throw new Error('missing nested assignment');
});

test('addition expression with strings compiles correctly', () => {
  const js = compile('remember greeting as "Hello" + " " + "World"');
  if (!js.includes('("Hello" + " ") + "World"')) throw new Error('missing string concat');
});

test('function call result used in expression', () => {
  const js = compile('show add(1, 2) + 3');
  if (!js.includes('add(1, 2) + 3')) throw new Error('missing expression with call');
});

// â”€â”€ v1.0.2 â€” Error message quality â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv1.0 â€” Error message quality');

test('misspelled "mke" suggests "make"', () => {
  try {
    compile('mke greet()\n  show "hi"\ndone');
    throw new Error('should have thrown');
  } catch (e) {
    if (!e.message.toLowerCase().includes('did you mean')) {
      throw new Error(`Expected "did you mean" suggestion but got: ${e.message}`);
    }
  }
});

test('misspelled "wihle" suggests "while"', () => {
  try {
    compile('wihle x is 0\n  x becomes 1\ndone');
    throw new Error('should have thrown');
  } catch (e) {
    if (!e.message.toLowerCase().includes('did you mean')) {
      throw new Error(`Expected "did you mean" suggestion but got: ${e.message}`);
    }
  }
});

test('package names that are reserved words compile to a bare require', () => {
  const js = compile('use class');
  if (!js.includes("require('class')")) throw new Error('missing require class');
  if (js.includes('const class')) throw new Error('reserved word must not become a const binding');
});

test('unterminated string has line and column info', () => {
  try {
    tokenize('"missing close');
    throw new Error('should have thrown');
  } catch (e) {
    if (!e.message.match(/Line \d+/)) {
      throw new Error(`Expected "Line N" in error but got: ${e.message}`);
    }
  }
});

test('missing "as" in remember gives helpful message', () => {
  try {
    compile('remember age 16');
    throw new Error('should have thrown');
  } catch (e) {
    if (!e.message.toLowerCase().includes('as')) {
      throw new Error(`Expected "as" in error but got: ${e.message}`);
    }
  }
});

// â”€â”€ v1.0.2 â€” Formatter additional coverage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv1.0 â€” Formatter additional coverage');

test('format: for each block body is indented', () => {
  const src = 'for each item in list\nshow item\ndone';
  const result = format(src);
  if (!result.includes('    show item')) throw new Error('for each body not indented');
});

test('format: while block body is indented', () => {
  const src = 'while x is below 10\nx becomes x + 1\ndone';
  const result = format(src);
  if (!result.includes('    x becomes x + 1')) throw new Error('while body not indented');
});

test('format: route block body is indented', () => {
  const src = 'route "/"\nreply "Hello"\ndone';
  const result = format(src);
  if (!result.includes('    reply "Hello"')) throw new Error('route body not indented');
});

test('format: nested if inside function is double-indented', () => {
  const src = 'make check(x)\nif x is 1\nshow "one"\ndone\ndone';
  const result = format(src);
  if (!result.includes('        show "one"')) throw new Error('nested if not double-indented');
});

test('format: object literal body is indented', () => {
  const src = 'remember user as\nname is "Ayokunle"\ndone';
  const result = format(src);
  if (!result.includes('    name is "Ayokunle"')) throw new Error('object body not indented');
});

// â”€â”€ v1.0.2 â€” CLI additional coverage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv1.0 â€” CLI additional coverage');

test('plainscript new creates the project directory', () => {
  const dir = tmpDir();
  const projectName = 'test-new-project';
  const projectDir = path.join(dir, projectName);
  runCli(['new', projectName], dir);
  if (!fs.existsSync(projectDir)) throw new Error('project directory not created');
  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('plainscript new creates src/app.pln', () => {
  const dir = tmpDir();
  const projectName = 'test-new-ps';
  const projectDir = path.join(dir, projectName);
  runCli(['new', projectName], dir);
  if (!fs.existsSync(path.join(projectDir, 'src', 'app.pln'))) throw new Error('src/app.pln not created');
  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('plainscript new creates package.json with build scripts and does NOT create plainscript.config.json', () => {
  const dir = tmpDir();
  const projectName = 'test-new-json';
  const projectDir = path.join(dir, projectName);
  runCli(['new', projectName], dir);
  if (fs.existsSync(path.join(projectDir, 'plainscript.config.json'))) throw new Error('plainscript.config.json must NOT be created');
  const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
  if (!pkg.scripts || pkg.scripts.build !== 'plainscript build') throw new Error('expected npm build script "plainscript build"');
  if (!pkg.devDependencies || !pkg.devDependencies['plainscript-lang']) throw new Error('expected plainscript-lang devDependency');
  if (!fs.existsSync(path.join(projectDir, 'src', 'app.pln'))) throw new Error('expected src/app.pln scaffold');
  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('plainscript build writes .js output into dist/, preserving the file name', () => {
  const dir = tmpDir();
  const plnFile = path.join(dir, 'hello.pln');
  fs.writeFileSync(plnFile, 'show "hello"\n');
  runCli(['build', plnFile], dir);
  const jsFile = path.join(dir, 'dist', 'hello.js');
  if (!fs.existsSync(jsFile)) throw new Error('dist/hello.js not created');
  if (fs.existsSync(path.join(dir, 'hello.js'))) throw new Error('output must not sit next to the source');
});

test('plainscript build output file contains valid JS', () => {
  const dir = tmpDir();
  const plnFile = path.join(dir, 'prog.pln');
  fs.writeFileSync(plnFile, 'remember x as 42\nshow x\n');
  runCli(['build', plnFile], dir);
  const js = fs.readFileSync(path.join(dir, 'dist', 'prog.js'), 'utf8');
  if (!js.includes('let x = 42')) throw new Error('expected let x = 42 in output');
  if (!js.includes('console.log(x)')) throw new Error('expected console.log in output');
});

test('plainscript help includes "plainscript new"', () => {
  const out = runCli(['help'], process.cwd());
  if (!out.includes('plainscript new')) throw new Error('"plainscript new" missing from help');
});

test('unknown command shows an error message', () => {
  const dir = tmpDir();
  const out = runCli(['doesnotexist'], dir);
  if (!out.toLowerCase().includes('unknown command')) {
    throw new Error(`Expected "unknown command" error but got: ${out}`);
  }
});

test('plainscript run on a nonexistent file exits with a friendly error', () => {
  const dir = tmpDir();
  const out = runCli(['run', 'no_such_file.pln'], dir);
  if (!out.includes('File not found')) {
    throw new Error(`Expected "File not found" error but got: ${out}`);
  }
  if (out.includes('Complex Compilation')) {
    throw new Error(`There is no Complex Compilation layer anymore. Output:\n${out}`);
  }
});

// â”€â”€ v1.0.2 â€” Compiler regression tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nv1.0 â€” Regression tests');

test('remember with array index read compiles correctly', () => {
  const js = compile('remember players as ["a", "b"]\nremember first as players[0]');
  if (!js.includes('let first = players[0]')) throw new Error('missing index read');
});

test('becomes with object member compiles to assignment', () => {
  const js = compile('user.score becomes 100');
  if (!js.includes('user.score = 100')) throw new Error('missing member assignment');
});

test('"is equal to" is not a valid alias (is is the keyword)', () => {
  // "is" compiles to ===; "equal" and "to" are not keywords the parser handles
  // as a multi-word operator. Only "is" alone triggers equality.
  const js = compile('if x is 5\n  show "five"\ndone');
  if (!js.includes('x === 5')) throw new Error('expected x === 5');
});

test('for each with function call in body', () => {
  const src = 'for each item in list\n  greet(item)\ndone';
  const js = compile(src);
  if (!js.includes('greet(item)')) throw new Error('missing function call in loop body');
});

test('nested function declarations compile correctly', () => {
  const src = 'make outer()\n    make inner()\n        show "hi"\n    done\ndone';
  const js = compile(src);
  if (!js.includes('function outer()')) throw new Error('missing outer');
  if (!js.includes('function inner()')) throw new Error('missing inner');
});

test('multiple show statements compile to multiple console.log calls', () => {
  const src = 'show "a"\nshow "b"\nshow "c"';
  const js = compile(src);
  const count = (js.match(/console\.log/g) || []).length;
  if (count !== 3) throw new Error(`Expected 3 console.log calls but got ${count}`);
});

test('reply json with multiple properties compiles correctly', () => {
  const src = 'when someone visits "/"\n  reply json\n    name is "PlainScript"\n    version is "1.0"\n  done\ndone';
  const js = compile(src);
  if (!js.includes('"name": "PlainScript"')) throw new Error('missing name property');
  if (!js.includes('"version": "1.0"')) throw new Error('missing version property');
});

test('serve folder compiles with correct path', () => {
  const js = compile('serve folder "dist"');
  if (!js.includes('"dist"')) throw new Error('missing folder path');
  if (!js.includes('express.static')) throw new Error('missing static call');
});

test('while loop with is not condition', () => {
  const src = 'remember x as 0\nwhile x is not 10\n  x becomes x + 1\ndone';
  const js = compile(src);
  if (!js.includes('while (x !== 10)')) throw new Error('expected while x !== 10');
});

test('between condition in while loop', () => {
  const src = 'remember x as 5\nif x between 1 and 10\n  show "in range"\ndone';
  const js = compile(src);
  if (!js.includes('x >= 1 && x <= 10')) throw new Error('expected between range');
});

// â”€â”€ RFC-0010 â€” PlainScript Expressions (v1.1) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nRFC-0010 â€” PlainScript Expressions (v1.1)');

test('first player from players compiles to index 0', () => {
  assert(compile('show first player from players'), 'console.log(players[0]);');
});

test('last player from players compiles to last index', () => {
  assert(compile('show last player from players'), 'console.log(players[players.length - 1]);');
});

test('player one from players compiles to index 0 (one-based words)', () => {
  assert(compile('show player one from players'), 'console.log(players[0]);');
});

test('player four from players compiles to index 3', () => {
  assert(compile('show player four from players'), 'console.log(players[3]);');
});

test('player twenty from players compiles to index 19', () => {
  assert(compile('show player twenty from players'), 'console.log(players[19]);');
});

test('all twenty number words compile to one-based indexes', () => {
  const words = ['one','two','three','four','five','six','seven','eight','nine',
    'ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen',
    'eighteen','nineteen','twenty'];
  words.forEach((word, i) => {
    const js = compile(`show player ${word} from players`);
    if (!js.includes(`players[${i}]`)) {
      throw new Error(`"player ${word}" should compile to players[${i}] but got: ${js}`);
    }
  });
});

test('item expression works with any noun', () => {
  assert(compile('show first item from items'), 'console.log(items[0]);');
});

test('item expression works with an array literal collection', () => {
  assert(compile('show first item from ["a", "b"]'), 'console.log(["a", "b"][0]);');
});

test('item expression works with a member access collection', () => {
  assert(compile('show first item from team.players'), 'console.log(team.players[0]);');
});

test('item expression in a condition', () => {
  const js = compile('if first player from players is "Ayo"\n  show "yes"\ndone');
  if (!js.includes('players[0] === "Ayo"')) throw new Error('expected index condition');
});

test('item expression in arithmetic', () => {
  assert(compile('show first score from scores + 10'), 'console.log(scores[0] + 10);');
});

test('item expression as an assignment target', () => {
  assert(compile('first player from players becomes "Ayo"'), 'players[0] = "Ayo";');
});

test('numbered item expression as an assignment target', () => {
  assert(compile('player two from players becomes "Bola"'), 'players[1] = "Bola";');
});

test('last item expression as an assignment target', () => {
  assert(compile('last player from players becomes "Zed"'), 'players[players.length - 1] = "Zed";');
});

test('of-expression combining with an item expression', () => {
  assert(compile('show name of first player from players'), 'console.log(players[0].name);');
});

test('players length compiles to .length', () => {
  assert(compile('show players length'), 'console.log(players.length);');
});

test('length of players compiles to .length (of form)', () => {
  assert(compile('show length of players'), 'console.log(players.length);');
});

test('length in a condition', () => {
  const js = compile('if players length is 3\n  show "three"\ndone');
  if (!js.includes('players.length === 3')) throw new Error('expected length condition');
});

test('length works on a member expression', () => {
  assert(compile('show team.players length'), 'console.log(team.players.length);');
});

test('name of user compiles to property access', () => {
  assert(compile('show name of user'), 'console.log(user.name);');
});

test('name of user becomes compiles to assignment', () => {
  assert(compile('name of user becomes "Ayo"'), 'user.name = "Ayo";');
});

test('of-expression is right-associative', () => {
  assert(compile('show city of address of customer'), 'console.log(customer.address.city);');
});

test('nested of-expression becomes compiles to nested assignment', () => {
  assert(compile('city of address of customer becomes "Lagos"'), 'customer.address.city = "Lagos";');
});

test('of-expression as a collection operation argument', () => {
  assert(compile('add(name of user to names)'), 'names.push(user.name);');
});

test('of-expression as a function argument', () => {
  assert(compile('greet(name of user)'), 'greet(user.name);');
});

test('of-expression object can be an indexed value', () => {
  assert(compile('show name of users[0]'), 'console.log(users[0].name);');
});

test('of-expression errors when the left side is not a property word', () => {
  try {
    compile('show 5 of user');
    throw new Error('expected an error but none was thrown');
  } catch (e) {
    if (!e.message.includes('Expected a property name before "of"')) {
      throw new Error(`unexpected message: ${e.message}`);
    }
  }
});

test('add(item to collection) compiles to push', () => {
  assert(compile('add(player to players)'), 'players.push(player);');
});

test('remove(item from collection) dispatches Map/Set then splice', () => {
  assert(compile('remove(player from players)'), 'players instanceof Map || players instanceof Set ? players.delete(player) : players.splice(players.indexOf(player), 1);');
});

test('add with a literal value', () => {
  assert(compile('add("Ayo" to players)'), 'players.push("Ayo");');
});

test('add with an item expression value', () => {
  assert(compile('add(first player from players to team)'), 'team.push(players[0]);');
});

test('remove with a property expression value', () => {
  assert(compile('remove(name of user from names)'), 'names instanceof Map || names instanceof Set ? names.delete(user.name) : names.splice(names.indexOf(user.name), 1);');
});

test('remove with an item expression value', () => {
  assert(compile('remove(last player from players)'),
    'players instanceof Map || players instanceof Set ? players.delete(players[players.length - 1]) : players.splice(players.indexOf(players[players.length - 1]), 1);');
});

test('remove with a numbered item value', () => {
  assert(compile('remove(player one from players)'), 'players instanceof Map || players instanceof Set ? players.delete(players[0]) : players.splice(players.indexOf(players[0]), 1);');
});

test('add works inside a for each loop', () => {
  const js = compile('for each item in items\n  add(item to seen)\ndone');
  if (!js.includes('seen.push(item)')) throw new Error('missing push in loop body');
});

test('add is still usable as a user function name (backward compat)', () => {
  const js = compile('make add(a, b)\n  give a + b\ndone\nshow add(2, 3)');
  if (!js.includes('function add(a, b)')) throw new Error('missing function declaration');
  if (!js.includes('add(2, 3)')) throw new Error('missing normal call');
});

test('length is still usable as a function (backward compat)', () => {
  assert(compile('show length(players)'), 'console.log((players).length);');
});

test('unknown special call form throws a helpful error', () => {
  try {
    compile('frobnicate(a to b)');
    throw new Error('expected an error but none was thrown');
  } catch (e) {
    if (!e.message.includes('not a valid PlainScript collection expression')) {
      throw new Error(`unexpected message: ${e.message}`);
    }
  }
});

test('contains compiles to includes (pre-existing v0.6)', () => {
  const js = compile('if players contains "Ayo"\n  show "found"\ndone');
  if (!js.includes('(players).includes("Ayo")')) throw new Error('expected includes');
});

test('contains works with a property expression', () => {
  const js = compile('if names contains name of user\n  show "found"\ndone');
  if (!js.includes('includes(user.name)')) throw new Error('expected includes with property');
});

test('read compiles to readFileSync with an fs prelude', () => {
  const js = compile('show read("users.txt")');
  if (!js.includes(`const fs = require('fs');`)) throw new Error('missing fs prelude');
  if (!js.includes(`fs.readFileSync("users.txt", 'utf8')`)) throw new Error('missing readFileSync');
});

test('read works with a variable path', () => {
  const js = compile('show read(filePath)');
  if (!js.includes(`fs.readFileSync(filePath, 'utf8')`)) throw new Error('missing readFileSync');
});

test('write(data to file) compiles to writeFileSync with an fs prelude', () => {
  const js = compile('write("hello" to "out.txt")');
  if (!js.includes(`const fs = require('fs');`)) throw new Error('missing fs prelude');
  if (!js.includes(`fs.writeFileSync("hello", "out.txt", 'utf8')`)) throw new Error('missing writeFileSync');
});

test('write works with a variable payload', () => {
  const js = compile('write(data to "out.txt")');
  if (!js.includes(`fs.writeFileSync(data, "out.txt", 'utf8')`)) throw new Error('missing writeFileSync');
});

test('readFile remains available (backward compat)', () => {
  const js = compile('show readFile("x.txt")');
  if (!js.includes(`fs.readFileSync("x.txt", 'utf8')`)) throw new Error('missing readFileSync');
});

test('read result feeds other stdlib functions', () => {
  const js = compile('show uppercase(read("notes.txt"))');
  if (!js.includes(`(fs.readFileSync("notes.txt", 'utf8')).toUpperCase()`)) {
    throw new Error(`missing nested read: ${js}`);
  }
});

test('first from players errors with a missing-noun hint', () => {
  try {
    compile('first from players');
    throw new Error('expected an error but none was thrown');
  } catch (e) {
    if (!e.message.includes('Expected a noun after "first"')) {
      throw new Error(`unexpected message: ${e.message}`);
    }
  }
});

test('last from players errors with a missing-noun hint', () => {
  try {
    compile('show last from players');
    throw new Error('expected an error but none was thrown');
  } catch (e) {
    if (!e.message.includes('Expected a noun after "last"')) {
      throw new Error(`unexpected message: ${e.message}`);
    }
  }
});

test('non-number word before "from" errors with a number-word hint', () => {
  try {
    compile('show player banana from players');
    throw new Error('expected an error but none was thrown');
  } catch (e) {
    if (!e.message.includes('Expected a number word after "player" before "from"')) {
      throw new Error(`unexpected message: ${e.message}`);
    }
  }
});

test('number words beyond twenty are rejected', () => {
  try {
    compile('show player twentyone from players');
    throw new Error('expected an error but none was thrown');
  } catch (e) {
    if (!e.message.includes('Expected a number word')) {
      throw new Error(`unexpected message: ${e.message}`);
    }
  }
});

test('expressions compose in consecutive statements', () => {
  const js = compile('remember p as first player from players\nshow p length');
  if (!js.includes('let p = players[0]')) throw new Error('missing item remember');
  if (!js.includes('console.log(p.length)')) throw new Error('missing length');
});

test('expressions work inside while loops', () => {
  const js = compile('while players length is above 0\n  remove(last player from players)\ndone');
  if (!js.includes('while (players.length > 0)')) throw new Error('expected while condition');
  if (!js.includes('players.splice(players.indexOf(players[players.length - 1]), 1)')) {
    throw new Error('expected remove in loop body');
  }
});

test('expressions work inside functions', () => {
  const js = compile('make pick()\n  give first player from players\ndone');
  if (!js.includes('return players[0];')) throw new Error('expected return item');
});

test('expressions work across if-otherwise branches', () => {
  const js = compile('if players contains "Ayo"\n  show "yes"\notherwise\n  add("Ayo" to players)\ndone');
  if (!js.includes('(players).includes("Ayo")')) throw new Error('expected condition');
  if (!js.includes('players.push("Ayo")')) throw new Error('expected add in otherwise');
});

test('legacy array index syntax still works', () => {
  assert(compile('show players[0]'), 'console.log(players[0]);');
});

test('format: preserves plain expressions', () => {
  const src = 'show first player from players\nadd(player to players)\nshow name of user';
  const result = format(src);
  if (!result.includes('first player from players')) throw new Error('item expression changed');
  if (!result.includes('add(player to players)')) throw new Error('collection expression changed');
  if (!result.includes('name of user')) throw new Error('of-expression changed');
});

// â”€â”€ RFC-0011 â€” JavaScript Gateway (v1.1.1-beta) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nRFC-0011 â€” JavaScript Gateway (v1.1.1-beta)');
// â”€â”€ Generic npm packages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('use axios compiles to a require binding', () => {
  assert(compile('use axios'), 'const axios = require(\'axios\');');
});

test('use dotenv and use sharp compile to require bindings', () => {
  const js = compile('use dotenv\nuse sharp');
  if (!js.includes("require('dotenv')")) throw new Error('missing dotenv');
  if (!js.includes("require('sharp')")) throw new Error('missing sharp');
});

test('duplicate generic requires are emitted once', () => {
  const js = compile('use axios\nuse axios');
  const count = (js.match(/require\('axios'\)/g) || []).length;
  if (count !== 1) throw new Error(`expected one axios require but got ${count}`);
});

test('use sqlite still maps to better-sqlite3', () => {
  const js = compile('use sqlite');
  if (!js.includes("require('better-sqlite3')")) throw new Error('missing better-sqlite3');
});

test('use node-fetch compiles to a bare require', () => {
  assert(compile('use node-fetch'), "require('node-fetch');");
});

test('use @scope/package compiles to a bare require', () => {
  assert(compile('use @scope/package'), "require('@scope/package');");
});

test('use @scope/package-name compiles to a bare require', () => {
  assert(compile('use @scope/package-name'), "require('@scope/package-name');");
});

test('hyphenated and scoped packages compile alongside regular packages', () => {
  const js = compile('use axios\nuse node-fetch\nuse @scope/package');
  if (!js.includes("const axios = require('axios');")) throw new Error('missing axios binding');
  if (!js.includes("require('node-fetch');")) throw new Error('missing node-fetch');
  if (!js.includes("require('@scope/package');")) throw new Error('missing scoped package');
});

test('bundle: generic npm packages are detected and required', () => {
  const js = bundleFixture('uses_npm.pln');
  if (!js.includes("require('node-fetch');")) throw new Error('missing node-fetch');
  if (!js.includes("require('@scope/package-name');")) throw new Error('missing scoped package');
  if (!js.includes("require('dotenv');")) throw new Error('missing dotenv');
});

test('bundle: hyphenated packages imported from other files are deduplicated', () => {
  const js = bundleFixture('gateway_imports_npm.pln');
  const count = (js.match(/require\('node-fetch'\)/g) || []).length;
  if (count !== 1) throw new Error(`expected one node-fetch require but got ${count}`);
  if (!js.includes('"gateway loaded"')) throw new Error('entry output missing');
});

test('use node-fetch inside a loop body works', () => {
  const js = compile('while x is above 0\n  use node-fetch\n  x becomes x + 1\ndone');
  if (!js.includes("require('node-fetch');")) throw new Error('missing node-fetch in loop');
});

test('use @scope/package inside a function body works', () => {
  const js = compile('make load()\n  use @scope/package\n  show "loaded"\ndone');
  if (!js.includes("require('@scope/package');")) throw new Error('missing scoped package in function');
});

test('use node-fetch inside an if body works', () => {
  const js = compile('if x is 1\n  use node-fetch\ndone');
  if (!js.includes("require('node-fetch');")) throw new Error('missing node-fetch in if');
});

// â”€â”€ Generic npm packages: aliases and version specs (v2.0.1) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('splitPackageSpec splits name and version range', () => {
  assert(JSON.stringify(splitPackageSpec('express')), JSON.stringify({ name: 'express', spec: null }));
  assert(JSON.stringify(splitPackageSpec('left-pad@^1.3.0')), JSON.stringify({ name: 'left-pad', spec: '^1.3.0' }));
  assert(JSON.stringify(splitPackageSpec('@scope/pkg')), JSON.stringify({ name: '@scope/pkg', spec: null }));
  assert(JSON.stringify(splitPackageSpec('@scope/pkg@2')), JSON.stringify({ name: '@scope/pkg', spec: '2' }));
});

test('use pkg as name binds the package to the alias', () => {
  assert(compile('use node-fetch as fetch'), "const fetch = require('node-fetch');");
});

test('use @scope/pkg as name and hyphenated as name bind aliases', () => {
  const js = compile('use @scope/pkg as scoped\nuse left-pad as pad');
  if (!js.includes("const scoped = require('@scope/pkg');")) throw new Error(`missing scoped alias:\n${js}`);
  if (!js.includes("const pad = require('left-pad');")) throw new Error(`missing pad alias:\n${js}`);
});

test('aliased packages are deduplicated by package and alias', () => {
  const js = compile('use dotenv as env\nuse dotenv as env');
  const count = (js.match(/require\('dotenv'\)/g) || []).length;
  if (count !== 1) throw new Error(`expected one dotenv require but got ${count}`);
  assert(compile('use semver\nuse semver as sem'),
    "const semver = require('semver');\nconst sem = require('semver');");
});

test('aliasing a built-in runtime package fails with guidance', () => {
  try {
    compile('use express as app');
    throw new Error('expected an error but none was thrown');
  } catch (e) {
    if (!/already available as "express"/.test(e.message)) throw new Error(`wrong error: ${e.message}`);
  }
});

test('an invalid alias fails with a clear error', () => {
  try {
    generate(parse(tokenize('use node-fetch as "quoted"')));
    throw new Error('expected an error but none was thrown');
  } catch (e) {
    if (!/variable name after "as"/.test(e.message)) throw new Error(`wrong error: ${e.message}`);
  }
});

test('version specs are lexed as part of the package token', () => {
  const tokens = tokenize('use left-pad@^1.3.0');
  if (tokens[1].type !== TOKEN.PACKAGE) throw new Error(`type: ${tokens[1].type}`);
  if (tokens[1].value !== 'left-pad@^1.3.0') throw new Error(`value: ${tokens[1].value}`);
});

test('version specs are stripped for require()', () => {
  assert(compile('use left-pad@^1.3.0'), "require('left-pad');");
  const js = compile('use dotenv@16 as env');
  if (!js.includes("const env = require('dotenv');")) throw new Error(`spec leaked into require:\n${js}`);
});

test('known packages keep their canonical binding when versioned', () => {
  assert(compile('use sqlite@7'), `const Database = require('better-sqlite3');`);
});

test('detect keeps version specs and maps friendly names through them', () => {
  assert(JSON.stringify(detectDependencies('use left-pad@^1.3.0')), '["left-pad@^1.3.0"]');
assert(JSON.stringify(detectDependencies('use sqlite@7')), '["better-sqlite3@7"]');
  assert(JSON.stringify(detectDependencies('use @scope/pkg@1')), '["@scope/pkg@1"]');
});

// â”€â”€ CLI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('plainscript version shows the compiler version', () => {
  const out = runCli(['version'], process.cwd());
  const { VERSION } = require('../compiler/version');
  if (!out.includes(VERSION)) throw new Error(`Expected ${VERSION} but got: ${out}`);
});

test('plainscript run on a nonexistent file reports a friendly error and does not invoke AI', () => {
  const dir = tmpDir();
  const out = runCli(['run', 'missing.pln'], dir);
  if (!out.includes('File not found')) {
    throw new Error(`Expected a "File not found" error but got: ${out}`);
  }
  if (out.includes('Complex Compilation')) {
    throw new Error(`There is no Complex Compilation layer anymore. Output:\n${out}`);
  }
});

// â”€â”€ Regression: project-local dependency resolution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Fabricate an "installed" package inside a project's node_modules without
// hitting the network, so isInstalled() (require.resolve) treats it as present.
function writeLocalPackage(projectDir, pkgName, mainSrc) {
  const pkgDir = path.join(projectDir, 'node_modules', pkgName);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: pkgName, version: '1.0.1', main: 'index.js' })
  );
  fs.writeFileSync(path.join(pkgDir, 'index.js'), mainSrc);
}

test('plainscript run resolves dependencies from the project node_modules, not the global install', () => {
  const dir = tmpDir();
  writeLocalPackage(dir, 'plainscriptlocaltest', 'module.exports = "resolved-from-project-node_modules";\n');
  fs.writeFileSync(path.join(dir, 'app.pln'), 'use plainscriptlocaltest\nshow plainscriptlocaltest\n');
  const out = runCli(['run', 'app.pln'], dir);
  if (!out.includes('resolved-from-project-node_modules')) {
    throw new Error(`local dependency did not resolve from the project. Output:\n${out}`);
  }
  const stale = path.join(dir, 'stray-check.tmp.js');
  if (fs.existsSync(stale)) {
    throw new Error('run wrote an artifact into the compiler directory');
  }
});

test('plainscript start resolves project-local dependencies from src/', () => {
  const dir = tmpDir();
  writeLocalPackage(dir, 'plainscriptlocaltest', 'module.exports = "start-resolved-locally";\n');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.pln'), 'use plainscriptlocaltest\nshow plainscriptlocaltest\n');
  const out = runCli(['start'], dir);
  if (!out.includes('start-resolved-locally')) {
    throw new Error(`plainscript start did not resolve the local dependency. Output:\n${out}`);
  }
});

test('hyphenated packages resolve at runtime from the project node_modules', () => {
  const dir = tmpDir();
  const marker = path.join(dir, 'hyphenated-loaded.txt');
  writeLocalPackage(dir, 'plainscript-fake-fetch',
    `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ok');\nmodule.exports = {};\n`);
  fs.writeFileSync(path.join(dir, 'app.pln'), 'use plainscript-fake-fetch\nshow "hyphenated-ok"\n');
  const out = runCli(['run', 'app.pln'], dir);
  if (!out.includes('hyphenated-ok')) throw new Error(`run failed. Output:\n${out}`);
  if (!fs.existsSync(marker)) {
    throw new Error('hyphenated package was not loaded from the project node_modules');
  }
});

test('scoped packages resolve at runtime from the project node_modules', () => {
  const dir = tmpDir();
  const marker = path.join(dir, 'scoped-loaded.txt');
  writeLocalPackage(dir, '@fakescope/pkg',
    `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ok');\nmodule.exports = {};\n`);
  fs.writeFileSync(path.join(dir, 'app.pln'), 'use @fakescope/pkg\nshow "scoped-ok"\n');
  const out = runCli(['run', 'app.pln'], dir);
  if (!out.includes('scoped-ok')) throw new Error(`run failed. Output:\n${out}`);
  if (!fs.existsSync(marker)) {
    throw new Error('scoped package was not loaded from the project node_modules');
  }
});

test('multiple project-local dependencies resolve at runtime', () => {
  const dir = tmpDir();
  writeLocalPackage(dir, 'plainscriptfirst', 'module.exports = "first";\n');
  writeLocalPackage(dir, 'plainscriptsecond', 'module.exports = "second";\n');
  fs.writeFileSync(path.join(dir, 'app.pln'),
    'use plainscriptfirst\nuse plainscriptsecond\nshow plainscriptfirst + " " + plainscriptsecond\n');
  const out = runCli(['run', 'app.pln'], dir);
  if (!out.includes('first second')) throw new Error(`multiple deps did not resolve. Output:\n${out}`);
});

test('multi-file projects resolve project-local dependencies at runtime', () => {
  const dir = tmpDir();
  writeLocalPackage(dir, 'plainscriptlocaltest', 'module.exports = "from-multifile";\n');
  fs.writeFileSync(path.join(dir, 'lib.pln'), 'make version()\n  give "v2"\ndone\n');
  fs.writeFileSync(path.join(dir, 'app.pln'),
    'import "./lib.pln"\nuse plainscriptlocaltest\nshow plainscriptlocaltest + " " + version()\n');
  const out = runCli(['run', 'app.pln'], dir);
  if (!out.includes('from-multifile v2')) throw new Error(`multi-file run failed. Output:\n${out}`);
});

test('built-in modules still execute after the dependency-resolution fix', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'note.txt'), 'hello-builtin');
  fs.writeFileSync(path.join(dir, 'app.pln'),
    'use fs\nremember content as readFile("note.txt")\nshow content\n');
  const out = runCli(['run', 'app.pln'], dir);
  if (!out.includes('hello-builtin')) throw new Error(`built-in fs failed. Output:\n${out}`);
});

// â”€â”€ CLI: doctor, update, start, cc commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nCLI â€” plainscript doctor');

test('plainscript doctor exits 0 and prints environment checks', () => {
  const dir = tmpDir();
  const out = runCli(['doctor'], dir);
  if (!out.includes('PlainScript doctor')) throw new Error(`Expected "PlainScript doctor" header but got: ${out}`);
  if (!out.includes('Node.js')) throw new Error('Expected Node.js check');
  if (!out.includes('npm')) throw new Error('Expected npm check');
  if (!out.includes('PlainScript CLI')) throw new Error('Expected PlainScript CLI check');
  if (!out.includes('Compiler')) throw new Error('Expected Compiler check');
  if (!out.includes('Formatter')) throw new Error('Expected Formatter check');
  if (!out.includes('Runtime')) throw new Error('Expected Runtime check');
});

test('plainscript doctor does not report a Complex Compilation layer', () => {
  const dir = tmpDir();
  const out = runCli(['doctor'], dir);
  if (out.includes('Complex Compilation')) throw new Error(`Complex Compilation must be gone. Output:\n${out}`);
});

test('plainscript doctor reports source files when src/ contains .pln files', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.pln'), 'show "hello"\n');
  const out = runCli(['doctor'], dir);
  if (!out.includes('Source files')) throw new Error(`Expected "Source files" check but got: ${out}`);
  if (!out.includes('src')) throw new Error(`Expected "src" in source check detail but got: ${out}`);
});

test('plainscript doctor reports no sources when no .pln files exist', () => {
  const dir = tmpDir();
  const out = runCli(['doctor'], dir);
  if (!out.includes('Source files')) throw new Error(`Expected "Source files" check but got: ${out}`);
  if (!out.includes('no .pln files')) throw new Error(`Expected "no .pln files" detail but got: ${out}`);
});

test('plainscript doctor reports no sources when src/ is empty', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const out = runCli(['doctor'], dir);
  if (!out.includes('no .pln files')) throw new Error(`Expected "no .pln files" detail but got: ${out}`);
});

test('plainscript doctor reports ready dependencies when all installed', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.pln'), 'show "hello"\n');
  const out = runCli(['doctor'], dir);
  if (!out.includes('ready')) throw new Error(`Expected "ready" for dependencies but got: ${out}`);
});

test('plainscript help includes "plainscript doctor"', () => {
  const out = runCli(['help'], process.cwd());
  if (!out.includes('plainscript doctor')) throw new Error('"plainscript doctor" missing from help');
});

console.log('\nCLI â€” plainscript start');

test('plainscript start errors when no entry file found', () => {
  const dir = tmpDir();
  const out = runCli(['start'], dir);
  if (!out.includes('No entry file found')) {
    throw new Error(`Expected "No entry file found" but got: ${out}`);
  }
});

test('plainscript start errors when src/app.pln is missing', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const out = runCli(['start'], dir);
  if (!out.includes('No entry file found')) {
    throw new Error(`Expected "No entry file found" but got: ${out}`);
  }
});

test('plainscript start runs src/app.pln by default', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.pln'), 'show "started-from-src"\n');
  const out = runCli(['start'], dir);
  if (!out.includes('started-from-src')) {
    throw new Error(`Expected "started-from-src" output but got: ${out}`);
  }
  if (!fs.existsSync(path.join(dir, 'dist', 'app.js'))) {
    throw new Error('start must persist the built output in dist/');
  }
});

test('plainscript start defaults to src/app.pln when no entry configured', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.pln'), 'show "default-entry"\n');
  const out = runCli(['start'], dir);
  if (!out.includes('default-entry')) {
    throw new Error(`Expected "default-entry" output but got: ${out}`);
  }
});

console.log('\nCLI â€” plainscript update');

test('plainscript update runs npm update', () => {
  const dir = tmpDir();
  runCli(['init'], dir);
  const out = runCli(['update'], dir);
  if (!out.includes('Updating packages')) throw new Error(`Expected "Updating packages" but got: ${out}`);
  if (!out.includes('updated')) throw new Error(`Expected "updated" confirmation but got: ${out}`);
});

test('plainscript help includes "plainscript update"', () => {
  const out = runCli(['help'], process.cwd());
  if (!out.includes('plainscript update')) throw new Error('"plainscript update" missing from help');
});

console.log('\nCLI â€” one compiler only');

test('plainscript cc is no longer a command', () => {
  const out = runCli(['cc', 'status'], process.cwd());
  if (!out.toLowerCase().includes('unknown command')) throw new Error(`Expected "Unknown command" but got: ${out}`);
});

test('plainscript ai is no longer a command', () => {
  const out = runCli(['ai', 'status'], process.cwd());
  if (!out.toLowerCase().includes('unknown command')) throw new Error(`Expected "Unknown command" but got: ${out}`);
});

test('plainscript help does not mention Complex Compilation', () => {
  const out = runCli(['help'], process.cwd());
  if (out.includes('Complex Compilation')) throw new Error(`Help must not mention Complex Compilation. Output:\n${out}`);
});

test('plainscript help includes "plainscript start"', () => {
  const out = runCli(['help'], process.cwd());
  if (!out.includes('plainscript start')) throw new Error('"plainscript start" missing from help');
});

const pendingPluginTests = [];

// â”€â”€ String Templates (backtick strings) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('string template: lexer produces TEMPLATE_STRING token', () => {
  const tokens = tokenize('remember msg as `Hello World`');
  const t = tokens.find(tok => tok.type === TOKEN.TEMPLATE_STRING);
  if (!t) throw new Error('Expected TEMPLATE_STRING token');
  if (t.value !== 'Hello World') throw new Error('Wrong value: ' + t.value);
});

test('string template: lexer preserves multiline content', () => {
  const tokens = tokenize('remember msg as `line1\nline2\nline3`');
  const t = tokens.find(tok => tok.type === TOKEN.TEMPLATE_STRING);
  if (!t) throw new Error('Expected TEMPLATE_STRING token');
  if (t.value !== 'line1\nline2\nline3') throw new Error('Wrong value: ' + JSON.stringify(t.value));
});

test('string template: lexer preserves interpolation syntax', () => {
  const tokens = tokenize('remember msg as `Hello ${name}!`');
  const t = tokens.find(tok => tok.type === TOKEN.TEMPLATE_STRING);
  if (!t) throw new Error('Expected TEMPLATE_STRING token');
  if (t.value !== 'Hello ${name}!') throw new Error('Wrong value: ' + t.value);
});

test('string template: unterminated backtick throws', () => {
  let threw = false;
  try { tokenize('remember msg as `Hello World'); } catch (e) { threw = true; }
  if (!threw) throw new Error('Expected error for unterminated backtick');
});

test('string template: two separate backtick strings', () => {
  const tokens = tokenize('remember msg as `hello` `world`');
  const ts = tokens.filter(tok => tok.type === TOKEN.TEMPLATE_STRING);
  if (ts.length !== 2) throw new Error('Expected 2 templates, got ' + ts.length);
  if (ts[0].value !== 'hello') throw new Error('First value wrong');
  if (ts[1].value !== 'world') throw new Error('Second value wrong');
});

test('string template: parser produces TemplateLiteral node', () => {
  const tokens = tokenize('remember msg as `Hello World`');
  const ast = parse(tokens);
  const stmt = ast.body[0];
  if (stmt.type !== 'RememberStatement') throw new Error('Wrong stmt type: ' + stmt.type);
  if (stmt.value.type !== 'TemplateLiteral') throw new Error('Wrong value type: ' + stmt.value.type);
  if (stmt.value.value !== 'Hello World') throw new Error('Wrong value');
});

test('string template: generator emits JS template literal', () => {
  const tokens = tokenize('remember msg as `Hello World`');
  const code = generate(parse(tokens));
  if (!code.includes('`Hello World`')) throw new Error('Missing template literal in output: ' + code);
  if (code.includes('JSON.stringify')) throw new Error('Should not use JSON.stringify for templates');
});

test('string template: full compile roundtrip', () => {
  const src = 'remember msg as `Hello World`\nshow msg';
  const code = generate(parse(tokenize(src)));
  if (!code.includes('`Hello World`')) throw new Error('Template literal missing');
});

test('string template: interpolation roundtrip', () => {
  const src = 'remember name as "World"\nremember msg as `Hello ${name}!`\nshow msg';
  const code = generate(parse(tokenize(src)));
  if (!code.includes('`Hello ${name}!`')) throw new Error('Interpolation missing: ' + code);
});

test('string template: multiline in show roundtrip', () => {
  const src = 'show `line1\nline2`';
  const code = generate(parse(tokenize(src)));
  if (!code.includes('line1\nline2')) throw new Error('Multiline missing: ' + code);
});

test('string template: backtick contains double and single quotes', () => {
  const src = 'show `Hello "World" and \'single\'`';
  const code = generate(parse(tokenize(src)));
  if (!code.includes('"World"')) throw new Error('Double quotes missing');
  if (!code.includes("'single'")) throw new Error('Single quotes missing');
});

test('string template: plain dollar sign without interpolation', () => {
  const src = 'show `price is $5`';
  const code = generate(parse(tokenize(src)));
  if (!code.includes('$5')) throw new Error('Dollar sign missing');
  if (code.includes('${')) throw new Error('Should not contain interpolation syntax');
});

// â”€â”€ Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

Promise.all(pendingPluginTests).then(() => {
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
