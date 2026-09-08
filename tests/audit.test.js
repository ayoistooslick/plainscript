// v1.0.2 capability-gap audit tests.
// Exercises every feature shipped to close the TypeScript/Node capability gap
// (see docs/CAPABILITY_GAP_AUDIT.md): record kinds, concurrency combinators,
// generators, binary/serialization, reflection, config, CLI, process, streams,
// filesystem metadata/walk/path, and the native test DSL.
//
// Two kinds of assertions:
//   * static — compiled JavaScript contains the expected output pattern, and
//   * runtime — the compiled program is executed with node and its stdout,
//     exit code are verified against reality.

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execFileSync, spawnSync } = require('child_process');
const { parse } = require('../compiler/parser');
const { tokenize } = require('../compiler/lexer');
const { generate, wrapAsync, createGenerationContext } = require('../compiler/generator');

let passed = 0;
let failed = 0;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-audit-'));

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
  const a = String(actual).trim();
  const e = String(expected).trim();
  if (a !== e) throw new Error(`Expected:\n        ${e}\n        Got:\n        ${a}`);
}

function assertIncludes(haystack, needle) {
  if (!String(haystack).includes(String(needle))) {
    throw new Error(`Expected output to include:\n        ${needle}\n        Got:\n        ${haystack}`);
  }
}

function compile(source) {
  return generate(parse(tokenize(source)), createGenerationContext());
}

// Execute a PlainScript program with node, returning { stdout, code }.
function run(source) {
  const base = `run_${Date.now()}_${Math.floor(Math.random() * 1e9)}.js`;
  const file = path.join(tmpDir, base);
  const ctx = createGenerationContext();
  const js = generate(parse(tokenize(source)), ctx);
  fs.writeFileSync(file, ctx.needsAsync ? wrapAsync(js) : js);
  const res = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  return { stdout: res.stdout || '', code: res.status, stderr: res.stderr || '' };
}

console.log('\n── v1.0.2 capability-gap audit ───────────────────────────────\n');
console.log('Record kinds (classes)');

test('define a kind compiles to a factory with defaults', () => {
  const js = compile('define a kind called "Person" with\n  name is ""\n  age is 0\ndone');
  assertIncludes(js, 'const Person = __makeKind_Person;');
  assertIncludes(js, '"name": ""');
  assertIncludes(js, '"age": 0');
});

test('kind factories reject unknown fields at runtime', () => {
  const r = run([
    'define a kind called "Person" with',
    '  name is ""',
    'done',
    'remember p as create a Person with oops "x"',
  ].join('\n'));
  assertIncludes(r.stderr + r.stdout, 'has no field named');
});

test('create a Kind with pairs produces a plain record', () => {
  const r = run([
    'define a kind called "Person" with',
    '  name is ""',
    '  age is 0',
    'done',
    'remember p as create a Person with name "Ada" and age 17',
    'show p.name',
    'show p.age',
  ].join('\n'));
  assert(r.stdout, 'Ada\n17');
});

test('kind records serialize with jsonEncode', () => {
  const r = run([
    'define a kind called "Point" with',
    '  x is 0',
    '  y is 0',
    'done',
    'remember p as create a Point with x 3 and y 4',
    'show jsonEncode(p)',
  ].join('\n'));
  assert(r.stdout, '{"x":3,"y":4}');
});

console.log('\nConcurrency combinators');

test('all of [a(), b()] awaits every promise', () => {
  const r = run([
    'make add(x)',
    '  wait for sleep(5)',
    '  give x + 100',
    'done',
    'remember both as all of [add(1), add(2)]',
    'show both[0]',
    'show both[1]',
  ].join('\n'));
  assert(r.stdout, '101\n102');
});

test('any of [a(), b()] resolves to the first to settle', () => {
  const r = run([
    'make slow(x)',
    '  wait for sleep(200)',
    '  give x',
    'done',
    'make fast(x)',
    '  give x',
    'done',
    'remember winner as any of [slow(1), fast(2)]',
    'show winner',
  ].join('\n'));
  assert(r.stdout, '2');
});

