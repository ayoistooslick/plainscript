// Browser/game capability tests for PlainScript v1.0.36.
//
// Drives the compiler through the same tokenize → parse → generate pipeline as
// the CLI, then runs the generated JavaScript through tests/browser-stubs.js
// (a zero-dependency DOM/canvas/WebGL/rAF/timer stub environment). Every env is
// freshly built per makeBrowserEnv() call, all time is pumped (rAF frames and
// captured timers), and assertions are deterministic string comparisons.
//
// Run with: node tests/browser.test.js

const fs = require('fs');
const path = require('path');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate, createGenerationContext, wrapAsync } = require('../compiler/generator');
const { makeBrowserEnv } = require('./browser-stubs');

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
  const a = String(actual).trim();
  const e = String(expected).trim();
  if (a !== e) throw new Error(`Expected:\n        ${e}\n        Got:\n        ${a}`);
}

function assertIncludes(actual, expected) {
  if (!String(actual).includes(expected)) {
    throw new Error(`Expected to include:\n        ${expected}\n        Got:\n        ${String(actual).trim()}`);
  }
}

function compileProgram(source) {
  const context = createGenerationContext();
  let js = generate(parse(tokenize(source)), context);
  if (context.needsAsync) js = wrapAsync(js);
  return js;
}

// The WebGL stub returns contexts per type ("webgl2" wins in __glContext), so
// seed the enum constants the helpers read straight off the real context.
const GL_ENUMS = {
  VERTEX_SHADER: 0x8B31,
  FRAGMENT_SHADER: 0x8B30,
  COMPILE_STATUS: 0x8B81,
  LINK_STATUS: 0x8B82,
  ARRAY_BUFFER: 0x8892,
  STATIC_DRAW: 0x88E4,
  COLOR_BUFFER_BIT: 0x4000,
  TRIANGLES: 0x0004,
};
function presetGLEnums(env, canvas) {
  for (const kind of ['webgl2', 'webgl']) {
    const gl = canvas.getContext(kind);
    for (const key of Object.keys(GL_ENUMS)) gl[key] = GL_ENUMS[key];
  }
}

// ── 1. new expressions ─────────────────────────────────────────────────────────

console.log('\nv1.0.36 browser: new expressions');

test('new expressions compile to single constructor calls (no double parens)', () => {
  const js = compileProgram([
    'remember s as new THREE.Scene()',
    'remember b as new Box(1, 2)',
    'remember cam as new window.Thing(1, 2)',
  ].join('\n'));
  assertIncludes(js, 'let s = new THREE.Scene();');
  assertIncludes(js, 'let b = new Box(1, 2);');
  assertIncludes(js, 'let cam = new window.Thing(1, 2);');
  if (js.includes('()()')) throw new Error('double-call parens produced: ' + js);
});

test('new expressions work as arguments, targets, and bare form', () => {
  const js = compileProgram([
    'item becomes new Vehicle("car")',
    'F(new Airplane(3))',
    'remember node as [new Node(1), new Node(2)]',
    'remember bare as new Foo',
  ].join('\n'));
  assertIncludes(js, 'item = new Vehicle("car");');
  assertIncludes(js, 'F(new Airplane(3));');
  assertIncludes(js, '[new Node(1), new Node(2)]');
  assertIncludes(js, 'let bare = new Foo();');
});

// ── 2. Hex literals ────────────────────────────────────────────────────────────

console.log('\nv1.0.36 browser: hex literals');

test('hex literals compile to decimal numbers', () => {
  const js = compileProgram('show 0xFF\nshow 0x40c463\nshow 0x0');
  assertIncludes(js, 'console.log(255);');
  assertIncludes(js, 'console.log(4244579);');
  assertIncludes(js, 'console.log(0);');
});

testAsync('hex literals run through the stub env and print decimal', async () => {
  const env = makeBrowserEnv();
  await env.run(compileProgram('show 0xFF\nshow 0x40c463\nshow 0x0'));
  assert(JSON.stringify(env.logs), JSON.stringify(['255', '4244579', '0']));
});

// ── 3. Event statements ────────────────────────────────────────────────────────

console.log('\nv1.0.36 browser: when ... happens');

