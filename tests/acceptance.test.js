// Acceptance tests for the v2.1.1 example projects.
//
// These boot the REAL compiled output of examples/ over live HTTP:
//   • examples/football-backend/app.pln   -  SQLite + sessions + api key + 404
//   • examples/id-verification/app.pln    -  uploads + ocr + name matching
//
// tesseract.js is not bundled (it downloads language data on demand), so the
// OCR engine is replaced by a deterministic stub that genuinely decodes the
// pixels produced by examples/id-verification/make-sample-id.js.
//
// Run with: node tests/acceptance.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate, createGenerationContext, wrapAsync } = require('../compiler/generator');

let passed = 0;
let failed = 0;

function assert(actual, expected) {
  const a = String(actual);
  const e = String(expected);
  if (a !== e) throw new Error(`Expected:\n        ${e}\n        Got:\n        ${a}`);
}

function assertIncludes(actual, expected) {
  if (!String(actual).includes(expected)) {
    throw new Error(`Expected to include:\n        ${expected}\n        Got:\n        ${actual}`);
  }
}

function compileFile(file) {
  const context = createGenerationContext();
  let js = generate(parse(tokenize(fs.readFileSync(file, 'utf8'))), context);
  if (context.needsAsync) js = wrapAsync(js);
  return js;
}

// Boots compiled PlainScript output on an ephemeral port by capturing app.listen,
// exactly like the backend test harness. `fakeOcr(path)` replaces the
// tesseract.js engine when provided.
async function bootApp(js, { fakeOcr = null } = {}) {
  const originalCwd = process.cwd();
  const realExpress = require('express');
  const captured = [];
  const express = (...args) => {
    const app = realExpress(...args);
    const originalListen = app.listen.bind(app);
    app.listen = (...listenArgs) => {
      const server = originalListen(...listenArgs);
      captured.push(server);
      return server;
    };
    return app;
  };
  for (const key of Object.keys(realExpress)) express[key] = realExpress[key];

  const requireHook = (name) => {
    if (name === 'express') return express;
    if (name === 'tesseract.js' && fakeOcr) {
      return {
        createWorker: async () => ({
          recognize: async (imagePath) => ({ data: { text: fakeOcr(imagePath) } }),
          terminate: async () => {},
        }),
      };
    }
    return require(name);
  };

  const match = js.match(/^\(async \(\) => \{\n([\s\S]*)\n\}\)\(\);$/);
  const body = match ? `return (async () => {\n${match[1]}\n})();` : `${js}\n;return undefined;`;
  const promise = new Function('require', 'console', body)(requireHook, console);
  await Promise.resolve(promise);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const server = captured[0];
  if (!server) throw new Error('the compiled app never started listening');
  return {
    port: server.address().port,
    server,
    restoreCwd: () => process.chdir(originalCwd),
  };
}

// ── Pixel-level OCR stub: decodes exactly what make-sample-id.js writes ─────

const { createIdPng, FONT, WIDTH, HEIGHT, SCALE, MARGIN_X, LINE_HEIGHT } =
  require('../examples/id-verification/make-sample-id.js');

const GLYPH_LOOKUP = new Map(
  Object.entries(FONT).map(([char, rows]) => [rows.join(','), char])
);

function decodeIdPngText(png) {
  let offset = 8;
  const idatChunks = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') idatChunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const pixelAt = (x, y) => raw[y * (WIDTH * 3 + 1) + 1 + x * 3];

  const maxCharsPerLine = Math.floor((WIDTH - MARGIN_X) / (6 * SCALE));
  const lines = [];
  for (let line = 0; line * LINE_HEIGHT + 24 < HEIGHT; line++) {
    const y0 = 24 + line * LINE_HEIGHT;
    let text = '';
    for (let c = 0; c < maxCharsPerLine; c++) {
      const x0 = MARGIN_X + c * 6 * SCALE;
      const rows = [];
      for (let row = 0; row < 7; row++) {
        let value = 0;
        for (let col = 0; col < 5; col++) {
          const px = x0 + col * SCALE + (SCALE >> 1);
          const py = y0 + row * SCALE + (SCALE >> 1);
          if (px < WIDTH && py < HEIGHT && pixelAt(px, py) < 128) value |= 1 << (4 - col);
        }
        rows.push(value);
      }
      const char = GLYPH_LOOKUP.get(rows.join(','));
      if (!char) { text += '?'; continue; }
      text += char;
    }
    lines.push(text.replace(/\?+$/, '').trimEnd());
  }
  return lines.filter((line) => line.length > 0).join('\n');
}

