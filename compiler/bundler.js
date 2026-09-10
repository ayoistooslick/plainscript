// Bundler: resolves PlainScript import statements, builds a dependency graph,
// and returns a single concatenated JavaScript output.

const fs   = require('fs');
const path = require('path');
const { tokenize } = require('./lexer');
const { parse }    = require('./parser');
const { generate, createGenerationContext, wrapAsync } = require('./generator');

function isLocalImportPath(p) {
  if (!p) return false;
  return p.startsWith('.') || p.startsWith('/') || p.startsWith('\\') || p.startsWith('@/') || p.endsWith('.pln');
}

function resolveImportPath(dir, importPath) {
  let base;
  if (importPath.startsWith('@/')) {
    const srcDir = fs.existsSync(path.resolve(process.cwd(), 'src'))
      ? path.resolve(process.cwd(), 'src')
      : process.cwd();
    base = path.resolve(srcDir, importPath.slice(2));
  } else {
    base = path.resolve(dir, importPath);
  }

  // 1. Direct match (e.g. "./math.pln")
  if (fs.existsSync(base) && fs.statSync(base).isFile()) {
    return base;
  }
  // 2. Implicit .pln extension (e.g. "./math" -> "./math.pln")
  if (fs.existsSync(`${base}.pln`) && fs.statSync(`${base}.pln`).isFile()) {
    return `${base}.pln`;
  }
  // 3. Directory index resolution (e.g. "./utils" -> "./utils/index.pln" or "./utils/app.pln")
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    const indexPath = path.join(base, 'index.pln');
    if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
      return indexPath;
    }
    const appPath = path.join(base, 'app.pln');
    if (fs.existsSync(appPath) && fs.statSync(appPath).isFile()) {
      return appPath;
    }
  }
  return base;
}

// Returns the local file import and re-export paths declared at the top level of an AST.
function getImports(ast) {
  const paths = [];
  for (const node of ast.body) {
    if (node.type === 'ImportStatement' && node.path && isLocalImportPath(node.path)) {
      paths.push(node.path);
    } else if (node.type === 'ExportStatement' && node.fromPath && isLocalImportPath(node.fromPath)) {
      paths.push(node.fromPath);
    }
  }
  return paths;
}

// Resolves all dependencies of entryPath using DFS topological order.
// Returns an array of { absPath, ast } in compile order (deepest dependencies first).
// Throws on circular imports or missing files.
function resolveDependencies(entryPath) {
  const absoluteEntry = path.resolve(entryPath);
  const visited = new Set();  // fully processed files (don't revisit)
  const order   = [];         // final compile order

  function visit(absPath, stack) {
    // Already fully processed  -  skip (handles duplicate imports)
    if (visited.has(absPath)) return;

    // File is in the current DFS stack → circular dependency
    const cycleIdx = stack.indexOf(absPath);
    if (cycleIdx !== -1) {
      const cycle = [...stack.slice(cycleIdx), absPath]
        .map(p => `  "${path.relative(process.cwd(), p) || path.basename(p)}"`)
        .join(' →\n');
      throw new Error(
        `Circular import detected:\n${cycle}\n\nPlain cannot compile files with circular dependencies.`
      );
    }

    // File does not exist
    if (!fs.existsSync(absPath)) {
      throw new Error(
        `Cannot find file "${path.relative(process.cwd(), absPath) || absPath}".\n\nMake sure the file exists and the path is correct.`
      );
    }

    // Parse the file to discover its own imports.
    // Annotate any tokenise/parse error with the filename so callers see
    // "file.pln  -  Line N, Column N: …" rather than a bare positional message.
    const source = fs.readFileSync(absPath, 'utf8');
    let tokens, ast;
    try {
      tokens = tokenize(source);
      ast    = parse(tokens);
    } catch (err) {
      const relPath = path.relative(process.cwd(), absPath) || path.basename(absPath);
      throw new Error(`${relPath}  -  ${err.message}`);
    }

    // Recurse into each import before processing this file (DFS)
    const newStack = [...stack, absPath];
    for (const importPath of getImports(ast)) {
      const dir         = path.dirname(absPath);
      const resolvedAbs = resolveImportPath(dir, importPath);
      visit(resolvedAbs, newStack);
    }

    // All dependencies are done  -  add this file to the order
    visited.add(absPath);
    order.push({ absPath, ast });
  }

  visit(absoluteEntry, []);
  return order;
}

// Compile all files in dependency order into one JavaScript string.
function bundle(entryPath, options = {}) {
  const files = resolveDependencies(entryPath);
  const context = createGenerationContext(options);
  const parts = files.map(({ absPath, ast }) => {
    const relPath = path.relative(process.cwd(), absPath).replace(/\\/g, '/') || path.basename(absPath);
    context.sourceFile = relPath;
    if (context.sourceMapBuilder) {
      try {
        const content = fs.readFileSync(absPath, 'utf8');
        context.sourceMapBuilder.addSource(relPath, content);
      } catch (_) { /* ignore missing content */ }
    }
    const res = generate(ast, context);
    return typeof res === 'string' ? res : (res && res.code ? res.code : '');
  }).filter(js => js && js.trim() !== '');
  let js = parts.join('\n');
  if (context.needsAsync) {
    js = wrapAsync(js);
    if (context.sourceMapBuilder) {
      for (const m of context.sourceMapBuilder.mappings) {
        m.generatedLine += 1;
      }
    }
  }

  if (options.sourceMap && context.sourceMapBuilder) {
    return {
      code: js,
      map: context.sourceMapBuilder,
      mapObject: context.sourceMapBuilder.toJSON(),
    };
  }
  return js;
}

module.exports = { bundle, resolveDependencies };
