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
                              templates: project-management, ecommerce, realtime-chat
  ir <file.pln>              print the high-level IR as JSON
  version                    print the compiler version
  help                       show this message

Options
  --quiet       only print errors
  --verbose     print every compilation stage
  --check       with fmt: report unformatted files instead of writing
  --std-base=<url>  browser build: import std modules from <url>/<name>.js
  --declarations    with build: also write <name>.d.pln for every module
  --help        show this message

Exit codes
  0 success   1 compile or test failure   2 usage error
`;

function parseArguments(argv) {
  const flags = { quiet: false, verbose: false, check: false, help: false, stdBase: null, template: null, declarations: false };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--quiet') flags.quiet = true;
    else if (argument === '--verbose') flags.verbose = true;
    else if (argument === '--check') flags.check = true;
    else if (argument === '--declarations') flags.declarations = true;
    else if (argument === '--help' || argument === '-h') flags.help = true;
    else if (argument.startsWith('--std-base=')) flags.stdBase = argument.slice('--std-base='.length);
    else if (argument === '--template' || argument === '-t') {
      flags.template = argv[index + 1] || null;
      index += 1;
    } else if (argument.startsWith('--template=')) flags.template = argument.slice('--template='.length);
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
    return parsed.compilerOptions || {};
  } catch (failure) {
    process.stderr.write(`plainscript.config.json is not valid JSON: ${failure.message}\n`);
    return {};
  }
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

  const compiler = new Compiler({ root: projectRoot });
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

function commandBuild(positional, flags) {
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

  const compiler = new Compiler({ root, outputFor, stdBase: flags.stdBase });
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
  for (const output of outputs) {
    fs.mkdirSync(path.dirname(output.outFile), { recursive: true });
    const mapName = `${path.basename(output.outFile)}.map`;
    fs.writeFileSync(output.outFile, `${output.code}//# sourceMappingURL=${mapName}\n`);
    fs.writeFileSync(`${output.outFile}.map`, JSON.stringify(output.map));
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

  status(`built ${written} file(s) into ${path.relative(root, outRoot) || '.'}${declarations.length ? ` (+${declarations.length} declaration file(s))` : ''}`, flags);
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

  const compiler = new Compiler({ root });
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

  let changed = 0;
  let unformatted = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    let formatted;
    try {
      formatted = format(source, path.relative(root, file));
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
  fs.writeFileSync(path.join(directory, 'src', 'app.pln'), `import { print } from "std/io"
import { upper } from "std/text"

function greet(name: text) -> text
    return "Hello, {name}!"
end

print(greet(upper("world")))
`);
  process.stdout.write(`Created ${name}.\n\n  cd ${name}\n  npm install\n  npm start\n`);
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
  const compiler = new Compiler({ root });
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
    fmt: commandFormat,
    format: commandFormat,
    test: commandTest,
    ir: commandIr,
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
