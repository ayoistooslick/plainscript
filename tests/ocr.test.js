// Tests for PlainScript v2.0.1  -  OCR statements (tesseract.js backing).
//
// Run with: node tests/ocr.test.js

const vm = require('vm');
const { tokenize, TOKEN } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate, createGenerationContext, wrapAsync } = require('../compiler/generator');
const { detectDependencies } = require('../compiler/dependency-detector');

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

// Async tests are queued and joined before the summary (see bottom).
const pendingTests = [];
let lastTest = Promise.resolve();

function testAsync(name, fn) {
  const run = () => fn().then(
    () => { console.log(`  PASS  ${name}`); passed++; },
    (e) => { console.log(`  FAIL  ${name}`); console.log(`        ${e.message}`); failed++; },
  );
  lastTest = lastTest.then(run, run);
  pendingTests.push(lastTest);
}

function assert(actual, expected) {
  const a = actual.trim();
  const e = expected.trim();
  if (a !== e) {
    throw new Error(`Expected:\n        ${e}\n        Got:\n        ${a}`);
  }
}

// Compile PlainScript source the way `plainscript build` does (async runtime wrapper).
function compileProgram(source) {
  const context = createGenerationContext();
  let js = generate(parse(tokenize(source)), context);
  if (context.needsAsync) js = wrapAsync(js);
  return js;
}

// ── Lexer ──────────────────────────────────────────────────────────────────

test('lexer: ocr is a keyword token', () => {
  assert(
    JSON.stringify(tokenize('ocr "a.png" as text').map(t => t.type)),
    JSON.stringify(['OCR_KW', 'STRING', 'AS', 'IDENTIFIER', 'EOF'])
  );
});

test('lexer: ocr using form keeps the language string', () => {
  const types = tokenize('ocr "a.png" as text using "deu"').map(t => t.type);
  if (!types.includes('OCR_KW')) throw new Error('missing OCR_KW token');
  if (!types.includes('USING') && !tokenize('ocr "a.png" as text using "deu"').some(t => t.value === 'using')) {
    throw new Error('missing "using" in token stream');
  }
});

// ── Parser ─────────────────────────────────────────────────────────────────

test('parser: basic ocr statement', () => {
  const node = parse(tokenize('ocr "scan.png" as text')).body[0];
  delete node.line;
  delete node.col;
  assert(JSON.stringify(node), JSON.stringify({
    type: 'OcrStatement',
    image: { type: 'StringLiteral', value: 'scan.png' },
    variable: 'text',
    lang: null,
  }));
});

test('parser: ocr with language pack', () => {
  const node = parse(tokenize('ocr "brief.png" as inhalt using "deu"')).body[0];
  if (node.variable !== 'inhalt') throw new Error(`variable: ${node.variable}`);
  if (node.lang !== 'deu') throw new Error(`lang: ${JSON.stringify(node.lang)}`);
});

test('parser: image may be an expression', () => {
  const node = parse(tokenize('remember shot as "a.png"\nocr shot as theText')).body[1];
  if (node.type !== 'OcrStatement') throw new Error(`type: ${node.type}`);
  if (node.image.type !== 'Identifier' || node.image.name !== 'shot') {
    throw new Error(`image: ${JSON.stringify(node.image)}`);
  }
});

test('parser: ocr without as fails with a friendly error', () => {
  let threw = null;
  try { parse(tokenize('ocr "scan.png"')); } catch (e) { threw = e; }
  if (!threw) throw new Error('expected a syntax error');
  if (!/as <name>/.test(threw.message)) throw new Error(`unhelpful error: ${threw.message}`);
});

// ── Generator ──────────────────────────────────────────────────────────────

test('generate: basic ocr emits awaited __ocr call', () => {
  const js = compileProgram('ocr "scan.png" as text\nshow text');
  if (!js.includes('let text = await __ocr("scan.png");')) {
    throw new Error(`missing __ocr call:\n${js}`);
  }
  if (!js.includes("require('tesseract.js')")) throw new Error('tesseract.js require missing');
});

test('generate: language pack is forwarded to __ocr', () => {
  const js = compileProgram('ocr "a.png" as words using "deu+eng"');
  if (!js.includes('let words = await __ocr("a.png", "deu+eng");')) {
    throw new Error(`missing language argument:\n${js}`);
  }
});

test('generate: top-level ocr keeps the async wrapper', () => {
  const js = compileProgram('ocr "a.png" as text');
  if (!/(async\s*\(\)\s*=>|async function)/.test(js)) {
    throw new Error(`expected async wrapper:\n${js}`);
  }
});

