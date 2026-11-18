#!/usr/bin/env node
'use strict';

// Reproducible PlainScript compiler benchmark. This measures this repository's
// compiler on a synthetic module graph; it does not claim to be a TypeScript
// benchmark. A TypeScript comparison would need the same fixture compiled by a
// pinned TypeScript version installed in the project, which is intentionally
// not a runtime dependency of this repository.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Compiler } = require('../src/modules');

const modules = Number(process.argv[2] || 40);
const iterations = Number(process.argv[3] || 7);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-bench-'));
const src = path.join(directory, 'src');
const out = path.join(directory, 'dist');
fs.mkdirSync(src, { recursive: true });

const imports = [];
const values = [];
for (let index = 0; index < modules; index += 1) {
  const file = path.join(src, `module${index}.pln`);
  fs.writeFileSync(file, `export function value${index}(input: number) -> number\n    return input + ${index}\nend\n`);
  imports.push(`import { value${index} } from "./module${index}"`);
  values.push(`value${index}(1)`);
}
fs.writeFileSync(path.join(src, 'main.pln'), `${imports.join('\n')}\nimport { print } from "std/io"\nprint("${values.join(' + ')}")\n`);
const entry = path.join(src, 'main.pln');

function time(work) {
  const started = process.hrtime.bigint();
  const result = work();
  return { ms: Number(process.hrtime.bigint() - started) / 1e6, result };
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

const cold = [];
for (let iteration = 0; iteration < iterations; iteration += 1) {
  const compiler = new Compiler({ root: directory });
  const measured = time(() => compiler.compileGraph(entry, path.join(out, `run${iteration}`), src));
  if (compiler.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    process.stderr.write(`${compiler.diagnostics.map((diagnostic) => diagnostic.message).join('\n')}\n`);
    process.exit(1);
  }
  cold.push(measured.ms);
}

const compiler = new Compiler({ root: directory });
const check = time(() => compiler.load(entry));
const modulesLoaded = compiler.modules.size;
fs.rmSync(directory, { recursive: true, force: true });

const report = {
  language: 'PlainScript',
  compilerVersion: require('../package.json').version,
  fixture: { sourceModules: modules, generatedModules: modulesLoaded },
  iterations,
  coldCompileMs: {
    min: Number(Math.min(...cold).toFixed(2)),
    median: Number(median(cold).toFixed(2)),
    max: Number(Math.max(...cold).toFixed(2)),
  },
  typecheckMs: Number(check.ms.toFixed(2)),
  notes: 'Synthetic independent modules; a TypeScript baseline is not installed in this repository.',
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
