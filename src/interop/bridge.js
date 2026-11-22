'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const readline = require('readline');
const { pathToFileURL } = require('url');

const { Compiler } = require('../modules');
const { formatDiagnostics } = require('../diagnostics');
const { describeModule } = require('./manifest');
const {
  ERROR_CODES,
  RpcError,
  failure,
  parse,
  serialize,
  success,
} = require('./protocol');

// The bridge compiles a PlainScript entry module and exposes its exported
// functions over JSON-RPC. Everything crosses the boundary as JSON, so a
// consumer never needs a PlainScript runtime: it needs a pipe (stdio) or an
// HTTP client. That is the adapter every language can implement.
function bridgeOutputRoot(root, entry) {
  const digest = crypto.createHash('sha1').update(path.resolve(entry)).digest('hex').slice(0, 12);
  return path.join(root, '.plainscript', 'bridge', digest);
}

async function loadBridgeModule(entry, options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const compiler = new Compiler({ root, dialect: options.dialect || null });
  const outRoot = bridgeOutputRoot(root, entry);
  const result = compiler.compileGraph(entry, outRoot, root);
  const errors = (result.diagnostics || []).filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length) {
    const failureError = new Error(formatDiagnostics(errors, sourcesOf(compiler)));
    failureError.diagnostics = errors;
    throw failureError;
  }
  const record = compiler.modules.get(path.resolve(entry)) || result.entryRecord;
  if (!record || !record.check) {
    throw new Error(`The bridge entry ${entry} did not produce a checked module.`);
  }
  const manifest = describeModule(record);
  const loaded = await import(`${pathToFileURL(result.entryOut).href}?t=${Date.now()}`);
  return { module: loaded, manifest, compiler, outFile: result.entryOut, record };
}

function sourcesOf(compiler) {
  const sources = new Map();
  for (const record of compiler.modules.values()) sources.set(record.display, record.source);
  return sources;
}

function normaliseParams(params, meta) {
  if (params === undefined || params === null) {
    if (meta.params.some((parameter) => !parameter.optional && !parameter.rest)) {
      throw new RpcError(ERROR_CODES.INVALID_PARAMS, `"${meta.name}" requires ${meta.params.length} argument(s).`);
    }
    return [];
  }
  if (Array.isArray(params)) {
    if (params.length > meta.params.length && !meta.params.some((parameter) => parameter.rest)) {
      throw new RpcError(ERROR_CODES.INVALID_PARAMS, `"${meta.name}" accepts at most ${meta.params.length} argument(s); received ${params.length}.`);
    }
    for (let index = 0; index < meta.params.length; index += 1) {
      const parameter = meta.params[index];
      if (!parameter.optional && !parameter.rest && params[index] === undefined) {
        throw new RpcError(ERROR_CODES.INVALID_PARAMS, `"${meta.name}" is missing argument "${parameter.name}".`);
      }
    }
    return params;
  }
  if (typeof params === 'object') {
    const args = [];
    for (const parameter of meta.params) {
      if (!Object.prototype.hasOwnProperty.call(params, parameter.name)) {
        if (parameter.optional || parameter.rest) {
          args.push(undefined);
          continue;
        }
        throw new RpcError(ERROR_CODES.INVALID_PARAMS, `"${meta.name}" is missing argument "${parameter.name}".`);
      }
      args.push(params[parameter.name]);
    }
    const known = new Set(meta.params.map((parameter) => parameter.name));
    for (const key of Object.keys(params)) {
      if (!known.has(key)) {
        throw new RpcError(ERROR_CODES.INVALID_PARAMS, `"${meta.name}" has no argument "${key}".`);
      }
    }
    return args;
  }
  throw new RpcError(ERROR_CODES.INVALID_PARAMS, 'Params must be an array or an object keyed by parameter name.');
}

function jsonSafe(value) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (failure) {
    throw new RpcError(ERROR_CODES.EXECUTION, `The result is not JSON-serialisable: ${failure.message}`);
  }
}

