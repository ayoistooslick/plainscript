'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function waitFor(predicate, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      try {
        if (predicate()) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > timeout) {
          clearInterval(timer);
          reject(new Error('timed out waiting for watch rebuild'));
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    }, 40);
  });
}

test('watch rebuilds changed sources and leaves unchanged outputs alone', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plainscript-watch-'));
  fs.mkdirSync(path.join(directory, 'src'));
  const source = path.join(directory, 'src', 'main.pln');
  fs.writeFileSync(source, 'import { print } from "std/io"\nprint("one")\n');
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'cli.js'), 'watch'], {
    cwd: directory,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  try {
    await waitFor(() => fs.existsSync(path.join(directory, 'dist', 'main.js')));
    await waitFor(() => logs.includes('watching'));
    const first = fs.readFileSync(path.join(directory, 'dist', 'main.js'), 'utf8');
    assert.match(first, /one/);
    fs.writeFileSync(source, 'import { print } from "std/io"\nprint("two")\n');
    await waitFor(() => fs.readFileSync(path.join(directory, 'dist', 'main.js'), 'utf8').includes('two'));
    fs.writeFileSync(source, 'import { print } from "std/io"\nprint("two")\n');
    await waitFor(() => logs.includes('unchanged'));
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', resolve);
      setTimeout(resolve, 1500);
    });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
