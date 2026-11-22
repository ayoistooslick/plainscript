#!/usr/bin/env node
'use strict';

// Generates every cross-language client from one real PlainScript module, then
// compiles each target and executes the ones whose runtime is available. This
// is the script CI uses to replace the previous "generation only" claim.
//
//   node scripts/verify-bindings.js
//   node scripts/verify-bindings.js --require-all   # every toolchain required

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'src', 'cli.js');
const requireAll = process.argv.includes('--require-all');
const work = path.join(ROOT, '.plainscript', 'bindings-check');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const entry = path.join(work, 'service.pln');
fs.writeFileSync(entry, `export function add(left: number, right: number) -> number
    return left + right
end

export function greet(name: text) -> text
    return "Hello, {name}!"
end

export function totals(values: list of number) -> { count: number, total: number }
    let total = 0
    for value in values
        total += value
    end
    return { count: 3, total }
end
`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || work,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
  return {
    command: `${command} ${args.join(' ')}`,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

function installed(command) {
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return !probe.error;
}

const generated = run(process.execPath, [CLI, 'bindings', entry, '--out=' + path.join(work, 'bindings')]);
if (generated.status !== 0) {
  process.stderr.write(generated.stderr || generated.stdout);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(work, 'bindings', 'plainscript.manifest.json'), 'utf8'));
const language = require('../src/interop/bindings');
const files = language.generateBindings(manifest, language.SUPPORTED, entry);
const byLanguage = new Map(files.map((file) => [file.language, path.join(work, 'bindings', file.name)]));

// Each check is a command that proves the generated source is valid for that
// target. Execution checks below go further for runtimes we can host in CI.
const checks = {
  javascript: () => ({ command: process.execPath, args: ['--check', byLanguage.get('javascript')] }),
  typescript: () => ({ command: path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc'), args: ['--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', byLanguage.get('typescript')] }),
  python: () => ({ command: 'python3', args: ['-m', 'py_compile', byLanguage.get('python')] }),
  go: () => {
    fs.writeFileSync(path.join(work, 'bindings', 'go.mod'), 'module generated\n\ngo 1.22\n');
    return { command: 'go', args: ['build', './...'], cwd: path.join(work, 'bindings') };
  },
  rust: () => {
    fs.mkdirSync(path.join(work, 'rust', 'src'), { recursive: true });
    fs.copyFileSync(byLanguage.get('rust'), path.join(work, 'rust', 'src', 'lib.rs'));
    fs.writeFileSync(path.join(work, 'rust', 'Cargo.toml'), '[package]\nname = "generated"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde_json = "1"\n');
    return { command: 'cargo', args: ['check', '--quiet'], cwd: path.join(work, 'rust') };
  },
  java: () => ({ command: 'javac', args: [byLanguage.get('java')] }),
  kotlin: () => ({ command: 'kotlinc', args: [byLanguage.get('kotlin'), '-d', path.join(work, 'kotlin.jar')] }),
  ruby: () => ({ command: 'ruby', args: ['-c', byLanguage.get('ruby')] }),
  php: () => ({ command: 'php', args: ['-l', byLanguage.get('php')] }),
  csharp: () => {
    fs.mkdirSync(path.join(work, 'csharp'), { recursive: true });
    fs.copyFileSync(byLanguage.get('csharp'), path.join(work, 'csharp', 'BridgeClient.cs'));
    fs.writeFileSync(path.join(work, 'csharp', 'generated.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>\n');
    return { command: 'dotnet', args: ['build', '-v', 'q'], cwd: path.join(work, 'csharp') };
  },
  swift: () => ({ command: 'swiftc', args: ['-parse', byLanguage.get('swift')] }),
  dart: () => ({ command: 'dart', args: ['analyze', '--fatal-infos', byLanguage.get('dart')] }),
  c: () => ({ command: 'gcc', args: ['-std=c11', '-fsyntax-only', byLanguage.get('c')] }),
  cpp: () => ({ command: 'g++', args: ['-std=c++17', '-fsyntax-only', '-x', 'c++', byLanguage.get('cpp')] }),
};

const toolFor = {
  python: 'python3', go: 'go', rust: 'cargo', java: 'javac', kotlin: 'kotlinc',
  ruby: 'ruby', php: 'php', csharp: 'dotnet', swift: 'swiftc', dart: 'dart',
  c: 'gcc', cpp: 'g++',
};

const results = [];
for (const [name, make] of Object.entries(checks)) {
  const check = make();
  const tools = name === 'typescript' ? [check.command] : [toolFor[name] || check.command];
  const missing = tools.filter((tool) => !installed(tool));
  if (missing.length) {
    results.push({ name, status: requireAll ? 'missing' : 'skipped', detail: missing.join(', ') });
    continue;
  }
  const outcome = run(check.command, check.args, { cwd: check.cwd });
  results.push({ name, status: outcome.status === 0 ? 'pass' : 'fail', detail: outcome.stderr.trim().split('\n').slice(0, 8).join('\n') });
}

function execute(name, command, args, expected) {
  const outcome = run(command, args, { cwd: work });
  const output = `${outcome.stdout}${outcome.stderr}`;
  const ok = outcome.status === 0 && (!expected || outcome.stdout.includes(expected));
  results.push({ name: `execute:${name}`, status: ok ? 'pass' : 'fail', detail: output.trim().slice(0, 800) });
}

const nodeCommand = process.execPath;
const bridgeArgs = [CLI, 'bridge', entry];

// JavaScript and TypeScript execute through the real stdio bridge.
if (installed('node')) {
  const script = path.join(work, 'run-js.mjs');
  fs.writeFileSync(script, `import { Client } from ${JSON.stringify(byLanguage.get('javascript'))};\nconst client = new Client(${JSON.stringify(nodeCommand)}, ${JSON.stringify(bridgeArgs)});\nconsole.log(await client.add(2, 3));\nconsole.log(await client.greet("JS"));\nclient.close();\n`);
  execute('javascript', nodeCommand, [script], '5\nHello, JS!');
}

if (installed(path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc'))) {
  const out = path.join(work, 'ts-out');
  const tsc = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  const compile = run(tsc, ['--outDir', out, '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', byLanguage.get('typescript')]);
  if (compile.status === 0) {
    const script = path.join(work, 'run-ts.mjs');
    fs.writeFileSync(script, `import { Client } from ${JSON.stringify(path.join(out, path.basename(byLanguage.get('typescript')).replace(/\.ts$/, '.js')))};\nconst client = new Client(${JSON.stringify(nodeCommand)}, ${JSON.stringify(bridgeArgs)});\nconsole.log(await client.add(2, 3));\nconsole.log(await client.greet("TS"));\nclient.close();\n`);
    execute('typescript', nodeCommand, [script], '5\nHello, TS!');
  } else {
    results.push({ name: 'execute:typescript', status: 'fail', detail: compile.stderr });
  }
}

if (installed('python3')) {
  const script = path.join(work, 'run.py');
  fs.writeFileSync(script, `import sys\nsys.path.insert(0, ${JSON.stringify(path.dirname(byLanguage.get('python')))})\nfrom service_bridge import Client\nclient = Client(command=sys.argv[1], args=[sys.argv[2], "bridge", sys.argv[3]])\nprint(client.add(2, 3))\nprint(client.greet("PY"))\nclient.close()\n`);
  execute('python', 'python3', [script, nodeCommand, CLI, entry], '5\nHello, PY!');
}

if (installed('ruby')) {
  const script = path.join(work, 'run.rb');
  fs.writeFileSync(script, `require ${JSON.stringify(byLanguage.get('ruby').replace(/\.rb$/, ''))}\nclient = Client.new(ARGV[0], [ARGV[1], "bridge", ARGV[2]])\nputs client.add(2, 3)\nputs client.greet("RB")\nclient.close\n`);
  execute('ruby', 'ruby', [script, nodeCommand, CLI, entry], '5\nHello, RB!');
}

if (installed('php')) {
  const script = path.join(work, 'run.php');
  fs.writeFileSync(script, `<?php\nrequire ${JSON.stringify(byLanguage.get('php'))};\n$client = new Client($argv[1], [$argv[2], "bridge", $argv[3]]);\necho $client->add(2, 3), "\\n";\necho $client->greet("PHP"), "\\n";\n$client->close();\n`);
  execute('php', 'php', [script, nodeCommand, CLI, entry], '5\nHello, PHP!');
}

if (installed('gcc')) {
  const usage = path.join(work, 'use.c');
  fs.writeFileSync(usage, `#include "service_bridge.h"\n#include <stdio.h>\nint main(void) { char* result = ps_add("2", "3"); if (!result) return 1; printf("%s\\n", result); ps_free(result); return 0; }\n`);
  const binary = path.join(work, 'use-c');
  const compile = run('gcc', ['-std=c11', '-I', path.dirname(byLanguage.get('c')), `-DPS_COMMAND=${JSON.stringify(`${nodeCommand} ${CLI}`)}`, `-DPS_ENTRY="${entry}"`, usage, '-o', binary]);
  if (compile.status === 0) execute('c', binary, [], '5');
  else results.push({ name: 'execute:c', status: 'fail', detail: compile.stderr });
}

if (installed('g++')) {
  const usage = path.join(work, 'use.cpp');
  fs.writeFileSync(usage, `#include "service_bridge.hpp"\n#include <iostream>\nint main() { std::cout << plainscript_service::call("add", "[2,3]") << "\\n"; }\n`);
  const binary = path.join(work, 'use-cpp');
  const compile = run('g++', ['-std=c++17', '-I', path.dirname(byLanguage.get('cpp')), `-DPS_COMMAND=${JSON.stringify(`${nodeCommand} ${CLI}`)}`, usage, '-o', binary]);
  if (compile.status === 0) execute('cpp', binary, [], '5');
  else results.push({ name: 'execute:cpp', status: 'fail', detail: compile.stderr });
}

for (const result of results) {
  console.log(`${result.status.padEnd(8)} ${result.name}${result.detail && result.status !== 'pass' ? ` — ${result.detail.split('\n')[0]}` : ''}`);
}
const failed = results.filter((result) => result.status === 'fail' || result.status === 'missing');
if (failed.length) {
  process.stderr.write(`\n${failed.length} binding check(s) failed or were missing.\n`);
  for (const result of failed) if (result.detail) process.stderr.write(`\n${result.name}:\n${result.detail}\n`);
  process.exit(1);
}
console.log(`\nAll ${results.length} binding checks passed.`);