function createHandler({ module, manifest, debug = false }) {
  const functions = new Map(manifest.functions.map((fn) => [fn.name, fn]));

  async function dispatch(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new RpcError(ERROR_CODES.INVALID_REQUEST, 'A request must be a JSON object.');
    }
    if (typeof message.method !== 'string') {
      throw new RpcError(ERROR_CODES.INVALID_REQUEST, 'A request must name a method.');
    }
    if (message.method === '__manifest') return manifest;
    if (message.method === '__ping') return { ok: true, module: manifest.module };

    const meta = functions.get(message.method);
    if (!meta) {
      throw new RpcError(
        ERROR_CODES.METHOD_NOT_FOUND,
        `Unknown method "${message.method}". Available: ${[...functions.keys()].join(', ') || '(none)'}.`,
      );
    }
    const callable = module[message.method];
    if (typeof callable !== 'function') {
      throw new RpcError(ERROR_CODES.METHOD_NOT_FOUND, `"${message.method}" is exported but is not a function.`);
    }
    const args = normaliseParams(message.params, meta);
    try {
      return jsonSafe(await callable(...args));
    } catch (failure) {
      if (failure instanceof RpcError) throw failure;
      const detail = debug && failure && failure.stack ? failure.stack : undefined;
      throw new RpcError(ERROR_CODES.EXECUTION, failure && failure.message ? failure.message : String(failure), detail);
    }
  }

  return async function handle(message) {
    if (Array.isArray(message)) {
      if (!message.length) return failure(null, ERROR_CODES.INVALID_REQUEST, 'An empty batch is not a request.');
      const responses = [];
      for (const item of message) {
        const hasId = item && item.id !== undefined;
        try {
          const result = await dispatch(item);
          if (hasId) responses.push(success(item.id, result));
        } catch (error) {
          if (hasId) responses.push(failure(item.id, error.code || ERROR_CODES.INTERNAL, error.message, error.data));
        }
      }
      return responses.length ? responses : null;
    }
    const hasId = message && message.id !== undefined;
    try {
      const result = await dispatch(message);
      return hasId ? success(message.id, result) : null;
    } catch (error) {
      if (!hasId) return null;
      return failure(message.id, error.code || ERROR_CODES.INTERNAL, error.message, error.data);
    }
  };
}

// Serves one JSON-RPC message per line on stdin/stdout. Requests are answered
// in order; notifications are executed but produce no response.
function serveStdio(handle, options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  let queue = Promise.resolve();
  let closed = false;

  reader.on('line', (line) => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      let response;
      try {
        const message = parse(line);
        response = await handle(message);
      } catch (error) {
        response = failure(null, error.code || ERROR_CODES.PARSE_ERROR, error.message);
      }
      if (response !== null && response !== undefined) output.write(`${serialize(response)}\n`);
    });
  });

  reader.on('close', () => {
    closed = true;
    if (options.onClose) options.onClose();
  });

  return { reader, get closed() { return closed; }, done: () => queue };
}

function readBody(request, limit = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new RpcError(ERROR_CODES.INVALID_REQUEST, 'Request body is larger than 10 MiB.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function serveHttp(handle, options = {}) {
  const manifest = options.manifest;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, module: manifest.module }));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/manifest') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(manifest));
      return;
    }
    if (request.method === 'POST' && (url.pathname === '/rpc' || url.pathname === '/')) {
      try {
        const body = await readBody(request);
        const message = parse(body);
        const result = await handle(message);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(error instanceof RpcError && error.code === ERROR_CODES.PARSE_ERROR ? 400 : 500, { 'content-type': 'application/json' });
        response.end(JSON.stringify(failure(null, error.code || ERROR_CODES.INTERNAL, error.message)));
      }
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found. Use POST /rpc, GET /manifest or GET /health.' }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port === undefined ? 0 : options.port, options.host || '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port, url: `http://${options.host || '127.0.0.1'}:${address.port}` });
    });
  });
}

module.exports = {
  bridgeOutputRoot,
  loadBridgeModule,
  createHandler,
  normaliseParams,
  serveStdio,
  serveHttp,
  readBody,
};
