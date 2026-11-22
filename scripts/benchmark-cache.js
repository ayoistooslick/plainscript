#!/usr/bin/env node
'use strict';

// Measures the persistent build cache on the same synthetic project used by
// scripts/benchmark.js. Wall time includes Node startup for each CLI process,
// so treat it as an end-to-end CLI measurement rather than compiler-only time.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const modules = Number(process.argv[2] || 100);
const warmRuns = Number(process.argv[3] || 5);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-cache-bench-'));
const src = path.join(directory, 'src');
fs.mkdirSync(src, { recursive: true });
const cli = path.join(__dirname, '..', 'src', 'cli.js');
const imports = [];
const values = [];
for (let index = 0; index < modules; index += 1) {
  fs.writeFileSync(
    path.join(src, `module${index}.pln`),
    `export function value${index}(input: number) -> number\n    return input + ${index}\nend\n`,
  );
  imports.push(`import { value${index} } from "./module${index}"`);
  values.push(`value${index}(1)`);
}
fs.writeFileSync(
  path.join(src, 'main.pln'),
  `${imports.join('\n')}\nimport { print } from "std/io"\nprint(${values.join(' + ')})\n`,
);

function build(args = []) {
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [cli, 'build', ...args], { cwd: directory, encoding: 'utf8' });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(1);
  }
  const match = /(\d+) cached/.exec(result.stderr || '');
  return { ms, cached: match ? Number(match[1]) : 0 };
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

const cold = build();
const warm = [];
for (let index = 0; index < warmRuns; index += 1) warm.push(build());
const nocache = build(['--no-cache']);

const report = {
  language: 'PlainScript',
  compilerVersion: require('../package.json').version,
  fixture: { sourceModules: modules, mainImports: modules },
  coldBuildMs: Number(cold.ms.toFixed(2)),
  warmBuildMs: {
    min: Number(Math.min(...warm.map((run) => run.ms)).toFixed(2)),
    median: Number(median(warm.map((run) => run.ms)).toFixed(2)),
    max: Number(Math.max(...warm.map((run) => run.ms)).toFixed(2)),
  },
  cachedModules: warm[0].cached,
  noCacheBuildMs: Number(nocache.ms.toFixed(2)),
  cachedModulesOnNoCacheBuild: nocache.cached,
  machine: { platform: process.platform, arch: process.arch, node: process.version },
  notes: 'End-to-end CLI wall time including Node startup; synthetic independent modules.',
};
fs.rmSync(directory, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
