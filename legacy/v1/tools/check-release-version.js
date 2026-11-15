#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lockJson = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const vscodeJson = JSON.parse(fs.readFileSync(path.join(root, 'plainscript-vscode', 'package.json'), 'utf8'));
const { VERSION } = require(path.join(root, 'compiler', 'version'));
const grammar = fs.readFileSync(path.join(root, 'docs', 'PLAINSCRIPT-GRAMMAR.md'), 'utf8');
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const { LspService } = require(path.join(root, 'compiler', 'lsp'));
const lsp = new LspService().request('initialize');

const expected = packageJson.version;
const values = {
  'package.json': packageJson.version,
  'package-lock.json root': lockJson.version,
  'compiler/version.js': VERSION,
  'grammar': /^Version:\s*([^\s]+)/m.exec(grammar)?.[1],
  'VS Code package': vscodeJson.version,
  'LSP serverInfo': lsp.serverInfo?.version,
};
const failures = Object.entries(values)
  .filter(([, value]) => value !== expected)
  .map(([name, value]) => `${name} reports ${JSON.stringify(value)}; expected ${expected}`);
if (!/^## \[\d+\.\d+\.\d+\]/m.test(changelog)) failures.push('CHANGELOG.md has no release heading');
if (!new RegExp(`^## \\[${expected.replace(/\./g, '\\.') }\\]`, 'm').test(changelog)) failures.push(`CHANGELOG.md has no ${expected} heading`);
if (failures.length) {
  console.error('Release metadata check failed:');
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}
console.log(`Release metadata consistent: ${expected}`);
