'use strict';

// `node --test` accepts a directory on Node 20 but not Node 22, and shell glob
// expansion differs between bash, cmd.exe and PowerShell. Build the file list
// here so `npm test` runs the same suite on every supported platform.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const tests = path.join(root, 'tests');
const files = fs.readdirSync(tests)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(tests, name));

if (!files.length) {
  console.error('No test files found in tests/.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
