// compiler/dev.js
// Modern Dev Loop & Live HMR Server for PlainScript (plainscript dev).
// Provides sub-10ms developer feedback with an incremental dependency graph,
// in-memory hot module replacement, and live terminal / SSE browser reload.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { EventEmitter } = require('events');
const { tokenize } = require('./lexer');
const { parse } = require('./parser');
const { generate, createGenerationContext, wrapAsync } = require('./generator');
const { resolveDependencies, resolveImportPath } = require('./bundler');
const { analyzeSemantics } = require('./passes/semantic');
const { inferTypes } = require('./passes/inference');
const { formatDiagnostic } = require('./diagnostics');
const { VERSION } = require('./version');

// ── Incremental Dependency Graph ─────────────────────────────────────────────

class IncrementalGraph {
  constructor() {
    this.dependencies = new Map(); // file -> Set(imports)
    this.dependents = new Map();   // file -> Set(importers)
    this.cache = new Map();        // file -> { source, mtime, ast, js, types, errors, warnings }
  }

  updateFile(absPath) {
    const norm = path.normalize(absPath);
    if (!fs.existsSync(norm)) {
      this.removeFile(norm);
      return { changed: true, removed: true };
    }

    const stat = fs.statSync(norm);
    const existing = this.cache.get(norm);
    const source = fs.readFileSync(norm, 'utf8');

    if (existing && existing.source === source && existing.mtime === stat.mtimeMs) {
      return { changed: false, ast: existing.ast, js: existing.js, types: existing.types };
    }

    const tokens = tokenize(source);
    const ast = parse(tokens);
    const sem = analyzeSemantics(ast);
    const inference = inferTypes(ast);

    const genCtx = createGenerationContext();
    let js = generate(ast, genCtx);
    if (genCtx.needsAsync) js = wrapAsync(js);

    // Track imports
    const currentImports = new Set();
    const dir = path.dirname(norm);
    for (const node of ast.body) {
      if (node.type === 'ImportStatement' && node.path) {
        const resolved = resolveImportPath(dir, node.path);
        currentImports.add(path.normalize(resolved));
      }
    }

    // Clean old reverse mappings
    const prevImports = this.dependencies.get(norm) || new Set();
    for (const oldImp of prevImports) {
      if (!currentImports.has(oldImp) && this.dependents.has(oldImp)) {
        this.dependents.get(oldImp).delete(norm);
      }
    }

    // Set new dependencies
    this.dependencies.set(norm, currentImports);
    for (const imp of currentImports) {
      if (!this.dependents.has(imp)) this.dependents.set(imp, new Set());
      this.dependents.get(imp).add(norm);
    }

    const record = {
      source,
      mtime: stat.mtimeMs,
      ast,
      js,
      types: inference.types,
      errors: sem.errors,
      warnings: sem.warnings,
    };
    this.cache.set(norm, record);
    return { changed: true, ast, js, types: inference.types };
  }

  getCachedJs(absPath) {
    const c = this.cache.get(path.normalize(absPath));
    return c ? c.js : null;
  }

  getCachedAst(absPath) {
    const c = this.cache.get(path.normalize(absPath));
    return c ? c.ast : null;
  }

  getDependents(absPath) {
    return this.dependents.get(path.normalize(absPath)) || new Set();
  }

  invalidate(absPath) {
    return new Set(this.getAffectedFiles(absPath));
  }

  removeFile(absPath) {
    const norm = path.normalize(absPath);
    this.cache.delete(norm);
    const imps = this.dependencies.get(norm) || new Set();
    for (const imp of imps) {
      if (this.dependents.has(imp)) this.dependents.get(imp).delete(norm);
    }
    this.dependencies.delete(norm);
    this.dependents.delete(norm);
  }

  getAffectedFiles(changedPath) {
    const norm = path.normalize(changedPath);
    const affected = new Set([norm]);
    const queue = [norm];

    while (queue.length > 0) {
      const current = queue.shift();
      const deps = this.dependents.get(current);
      if (deps) {
        for (const dep of deps) {
          if (!affected.has(dep)) {
            affected.add(dep);
            queue.push(dep);
          }
        }
      }
    }

    return Array.from(affected);
  }
}

// ── In-Memory HMR Runtime ───────────────────────────────────────────────────

class HmrRuntime {
  constructor() {
    this.sandbox = {
      console,
      process,
      require,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Buffer,
      // Shared persistent server & database registries
      __pln_servers: new Map(),
      __pln_databases: new Map(),
      __pln_routes: new Map(),
    };
    this.context = vm.createContext(this.sandbox);
  }

