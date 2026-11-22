#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { generateDeclarations } = require('./declarations');

const {
  Compiler,
  findProjectRoot,
  prepareRunDirectory,
  tempRunRoot,
  isFile,
  isDirectory,
} = require('./modules');
const { format } = require('./formatter');
const { DIALECTS, isDialect } = require('./dialect');
const { CompileError, Span, error, formatDiagnostics } = require('./diagnostics');
const { VERSION } = require('./version');

const OUTPUT_EXTENSION = '.js';
const SOURCE_EXTENSION = '.pln';

const HELP = `PlainScript ${VERSION}

Usage: plainscript <command> [options]

Commands
  run [file.pln] [args...]   compile and execute a program (default src/main.pln)
  build [files...]           compile the project to dist/ (--declarations for .d.pln)
  check [files...]           type-check without running
  fmt [files...]             normalise indentation and blank lines
  test [files...]            run *.test.pln files
  new <name> [--template <id>]  scaffold a new project, optionally from a bundled template
                              templates: project-management, ecommerce, realtime-chat,
                              react-vite, next, express, cli, library
  watch [files...]           rebuild the project when a .pln file changes
  ir <file.pln>              print the high-level IR as JSON
  lsp                        start the language server over stdio
  migrate [paths...]         analyse a project and plan an incremental migration
  interop [files...]         translate supported TypeScript .d.ts declarations to .d.pln
  bridge [file.pln]          serve exported functions over JSON-RPC (stdio or HTTP)
  bindings [file.pln]        generate cross-language clients for a module
  dap                        run the PlainScript Debug Adapter Protocol server
  version                    print the compiler version
  help                       show this message

Options
  --quiet       only print errors
  --verbose     print every compilation stage
  --check       with fmt: report unformatted files; with migrate: exit 1 on findings
  --std-base=<url>  browser build: import std modules from <url>/<name>.js
  --declarations    with build: also write <name>.d.pln for every module
  --template=<id>   with new: choose a bundled starter
  --syntax=<v>   compile files without a pragma as syntax <v> (2.0 or 2.1)
  --json        with migrate/interop/bindings: print a machine-readable report
  --http=<port> with bridge: serve JSON-RPC over HTTP instead of stdio
  --host=<host> with bridge: HTTP bind address (default 127.0.0.1)
  --manifest    with bridge: print the module manifest and exit
  --call=<name> with bridge: run one call and print its JSON result
  --args=<json> with --call: argument array (default [])
  --lang=<list> with bindings: comma-separated languages (default: all supported)
  --out=<dir>   with bindings: output directory (default: bindings)
  --write       with migrate: write interop boundaries and converted modules
  --report=<file> with migrate: write the full JSON report to a file
  --help        show this message

Exit codes
  0 success   1 compile or test failure   2 usage error
`;

function parseArguments(argv) {
  const flags = { quiet: false, verbose: false, check: false, help: false, stdBase: null, template: null, declarations: false, json: false, syntax: null, manifest: false, write: false, http: null, host: '127.0.0.1', call: null, args: null, lang: null, out: null, report: null };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--quiet') flags.quiet = true;
    else if (argument === '--verbose') flags.verbose = true;
    else if (argument === '--check') flags.check = true;
    else if (argument === '--declarations') flags.declarations = true;
    else if (argument === '--json') flags.json = true;
    else if (argument === '--manifest') flags.manifest = true;
    else if (argument === '--write') flags.write = true;
    else if (argument.startsWith('--http=')) flags.http = argument.slice('--http='.length);
    else if (argument === '--http') { flags.http = argv[index + 1] || ''; index += 1; }
    else if (argument.startsWith('--host=')) flags.host = argument.slice('--host='.length);
    else if (argument.startsWith('--call=')) flags.call = argument.slice('--call='.length);
    else if (argument === '--call') { flags.call = argv[index + 1] || null; index += 1; }
    else if (argument === '--host') { flags.host = argv[index + 1] || '127.0.0.1'; index += 1; }
    else if (argument === '--args') { flags.args = argv[index + 1] || null; index += 1; }
    else if (argument.startsWith('--args=')) flags.args = argument.slice('--args='.length);
    else if (argument.startsWith('--lang=')) flags.lang = argument.slice('--lang='.length);
    else if (argument === '--lang') { flags.lang = argv[index + 1] || null; index += 1; }
    else if (argument.startsWith('--out=')) flags.out = argument.slice('--out='.length);
    else if (argument === '--out') { flags.out = argv[index + 1] || null; index += 1; }
    else if (argument.startsWith('--report=')) flags.report = argument.slice('--report='.length);
    else if (argument === '--help' || argument === '-h') flags.help = true;
    else if (argument.startsWith('--std-base=')) flags.stdBase = argument.slice('--std-base='.length);
    else if (argument === '--template' || argument === '-t') {
      flags.template = argv[index + 1] || null;
      index += 1;
    } else if (argument.startsWith('--template=')) flags.template = argument.slice('--template='.length);
    else if (argument === '--syntax') {
      flags.syntax = argv[index + 1] || null;
      index += 1;
    } else if (argument.startsWith('--syntax=')) flags.syntax = argument.slice('--syntax='.length);
    else positional.push(argument);
  }
  return { flags, positional };
}

