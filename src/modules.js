'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { parse } = require('./parser');
const { checkModule } = require('./checker');
const { lowerProgram } = require('./hir');
const { generate } = require('./codegen');
const { Span, error, CompileError } = require('./diagnostics');

const COMPILER_ROOT = path.resolve(__dirname, '..');
const STDLIB_DIR = path.join(COMPILER_ROOT, 'stdlib');
const SOURCE_EXTENSION = '.pln';
const OUTPUT_EXTENSION = '.js';

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function isDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

class Compiler {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.cwd());
    this.modules = new Map();
    this.stdModules = new Map();
    this.loading = new Set();
    this.diagnostics = [];
    this.outputFor = options.outputFor || null;
    // When compiling for the browser, standard library imports become URLs
    // relative to the page (for example /std/dom.js) instead of file paths.
    this.stdBase = options.stdBase || null;
    // Project-wide default syntax dialect. Individual files may override it
    // with a `#syntax 2.0` / `#syntax 2.1` pragma.
    this.dialect = options.dialect ? String(options.dialect) : null;
    // Editor and test harnesses can supply unsaved documents without writing
    // them to disk. Keys are absolute paths.
    this.overrides = options.overrides || new Map();
  }

  sourceFor(file) {
    const absolute = path.resolve(file);
    return this.overrides.has(absolute) ? this.overrides.get(absolute) : null;
  }

  existsFile(candidate) {
    const absolute = path.resolve(candidate);
    return this.overrides.has(absolute) || isFile(absolute);
  }

  invalidate(file) {
    const target = path.resolve(file);
    const removed = new Set([target]);
    // A changed module can alter exported types used by any importer, so walk
    // the reverse dependency closure. Unrelated modules stay in the cache and
    // do not need to be parsed or checked again.
    let changed = true;
    while (changed) {
      changed = false;
      for (const [candidate, record] of this.modules) {
        if (removed.has(candidate)) continue;
        for (const resolved of record.resolutions.values()) {
          if (resolved.path && removed.has(path.resolve(resolved.path))) {
            removed.add(candidate);
            changed = true;
            break;
          }
        }
      }
    }
    for (const candidate of removed) this.modules.delete(candidate);
    this.diagnostics.length = 0;
    this.loading.clear();
    return [...removed];
  }

  displayPath(file) {
    const relative = path.relative(this.root, file);
    return relative && !relative.startsWith('..') ? relative.split(path.sep).join('/') : file;
  }

  relativeImport(fromFile, toFile) {
    const relative = path.relative(path.dirname(fromFile), toFile).split(path.sep).join('/');
    return relative.startsWith('.') ? relative : `./${relative}`;
  }

  resolveImport(spec, fromFile) {
    if (spec.startsWith('.')) {
      const base = path.resolve(path.dirname(fromFile), spec);

      if (this.existsFile(base)) {
        // A declaration next to built JavaScript is how a compiled PlainScript
        // library is consumed: the runtime is `x.js`, the types are `x.d.pln`.
        if (base.endsWith('.d.pln')) {
          return { kind: 'declared', path: base, runtime: base.replace(/\.d\.pln$/, '.js') };
        }
        if (base.endsWith('.js')) {
          const declaration = base.replace(/\.js$/, '.d.pln');
          if (isFile(declaration)) return { kind: 'declared', path: declaration, runtime: base };
          return { kind: 'untyped', spec, runtime: base };
        }
        return { kind: 'local', path: base };
      }

      const candidates = [
        base + SOURCE_EXTENSION,
        base + '.d.pln',
        path.join(base, 'index' + SOURCE_EXTENSION),
        path.join(base, 'index.d.pln'),
      ];
      for (const candidate of candidates) {
        if (!this.existsFile(candidate)) continue;
        if (candidate.endsWith('.d.pln')) {
          return { kind: 'declared', path: candidate, runtime: candidate.replace(/\.d\.pln$/, '.js') };
        }
        return { kind: 'local', path: candidate };
      }
      return { kind: 'missing', spec };
    }
    if (spec.startsWith('std/')) {
      const name = spec.slice('std/'.length);
      const declaration = path.join(STDLIB_DIR, `${name}.d.pln`);
      const runtime = path.join(STDLIB_DIR, `${name}.js`);
      if (!isFile(declaration) || !isFile(runtime)) return { kind: 'missing', spec };
      return { kind: 'std', name, declaration, runtime };
    }
    return this.resolvePackageImport(spec, fromFile);
  }

  // A bare specifier may name an installed PlainScript library. Node's own
  // rules find the package; the declaration file next to its entry (or named by
  // `exports`/`types`) supplies the types.
  packageRoot(spec, fromFile) {
    const parts = spec.split('/');
    const scoped = spec.startsWith('@');
    const name = scoped ? parts.slice(0, 2).join('/') : parts[0];
    const subpath = parts.slice(scoped ? 2 : 1).join('/');
    let directory = path.dirname(fromFile);
    while (true) {
      const root = path.join(directory, 'node_modules', name);
      if (isDirectory(root)) return { root, subpath };
      const parent = path.dirname(directory);
      if (parent === directory) return null;
      directory = parent;
    }
  }

  existingFile(root, candidate) {
    const absolute = path.resolve(root, candidate);
    for (const attempt of [absolute, `${absolute}.js`, path.join(absolute, 'index.js')]) {
      if (isFile(attempt)) return attempt;
    }
    return null;
  }

  resolvePackageImport(spec, fromFile) {
    const located = this.packageRoot(spec, fromFile);
    if (!located) return { kind: 'package' };

    let manifest = {};
    const manifestPath = path.join(located.root, 'package.json');
    if (isFile(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (failure) {
        manifest = {};
      }
    }

    const key = located.subpath ? `./${located.subpath}` : '.';
    const target = manifest.exports && typeof manifest.exports === 'object' ? manifest.exports[key] : undefined;
    const exportTypes = target && typeof target === 'object' ? target.types : undefined;
    const exportRuntime = typeof target === 'string'
      ? target
      : (target && typeof target === 'object'
        ? (target.import || target.default || target.require || target.node)
        : undefined);

    const runtimeCandidate = exportRuntime || (located.subpath
      ? `./${located.subpath}`
      : (manifest.module || manifest.main || './index.js'));
    const runtime = this.existingFile(located.root, runtimeCandidate);

    const declared = [];
    if (typeof exportTypes === 'string') declared.push(exportTypes);
    if (!located.subpath) {
      const named = manifest.types || manifest.typings;
      if (typeof named === 'string') declared.push(named);
    }
    if (runtime) declared.push(runtime.replace(/\.js$/, '.d.pln'));

    for (const candidate of declared) {
      const absolute = path.resolve(located.root, candidate);
      if (isFile(absolute)) return { kind: 'typed-package', spec, path: absolute, runtime };
    }

    // Installed JavaScript that ships no declarations stays untyped rather
    // than failing: package imports are values the host resolves.
    return { kind: 'package' };
  }

  stdExports(std) {
    if (this.stdModules.has(std.name)) return this.stdModules.get(std.name);
    let exports = { values: new Map(), types: new Map() };
    try {
      const source = fs.readFileSync(std.declaration, 'utf8');
      const ast = parse(source, std.declaration);
      const checked = checkModule({
        file: std.declaration,
        source,
        program: ast,
        resolveImport: () => null,
      });
      exports = checked.exports;
    } catch (failure) {
      if (failure instanceof CompileError) {
        this.diagnostics.push(...failure.diagnostics);
        this.diagnostics.push(error(
          'PS5001',
          `The bundled declaration file for "${std.name}" is invalid; imports from it are untyped.`,
          new Span(std.declaration, 1, 1),
        ));
      } else {
        this.diagnostics.push(error(
          'PS5001',
          `The bundled declaration file for "${std.name}" could not be read (${failure.message}).`,
          new Span(std.declaration, 1, 1),
        ));
      }
    }
    this.stdModules.set(std.name, exports);
    return exports;
  }

  load(file) {
    if (this.loading.has(file)) {
      this.diagnostics.push(error(
        'PS4001',
        `Circular import: ${this.displayPath(file)} is still being compiled.`,
        new Span(this.displayPath(file), 1, 1),
        { hint: 'Move the shared declaration into a third module, or import a type only.' },
      ));
      return { file, display: this.displayPath(file), source: '', ast: { kind: 'Program', body: [] }, check: null, resolutions: new Map(), failed: true };
    }
    if (this.modules.has(file)) return this.modules.get(file);

    let source = this.sourceFor(file);
    if (source === null) try {
      source = fs.readFileSync(file, 'utf8');
    } catch (failure) {
      this.diagnostics.push(error('PS4004', `Cannot read ${this.displayPath(file)}: ${failure.message}`, new Span(this.displayPath(file), 1, 1)));
      const empty = { file, source: '', ast: { kind: 'Program', body: [] }, check: null, resolutions: new Map(), failed: true };
      this.modules.set(file, empty);
      return empty;
    }

    const record = {
      file,
      display: this.displayPath(file),
      source,
      ast: null,
      check: null,
      resolutions: new Map(),
      failed: false,
      // `.d.pln` modules describe types and values; they never produce output.
      declarationOnly: file.endsWith('.d.pln'),
    };
    this.modules.set(file, record);

    try {
      record.ast = parse(source, record.display, { dialect: this.dialect });
    } catch (failure) {
      if (failure instanceof CompileError) {
        this.diagnostics.push(...failure.diagnostics);
      } else {
        this.diagnostics.push(error('PS5000', failure.message, new Span(record.display, 1, 1)));
      }
      record.failed = true;
      return record;
    }

    this.loading.add(file);

    for (const statement of record.ast.body) {
      if (statement.kind !== 'Import') continue;
      const resolved = this.resolveImport(statement.spec, file);
      record.resolutions.set(statement.spec, resolved);
      if (resolved.kind === 'local' || resolved.kind === 'declared' || resolved.kind === 'typed-package') {
        this.load(resolved.path);
      } else if (resolved.kind === 'std') {
        this.stdExports(resolved);
      } else if (resolved.kind === 'untyped') {
        this.diagnostics.push(error(
          'PS4005',
          `"${statement.spec}" is JavaScript without a declaration file, so its exports are untyped.`,
          new Span(record.display, statement.line, statement.col),
          { hint: `Add ${path.basename(resolved.runtime).replace(/\.js$/, '.d.pln')} next to it.` },
        ));
      } else if (resolved.kind === 'missing') {
        this.diagnostics.push(error(
          'PS4002',
          `Cannot resolve "${statement.spec}".`,
          new Span(record.display, statement.line, statement.col),
          { hint: statement.spec.startsWith('std/') ? 'Bundled modules live under "std/".' : 'Use a relative path ("./mod") or an installed package name.' },
        ));
      }
    }

    const resolveForChecker = (spec) => {
      const resolved = record.resolutions.get(spec);
      if (!resolved) return null;
      if (resolved.kind === 'local' || resolved.kind === 'declared' || resolved.kind === 'typed-package') {
        const target = this.modules.get(resolved.path);
        if (!target || !target.check) {
          if (target && target.failed) return { values: new Map(), types: new Map() };
          return null;
        }
        return target.check.exports;
      }
      if (resolved.kind === 'untyped') return { values: new Map(), types: new Map() };
      if (resolved.kind === 'std') return this.stdExports(resolved);
      return null;
    };

    const checked = checkModule({
      file: record.display,
      source,
      program: record.ast,
      resolveImport: resolveForChecker,
    });
    record.check = checked;
    this.diagnostics.push(...checked.diagnostics);

    this.loading.delete(file);
    return record;
  }

  emitSpecifier(spec, outFile, record) {
    const resolved = record.resolutions.get(spec);
    if (!resolved) return spec;

    if (resolved.kind === 'local') {
      const target = this.outputFor
        ? this.outputFor(resolved.path)
        : resolved.path.replace(/\.pln$/, OUTPUT_EXTENSION);
      return this.relativeImport(outFile, target).replace(/\.pln$/, OUTPUT_EXTENSION);
    }

    if (resolved.kind === 'declared') {
      return this.relativeImport(outFile, resolved.runtime);
    }
    if (resolved.kind === 'untyped' || resolved.kind === 'typed-package') return spec;

    if (resolved.kind === 'std') {
      if (this.stdBase) return `${this.stdBase.replace(/\/$/, '')}/${resolved.name}.js`;
      const relative = path.relative(COMPILER_ROOT, outFile);
      if (!relative.startsWith('..')) {
        return this.relativeImport(outFile, resolved.runtime);
      }
      return `plainscript-lang/std/${resolved.name}`;
    }

    return spec;
  }

  compile(file, options = {}) {
    const record = this.load(file);
    if (!record.check) {
      return { ok: false, diagnostics: this.diagnostics, record };
    }
    const outFile = options.outFile || (this.outputFor ? this.outputFor(file) : file.replace(/\.pln$/, OUTPUT_EXTENSION));

    const checker = record.check.checker;
    const unitVariants = new Set();
    const variantFields = new Map();
    for (const [name, constructor] of checker.variantCtors) {
      if (constructor.kind === 'value') unitVariants.add(name);
      else variantFields.set(name, constructor.type.params.map((parameter) => parameter.name));
    }

    const hir = lowerProgram(record.ast, {
      checker,
      file: record.display,
      unitVariants,
      variantFields,
      typeOnlyImports: record.check.typeOnlyImports,
    });

    const generated = generate(hir, {
      file: record.display,
      outFile: path.basename(outFile),
      mapSpecifier: (spec) => this.emitSpecifier(spec, outFile, record),
      unitVariants,
      variantFields,
    });

    record.hir = hir;
    record.output = generated.code;
    record.map = generated.map.toJSON();
    return { ok: true, code: generated.code, map: generated.map.toJSON(), diagnostics: this.diagnostics, record };
  }

  // Compiles the whole graph reachable from `entry` into `outRoot`, preserving
  // the source-relative layout so ESM imports keep working.
  compileGraph(entry, outRoot, srcRoot = this.root) {
    const layout = (file) => path.join(outRoot, path.relative(srcRoot, file)).replace(/\.pln$/, OUTPUT_EXTENSION);
    const previousOutputFor = this.outputFor;
    this.outputFor = layout;
    const entryRecord = this.load(entry);
    const outputs = [];
    for (const [file, record] of this.modules) {
      if (record.failed || record.declarationOnly) continue;
      const relative = path.relative(srcRoot, file);
      if (relative.startsWith('..')) continue;
      const outFile = layout(file);
      const result = this.compile(file, { outFile });
      if (!result.ok || this.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) continue;
      outputs.push({ outFile, code: result.code, map: result.map });
    }
    // Nothing is written when compilation failed: a stale program on disk is
    // worse than no program at all.
    for (const output of outputs) {
      fs.mkdirSync(path.dirname(output.outFile), { recursive: true });
      const mapName = `${path.basename(output.outFile)}.map`;
      fs.writeFileSync(output.outFile, `${output.code}//# sourceMappingURL=${mapName}\n`);
      fs.writeFileSync(`${output.outFile}.map`, JSON.stringify(output.map));
    }
    // Generated files are ES modules regardless of the surrounding project's
    // module system, so the output directory declares its own type.
    const packageFile = path.join(outRoot, 'package.json');
    if (!isFile(packageFile)) {
      fs.mkdirSync(outRoot, { recursive: true });
      fs.writeFileSync(packageFile, `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
    }

    this.outputFor = previousOutputFor;
    const entryOut = layout(entry);
    return { entryOut, modules: [...this.modules.keys()], diagnostics: this.diagnostics, entryRecord };
  }
}

function findProjectRoot(start) {
  let directory = path.dirname(path.resolve(start));
  while (true) {
    if (isFile(path.join(directory, 'package.json'))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return path.dirname(path.resolve(start));
    directory = parent;
  }
}

function prepareRunDirectory(projectRoot) {
  const runRoot = path.join(projectRoot, '.plainscript', 'run');
  fs.mkdirSync(runRoot, { recursive: true });
  const packageJson = path.join(runRoot, 'package.json');
  fs.writeFileSync(packageJson, `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
  return runRoot;
}

function tempRunRoot(entry) {
  const digest = require('crypto').createHash('sha1').update(path.resolve(entry)).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `plainscript-run-${digest}`);
}

function compileFileOrThrow(source, options = {}) {
  const file = options.file || '<input>';
  const ast = parse(source, file, { dialect: options.dialect || null });
  const checked = checkModule({
    file,
    source,
    program: ast,
    resolveImport: options.resolveImport || (() => null),
  });
  if (checked.diagnostics.length) throw new CompileError(checked.diagnostics);
  const checker = checked.checker;
  const unitVariants = new Set();
  const variantFields = new Map();
  for (const [name, constructor] of checker.variantCtors) {
    if (constructor.kind === 'value') unitVariants.add(name);
    else variantFields.set(name, constructor.type.params.map((parameter) => parameter.name));
  }
  const hir = lowerProgram(ast, { checker, file, unitVariants, variantFields });
  const generated = generate(hir, {
    file,
    outFile: options.outFile || null,
    mapSpecifier: options.mapSpecifier || ((spec) => spec),
    unitVariants,
    variantFields,
  });
  return { ast, hir, code: generated.code, map: generated.map.toJSON(), checker };
}

module.exports = {
  Compiler,
  findProjectRoot,
  prepareRunDirectory,
  tempRunRoot,
  compileFileOrThrow,
  COMPILER_ROOT,
  STDLIB_DIR,
  isFile,
  isDirectory,
  SOURCE_EXTENSION,
  OUTPUT_EXTENSION,
};