test('settled of [...] yields status records', () => {
  const r = run([
    'make get(x)',
    '  give x',
    'done',
    'remember s as settled of [get(1), get(2)]',
    'show s[0].status',
    'show s[1].value',
  ].join('\n'));
  assert(r.stdout, 'fulfilled\n2');
});

test('all of at the top level makes the program async', () => {
  const r = run('make id(x)\n  give x\ndone\nremember v as all of [id(7)]\nshow v[0]');
  assert(r.stdout, '7');
});

console.log('\nGenerators');

test('a make containing yield compiles to function*', () => {
  const js = compile([
    'make countUp(n)',
    '  remember i as 0',
    '  while i is less than n',
    '    i becomes i + 1',
    '    yield i',
    '  done',
    'done',
  ].join('\n'));
  assertIncludes(js, 'function* countUp');
});

test('yield drives a lazy sequence', () => {
  const r = run([
    'make countUp(n)',
    '  remember i as 0',
    '  while i is less than n',
    '    i becomes i + 1',
    '    yield i',
    '  done',
    'done',
    'show spread of countUp(3)',
  ].join('\n'));
  assert(r.stdout, '[ 1, 2, 3 ]');
});

test('yield outside a function is a compile error', () => {
  try {
    compile('yield 5');
    throw new Error('expected an error');
  } catch (e) {
    assertIncludes(e.message, 'yield');
  }
});

test('spread of an array is a fresh array', () => {
  const r = run('remember a as spread of [1, 2]\nshow a[1]');
  assert(r.stdout, '2');
});

console.log('\nBinary data & serialization');

test('base64 round-trips text', () => {
  const r = run('show base64Decode(base64Encode("hi"))');
  assert(r.stdout, 'hi');
});

test('textToBytes / bytesToText round-trip', () => {
  const r = run('show bytesToText(textToBytes("plain"))');
  assert(r.stdout, 'plain');
});

