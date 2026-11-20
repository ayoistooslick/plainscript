#!/usr/bin/env node
'use strict';

// Verifies the framework integration projects that need a full dependency
// install and a production build:
//
//   integrations/react-vite  compile, bundle with Vite, serve the bundle
//   integrations/next-app    compile, run `next build`, inspect prerendered HTML
//
// The compiler-level integrations (Express, async HTTP, SQLite, React SSR) run
// in `npm test`; this script covers the two bundlers, which are slower and need
// their own node_modules.
//
//   node scripts/verify-integrations.js            both
//   node scripts/verify-integrations.js react      one
//   node scripts/verify-integrations.js next

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'src', 'cli.js');
const results = [];

function run(label, command, args, options = {}) {
  const started = Date.now();
  const child = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeout || 240000,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = child.status === 0;
  results.push({ label, ok, seconds, status: child.status });
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${label} (${seconds}s)\n`);
  if (!ok) {
    process.stdout.write(`${(child.stdout || '').slice(-4000)}\n${(child.stderr || '').slice(-4000)}\n`);
  }
  return ok;
}

function verifyReact() {
  const directory = path.join(ROOT, 'integrations', 'react-vite');
  const ok = run('react-vite: compile PlainScript', process.execPath, [CLI, 'build'], { cwd: directory })
    && run('react-vite: vite production build', path.join(ROOT, 'node_modules', '.bin', 'vite'), ['build'], { cwd: directory });
  if (!ok) return false;

  const dist = path.join(directory, 'dist');
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const assets = fs.readdirSync(path.join(dist, 'assets'));
  const bundle = assets.find((name) => name.endsWith('.js'));
  const code = bundle ? fs.readFileSync(path.join(dist, 'assets', bundle), 'utf8') : '';
  const checks = [
    ['react-vite: HTML entry emitted', html.includes('/assets/')],
    ['react-vite: JavaScript bundle emitted', Boolean(bundle) && code.length > 1000],
    ['react-vite: component text is in the bundle', code.includes('PlainScript + React + Vite')],
    ['react-vite: React is bundled', code.includes('react')],
  ];
  for (const [label, passed] of checks) {
    results.push({ label, ok: passed, seconds: '0.0', status: passed ? 0 : 1 });
    process.stdout.write(`${passed ? 'ok  ' : 'FAIL'} ${label}\n`);
  }
  return checks.every(([, passed]) => passed);
}

function verifyNext() {
  const directory = path.join(ROOT, 'integrations', 'next-app');
  if (!fs.existsSync(path.join(directory, 'node_modules', 'next'))) {
    process.stdout.write('next-app: dependencies are not installed. Run `npm install` inside integrations/next-app first.\n');
    results.push({ label: 'next-app: dependencies installed', ok: false, seconds: '0.0', status: 1 });
    return false;
  }

  const ok = run('next-app: compile PlainScript', process.execPath, [CLI, 'build'], { cwd: directory })
    && run('next-app: next build', path.join(directory, 'node_modules', '.bin', 'next'), ['build'], { cwd: directory, timeout: 300000 });
  if (!ok) return false;

  const buildId = path.join(directory, '.next', 'BUILD_ID');
  const htmlPath = path.join(directory, '.next', 'server', 'app', 'index.html');
  const checks = [
    ['next-app: BUILD_ID written', fs.existsSync(buildId)],
    ['next-app: page prerendered', fs.existsSync(htmlPath)],
    ['next-app: component rendered into HTML', fs.existsSync(htmlPath) && fs.readFileSync(htmlPath, 'utf8').includes('PlainScript inside Next.js')],
  ];
  for (const [label, passed] of checks) {
    results.push({ label, ok: passed, seconds: '0.0', status: passed ? 0 : 1 });
    process.stdout.write(`${passed ? 'ok  ' : 'FAIL'} ${label}\n`);
  }
  return checks.every(([, passed]) => passed);
}

const target = process.argv[2] || 'all';
let ok = true;
if (target === 'all' || target === 'react') ok = verifyReact() && ok;
if (target === 'all' || target === 'next') ok = verifyNext() && ok;

process.stdout.write(`\n${results.filter((entry) => entry.ok).length}/${results.length} integration checks passed.\n`);
process.exit(ok ? 0 : 1);