test('generate: ocr inside a function makes the function async', () => {
  const js = generate(parse(tokenize('make read()\n  ocr "a.png" as t\n  give t\ndone')));
  if (!js.includes('async function read()')) {
    throw new Error(`function not async:\n${js}`);
  }
  if (!js.includes('let t = await __ocr("a.png");')) {
    throw new Error(`__ocr call missing:\n${js}`);
  }
});

test('generate: ocr inside an if block stays awaited', () => {
  const js = generate(parse(tokenize('if true is true\n  ocr "a.png" as t\ndone')));
  if (!js.includes('let t = await __ocr("a.png");')) {
    throw new Error(`__ocr call missing:\n${js}`);
  }
});

test('generate: ocr inside a route makes the handler async', () => {
  const js = compileProgram('web app\nroute post "/verify"\n  ocr "scan.png" as text\n  reply text\ndone\nstart 0');
  if (!js.includes('app.post("/verify", async (req, res) => {')) {
    throw new Error(`route handler not async:\n${js}`);
  }
  if (!js.includes('let text = await __ocr("scan.png");')) {
    throw new Error(`__ocr call missing:\n${js}`);
  }
});

test('generate: ocr nested in if/otherwise inside a route keeps the handler async', () => {
  const js = compileProgram('web app\nroute post "/v"\n  if count is 0\n    reply "none"\n  otherwise\n    ocr "b.png" as s\n    reply s\n  done\ndone\nstart 0');
  if (!js.includes('app.post("/v", async (req, res) => {')) {
    throw new Error(`route handler not async:\n${js}`);
  }
  if (!js.includes('let s = await __ocr("b.png");')) {
    throw new Error(`__ocr call missing:\n${js}`);
  }
});

test('generate: a route without any await stays synchronous (no churn)', () => {
  const js = compileProgram('web app\nroute get "/h"\n  reply "hi"\ndone\nstart 0');
  if (!js.includes('app.get("/h", (req, res) => {')) {
    throw new Error(`plain route changed shape unexpectedly:\n${js}`);
  }
});

test('generate: ocr inside a function inside another function only marks the inner one async', () => {
  const js = generate(parse(tokenize('make outer()\n  make inner()\n    ocr "a.png" as t\n    give t\n  done\n  give 1\ndone')));
  if (!js.includes('function outer() {')) {
    throw new Error(`outer function should stay synchronous:\n${js}`);
  }
  if (!js.includes('async function inner() {')) {
    throw new Error(`inner function should be async:\n${js}`);
  }
});

// ── Dependency detection ───────────────────────────────────────────────────

test('detect: ocr maps to tesseract.js', () => {
  assert(
    JSON.stringify(detectDependencies('ocr "scan.png" as text')),
    JSON.stringify(['tesseract.js'])
  );
});

test('detect: tesseract.js listed once for multiple ocr statements', () => {
  assert(
    JSON.stringify(detectDependencies('ocr "a.png" as one\nocr "b.png" as two using "deu"')),
    JSON.stringify(['tesseract.js'])
  );
});

// ── Runtime (fake tesseract.js module, real generated prelude) ─────────────

const RUNTIME_SOURCE = [
  'ocr "scan.png" as text',
  'show text',
].join('\n');

function runWithFakeTesseract(js) {
  const logs = [];
  const sandbox = {
    console: { log: (...args) => logs.push(args.join(' ')) },
    process: { env: {} },
    setTimeout,
    clearTimeout,
    // The generated code requires 'tesseract.js'; serve a fake worker.
    require: (name) => {
      if (name === 'tesseract.js') {
        return {
          createWorker: async (lang) => ({
            lang,
            recognize: async (path) => ({ data: { text: `TEXT OF ${path} [${lang}]` } }),
            terminate: async () => {},
          }),
        };
      }
      return require(name);
    },
  };
  vm.runInNewContext(js, sandbox, { filename: 'generated-ocr.js' });
  return logs;
}

test('runtime: extracted text flows into the variable and show', async () => {
  const js = compileProgram(RUNTIME_SOURCE);
  const logs = runWithFakeTesseract(js);
  // The generated async wrapper resolves on a later microtask tick.
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (!logs.includes('TEXT OF scan.png [eng]')) {
    throw new Error(`unexpected output: ${JSON.stringify(logs)}`);
  }
});

test('runtime: language pack reaches the worker', async () => {
  const js = compileProgram('ocr "brief.png" as de using "deu"\nshow de');
  const logs = runWithFakeTesseract(js);
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (!logs.includes('TEXT OF brief.png [deu]')) {
    throw new Error(`unexpected output: ${JSON.stringify(logs)}`);
  }
});

// ── Summary ────────────────────────────────────────────────────────────────

Promise.all(pendingTests).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