function status(message, flags) {
  if (!flags.quiet) process.stderr.write(`${message}\n`);
}

function sourcesFor(compiler) {
  const sources = new Map();
  for (const record of compiler.modules.values()) {
    sources.set(record.display, record.source);
  }
  for (const [name, exports] of compiler.stdModules) {
    const declaration = path.join(__dirname, '..', 'stdlib', `${name}.d.pln`);
    try {
      sources.set(declaration, fs.readFileSync(declaration, 'utf8'));
    } catch {
      // A missing declaration already produced its own diagnostic.
    }
  }
  return sources;
}

function reportDiagnostics(diagnostics, compiler, flags) {
  if (!diagnostics.length) return false;
  const sources = compiler ? sourcesFor(compiler) : new Map();
  const text = formatDiagnostics(diagnostics, sources);
  process.stderr.write(`${text}\n\n${diagnostics.length} error${diagnostics.length === 1 ? '' : 's'}\n`);
  return true;
}

function loadConfig(root) {
  const configPath = path.join(root, 'plainscript.config.json');
  if (!isFile(configPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const compilerOptions = parsed.compilerOptions || {};
    // `syntax` may be written at the top level or inside compilerOptions;
    // both mean "the project's default dialect".
    const syntax = parsed.syntax !== undefined ? parsed.syntax : compilerOptions.syntax;
    return syntax === undefined
      ? compilerOptions
      : { ...compilerOptions, syntax: String(syntax) };
  } catch (failure) {
    process.stderr.write(`plainscript.config.json is not valid JSON: ${failure.message}\n`);
    return {};
  }
}

// Resolves the dialect for a command: `--syntax` beats the project
// configuration, and a per-file pragma beats both once parsing starts.
function dialectFor(root, flags) {
  if (flags.syntax) {
    if (!isDialect(flags.syntax)) {
      process.stderr.write(`Unsupported syntax "${flags.syntax}". Supported dialects are ${DIALECTS.join(' and ')}.\n`);
      return { value: null, failed: true };
    }
    return { value: String(flags.syntax), failed: false };
  }
  const { syntax } = loadConfig(root);
  if (syntax === undefined) return { value: null, failed: false };
  if (!isDialect(syntax)) {
    process.stderr.write(`plainscript.config.json: unsupported syntax "${syntax}". Supported dialects are ${DIALECTS.join(' and ')}.\n`);
    return { value: null, failed: true };
  }
  return { value: syntax, failed: false };
}

function resolveLayout(root) {
  const config = loadConfig(root);
  const srcRoot = path.resolve(root, config.rootDir || (isDirectory(path.join(root, 'src')) ? 'src' : '.'));
  const outRoot = path.resolve(root, config.outDir || 'dist');
  const exclude = new Set((config.exclude || []).map((entry) => path.resolve(root, entry)));
  return { srcRoot, outRoot, exclude };
}

function discoverSources(directory, outRoot, exclude = new Set()) {
  const results = [];
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (full === outRoot || exclude.has(full)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(SOURCE_EXTENSION) && !entry.name.endsWith('.d.pln')) {
        results.push(full);
      }
    }
  };
  walk(directory);
  return results;
}