test('when <target> "<event>" happens compiles to addEventListener', () => {
  const js = compileProgram([
    'when button "click" happens as ev',
    '    show "hit"',
    'done',
    'when document "keydown" happens',
    '    show "key"',
    'done',
  ].join('\n'));
  assertIncludes(js, 'button.addEventListener("click", function (ev) {');
  assertIncludes(js, 'document.addEventListener("keydown", function (event) {');
});

testAsync('when happens listeners fire through the environment', async () => {
  const env = makeBrowserEnv();
  const canvas = env.document.createElement('canvas');
  env.document.elements.set('game', canvas);
  await env.run(compileProgram([
    'remember canvas as document.getElementById("game")',
    'when canvas "click" happens as ev',
    '    show "clicked"',
    'done',
    'when document "keydown" happens as ke',
    '    show ke.key',
    'done',
  ].join('\n')));
  canvas.click();
  env.document.fire('keydown', { key: 'ArrowLeft' });
  assert(JSON.stringify(env.logs), JSON.stringify(['clicked', 'ArrowLeft']));
});

// ── 4. every frame loop ────────────────────────────────────────────────────────

console.log('\nv1.0.36 browser: every frame');

test('every frame compiles to a self-scheduling requestAnimationFrame loop', () => {
  const js = compileProgram([
    'every frame',
    '    show "frame"',
    'done',
  ].join('\n'));
  assertIncludes(js, 'requestAnimationFrame(function __frame(__frameTime) {');
  assertIncludes(js, 'requestAnimationFrame(__frame);');
});

testAsync('every frame runs once per pumped animation frame', async () => {
  const env = makeBrowserEnv();
  await env.run(compileProgram([
    'remember count as 0',
    'every frame',
    '    count becomes count + 1',
    '    show count',
    'done',
  ].join('\n')));
  env.pump(3);
  assert(JSON.stringify(env.logs), JSON.stringify(['1', '2', '3']));
});

// ── 5. after / every milliseconds ──────────────────────────────────────────────

console.log('\nv1.0.36 browser: after / every <time>');

test('after <n> <unit> compiles to a scaled setTimeout', () => {
  const js = compileProgram([
    'after 0.5 seconds',
    '    show "later"',
    'done',
    'after 2 minutes',
    '    show "soon"',
    'done',
  ].join('\n'));
  assertIncludes(js, 'setTimeout(() => {');
  assertIncludes(js, '}, 0.5 * 1000);');
  assertIncludes(js, '}, 2 * 60000);');
});

test('every <n> milliseconds compiles to a setInterval', () => {
  const js = compileProgram([
    'every 16 milliseconds',
    '    show "tick"',
    'done',
  ].join('\n'));
  assertIncludes(js, 'setInterval(');
  assertIncludes(js, '}, 16);');
});

testAsync('after/every timers capture the correct delay on the stub', async () => {
  const env = makeBrowserEnv();
  await env.run(compileProgram([
    'after 0.5 seconds',
    '    show "later"',
    'done',
    'every 16 milliseconds',
    '    show "tick"',
    'done',
  ].join('\n')));
  const timers = env.recorder.timers;
  assert(timers.length, '2');
  assert(timers[0].delay, '500');
  assert(timers[0].interval, 'false');
  assert(timers[1].delay, '16');
  assert(timers[1].interval, 'true');
});

// ── 6. Browser builtins ────────────────────────────────────────────────────────

console.log('\nv1.0.36 browser: builtins');

test('browser builtins compile to their guarded helpers', () => {
  const js = compileProgram([
    'remember a as select("#x")',
    'remember b as selectAll(".y")',
    'remember p as localPoint(e, canvas)',
    'remember pads as gamepads()',
    'remember img as loadImage(url)',
    'remember au as loadAudio(url)',
    'remember j as fetchJson(url)',
    'remember d as readDataUrl(file)',
    'remember ac as audioContext()',
    'playTone(440, 0.1)',
    'webSocketSend(ws, value)',
    'remember gl as webglContext(canvas)',
    'remember vs as glShader(gl, "vertex", src)',
    'remember pr as glProgram(gl, a, b)',
    'remember bf as glBuffer(gl, data)',
  ].join('\n'));
  const checks = [
    'document.querySelector',
    '[...document.querySelectorAll(sel)]',
    '__localPoint(',
    '__gamepads',
    '(await __loadImage(',
    '(await __loadAudio(',
    '(await __fetchJson(',
    '(await __readDataUrl(',
    '__audioContext',
    '__audioTone(',
    '.send(',
    '__glContext(',
    '__glShader(',
    '__glProgram(',
    '__glBuffer(',
  ];
  for (const c of checks) assertIncludes(js, c);
});

