// Build browser bundle for PlainScript compiler.
// Emits docs/website/plainscript-browser.js exposing window.PlainScript.

const fs = require('fs');
const path = require('path');

function buildBrowserBundle() {
  const root = path.resolve(__dirname, '..');
  const outPath = path.join(root, 'docs', 'website', 'plainscript-browser.js');

  // Strict dependency topological order
  const files = [
    { name: 'version', file: path.join(root, 'compiler', 'version.js') },
    { name: 'sourcemap', file: path.join(root, 'compiler', 'sourcemap.js') },
    { name: 'diagnostics', file: path.join(root, 'compiler', 'diagnostics.js') },
    { name: 'lexer', file: path.join(root, 'compiler', 'lexer.js') },
    { name: 'parser', file: path.join(root, 'compiler', 'parser.js') },
    { name: 'dependencyDetector', file: path.join(root, 'compiler', 'dependency-detector.js') },
    { name: 'generator', file: path.join(root, 'compiler', 'generator.js') },
    { name: 'formatter', file: path.join(root, 'compiler', 'formatter.js') },
  ];

  const contents = files.map(({ name, file }) => {
    let code = fs.readFileSync(file, 'utf8');
    return `// ── ${path.basename(file)} ──
(function() {
  const module = { exports: {} };
  const exports = module.exports;
  const require = function(id) {
    if (id === './version') return modules['version'];
    if (id === './sourcemap') return modules['sourcemap'];
    if (id === './diagnostics') return modules['diagnostics'];
    if (id === './lexer') return modules['lexer'];
    if (id === './parser') return modules['parser'];
    if (id === './dependency-detector') return modules['dependencyDetector'];
    if (id === './generator') return modules['generator'];
    if (id === './formatter') return modules['formatter'];
    if (id === 'fs') return { existsSync: () => false, readFileSync: () => '' };
    if (id === 'path') return { resolve: (...p) => p.join('/'), relative: (_a, b) => b, basename: (p) => p.split(/[\\\\/]/).pop() };
    if (id === 'module') return { builtinModules: [] };
    return {};
  };

${code}

  modules['${name}'] = module.exports;
})();`;
  });

  const bundle = `(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PlainScript = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  const modules = {};

  ${contents.join('\n\n  ')}

  const { tokenize, TOKEN } = modules['lexer'];
  const { parse } = modules['parser'];
  const { generate, createGenerationContext, wrapAsync } = modules['generator'];
  const { format } = modules['formatter'];
  const { formatDiagnostic } = modules['diagnostics'];
  const { VERSION } = modules['version'];

  function compile(source, options = {}) {
    const tokens = tokenize(source);
    const ast = parse(tokens);
    const ctx = createGenerationContext(options);
    let js = generate(ast, ctx);
    if (ctx.needsAsync) js = wrapAsync(js);
    return js;
  }

  return {
    VERSION,
    compile,
    tokenize,
    TOKEN,
    parse,
    generate,
    format,
    formatDiagnostic,
  };
}));
`;

  fs.writeFileSync(outPath, bundle, 'utf8');
  console.log(`✓ Browser bundle created at docs/website/plainscript-browser.js (${Buffer.byteLength(bundle, 'utf8')} bytes)`);
}

if (require.main === module) {
  buildBrowserBundle();
}

module.exports = { buildBrowserBundle };