test('sha256 matches a known digest', () => {
  const r = run('show sha256("abc")');
  assert(r.stdout, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('yamlDecode parses a mapping', () => {
  const r = run('remember c as yamlDecode("name: Ada\\nage: 17\\n")\nshow c.name\nshow c.age');
  assert(r.stdout, 'Ada\n17');
});

test('yamlEncode emits key: value lines', () => {
  const r = run('show yamlEncode({x: 1, y: "two"})');
  assertIncludes(r.stdout, 'x: 1');
  assertIncludes(r.stdout, 'y: "two"');
});

console.log('\nReflection');

test('typeOf classifies values', () => {
  const r = run([
    'show typeOf("s")',
    'show typeOf(3)',
    'show typeOf(true)',
    'show typeOf([1])',
    'show typeOf({})',
    'show typeOf(null)',
    'make f(x)',
    '  give x',
    'done',
    'show typeOf(f)',
  ].join('\n'));
  assert(r.stdout, 'text\nnumber\nboolean\narray\nrecord\nnull\nfunction');
});

test('fieldsOf lists record keys', () => {
  const r = run('show fieldsOf({a: 1, b: 2})');
  assertIncludes(r.stdout, 'a');
  assertIncludes(r.stdout, 'b');
});

test('valueOf returns the value with a fallback', () => {
  const r = run('remember r as {a: 5}\nshow valueOf(r, "a")\nshow valueOf(r, "missing", "fb")');
  assert(r.stdout, '5\nfb');
});

test('sizeOf counts strings, arrays and sets', () => {
  const r = run('show sizeOf("hello")\nshow sizeOf([1, 2, 3])\nshow sizeOf("")');
  assert(r.stdout, '5\n3\n0');
});

console.log('\nCollections (Map / Set)');

test('Map helpers store and read values', () => {
  const r = run([
    'remember m as keyMap()',
    'mapSet(m, "k", 42)',
    'show mapGet(m, "k")',
    'show mapHas(m, "k")',
  ].join('\n'));
  assert(r.stdout, '42\ntrue');
});

test('Set helpers de-duplicate', () => {
  const r = run([
    'remember st as newSet()',
    'addToSet(st, "a")',
    'addToSet(st, "a")',
    'show setHas(st, "a")',
    'show sizeOf(st)',
  ].join('\n'));
  assert(r.stdout, 'true\n1');
});

console.log('\nFilesystem metadata, walk & path');

test('fileType distinguishes files and directories', () => {
  const r = run([
    'show fileType("package.json")',
    'show fileType("compiler")',
  ].join('\n'));
  assert(r.stdout, 'file\ndirectory');
});

test('fileSize is a positive number for a real file', () => {
  const r = run('show fileSize("package.json")');
  const lines = r.stdout.trim().split('\n');
  if (lines.length !== 1 || !/^\d+$/.test(lines[0]) || Number(lines[0]) <= 0) {
    throw new Error(`Expected a positive byte count, got: ${r.stdout}`);
  }
});

test('path helpers decompose a path', () => {
  const r = run([
    'show extensionOf("src/app.pln")',
    'show baseName("/tmp/x/hello.txt")',
    'show folderOf("/tmp/x/hello.txt")',
    'show joinPath("/a", "b")',
  ].join('\n'));
  const normalized = r.stdout.replace(/\\/g, '/');
  assert(normalized, '.pln\nhello.txt\n/tmp/x\n/a/b');
});

test('walkFolder returns file paths', () => {
  const r = run('show sizeOf(walkFolder("compiler"))');
  const lines = r.stdout.trim().split('\n');
  if (lines.length !== 1 || !/^\d+$/.test(lines[0]) || Number(lines[0]) <= 3) {
    throw new Error(`Expected several compiler files, got: ${r.stdout}`);
  }
});

console.log('\nStreams');

test('writeLine appends a line terminated by newline', () => {
  const file = path.join(tmpDir, 'out.txt');
  const r = run(`writeLine(${JSON.stringify(file)}, "a")\nwriteLine(${JSON.stringify(file)}, "b")\nshow read(${JSON.stringify(file)})`);
  assert(r.stdout, 'a\nb');
});

console.log('\nConfiguration');

test('load env file applies KEY=VALUE pairs', () => {
  const file = path.join(tmpDir, '.test-env');
  fs.writeFileSync(file, '# a comment\nSECRET=shh\nPORT=8080\n');
  const r = run(`load env file ${JSON.stringify(file)}\nshow env("SECRET")\nshow env("PORT")`);
  assert(r.stdout, 'shh\n8080');
});

test('yaml and env cover config cases', () => {
  const r = run('show jsonDecode(jsonEncode({ok: true})).ok');
  assert(r.stdout, 'true');
});

console.log('\nCLI & process');

test('args() exposes command-line arguments', () => {
  const source = 'show args()';
  const file = path.join(tmpDir, 'cli.js');
  const ctx = createGenerationContext();
  fs.writeFileSync(file, generate(parse(tokenize(source)), ctx));
  const res = spawnSync(process.execPath, [file, 'x', 'y'], { encoding: 'utf8' });
  assert(res.stdout, "[ 'x', 'y' ]");
});

test('runCommand captures output and exit code', () => {
  const script = path.join(tmpDir, 'hello.js').replace(/\\/g, '/');
  fs.writeFileSync(script, 'console.log("hello");');
  const nodeBin = process.execPath.replace(/\\/g, '/');
  const cmd = `runCommand(${JSON.stringify(nodeBin)}, [${JSON.stringify(script)}])`;
  const r = run(`remember out as ${cmd}\nshow out.ok\nshow out.code\nshow out.stdout.trim()`);
  assert(r.stdout, 'true\n0\nhello');
});

console.log('\nNative test DSL');

test('a passing test suite exits 0 and prints PASS', () => {
  const r = run([
    'make add(a, b)',
    '  give a + b',
    'done',
    'test "addition"',
    '  check add(2, 3) equals 5',
    '  check "hello" contains "ell"',
    'done',
  ].join('\n'));
  assertIncludes(r.stdout, 'PASS');
  assertIncludes(r.stdout, '1 passed, 0 failed');
  assert(r.code, 0);
});

test('a failing assertion prints FAIL and sets exit code 1', () => {
  const r = run('test "wrong"\n  check 2 + 2 equals 5\ndone');
  assertIncludes(r.stdout + r.stderr, 'FAIL');
  assert(r.code, 1);
});

test('check with raises passes when the expression throws', () => {
  const r = run([
    'test "boom"',
    '  check jsonDecode("not valid json") raises "JSON"',
    'done',
  ].join('\n'));
  assertIncludes(r.stdout, 'PASS');
  assertIncludes(r.stdout, '1 passed, 0 failed');
});

console.log('\nDocs & control-flow regression');

test('nested if inside otherwise closes on its own done', () => {
  const r = run([
    'remember a as 2',
    'if a is 1',
    '  show "one"',
    'otherwise',
    '  if a is 2',
    '    show "two"',
    '  done',
    'done',
  ].join('\n'));
  assert(r.stdout, 'two');
  assert(r.code, 0);
});

test('nested if inside otherwise still runs statements after the nested if', () => {
  const r = run([
    'remember a as 2',
    'if a is 1',
    '  show "one"',
    'otherwise',
    '  if a is 2',
    '    show "two"',
    '  done',
    '  show "tail"',
    'done',
  ].join('\n'));
  assert(r.stdout, 'two\ntail');
  assert(r.code, 0);
});

test('match supports numeric and boolean literal cases', () => {
  const r = run([
    'remember n as 2',
    'match n against',
    '  1 -> show "one"',
    '  2 -> show "two"',
    '  otherwise -> show "many"',
    'done',
    'remember flag as true',
    'match flag against',
    '  true -> show "yes"',
    '  false -> show "no"',
    'done',
  ].join('\n'));
  assertIncludes(r.stdout, 'two');
  assertIncludes(r.stdout, 'yes');
  assert(r.code, 0);
});

test('regexReplace replaces every regex match', () => {
  const r = run('show regexReplace("a1b2c3", "\\\\d", "#")');
  assert(r.stdout, 'a#b#c#');
  assert(r.code, 0);
});

test('coalesce picks the first non-null non-undefined value', () => {
  const r = run([
    'remember cfg as {theme: null}',
    'remember opt as undefined',
    'show coalesce(theme of cfg, opt, "light")',
  ].join('\n'));
  assert(r.stdout, 'light');
  assert(r.code, 0);
});

test('parseDate / formatDate round-trip a date', () => {
  const r = run([
    'remember ms as parseDate("2020-01-02")',
    'show formatDate(ms, "DD/MM/YYYY")',
  ].join('\n'));
  assert(r.stdout, '02/01/2020');
  assert(r.code, 0);
});

console.log('\n`otherwise if` chain');

test('otherwise if chains without nesting a second if', () => {
  const js = compile([
    'remember score as 85',
    'if score is above 90',
    '    show "A"',
    'otherwise if score is above 80',
    '    show "B"',
    'otherwise if score is above 70',
    '    show "C"',
    'otherwise',
    '    show "F"',
    'done',
  ].join('\n'));
  assertIncludes(js, 'if (score > 90)');
  assertIncludes(js, 'score > 80');
  assertIncludes(js, 'score > 70');
});

test('otherwise if runs the matching branch at runtime', () => {
  const r = run([
    'remember score as 85',
    'if score is above 90',
    '    show "A"',
    'otherwise if score is above 80',
    '    show "B"',
    'otherwise if score is above 70',
    '    show "C"',
    'otherwise',
    '    show "F"',
    'done',
  ].join('\n'));
  assert(r.stdout, 'B');
  assert(r.code, 0);
});

test('otherwise if passes control to the trailing otherwise', () => {
  const r = run([
    'remember score as 40',
    'if score is above 90',
    '    show "A"',
    'otherwise if score is above 80',
    '    show "B"',
    'otherwise if score is above 70',
    '    show "C"',
    'otherwise',
    '    show "F"',
    'done',
  ].join('\n'));
  assert(r.stdout, 'F');
  assert(r.code, 0);
});

console.log('\nOCR buffers');

test('ocr accepts an in-memory buffer expression', () => {
  const js = compile([
    'remember buf as readBytes("img.png")',
    'ocr buf as text',
    'show text',
  ].join('\n'));
  assertIncludes(js, 'let buf = fs.readFileSync("img.png");');
  assertIncludes(js, 'let text = await __ocr(buf);');
});

console.log('\nExports');

test('export marks a symbol for module.exports', () => {
  const js = compile('export configVersion\nremember configVersion as 3');
  assertIncludes(js, 'module.exports.configVersion = configVersion;');
});

console.log('\nv2.2.0 core collection/string primitives');

test('range ascends from start to end by 1', () => {
  const r = run('show range(1, 6)');
  assert(r.stdout, '[ 1, 2, 3, 4, 5 ]');
  assert(r.code, 0);
});

test('range with one arg counts from zero', () => {
  const r = run('show range(4)');
  assert(r.stdout, '[ 0, 1, 2, 3 ]');
  assert(r.code, 0);
});

test('range descends when start exceeds end', () => {
  const r = run('show range(3, 0)');
  assert(r.stdout, '[ 3, 2, 1 ]');
  assert(r.code, 0);
});

test('clamp bounds a value', () => {
  assert(run('show clamp(15, 0, 10)').stdout, '10');
  assert(run('show clamp(-3, 0, 10)').stdout, '0');
  assert(run('show clamp(5, 0, 10)').stdout, '5');
});

test('flatten collapses nested arrays', () => {
  const r = run('remember a as [1, [2, 3], [4, [5]]]\nshow flatten(a)');
  assert(r.stdout, '[ 1, 2, 3, 4, 5 ]');
  assert(r.code, 0);
});

test('first and last index a list', () => {
  assert(run('show first([10, 20, 30])').stdout, '10');
  assert(run('show last([10, 20, 30])').stdout, '30');
});

test('includes tests list membership', () => {
  assert(run('show includes([1, 2, 3], 2)').stdout, 'true');
  assert(run('show includes([1, 2, 3], 9)').stdout, 'false');
});

test('pick keeps only the named fields', () => {
  const r = run('remember u as {name: "Ada", age: 36, secret: "x"}\nshow pick(u, "name", "age")');
  assertIncludes(r.stdout, "name: 'Ada'");
  assertIncludes(r.stdout, 'age: 36');
  assert(r.code, 0);
});

test('omit drops the named fields', () => {
  const r = run('remember u as {name: "Ada", secret: "x"}\nshow omit(u, "secret")');
  assertIncludes(r.stdout, "name: 'Ada'");
  assert(r.code, 0);
});

test('groupBy buckets a list by a field or key function', () => {
  const r = run([
    'remember people as [{team: "a", n: 1}, {team: "b", n: 2}, {team: "a", n: 3}]',
    'show groupBy(people, "team")',
  ].join('\n'));
  assertIncludes(r.stdout, 'a:');
  assertIncludes(r.stdout, 'b:');
  assertIncludes(r.stdout, "team: 'a'");
  assert(r.code, 0);
});

test('startsWith / endsWith test string prefixes and suffixes', () => {
  assert(run('show startsWith("hello", "he")').stdout, 'true');
  assert(run('show endsWith("hello", "lo")').stdout, 'true');
  assert(run('show startsWith("hello", "lo")').stdout, 'false');
});

test('truncate shortens text and appends a suffix', () => {
  assert(run('show truncate("abcdefghij", 4)').stdout, 'abcd…');
  assert(run('show truncate("abc", 4)').stdout, 'abc');
});

test('padStart / padEnd pad text', () => {
  assert(run('show padStart("7", 3, "0")').stdout, '007');
  assert(run('show padEnd("7", 3, "0")').stdout, '700');
});

console.log('\nv2.2.0 web/full-stack compile checks');

test('body("field") reads one JSON request-body field', () => {
  const js = compile([
    'web app',
    'route post "/items"',
    '    remember n as body("name")',
    '    reply n',
    'done',
  ].join('\n'));
  assertIncludes(js, 'req.body["name"]');
});

test('body() reads the whole JSON request body', () => {
  const js = compile([
    'web app',
    'route post "/items"',
    '    remember whole as body()',
    '    reply whole',
    'done',
  ].join('\n'));
  assertIncludes(js, 'req.body');
});

test('body rejects use outside a route handler', () => {
  let threw = false;
  try { compile('remember x as body("a")'); }
  catch (e) { threw = /route handler/.test(e.message); }
  assert(threw, true);
});

test('redirect to sends an HTTP redirect from a route', () => {
  const js = compile([
    'web app',
    'route get "/old"',
    '    redirect to "/new"',
    'done',
  ].join('\n'));
  assertIncludes(js, 'res.redirect("/new");');
});

test('redirect to rejects use outside a route handler', () => {
  let threw = false;
  try { compile('redirect to "/x"'); }
  catch (e) { threw = /route handler/.test(e.message); }
  assert(threw, true);
});

console.log('\nv2.2.0 AI/ML helpers');

test('similarity is 1 for identical vectors', () => {
  assert(run('show similarity([1, 2, 3], [1, 2, 3])').stdout, '1');
  assert(run('show similarity([1, 2, 3], [1, 2, 3])').code, 0);
});

test('similarity is 0 for orthogonal vectors', () => {
  assert(run('show similarity([1, 0], [0, 1])').stdout, '0');
});

test('similarity is -1 for opposite vectors', () => {
  assert(run('show similarity([1, 2, 3], [-1, -2, -3])').stdout, '-1');
});

test('chat compiles to an awaited AI completion call', () => {
  const js = compile('remember r as chat("gpt-4o-mini", "hello")');
  assertIncludes(js, 'await __aiChat("gpt-4o-mini", "hello", undefined)');
});

test('chat supports a Groq provider preset and request options', () => {
  const js = compile([
    'remember r as chat("llama-3.3-70b-versatile", "hello", {',
    '  provider: "groq",',
    '  key: env("GROQ_API_KEY"),',
    '  temperature: 0.2,',
    '  maxTokens: 100',
    '})',
  ].join('\n'));
  assertIncludes(js, 'process.env.GROQ_API_KEY');
  assertIncludes(js, 'https://api.groq.com/openai/v1');
  assertIncludes(js, 'body.max_tokens = options.maxTokens');
});

test('chatWith makes the provider explicit', () => {
  const js = compile('remember r as chatWith("groq", "llama-3.3-70b-versatile", "hello")');
  assertIncludes(js, 'Object.assign({}, {}, { provider: "groq" })');
});

test('AI and Telegram helpers reject missing required arguments at check time', () => {
  let chatError = '';
  let telegramError = '';
  try { compile('chat("model")'); } catch (e) { chatError = e.message; }
  try { compile('telegramCall()'); } catch (e) { telegramError = e.message; }
  assertIncludes(chatError, '"chat" needs at least 2 arguments');
  assertIncludes(telegramError, '"telegramCall" needs at least 1 argument');
});

test('embedText compiles to an awaited AI embeddings call', () => {
  const js = compile('remember e as embedText("text-embedding-3-small", "cat")');
  assertIncludes(js, 'await __aiEmbed("text-embedding-3-small", "cat", undefined)');
});

test('AI calls mark the enclosing program async', () => {
  const ctx = createGenerationContext();
  generate(parse(tokenize('remember r as chat("m", "hi")')), ctx);
  assert(ctx.needsAsync, true);
});

console.log('\nv2.2.0 data/storage: pagination + in-memory cache fallback');

test('paginate returns the first page and total counts', () => {
  const r = run([
    'remember items as range(1, 21)',
    'remember page1 as paginate(items, 1, 10)',
    'show items of page1',
    'show count of page1',
    'show pages of page1',
    'show hasNext of page1',
  ].join('\n'));
  assertIncludes(r.stdout, '10');
  assertIncludes(r.stdout, '20');
  assertIncludes(r.stdout, '2');
  assertIncludes(r.stdout, 'true');
  assert(r.code, 0);
});

test('paginate computes the last page and previous flag', () => {
  const r = run([
    'remember items as range(1, 21)',
    'remember page3 as paginate(items, 3, 10)',
    'show items of page3',
    'show hasPrev of page3',
    'show hasNext of page3',
  ].join('\n'));
  assertIncludes(r.stdout, '20');
  assertIncludes(r.stdout, 'true');
  assertIncludes(r.stdout, 'false');
  assert(r.code, 0);
});

test('paginate clamps an out-of-range page', () => {
  const r = run('remember p as paginate(range(1, 5), 99, 10)\nshow page of p');
  assertIncludes(r.stdout, '1');
  assert(r.code, 0);
});

test('cache falls back to in-memory storage without a cache statement', () => {
  const r = run([
    'cacheSet("greeting", "hello world")',
    'show cacheGet("greeting")',
    'cacheDelete("greeting")',
    'show cacheGet("greeting")',
  ].join('\n'));
  assertIncludes(r.stdout, 'hello world');
  assertIncludes(r.stdout, 'null');
  assert(r.code, 0);
});

test('in-memory cache respects TTL expiry', () => {
  const r = run([
    'cacheSet("temp", "v", 1)',
    'show cacheGet("temp")',
  ].join('\n'));
  assertIncludes(r.stdout, 'v');
  assert(r.code, 0);
});

console.log('\nNatural string verb runtime tests');

test('runtime: lowercase statement', () => {
  const r = run('remember x as "HELLO"\nlowercase x\nshow x');
  assert(r.stdout, 'hello');
  assert(r.code, 0);
});

test('runtime: uppercase statement', () => {
  const r = run('remember x as "hello"\nuppercase x\nshow x');
  assert(r.stdout, 'HELLO');
  assert(r.code, 0);
});

test('runtime: trim statement', () => {
  const r = run('remember x as "  hi  "\ntrim x\nshow x');
  assert(r.stdout, 'hi');
  assert(r.code, 0);
});

test('runtime: split and join statements', () => {
  const r = run('remember x as "a,b,c"\nsplit x by ","\njoin x by "-"\nshow x');
  assert(r.stdout, 'a-b-c');
  assert(r.code, 0);
});

test('runtime: capitalize words statement', () => {
  const r = run('remember title as "hello world"\nsplit title by " "\nuppercase first letter of each word in title\njoin title by " "\nshow title');
  assert(r.stdout, 'Hello World');
  assert(r.code, 0);
});

console.log('\nSVG image and visualization tests');

test('visualization: charts save SVG images and produce data URIs', () => {
  const output = path.join(tmpDir, 'chart.svg');
  const r = run([
    'remember chart as barChart("Sales", ["Jan", "Feb"], [10, 20])',
    'remember trend as lineChart("Trend", ["Jan", "Feb"], [10, 20])',
    'remember custom as svgImage(100, 80, "<circle cx=\\"40\\" cy=\\"40\\" r=\\"20\\"/>")',
    `saveImage("${output.replace(/\\/g, '\\\\')}", chart)`,
    'remember uri as imageDataUri(chart)',
    'show trend',
    'show custom',
    'show uri',
  ].join('\n'));
  assert(r.code, 0);
  assertIncludes(r.stdout, '<polyline');
  assertIncludes(r.stdout, '<circle');
  assertIncludes(r.stdout, 'data:image/svg+xml;base64,');
  assertIncludes(fs.readFileSync(output, 'utf8'), '<svg');
  assertIncludes(fs.readFileSync(output, 'utf8'), 'Sales');
});

console.log('\n── audit suite summary ────────────────────────────────────────\n');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
