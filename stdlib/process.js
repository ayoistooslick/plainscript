// Child processes are real OS processes. `run` captures their output and
// rejects with an Error carrying the exit code, so a typed error contract can
// describe the failure. `start` returns a handle for long-running services.

import { spawn, execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

function envFor(options) {
  if (!options || !options.env) return process.env;
  return { ...process.env, ...options.env };
}

function resultOf(child, stdout, stderr) {
  return {
    code: child.status === null ? -1 : child.status,
    stdout: stdout || '',
    stderr: stderr || '',
  };
}

export function run(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: envFor(options),
      timeout: options.timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (failure) => reject(new Error(`Cannot run "${command}": ${failure.message}`)));
    child.on('close', (code, signal) => {
      const result = { code: code === null ? -1 : code, stdout, stderr };
      if (result.code !== 0) {
        const error = new Error(`Command "${command}" failed with exit code ${result.code}${signal ? ` (${signal})` : ''}.`);
        error.result = result;
        reject(error);
        return;
      }
      resolve(result);
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

export function runSync(command, args = [], options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: options.cwd,
      env: envFor(options),
      timeout: options.timeout,
      input: options.input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (failure) {
    if (failure.status !== undefined) {
      const result = {
        code: typeof failure.status === 'number' ? failure.status : -1,
        stdout: failure.stdout || '',
        stderr: failure.stderr || '',
      };
      const error = new Error(`Command "${command}" failed with exit code ${result.code}.`);
      error.result = result;
      throw error;
    }
    throw new Error(`Cannot run "${command}": ${failure.message}`);
  }
}

export function shell(command, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, [], {
      shell: true,
      cwd: options.cwd,
      env: envFor(options),
      timeout: options.timeout,
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf8',
    }, (failure, stdout, stderr) => {
      if (failure) {
        const result = {
          code: typeof failure.code === 'number' ? failure.code : -1,
          stdout: stdout || '',
          stderr: stderr || '',
        };
        const error = new Error(result.stderr.trim() || `Shell command failed with exit code ${result.code}.`);
        error.result = result;
        reject(error);
        return;
      }
      resolve({ code: 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

export function start(command, args = [], options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: envFor(options),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return {
    get pid() { return child.pid || -1; },
    kill: (signal) => child.kill(signal),
    onExit(handler) {
      child.on('close', (code) => handler(resultOf({ status: code }, stdout, stderr)));
    },
    onStdout(handler) { child.stdout.on('data', (chunk) => handler(chunk)); },
    onStderr(handler) { child.stderr.on('data', (chunk) => handler(chunk)); },
    write(text) { child.stdin.write(text); },
    endInput(text) { child.stdin.end(text); },
  };
}

export function which(command) {
  const paths = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':');
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];
  const separator = process.platform === 'win32' ? '\\' : '/';
  for (const directory of paths) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = `${directory}${separator}${command}${extension}`;
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function cwd() { return process.cwd(); }
export function chdir(path) { process.chdir(path); }
export function pid() { return process.pid; }
export function ppid() { return process.ppid; }
export function platform() { return process.platform; }
export function arch() { return process.arch; }
export function argv() { return process.argv.slice(); }
export function exit(code = 0) { process.exit(code); }
export function uptime() { return process.uptime(); }
export function memoryUsage() {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
  };
}
export function onSignal(signal, handler) {
  process.on(signal, handler);
}
