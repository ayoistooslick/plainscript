// Quick single-file validator: reads a .pln snippet and runs the compiler's
// check pipeline (tokenize -> parse -> generate -> JS syntax) printing any
// error. Exits 0 on success, 1 on failure.
const fs = require('fs');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate, createGenerationContext, wrapAsync } = require('../compiler/generator');
const { resolveDependencies } = require('../compiler/bundler');

const file = process.argv[2];
const absPath = require('path').resolve(file);

try {
  const files = resolveDependencies(absPath);
  const context = createGenerationContext();
  let js = files.map(({ ast }) => generate(ast, context)).filter(s => s.trim()).join('\n');
  if (context.needsAsync) js = wrapAsync(js);
  new (require('vm').Script)(js);
  console.log(`✓ ${file} — ok`);
} catch (e) {
  console.error(`✗ ${file}: ${e.message}`);
  process.exit(1);
}
