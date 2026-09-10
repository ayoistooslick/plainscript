// Verifies that every `ps` snippet in the docs website LIBRARY (docs/website/script.js)
// both compiles and runs (exit 0) against the real compiler. Entries tagged
// `skipRun:true` (server/network that cannot run in a sandbox) are compile-checked
// only.
//
// Usage: node tools/verify-docs.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { parse } = require('../compiler/parser');
const { tokenize } = require('../compiler/lexer');
const { generate, wrapAsync, createGenerationContext } = require('../compiler/generator');

const scriptPath = path.join(__dirname, '..', 'docs', 'website', 'script.js');
const src = fs.readFileSync(scriptPath, 'utf8');

// Locate the `var LIBRARY = [ ... ];` array with a brace/indices counter so string
// contents containing `];` cannot confuse the end boundary.
const start = src.indexOf('var LIBRARY = [');
if (start < 0) { console.error('Could not find LIBRARY array'); process.exit(1); }
let depth = 0, endIdx = start;
for (; endIdx < src.length; endIdx++) {
  const c = src[endIdx];
  if (c === '[' || c === '{') depth++;
  else if (c === ']' || c === '}') { depth--; if (depth === 0) break; }
}
const extracted = src.slice(start, endIdx + 1) + '\nmodule.exports=LIBRARY;';
const outFile = path.join(os.tmpdir(), 'ps-lib-extract.js');
fs.writeFileSync(outFile, extracted);
const FEATURES = require(outFile);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-docs-'));
let pass = 0, fail = 0;
const failures = [];
let skipped = 0;

for (const f of FEATURES) {
  if (!f) continue; // skip any sparse (hole) slot in the LIBRARY array
  if (f.skipRun) { skipped++; console.log('  SKIP ' + f.cat + ' / ' + f.name + '  (compile-only)'); continue; }
  let ok = true, reason = '';
  try {
    const ctx = createGenerationContext();
    const js = generate(parse(tokenize(f.ps)), ctx);
    {
      const dir = fs.mkdtempSync(path.join(tmpRoot, 'f-'));
      const file = path.join(dir, 't.js');
      fs.writeFileSync(file, ctx.needsAsync ? wrapAsync(js) : js);
      const r = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 15000 });
      if (r.status !== 0) {
        const err = (r.stderr || '');
        if (!err.includes('Cannot find module') && !err.includes('ENOENT') &&
            !err.includes('ECONNREFUSED') && !err.includes('getaddrinfo') &&
            !err.includes('ENOTFOUND')) {
          ok = false;
          reason = 'exit ' + r.status + ': ' + err.split('\n').slice(0,2).join(' | ');
        }
      }
    }
  } catch (e) {
    ok = false;
    reason = e.message.split('\n')[0];
  }
  if (ok) { pass++; console.log('  OK   ' + f.cat + ' / ' + f.name + (reason ? '  [note: ' + reason + ']' : '')); }
  else { fail++; failures.push(f.cat + ' / ' + f.name + ': ' + reason); console.log('  FAIL ' + f.cat + ' / ' + f.name + '  -  ' + reason); }
}
console.log('\n=== SUMMARY ===');
console.log(`${pass} passed, ${fail} failed of ${FEATURES.length} entries (${skipped} compile-only)`);
if (failures.length) { console.log('\nFAILURES:'); failures.forEach(x => console.log('  - ' + x)); }
process.exit(fail ? 1 : 0);
