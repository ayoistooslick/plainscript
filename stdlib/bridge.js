// Standard library: std/bridge
//
// PlainScript can call a JSON-RPC service in any language. `open` starts a
// child process and speaks one JSON message per line on stdin/stdout, which is
// the same protocol `plainscript bridge` exposes. This is the boundary used by
// the Python, Go, Rust, Java, Ruby, PHP, C# and Dart adapters in reverse: the
// other language is the server, PlainScript is the client.

import { spawn } from 'node:child_process';
import readline from 'node:readline';

export function open(command, args = []) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  const reader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  let nextId = 1;
  let closed = false;

  const failAll = (message) => {
    for (const entry of pending.values()) entry.reject(new Error(message));
    pending.clear();
  };

  reader.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) {
      const error = new Error(message.error.message || 'Bridge error');
      error.code = message.error.code;
      error.data = message.error.data;
      entry.reject(error);
    } else {
      entry.resolve(message.result);
    }
  });

  child.on('exit', (code) => {
    closed = true;
    reader.close();
    failAll(`The bridge process exited with code ${code}.`);
  });

  return {
    pid: child.pid === undefined ? -1 : child.pid,
    request(method, params = []) {
      if (closed) return Promise.reject(new Error('The bridge is closed.'));
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    notify(method, params = []) {
      if (closed) return;
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      try { child.stdin.end(); } catch { /* already gone */ }
      reader.close();
    },
  };
}

export function call(bridge, method, params = []) {
  return bridge.request(method, params);
}

export function close(bridge) {
  bridge.close();
}
