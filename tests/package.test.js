'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { ROOT } = require('./helpers');
const { VERSION } = require('../src/version');

const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('the compiler version and package version agree', () => {
  assert.strictEqual(packageJson.version, VERSION);
  assert.strictEqual(VERSION, '2.1.0');
});

test('the package exposes an API entry point and the standard library', () => {
  assert.strictEqual(packageJson.main, 'src/index.js');
  assert.strictEqual(packageJson.exports['.'], './src/index.js');
  assert.strictEqual(packageJson.exports['./std/*'], './stdlib/*.js');
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'index.js')));
});

test('every standard library module has a runtime and a declaration file', () => {
  const modules = fs.readdirSync(path.join(ROOT, 'stdlib'))
    .filter((name) => name.endsWith('.d.pln'))
    .map((name) => name.replace(/\.d\.pln$/, ''));
  assert.ok(modules.length >= 8);
  for (const module of modules) {
    assert.ok(fs.existsSync(path.join(ROOT, 'stdlib', `${module}.js`)), `runtime for ${module}`);
    assert.ok(fs.existsSync(path.join(ROOT, 'stdlib', `${module}.d.pln`)), `declarations for ${module}`);
  }
});

test('the CLI is executable and has a shebang', () => {
  assert.strictEqual(packageJson.bin.plainscript, './src/cli.js');
  const source = fs.readFileSync(path.join(ROOT, 'src', 'cli.js'), 'utf8');
  assert.ok(source.startsWith('#!/usr/bin/env node'));
});

test('the publish set excludes archived v1 sources and dependencies', () => {
  assert.ok(!packageJson.files.includes('legacy'));
  assert.ok(packageJson.files.includes('src'));
  assert.ok(packageJson.files.includes('stdlib'));
  assert.deepStrictEqual(packageJson.dependencies || {}, {});
  // Framework packages are development-only: they exist so the integration
  // tests run real Express, React and Vite against compiled output.
  for (const name of ['express', 'react', 'react-dom', 'vite']) {
    assert.ok(packageJson.devDependencies[name], `${name} is a development dependency for integrations`);
  }
});

test('the v1 implementation is preserved under legacy/ and not imported', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'legacy', 'v1', 'compiler', 'cli.js')));
  const sources = fs.readdirSync(path.join(ROOT, 'src')).map((name) => fs.readFileSync(path.join(ROOT, 'src', name), 'utf8'));
  for (const source of sources) {
    assert.ok(!source.includes('legacy/v1'), 'the v2 compiler must not import v1 code');
  }
});

test('every documented CLI command exists', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'cli.js'), 'utf8');
  for (const command of ['run', 'build', 'check', 'fmt', 'test', 'new', 'ir', 'version']) {
    assert.match(source, new RegExp(`${command}:`));
  }
});