console.log('\nAcceptance  -  football backend');
console.log('(examples/football-backend/app.pln over live HTTP)');

async function footballAcceptance() {
  const { port, server } = await bootApp(compileFile('examples/football-backend/app.pln'));
  const base = `http://127.0.0.1:${port}`;
  try {
    const keyHeaders = { 'x-api-key': 'coach-key-42' };

    const gated = await fetch(`${base}/teams`);
    assert(gated.status, '401');

    const wrongLogin = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'ada', password: 'wrong' }),
    });
    assert(wrongLogin.status, '401');

    const login = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'ada', password: 'touchline' }),
    });
    assert(login.status, '200');
    const loginBody = await login.json();
    assert(loginBody.user, 'ada');
    assertIncludes(loginBody.token, '.');
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assertIncludes(cookie, 'plainscript.sid=');

    const me = await fetch(`${base}/me`, { headers: { cookie } });
    assert((await me.json()).user, 'ada');

    const teamsRes = await fetch(`${base}/teams`, { headers: keyHeaders });
    assert(teamsRes.status, '200');
    const seeded = (await teamsRes.json()).teams;
    assert(seeded.length, '3');
    assert(seeded[0].name, 'Harbor City');

    const created = await fetch(`${base}/teams`, {
      method: 'POST',
      headers: { ...keyHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Riverside' }),
    });
    assert((await created.json()).added, 'Riverside');

    const afterAdd = await fetch(`${base}/teams`, { headers: keyHeaders });
    assert((await afterAdd.json()).teams.length, '4');

    const invalid = await fetch(`${base}/teams`, {
      method: 'POST',
      headers: { ...keyHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert(invalid.status, '400');
    assert(JSON.stringify(await invalid.json()), '["name"]');

    const standings = await fetch(`${base}/standings`, { headers: keyHeaders });
    const table = (await standings.json()).standings;
    assert(table[0].name, 'Thunder FC');
    assert(table[0].won, '2');

    const missing = await fetch(`${base}/definitely/not/here`, { headers: keyHeaders });
    assert(missing.status, '404');
    assert((await missing.json()).error, 'No such endpoint');
  } finally { server.close(); }
  console.log('  PASS  football backend serves the full coach API');
  passed++;
}

// ── ID verification ───────────────────────────────────────────────────────────

console.log('\nAcceptance  -  ID verification');
console.log('(examples/id-verification/app.pln over live HTTP)');

async function idVerificationAcceptance() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-idverify-'));
  // Compile before switching cwd (source paths are repo-relative); the app's
  // relative "uploads" folder then lands inside the temp work directory.
  const js = compileFile('examples/id-verification/app.pln');
  process.chdir(workDir);
  const { port, server, restoreCwd } = await bootApp(js, {
    fakeOcr: (imagePath) => decodeIdPngText(fs.readFileSync(imagePath)),
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    const postCard = (name) => {
      const form = new FormData();
      form.append('id', new Blob([createIdPng([name])], { type: 'image/png' }), 'card.png');
      return fetch(`${base}/verify`, { method: 'POST', body: form });
    };

    const good = await postCard('ADA LOVELACE');
    assert(good.status, '200');
    const goodBody = await good.json();
    assert(goodBody.verified, 'true');
    assert(goodBody.holder, 'Ada Lovelace');

    const bad = await postCard('IDA CARD');
    assert(bad.status, '200');
    const badBody = await bad.json();
    assert(badBody.verified, 'false');
    assert(badBody.holder, 'unknown');

    const none = await fetch(`${base}/verify`, { method: 'POST', body: new FormData() });
    assert(none.status, '400');

    const stored = fs.readdirSync(path.join(workDir, 'uploads'));
    assert(stored.length, '2');
  } finally {
    server.close();
    restoreCwd();
    // Windows occasionally still holds handles right after close(); retry.
    for (let attempt = 0; attempt < 5; attempt++) {
      try { fs.rmSync(workDir, { recursive: true, force: true }); break; }
      catch (_) { await new Promise((r) => setTimeout(r, 100)); }
    }
  }
  console.log('  PASS  ID verification matches the card holder through uploads + OCR');
  passed++;
}

const runs = [
  footballAcceptance().then(null, (e) => { console.log('  FAIL  football backend'); console.log(`        ${e.message}`); failed++; }),
  idVerificationAcceptance().then(null, (e) => { console.log('  FAIL  ID verification'); console.log(`        ${e.message}`); failed++; }),
];

Promise.all(runs).then(() => {
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
});