async function commandRun(positional, flags) {
  if (!positional.length) {
    const fallback = path.resolve(process.cwd(), 'src', 'main.pln');
    if (!isFile(fallback)) {
      process.stderr.write('plainscript run needs a .pln file (no src/main.pln found).\n');
      return 2;
    }
    positional = ['src/main.pln'];
  }
  const entry = path.resolve(positional[0]);
  if (!isFile(entry)) {
    process.stderr.write(`No such file: ${positional[0]}\n`);
    return 2;
  }

  const projectRoot = findProjectRoot(entry);
  const hasProject = isFile(path.join(projectRoot, 'package.json'));
  let runRoot;
  if (hasProject) {
    runRoot = prepareRunDirectory(projectRoot);
  } else {
    runRoot = tempRunRoot(entry);
    fs.mkdirSync(runRoot, { recursive: true });
    fs.writeFileSync(path.join(runRoot, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
  }

  const runDialect = dialectFor(projectRoot, flags);
  if (runDialect.failed) return 2;
  const compiler = new Compiler({ root: projectRoot, dialect: runDialect.value });
  const started = Date.now();
  const result = compiler.compileGraph(entry, runRoot, projectRoot);
  const failed = reportDiagnostics(compiler.diagnostics, compiler, flags);
  if (failed) return 1;
  if (flags.verbose) status(`compiled ${result.modules.length} module(s) in ${Date.now() - started}ms`, flags);

  const child = spawn(process.execPath, [result.entryOut, ...positional.slice(1)], {
    stdio: 'inherit',
    env: process.env,
  });

  // Forward termination signals to the program. Without this, stopping the CLI
  // (Ctrl+C, `kill <pid>`, a supervisor restart) left the server child running
  // and holding its port.
  const forward = (signal) => {
    try { child.kill(signal); } catch (failure) { /* already gone */ }
  };
  const onInterrupt = () => forward('SIGINT');
  const onTerminate = () => forward('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);

  const code = await new Promise((resolve) => {
    child.on('error', (failure) => {
      process.stderr.write(`Failed to start Node: ${failure.message}\n`);
      resolve(1);
    });
    child.on('close', (status) => resolve(status === null ? 1 : status));
  });

  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onTerminate);
  return code;
}

// A library build should be consumable without extra chores: point the
// package's `types` and `exports["."]` at the declaration and runtime that were
// just written. The entry is the one the manifest already names, the
// conventional index, or the single module nothing else imports. Ambiguous
// builds (several roots) are left alone rather than guessed at.
function wirePackageTypes(root, outRoot, outputs, declarations, imported, flags) {
  if (!declarations.length) return;
  const manifestPath = path.join(root, 'package.json');
  if (!isFile(manifestPath)) return;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (failure) {
    return;
  }

  const declarationFor = new Map();
  for (const output of outputs) {
    const declaration = declarations.find((entry) => entry.file === output.outFile.replace(/\.js$/, '.d.pln'));
    if (declaration) declarationFor.set(output.outFile, declaration.file);
  }
  if (!declarationFor.size) return;

  const relative = (file) => `./${path.relative(root, file).split(path.sep).join('/')}`;

  let entryOutput = null;
  const exportsEntry = manifest.exports && typeof manifest.exports === 'object' ? manifest.exports['.'] : null;
  const declaredMain = typeof exportsEntry === 'string'
    ? exportsEntry
    : (exportsEntry && typeof exportsEntry === 'object' ? exportsEntry.import || exportsEntry.default : null)
      || (typeof manifest.main === 'string' ? manifest.main : null);
  if (declaredMain) {
    const candidate = path.resolve(root, declaredMain);
    if (declarationFor.has(candidate)) entryOutput = candidate;
  }
  if (!entryOutput && declarationFor.has(path.join(outRoot, 'index.js'))) {
    entryOutput = path.join(outRoot, 'index.js');
  }
  if (!entryOutput) {
    const roots = outputs.filter((output) => !imported.has(output.file));
    if (roots.length === 1) entryOutput = roots[0].outFile;
  }
  if (!entryOutput) return;

  const typesPath = relative(declarationFor.get(entryOutput));
  const runtimePath = relative(entryOutput);
  manifest.types = typesPath;

  if (!manifest.exports || typeof manifest.exports !== 'object') {
    manifest.exports = { '.': { types: typesPath, import: runtimePath } };
  } else {
    const current = manifest.exports['.'];
    const base = typeof current === 'string'
      ? { import: current }
      : (current && typeof current === 'object' ? { ...current } : {});
    const next = { '.': { ...base, types: typesPath, import: typeof base.import === 'string' ? base.import : runtimePath } };
    for (const [key, value] of Object.entries(manifest.exports)) {
      if (key !== '.') next[key] = value;
    }
    manifest.exports = next;
  }

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  status(`  package.json: types -> ${typesPath}`, flags);
}

function commandBuild(positional, flags, options = {}) {
  const root = process.cwd();
  const { srcRoot, outRoot, exclude } = resolveLayout(root);
  const files = positional.length
    ? positional.map((entry) => path.resolve(root, entry))
    : discoverSources(srcRoot, outRoot, exclude);

  if (!files.length) {
    process.stderr.write(`No PlainScript sources found under ${path.relative(root, srcRoot) || '.'}.\n`);
    return 1;
  }

  const outputFor = (file) => {
    const relative = path.relative(srcRoot, file);
    if (relative.startsWith('..')) return file.replace(/\.pln$/, OUTPUT_EXTENSION);
    return path.join(outRoot, relative).replace(/\.pln$/, OUTPUT_EXTENSION);
  };

  const buildDialect = dialectFor(root, flags);
  if (buildDialect.failed) return 2;
  const compiler = options.compiler || new Compiler({ root, outputFor, stdBase: flags.stdBase, dialect: buildDialect.value });
  compiler.diagnostics.length = 0;
  const outputs = [];
  for (const file of files) {
    const outFile = outputFor(file);
    const result = compiler.compile(file, { outFile });
    if (result.ok) outputs.push({ file, outFile, code: result.code, map: result.map });
  }

  const failed = reportDiagnostics(compiler.diagnostics, compiler, flags);
  // Compilation failures must not leave a partially built project behind.
  if (failed) return 1;

  const declarations = [];
  if (flags.declarations) {
    for (const output of outputs) {
      const record = compiler.modules.get(output.file);
      const text = generateDeclarations(record);
      if (text === null) continue;
      declarations.push({ file: output.outFile.replace(/\.js$/, '.d.pln'), text });
    }
  }

  let written = 0;
  let unchanged = 0;
  for (const output of outputs) {
    fs.mkdirSync(path.dirname(output.outFile), { recursive: true });
    const mapName = `${path.basename(output.outFile)}.map`;
    const code = `${output.code}//# sourceMappingURL=${mapName}\n`;
    const map = JSON.stringify(output.map);
    if (isFile(output.outFile) && isFile(`${output.outFile}.map`)
      && fs.readFileSync(output.outFile, 'utf8') === code
      && fs.readFileSync(`${output.outFile}.map`, 'utf8') === map) {
      unchanged += 1;
      continue;
    }
    fs.writeFileSync(output.outFile, code);
    fs.writeFileSync(`${output.outFile}.map`, map);
    written += 1;
    status(`  ${path.relative(root, output.file)} -> ${path.relative(root, output.outFile)}`, flags);
  }
  for (const declaration of declarations) {
    fs.mkdirSync(path.dirname(declaration.file), { recursive: true });
    fs.writeFileSync(declaration.file, declaration.text);
    status(`  declarations -> ${path.relative(root, declaration.file)}`, flags);
  }

  // Emitted files are ES modules. Nested package.json keeps them loadable even
  // when the surrounding project is CommonJS.
  const projectPackage = path.join(root, 'package.json');
  let projectType = null;
  if (isFile(projectPackage)) {
    try {
      projectType = JSON.parse(fs.readFileSync(projectPackage, 'utf8')).type || null;
    } catch {
      projectType = null;
    }
  }
  if (projectType !== 'module') {
    fs.mkdirSync(outRoot, { recursive: true });
    fs.writeFileSync(path.join(outRoot, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
  }

  if (declarations.length) {
    const imported = new Set();
    for (const record of compiler.modules.values()) {
      for (const resolved of record.resolutions.values()) {
        if (resolved.kind === 'local') imported.add(resolved.path);
      }
    }
    wirePackageTypes(root, outRoot, outputs, declarations, imported, flags);
  }

  status(`built ${written} file(s) into ${path.relative(root, outRoot) || '.'}${unchanged ? ` (${unchanged} unchanged)` : ''}${declarations.length ? ` (+${declarations.length} declaration file(s))` : ''}`, flags);
  return 0;
}

function commandWatch(positional, flags) {
  const root = process.cwd();
  const { srcRoot, outRoot, exclude } = resolveLayout(root);
  const outputFor = (file) => {
    const relative = path.relative(srcRoot, file);
    if (relative.startsWith('..')) return file.replace(/\.pln$/, OUTPUT_EXTENSION);
    return path.join(outRoot, relative).replace(/\.pln$/, OUTPUT_EXTENSION);
  };
  const watchDialect = dialectFor(root, flags);
  if (watchDialect.failed) return 2;
  const compiler = new Compiler({ root, outputFor, stdBase: flags.stdBase, dialect: watchDialect.value });
  let changed = null;
  let timer = null;
  let building = false;
  let pending = false;

  const rebuild = () => {
    if (building) { pending = true; return; }
    building = true;
    const started = Date.now();
    if (changed) compiler.invalidate(changed);
    commandBuild(positional, { ...flags, quiet: false }, { compiler });
    building = false;
    status(`rebuilt in ${Date.now() - started}ms`, flags);
    if (pending) { pending = false; schedule(); }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(rebuild, 80);
  };

  rebuild();
  let watcher;
  try {
    watcher = fs.watch(srcRoot, { recursive: true }, (event, filename) => {
      if (!filename || !String(filename).endsWith(SOURCE_EXTENSION)) return;
      changed = path.resolve(srcRoot, String(filename));
      schedule();
    });
  } catch (failure) {
    process.stderr.write(`Cannot watch ${srcRoot}: ${failure.message}\n`);
    return 1;
  }
  watcher.on('error', (failure) => process.stderr.write(`watch error: ${failure.message}\n`));
  const close = () => { try { watcher.close(); } catch { /* already closed */ } process.exit(0); };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  status(`watching ${path.relative(root, srcRoot) || '.'} for .pln changes`, flags);
  return 0;
}

function commandCheck(positional, flags) {
  const root = process.cwd();
  const { srcRoot, outRoot, exclude } = resolveLayout(root);
  const files = positional.length
    ? positional.map((entry) => path.resolve(root, entry))
    : discoverSources(srcRoot, outRoot, exclude);

  if (!files.length) {
    process.stderr.write('No PlainScript sources to check.\n');
    return 1;
  }

  const checkDialect = dialectFor(root, flags);
  if (checkDialect.failed) return 2;
  const compiler = new Compiler({ root, dialect: checkDialect.value });
  for (const file of files) compiler.load(file);
  const failed = reportDiagnostics(compiler.diagnostics, compiler, flags);
  if (failed) return 1;
  for (const file of files) {
    if (!flags.quiet) process.stderr.write(`ok ${path.relative(root, file)}\n`);
  }
  status(`checked ${files.length} file(s)`, flags);
  return 0;
}

function commandFormat(positional, flags) {
  const root = process.cwd();
  const { srcRoot, outRoot, exclude } = resolveLayout(root);
  const files = positional.length
    ? positional.map((entry) => path.resolve(root, entry))
    : discoverSources(srcRoot, outRoot, exclude);

  const formatDialect = dialectFor(root, flags);
  if (formatDialect.failed) return 2;
  const formatOptions = { dialect: formatDialect.value };

  let changed = 0;
  let unformatted = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    let formatted;
    try {
      formatted = format(source, path.relative(root, file), formatOptions);
    } catch (failure) {
      if (failure instanceof CompileError) {
        process.stderr.write(`${formatDiagnostics(failure.diagnostics, new Map([[path.relative(root, file), source]]))}\n`);
      } else {
        process.stderr.write(`${file}: ${failure.message}\n`);
      }
      return 1;
    }
    if (formatted === source) continue;
    if (flags.check) {
      unformatted += 1;
      process.stderr.write(`not formatted: ${path.relative(root, file)}\n`);
    } else {
      fs.writeFileSync(file, formatted);
      changed += 1;
      status(`formatted ${path.relative(root, file)}`, flags);
    }
  }
  if (flags.check) return unformatted ? 1 : 0;
  status(`formatted ${changed} file(s)`, flags);
  return 0;
}

function discoverTests(root) {
  const results = [];
  const roots = [path.join(root, 'tests'), path.join(root, 'test'), path.join(root, 'src')];
  for (const directory of roots) {
    if (!isDirectory(directory)) continue;
    results.push(...discoverSources(directory, path.join(root, 'dist')).filter((file) =>
      file.endsWith('.test.pln') || file.endsWith('.spec.pln')));
  }
  return [...new Set(results)].sort();
}

async function commandTest(positional, flags) {
  const root = process.cwd();
  const files = positional.length
    ? positional.map((entry) => path.resolve(root, entry))
    : discoverTests(root);
  if (!files.length) {
    process.stderr.write('No *.test.pln files found.\n');
    return 1;
  }

  let failed = 0;
  for (const file of files) {
    status(`running ${path.relative(root, file)}`, flags);
    const code = await commandRun([file], flags);
    if (code !== 0) failed += 1;
  }
  if (failed) {
    process.stderr.write(`${failed} test file(s) failed\n`);
    return 1;
  }
  return 0;
}

const TEMPLATES_ROOT = path.join(__dirname, '..', 'templates');

function availableTemplates() {
  try {
    return fs.readdirSync(TEMPLATES_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (failure) {
    return [];
  }
}

// Copies a bundled template, leaving out directories that are build output or
// dependency state rather than template content.
function copyTemplate(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.plainscript' || entry.name === 'dist') continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTemplate(source, target);
    else fs.copyFileSync(source, target);
  }
}

const MIGRATION_SCAN_CHECKS = [
  { code: 'COMMONJS_REQUIRE', pattern: /\brequire\s*\(/, message: 'CommonJS require() must be replaced with an ES import.' },
  { code: 'COMMONJS_EXPORT', pattern: /\bmodule\.exports\b|\bexports\.[A-Za-z_$]/, message: 'CommonJS exports must be replaced with export declarations.' },
  { code: 'TS_INTERFACE', pattern: /\binterface\s+[A-Za-z_]/, message: 'TypeScript interfaces need a PlainScript type declaration.' },
  { code: 'TS_ENUM', pattern: /\benum\s+[A-Za-z_]/, message: 'TypeScript enums should become a PlainScript variant or literal union.' },
  { code: 'TS_NAMESPACE', pattern: /\bnamespace\s+[A-Za-z_]/, message: 'TypeScript namespaces are not part of PlainScript; use modules.' },
  { code: 'CLASS_SYNTAX', pattern: /\bclass\s+[A-Za-z_]/, message: 'Classes are JavaScript-boundary values; move the class into a .js module or rewrite it as records and functions.' },
  { code: 'JSX_SYNTAX', pattern: /<\/?[A-Z][A-Za-z0-9]*(?:\s|>)/, message: 'JSX syntax compiles natively in PlainScript, or can stay in a JavaScript/JSX module behind a boundary.' },
  { code: 'JS_COMMENT', pattern: /^\s*\/\//, message: 'PlainScript comments start with #.' },
];

function migrationScanFindings(project, root) {
  const findings = [];
  for (const item of project.files) {
    let source;
    try { source = fs.readFileSync(path.join(root, item.path), 'utf8'); } catch { continue; }
    source.split('\n').forEach((line, index) => {
      for (const check of MIGRATION_SCAN_CHECKS) {
        if (!check.pattern.test(line)) continue;
        findings.push({ file: item.path, line: index + 1, code: check.code, message: check.message });
      }
    });
    if (/\.(?:jsx|tsx)$/.test(item.path)) {
      findings.push({ file: item.path, line: 1, code: 'JSX_FILE', message: 'JSX/TSX files can stay in React tooling or migrate to PlainScript JSX with a generated boundary.' });
    }
  }
  return findings;
}

function commandMigrate(positional, flags = {}) {
  const {
    analyseProject,
    boundaryPlan,
    convertJavaScript,
    writeBoundaries,
    writeConverted,
    reportMarkdown,
  } = require('./migrate');
  const root = path.resolve(positional[0] || '.');
  let stat;
  try { stat = fs.statSync(root); } catch { stat = null; }
  if (!stat || !stat.isDirectory()) {
    process.stderr.write(`Migration target is not a directory: ${root}\n`);
    return 2;
  }

  const project = analyseProject(root);
  const findings = migrationScanFindings(project, root);
  const boundaries = [];
  const conversions = [];
  const failures = [];

  for (const item of project.files) {
    if (item.strategy === 'interop-boundary') {
      const boundary = boundaryPlan(project, item);
      if (boundary) boundaries.push(boundary);
      else failures.push({ path: item.path, diagnostics: [{ code: 'NO_EXPORTS', message: 'No exported names detected, so no boundary was generated.' }] });
      continue;
    }
    if (item.strategy === 'auto-convert') {
      let source;
      try { source = fs.readFileSync(path.join(root, item.path), 'utf8'); } catch { continue; }
      const result = convertJavaScript(source, item.path);
      if (result.ok) conversions.push({ path: item.path, code: result.code });
      else failures.push({ path: item.path, diagnostics: result.diagnostics });
      continue;
    }
    if (item.strategy === 'manual') {
      failures.push({
        path: item.path,
        diagnostics: [{
          code: 'MANUAL_REVIEW',
          message: `${item.language} modules are not source-converted. Keep the native module and connect it through a JSON-RPC bridge or generated bindings.`,
        }],
      });
    }
  }

  let written = null;
  if (flags.write) {
    written = {
      boundaries: writeBoundaries(project, boundaries),
      conversions: writeConverted(project, conversions),
    };
  }

  if (flags.report) {
    const reportPath = path.resolve(flags.report);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify({
      project,
      boundaries: boundaries.map((boundary) => ({
        source: boundary.path,
        declaration: boundary.declarationPath,
        wrapper: boundary.wrapperPath,
        names: boundary.names,
      })),
      conversions: conversions.map((conversion) => conversion.path),
      failures,
      written,
    }, null, 2)}\n`);
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({
      root,
      files: project.summary.files,
      findings,
      summary: project.summary,
      stack: project.stack,
      phases: project.phases,
      boundaries: boundaries.map((boundary) => ({ source: boundary.path, declaration: boundary.declarationPath, wrapper: boundary.wrapperPath })),
      conversions: conversions.map((conversion) => conversion.path),
      failures,
      written,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`${reportMarkdown(project, { explain: true })}\n\n`);
    process.stdout.write('## Migration findings\n\n');
    if (findings.length) {
      for (const finding of findings) {
        process.stdout.write(`${finding.file}:${finding.line}: ${finding.code}: ${finding.message}\n`);
      }
    } else {
      process.stdout.write('No mechanical migration blockers found.\n');
    }
    process.stdout.write('\n');
    process.stdout.write(`Safe conversions: ${conversions.length}   Interop boundaries: ${boundaries.length}   Unresolved: ${failures.length}\n`);
    if (flags.write && written) {
      process.stdout.write(`Wrote ${written.conversions.length} converted module(s) and ${written.boundaries.length} boundary pair(s).\n`);
    } else if (conversions.length || boundaries.length) {
      process.stdout.write('Re-run with --write to generate converted modules and interop boundaries.\n');
    }
  }

  if (flags.check && (findings.length || failures.length || project.summary.manual)) return 1;
  return 0;
}

function findDeclarationFiles(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '.plainscript') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) findDeclarationFiles(full, output);
    else if (entry.isFile() && entry.name.endsWith('.d.ts')) output.push(full);
  }
  return output;
}

function commandInterop(positional, flags = {}) {
  const { translateFile } = require('./typescript-declarations');
  const { formatDiagnostic } = require('./diagnostics');
  const initial = positional.length ? positional.map((file) => path.resolve(file)) : findDeclarationFiles(process.cwd());
  const queue = [...initial];
  const seen = new Set();
  let written = 0;
  let errors = 0;
  const reports = [];
  while (queue.length) {
    const file = queue.shift();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    if (!isFile(file)) {
      process.stderr.write(`No such declaration file: ${file}\n`);
      errors += 1;
      continue;
    }
    const result = translateFile(file);
    const output = file.replace(/\.d\.ts$/, '.d.pln').replace(/\.ts$/, '.d.pln');
    const fileErrors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    errors += fileErrors.length;
    reports.push({ file: path.relative(process.cwd(), file), output: path.relative(process.cwd(), output), diagnostics: result.diagnostics });
    if (!fileErrors.length) {
      fs.writeFileSync(output, result.code);
      written += 1;
    }
    for (const diagnostic of result.diagnostics) {
      process.stderr.write(`${formatDiagnostic(diagnostic, fs.readFileSync(file, 'utf8'))}\n`);
    }
    for (const imported of result.imports) {
      if (!imported.spec.startsWith('.')) continue;
      const base = path.resolve(path.dirname(file), imported.normalized);
      for (const candidate of [`${base}.d.ts`, path.join(base, 'index.d.ts')]) {
        if (isFile(candidate)) { queue.push(candidate); break; }
      }
    }
  }
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ written, errors, files: reports }, null, 2)}\n`);
  } else {
    process.stdout.write(`TypeScript declaration interop: ${written} file(s) written, ${errors} error(s).\n`);
  }
  return errors ? 1 : 0;
}

function bridgeEntryFor(positional) {
  const candidate = positional.length ? path.resolve(positional[0]) : path.resolve(process.cwd(), 'src', 'main.pln');
  return candidate;
}

async function commandBridge(positional, flags = {}) {
  const { loadBridgeModule, createHandler, serveStdio, serveHttp } = require('./interop/bridge');
  const entry = bridgeEntryFor(positional);
  if (!isFile(entry)) {
    process.stderr.write(`No such PlainScript entry: ${entry}\n`);
    return 2;
  }
  const root = findProjectRoot(entry);
  let loaded;
  try {
    loaded = await loadBridgeModule(entry, { root });
  } catch (failure) {
    process.stderr.write(`${failure.message}\n`);
    return 1;
  }
  const handle = createHandler({ module: loaded.module, manifest: loaded.manifest, debug: Boolean(flags.verbose) });

  if (flags.manifest) {
    process.stdout.write(`${JSON.stringify(loaded.manifest, null, 2)}\n`);
    return 0;
  }

  if (flags.call) {
    let args;
    try {
      args = flags.args ? JSON.parse(flags.args) : [];
    } catch (failure) {
      process.stderr.write(`--args must be a JSON array: ${failure.message}\n`);
      return 2;
    }
    const response = await handle({ jsonrpc: '2.0', id: 1, method: flags.call, params: args });
    if (response && response.error) {
      process.stderr.write(`${response.error.message}\n`);
      return 1;
    }
    process.stdout.write(`${JSON.stringify(response ? response.result : null)}\n`);
    return 0;
  }

  if (flags.http !== null && flags.http !== undefined) {
    const port = Number(flags.http);
    if (!Number.isInteger(port) || port < 0) {
      process.stderr.write(`--http expects a port number, found "${flags.http}".\n`);
      return 2;
    }
    const server = await serveHttp(handle, { manifest: loaded.manifest, port, host: flags.host });
    status(`PlainScript bridge for ${path.relative(root, entry)} listening on ${server.url}`, flags);
    await new Promise((resolve) => {
      const shutdown = () => server.server.close(() => resolve());
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
    return 0;
  }

  status(`PlainScript bridge for ${path.relative(root, entry)} ready on stdio (${loaded.manifest.functions.length} function(s))`, flags);
  serveStdio(handle, { onClose: () => process.exit(0) });
  return new Promise(() => {});
}

async function commandBindings(positional, flags = {}) {
  const { loadBridgeModule } = require('./interop/bridge');
  const { generateBindings, SUPPORTED } = require('./interop/bindings');
  const entry = bridgeEntryFor(positional);
  if (!isFile(entry)) {
    process.stderr.write(`No such PlainScript entry: ${entry}\n`);
    return 2;
  }
  const root = findProjectRoot(entry);
  let loaded;
  try {
    loaded = await loadBridgeModule(entry, { root });
  } catch (failure) {
    process.stderr.write(`${failure.message}\n`);
    return 1;
  }
  const requested = flags.lang && flags.lang !== 'all' ? flags.lang.split(',').map((item) => item.trim()).filter(Boolean) : SUPPORTED;
  let files;
  try {
    files = generateBindings(loaded.manifest, requested, entry);
  } catch (failure) {
    process.stderr.write(`${failure.message}\n`);
    return 2;
  }
  const directory = path.resolve(flags.out || 'bindings');
  fs.mkdirSync(directory, { recursive: true });
  const written = [];
  for (const file of files) {
    const target = path.join(directory, file.name);
    fs.writeFileSync(target, file.code);
    written.push({ language: file.language, file: path.relative(process.cwd(), target) });
  }
  fs.writeFileSync(path.join(directory, 'plainscript.manifest.json'), `${JSON.stringify(loaded.manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(directory, 'README.md'), bindingsReadme(loaded.manifest, files, entry));
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ module: loaded.manifest.module, directory, files: written }, null, 2)}\n`);
  } else {
    process.stdout.write(`Interop bindings for ${loaded.manifest.module} (${loaded.manifest.functions.length} function(s)):\n`);
    for (const file of written) process.stdout.write(`  ${file.language.padEnd(11)} ${file.file}\n`);
    process.stdout.write(`Manifest and protocol notes written to ${path.relative(process.cwd(), directory)}/.\n`);
  }
  return 0;
}

function bindingsReadme(manifest, files, entry) {
  const lines = [
    `# ${manifest.module} — cross-language bindings`,
    '',
    `Generated by PlainScript ${manifest.version} for ${manifest.functions.length} exported function(s).`,
    '',
    'Every client speaks newline-delimited JSON-RPC 2.0 to:',
    '',
    '```',
    `plainscript bridge ${entry}`,
    '```',
    '',
    'or the same messages over HTTP with `--http=<port>` (`POST /rpc`, `GET /manifest`, `GET /health`).',
    '',
    '## Files',
    '',
  ];
  for (const file of files) lines.push(`- \`${file.name}\` — ${file.language}`);
  lines.push(
    '',
    '## Runtime status',
    '',
    'The Python and JavaScript clients are exercised end-to-end by the PlainScript test suite.',
    'Go and Rust clients use only their standard JSON facilities plus serde_json (Rust). Java,',
    'Kotlin, Swift and Dart clients target the HTTP bridge; C# uses the bundled System.Text.Json.',
    'The C/C++ client is a POSIX one-shot helper built on popen(3). The remaining clients are',
    'generated from the same manifest and should be compiled with their own toolchain before use.',
    '',
    '## Protocol',
    '',
    'Request:  `{"jsonrpc":"2.0","id":1,"method":"name","params":[...]}`',
    '',
    'Response: `{"jsonrpc":"2.0","id":1,"result":...}` or `{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"..."}}`',
    '',
    'The `__manifest` method returns this module\'s manifest; `__ping` is a health check.',
    '',
  );
  return lines.join('\n');
}

function commandNew(positional, flags = {}) {
  if (!positional.length) {
    process.stderr.write('plainscript new needs a project name.\n');
    return 2;
  }
  const name = positional[0].replace(/[^A-Za-z0-9._-]/g, '-');
  const directory = path.resolve(process.cwd(), name);
  if (fs.existsSync(directory) && fs.readdirSync(directory).length) {
    process.stderr.write(`${name} already exists and is not empty.\n`);
    return 2;
  }

  if (flags.template) {
    const templates = availableTemplates();
    if (!templates.includes(flags.template)) {
      process.stderr.write(`Unknown template "${flags.template}". Available: ${templates.join(', ') || '(none)'}.\n`);
      return 2;
    }
    copyTemplate(path.join(TEMPLATES_ROOT, flags.template), directory);
    const manifestPath = path.join(directory, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.name = name;
    manifest.private = true;
    manifest.devDependencies = { ...(manifest.devDependencies || {}), 'plainscript-lang': `^${VERSION}` };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(directory, '.gitignore'), 'node_modules/\ndist/\n.plainscript/\n');
    process.stdout.write(`Created ${name} from template "${flags.template}".\n\n  cd ${name}\n  npm install\n  npm start\n`);
    return 0;
  }

  fs.mkdirSync(path.join(directory, 'src'), { recursive: true });

  const packageJson = {
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      build: 'plainscript build',
      start: 'plainscript run src/app.pln',
      check: 'plainscript check',
      test: 'plainscript test',
    },
    devDependencies: { 'plainscript-lang': `^${VERSION}` },
  };
  fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  fs.writeFileSync(path.join(directory, '.gitignore'), 'node_modules/\ndist/\n.plainscript/\n');
  // The config sets the project dialect once, so every file compiles as 2.1
  // without a pragma; an individual file can still opt back out.
  fs.writeFileSync(
    path.join(directory, 'plainscript.config.json'),
    `${JSON.stringify({ compilerOptions: { rootDir: 'src', outDir: 'dist', syntax: '2.1' } }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(directory, 'src', 'app.pln'), `
import { print } from "std/io"
import { upper } from "std/text"

define greet(name: text) returns text
    return "Hello, {name}!"
end

print(greet(upper("world")))
`);
  process.stdout.write(`Created ${name}.\n\n  cd ${name}\n  npm install\n  npm start\n`);
  return 0;
}

function commandLsp() {
  const { PlainScriptLanguageServer } = require('./lsp');
  new PlainScriptLanguageServer(process.stdin, process.stdout, process.cwd()).start();
  return 0;
}

function commandDap() {
  const { startDebugAdapter } = require('./dap');
  startDebugAdapter();
  return 0;
}

function commandIr(positional, flags) {
  if (!positional.length) {
    process.stderr.write('plainscript ir needs a .pln file.\n');
    return 2;
  }
  const entry = path.resolve(positional[0]);
  if (!isFile(entry)) {
    process.stderr.write(`No such file: ${positional[0]}\n`);
    return 2;
  }
  const root = findProjectRoot(entry);
  const irDialect = dialectFor(root, flags);
  if (irDialect.failed) return 2;
  const compiler = new Compiler({ root, dialect: irDialect.value });
  const record = compiler.load(entry);
  if (reportDiagnostics(compiler.diagnostics, compiler, flags) || !record.check) return 1;

  const checker = record.check.checker;
  const unitVariants = new Set();
  const variantFields = new Map();
  for (const [name, constructor] of checker.variantCtors) {
    if (constructor.kind === 'value') unitVariants.add(name);
    else variantFields.set(name, constructor.type.params.map((parameter) => parameter.name));
  }
  const { lowerProgram } = require('./hir');
  const hir = lowerProgram(record.ast, { checker, file: record.display, unitVariants, variantFields });
  process.stdout.write(`${JSON.stringify(hir, null, 2)}\n`);
  return 0;
}

function main(argv) {
  const { flags, positional } = parseArguments(argv);
  const command = positional.shift();

  if (flags.help || !command || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  const commands = {
    run: commandRun,
    build: commandBuild,
    check: commandCheck,
    watch: commandWatch,
    fmt: commandFormat,
    format: commandFormat,
    test: commandTest,
    ir: commandIr,
    lsp: commandLsp,
    dap: commandDap,
    migrate: commandMigrate,
    interop: commandInterop,
    bridge: commandBridge,
    bindings: commandBindings,
    new: commandNew,
    version: () => { process.stdout.write(`${VERSION}\n`); return 0; },
  };

  const handler = commands[command];
  if (!handler) {
    process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
    return 2;
  }
  return handler(positional, flags);
}

Promise.resolve(main(process.argv.slice(2))).then((code) => {
  process.exitCode = typeof code === 'number' ? code : 0;
}).catch((failure) => {
  process.stderr.write(`${failure && failure.stack ? failure.stack : failure}\n`);
  process.exitCode = 1;
});