testAsync('select() without a browser throws a teaching error', async () => {
  const js = compileProgram('remember x as select("#x")\nshow x');
  let thrown = null;
  try {
    const fn = new Function('require', 'console', 'process',
      `${js}\n;return undefined;`);
    fn(() => ({}), { log() {} }, {});
  } catch (e) {
    thrown = e;
  }
  if (thrown === null) throw new Error('expected select(...) to throw without a browser');
  assertIncludes(thrown.message, 'browser');
});

// ── 7. Functional via stubs ────────────────────────────────────────────────────

console.log('\nv1.0.36 browser: functional via stubs');

testAsync('canvas 2d program records fillRect with the right arguments', async () => {
  const env = makeBrowserEnv();
  env.document.selectorRegistry['#game'] = env.document.createElement('canvas');
  await env.run(compileProgram([
    'remember cnv as select("#game")',
    'remember ctx as cnv.getContext("2d")',
    'ctx.fillStyle becomes "#40c463"',
    'ctx.fillRect(10, 20, 100, 50)',
  ].join('\n')));
  const fillStyle = env.recorder.ctx2d.find((r) => r.fn === 'fillStyle');
  if (!fillStyle || fillStyle.value !== '#40c463') throw new Error('fillStyle not recorded: ' + JSON.stringify(env.recorder.ctx2d));
  const fillRect = env.recorder.ctx2d.find((r) => r.fn === 'fillRect');
  assert(JSON.stringify(fillRect.args), JSON.stringify([10, 20, 100, 50]));
});

testAsync('webgl program drives shaders, buffers, and rendering on the stub', async () => {
  const env = makeBrowserEnv();
  const canvas = env.document.createElement('canvas');
  env.document.selectorRegistry['#gl'] = canvas;
  presetGLEnums(env, canvas);
  await env.run(compileProgram([
    'remember cv as select("#gl")',
    'remember gl as webglContext(cv)',
    'gl.viewport(0, 0, 640, 480)',
    'gl.clearColor(0.1, 0.12, 0.15, 1)',
    'remember vs as glShader(gl, "vertex", "attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }")',
    'remember fs as glShader(gl, "fragment", "precision mediump float; void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }")',
    'remember prog as glProgram(gl, vs, fs)',
    'remember buf as glBuffer(gl, new Float32Array([0, 0, 1, 0, 0, 1]))',
    'gl.clear(gl.COLOR_BUFFER_BIT)',
    'gl.drawArrays(gl.TRIANGLES, 0, 3)',
  ].join('\n')));
  const fns = env.recorder.gl.map((r) => r.fn);
  for (const expected of ['clearColor', 'clear', 'drawArrays', 'createShader', 'compileShader', 'getShaderParameter', 'createProgram', 'linkProgram', 'getProgramParameter', 'createBuffer', 'bindBuffer', 'bufferData']) {
    if (!fns.includes(expected)) throw new Error('expected gl call missing: ' + expected + ' in ' + JSON.stringify(fns));
  }
  const clearColor = env.recorder.gl.find((r) => r.fn === 'clearColor');
  assert(JSON.stringify(clearColor.args), JSON.stringify([0.1, 0.12, 0.15, 1]));
  const drawArrays = env.recorder.gl.find((r) => r.fn === 'drawArrays');
  assert(JSON.stringify(drawArrays.args), JSON.stringify([4, 0, 3]));
  const bufferData = env.recorder.gl.find((r) => r.fn === 'bufferData');
  assert(bufferData.args.length, '3');
});

