'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { Compiler } = require('../src/modules');
const { parse } = require('../src/parser');
const { checkModule } = require('../src/checker');
const { CompileError } = require('../src/diagnostics');
const { resolveJsxOptions } = require('../src/jsx');

const ROOT = path.resolve(__dirname, '..');
const SANDBOX = path.join(ROOT, '.plainscript', 'tests');
let counter = 0;

function sandbox() {
  fs.mkdirSync(SANDBOX, { recursive: true });
  counter += 1;
  const directory = fs.mkdtempSync(path.join(SANDBOX, 'case-'));
  return directory;
}

function writeFiles(directory, files) {
  for (const [name, source] of Object.entries(files)) {
    const target = path.join(directory, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  }
}

// Compiles a project inside the compiler's own tree, which keeps standard
// library imports resolvable without an npm install.
function compileProject(files, entry = 'main.pln', options = {}) {
  const directory = sandbox();
  writeFiles(directory, files);
  const compiler = new Compiler({ root: ROOT, dialect: options.dialect || null });
  const outRoot = path.join(directory, 'out');
  const result = compiler.compileGraph(path.join(directory, entry), outRoot, directory);
  return { directory, compiler, result, outRoot, entryOut: result.entryOut };
}

function runProject(files, entry = 'main.pln', args = [], options = {}) {
  const project = compileProject(files, entry, options);
  const child = spawnSync(process.execPath, [project.entryOut, ...args], {
    cwd: project.directory,
    encoding: 'utf8',
    env: { ...process.env, PLAINSCRIPT_TEST: '1' },
  });
  return {
    ...project,
    stdout: child.stdout,
    stderr: child.stderr,
    status: child.status,
    diagnostics: project.compiler.diagnostics,
  };
}

function runSource(source, args = [], options = {}) {
  return runProject({ 'main.pln': source }, 'main.pln', args, options);
}

function diagnosticsOf(source, options = {}) {
  const { file = 'test.pln' } = options;
  try {
    const ast = parse(source, file);
    const checked = checkModule({ file, source, program: ast, resolveImport: () => null, jsx: resolveJsxOptions(source, options.jsx || {}) });
    return checked.diagnostics;
  } catch (failure) {
    if (failure instanceof CompileError) return failure.diagnostics;
    throw failure;
  }
}

function codesOf(source) {
  return diagnosticsOf(source).map((diagnostic) => diagnostic.code);
}

module.exports = {
  ROOT,
  sandbox,
  writeFiles,
  compileProject,
  runProject,
  runSource,
  diagnosticsOf,
  codesOf,
};
