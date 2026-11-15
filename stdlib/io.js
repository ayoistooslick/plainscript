// Standard library: std/io
// Console, arguments, environment, and process control.
import process from 'node:process';
import readline from 'node:readline';

let interfacePromise = null;

function reader() {
  if (!interfacePromise) {
    interfacePromise = Promise.resolve(readline.createInterface({ input: process.stdin, output: process.stdout }));
  }
  return interfacePromise;
}

export function print(value = '') {
  process.stdout.write(`${value}\n`);
}

export function eprint(value = '') {
  process.stderr.write(`${value}\n`);
}

export async function readLine(prompt = '') {
  const rl = await reader();
  const answer = await rl.question(prompt);
  return answer;
}

export function args() {
  return process.argv.slice(2);
}

export function env(name, fallback = '') {
  const value = process.env[name];
  return value === undefined ? fallback : value;
}

export function exit(code = 0) {
  process.exit(code);
}

export function stdinText() {
  try {
    return require('node:fs').readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

export function pid() {
  return process.pid;
}