testAsync('loadImage fires the stub Image onload and exposes its width', async () => {
  const env = makeBrowserEnv();
  await env.run(compileProgram([
    'remember img as loadImage("a.png")',
    'img.width becomes img.naturalWidth',
    'img.height becomes img.naturalHeight',
    'show width of img',
    'show height of img',
  ].join('\n')));
  assert(JSON.stringify(env.logs), JSON.stringify(['300', '150']));
  const load = env.recorder.imageLoads[0];
  if (!load || load.src !== 'a.png' || load.ok !== true) throw new Error('image load not recorded: ' + JSON.stringify(env.recorder.imageLoads));
});

testAsync('fetchJson at top level async-wraps the whole program', async () => {
  const js = compileProgram([
    'remember manifest as fetchJson("assets/manifest.json")',
    'show status of manifest',
    'show parseError of manifest',
  ].join('\n'));
  assertIncludes(js, '(async () => {');
  assertIncludes(js, '(await __fetchJson("assets/manifest.json"))');
  const env = makeBrowserEnv();
  env.extra.fetch = async () => ({ ok: true, status: 200, text: async () => '{"hi":"there"}' });
  await env.run(js);
  assert(JSON.stringify(env.logs), JSON.stringify(['200', 'null']));
});

// ── 8. Facts about the proven example ──────────────────────────────────────────

console.log('\nv1.0.36 browser: examples/canvas-game smoke');

testAsync('examples/canvas-game compiles and draws through three pumped frames', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'examples', 'canvas-game', 'src', 'game.pln'), 'utf8');
  const env = makeBrowserEnv();
  env.document.elements.set('game', env.document.createElement('canvas'));
  env.document.elements.set('restart', env.document.createElement('button'));
  env.document.elements.set('score', env.document.createElement('div'));
  await env.run(compileProgram(source));
  env.pump(3);
  const count = (fn) => env.recorder.ctx2d.filter((r) => r.fn === fn).length;
  assert(count('clearRect'), '3');
  assert(count('fillRect'), '21');
  assert(count('strokeRect'), '3');
  assert(count('fillText'), '6');
});

testAsync('glShader accepts the DOM-style "VERTEX_SHADER"/"FRAGMENT_SHADER" names too', async () => {
  const env = makeBrowserEnv();
  const canvas = env.document.createElement('canvas');
  env.document.selectorRegistry['#gl'] = canvas;
  presetGLEnums(env, canvas);
  await env.run(compileProgram([
    'remember cv as select("#gl")',
    'remember gl as webglContext(cv)',
    'remember vs as glShader(gl, "VERTEX_SHADER", "void main(){}")',
    'remember fs as glShader(gl, "FRAGMENT_SHADER", "void main(){}")',
  ].join('\n')));
  const creates = env.recorder.gl.filter((r) => r.fn === 'createShader').map((r) => r.args[0]);
  assert(JSON.stringify(creates), JSON.stringify([0x8B31, 0x8B30]));
});

// ── 9. Compatibility guards ────────────────────────────────────────────────────

console.log('\nv1.0.36 browser: compatibility guards');

test('"text" is not shadowed by the browser builtins', () => {
  assertIncludes(compileProgram('show text(5)'), 'console.log(String(5));');
});

test('canonical snippet from docs/GAME-PROMPT.md still compiles with the right shape', () => {
  const js = compileProgram([
    'remember scene as new THREE.Scene()',
    'when button "click" happens as ev',
    '    show text(ev.key)',
    'done',
    'every frame',
    '    ctx.clearRect(0, 0, 640, 480)',
    'done',
    'after 0.5 seconds',
    '    show "tick"',
    'done',
    'remember bg as loadImage("bg.png")',
  ].join('\n'));
  for (const shape of [
    '(async () => {',
    'new THREE.Scene()',
    'button.addEventListener("click", function (ev) {',
    'String(ev.key)',
    'requestAnimationFrame(function __frame(__frameTime) {',
    'requestAnimationFrame(__frame);',
    '0.5 * 1000',
    '(await __loadImage("bg.png"))',
  ]) assertIncludes(js, shape);
});

// ── Summary ────────────────────────────────────────────────────────────────────

(async () => {
  await Promise.all(pendingTests);
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();