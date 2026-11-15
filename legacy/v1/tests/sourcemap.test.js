// PlainScript  -  SourceMap (V3) verification suite.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const { encodeVlq, decodeVlq, SourceMapGenerator } = require('../compiler/sourcemap');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate } = require('../compiler/generator');
const { bundle } = require('../compiler/bundler');

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

console.log('── SourceMap (V3) unit and integration tests ───────────────────────────\n');

// 1. VLQ Encoder / Decoder
{
  const testValues = [0, 1, -1, 15, -15, 16, -16, 31, -31, 32, -32, 100, -100, 12345];
  for (const val of testValues) {
    const encoded = encodeVlq(val);
    const decoded = decodeVlq(encoded);
    assert(decoded === val, `VLQ roundtrip failed for ${val}: got ${decoded}`);
  }
  console.log('  PASS  VLQ encoding and decoding round-trip cleanly');
}

// 2. SourceMapGenerator V3 structure
{
  const gen = new SourceMapGenerator({ file: 'app.js' });
  gen.addMapping({
    generated: { line: 1, column: 0 },
    original: { line: 1, column: 1 },
    source: 'app.pln',
  });
  gen.addMapping({
    generated: { line: 2, column: 0 },
    original: { line: 2, column: 1 },
    source: 'app.pln',
  });

  const json = gen.toJSON();
  assert(json.version === 3, 'Expected version 3');
  assert(json.file === 'app.js', 'Expected file app.js');
  assert(json.sources.includes('app.pln'), 'Expected source app.pln');
  assert(typeof json.mappings === 'string' && json.mappings.length > 0, 'Expected valid mappings string');
  
  const dataUrl = gen.toInlineDataUrl();
  assert(dataUrl.startsWith('//# sourceMappingURL=data:application/json;charset=utf-8;base64,'), 'Expected data URL');
  console.log('  PASS  SourceMapGenerator creates valid V3 JSON structure and data URLs');
}

// 3. Single-file compilation source map
{
  const source = [
    'remember name as "Ada"',
    'remember greeting as `Hello ${name}`',
    'show greeting',
  ].join('\n');

  const tokens = tokenize(source);
  const ast = parse(tokens);
  const res = generate(ast, { sourceMap: true, sourceFile: 'hello.pln' });

  assert(typeof res === 'object' && res.code && res.mapObject, 'Expected object return with code and mapObject');
  assert(res.mapObject.version === 3, 'Expected V3 mapObject');
  assert(res.mapObject.sources.includes('hello.pln'), 'Expected hello.pln in sources');
  assert(res.code.includes('let name = "Ada";'), 'Expected compiled code');
  console.log('  PASS  generate() emits V3 source maps when sourceMap option is enabled');
}

// 4. Multi-file bundled source map
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-map-test-'));
  try {
    const mathFile = path.join(tmpDir, 'math.pln');
    const mainFile = path.join(tmpDir, 'main.pln');

    fs.writeFileSync(mathFile, 'make add(a, b)\n  give a + b\ndone\nexport add', 'utf8');
    fs.writeFileSync(mainFile, 'import { add } from "./math.pln"\nshow add(2, 3)', 'utf8');

    const res = bundle(mainFile, { sourceMap: true });
    assert(typeof res === 'object' && res.code && res.mapObject, 'Expected bundle sourcemap object');
    assert(res.mapObject.sources.length >= 2, 'Expected multiple sources in bundle map');
    assert(res.code.includes('add(2, 3)'), 'Expected bundled code');
    console.log('  PASS  bundle() aggregates multi-file sourcemap mappings across imports');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// 5. CLI build --sourcemap integration
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pln-cli-map-'));
  try {
    const srcDir = path.join(tmpDir, 'src');
    const distDir = path.join(tmpDir, 'dist');
    fs.mkdirSync(srcDir, { recursive: true });

    const appFile = path.join(srcDir, 'app.pln');
    fs.writeFileSync(appFile, 'remember x as 10\nshow x', 'utf8');

    const cliPath = path.resolve(__dirname, '../compiler/cli.js');
    const proc = spawnSync(process.execPath, [cliPath, 'build', appFile, '--sourcemap'], {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    assert(proc.status === 0, `CLI build failed: ${proc.stderr}`);

    const builtJs = path.join(distDir, 'app.js');
    const builtMap = path.join(distDir, 'app.js.map');

    assert(fs.existsSync(builtJs), 'Expected dist/app.js to exist');
    assert(fs.existsSync(builtMap), 'Expected dist/app.js.map to exist');

    const jsContent = fs.readFileSync(builtJs, 'utf8');
    assert(jsContent.includes('//# sourceMappingURL=app.js.map'), 'Expected sourceMappingURL comment in JS');

    const mapJson = JSON.parse(fs.readFileSync(builtMap, 'utf8'));
    assert(mapJson.version === 3, 'Expected V3 mapJson in file');
    console.log('  PASS  plainscript build --sourcemap writes .js.map and appends comment');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log('\nAll source map tests passed!');