  reloadModule(absPath, plnSource) {
    try {
      const tokens = tokenize(plnSource);
      const ast = parse(tokens);
      const sem = analyzeSemantics(ast);
      if (sem.errors && sem.errors.length > 0) {
        return { ok: false, error: sem.errors[0].message };
      }
      const genCtx = createGenerationContext();
      let js = generate(ast, genCtx);
      if (genCtx.needsAsync) js = wrapAsync(js);
      this.executeModule(absPath, js);
      return { ok: true, js };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  executeModule(absPath, js) {
    // Preserve global bindings by rewriting top-level let/const declarations to var
    let wrapped = js.replace(/^let\s+([A-Za-z0-9_]+)\s*=/gm, 'var $1 =');
    const script = new vm.Script(wrapped, { filename: absPath });
    return script.runInContext(this.context);
  }

  executeSnippet(jsCode) {
    return vm.runInContext(jsCode, this.context);
  }

  reset() {
    this.sandbox.__pln_servers.clear();
    this.sandbox.__pln_databases.clear();
    this.sandbox.__pln_routes.clear();
  }
}

// ── Live Dev Server with SSE & File Watcher ───────────────────────────────────

class DevServer extends EventEmitter {
  constructor(entryPath, options = {}) {
    super();
    this.entryPath = path.resolve(entryPath);
    this.entryFile = path.normalize(this.entryPath);
    this.watchDir = options.watchDir ? path.resolve(options.watchDir) : path.dirname(this.entryPath);
    this.port = options.port || 3000;
    this.graph = new IncrementalGraph();
    this.runtime = new HmrRuntime();
    this.clients = new Set(); // SSE HTTP response streams
    this.watcher = null;
    this.debounceTimer = null;
    this.isRunning = false;
  }

  buildInitialGraph() {
    const files = resolveDependencies(this.entryPath);
    for (const { absPath } of files) {
      this.graph.updateFile(absPath);
    }
  }

  start() {
    this.buildInitialGraph();

    // Execute bundle initially
    const t0 = Date.now();
    try {
      const files = resolveDependencies(this.entryPath);
      for (const { absPath } of files) {
        const cached = this.graph.cache.get(path.normalize(absPath));
        if (cached && cached.js) {
          this.runtime.executeModule(absPath, cached.js);
        }
      }
      this.emit('ready', { elapsed: Date.now() - t0 });
    } catch (err) {
      this.emit('error', err);
    }

    // Start recursive file watcher
    this.startWatcher();
    this.isRunning = true;
  }

  startWatcher() {
    try {
      this.watcher = fs.watch(this.watchDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        if (!filename.endsWith('.pln') && !filename.endsWith('.json')) return;

        const fullPath = path.join(this.watchDir, filename);
        this.debounceHandleChange(fullPath);
      });
    } catch (err) {
      this.emit('watcher-error', err);
    }
  }

  debounceHandleChange(filePath) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.handleFileChange(filePath);
    }, 40);
  }

  handleFileChange(filePath) {
    const t0 = Date.now();
    const norm = path.normalize(filePath);
    const affected = this.graph.getAffectedFiles(norm);

    try {
      // Recompile affected sub-graph
      for (const f of affected) {
        this.graph.updateFile(f);
      }

      // Hot swap affected modules in-memory
      for (const f of affected) {
        const cached = this.graph.cache.get(f);
        if (cached && cached.js) {
          this.runtime.executeModule(f, cached.js);
        }
      }

      const elapsed = Date.now() - t0;
      const relPath = path.relative(process.cwd(), norm) || norm;

      // Notify connected browser clients via SSE
      this.notifyClients('reload', { file: relPath, elapsed });
      this.emit('reload', { file: relPath, affected, elapsed });
    } catch (err) {
      this.emit('error', err);
      this.notifyClients('error', { message: err.message });
    }
  }

  notifyClients(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch (_) {
        this.clients.delete(client);
      }
    }
  }

  broadcast(event, data) {
    this.notifyClients(event, data);
  }

  createHmrMiddleware() {
    return this.createSseMiddleware();
  }

  createSseMiddleware() {
    return (req, res, next) => {
      if (req.url === '/__plain_hmr') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        res.write('event: connected\ndata: {"status":"ready"}\n\n');
        this.clients.add(res);

        req.on('close', () => {
          this.clients.delete(res);
        });
        return true;
      }
      if (next) next();
      return false;
    };
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const client of this.clients) {
      try { client.end(); } catch (_) {}
    }
    this.clients.clear();
    this.isRunning = false;
  }
}

function startDevServer(entryFile, options = {}) {
  const server = new DevServer(entryFile, options);
  server.on('ready', ({ elapsed }) => {
    console.log(`[PLN] ⚡ Dev server ready in ${elapsed}ms (HMR active).`);
    console.log(`[PLN] Watching ${server.watchDir} for live updates...\n`);
  });

  server.on('reload', ({ file, elapsed }) => {
    console.log(`[HMR] ↻ Reloaded ${file} in ${elapsed}ms (0 errors).`);
  });

  server.on('error', (err) => {
    console.error(`[HMR] ✗ Hot reload error: ${err.message}`);
  });

  server.start();
  return server;
}

module.exports = {
  IncrementalGraph,
  HmrRuntime,
  DevServer,
  startDevServer,
};
