'use strict';

// A small, language-neutral JSON-RPC 2.0 protocol over newline-delimited JSON.
//
// One message per line keeps the wire format readable in any language with a
// line reader, which is what makes the same bridge usable from Python, Go,
// Rust, Java, Ruby, PHP, C# and C without a per-language transport library.
// HTTP mode carries exactly the same message objects in a POST body.

const VERSION = '2.0';

const ERROR_CODES = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  EXECUTION: -32000,
});

class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

function request(id, method, params) {
  const message = { jsonrpc: VERSION, id, method };
  if (params !== undefined) message.params = params;
  return message;
}

function notification(method, params) {
  const message = { jsonrpc: VERSION, method };
  if (params !== undefined) message.params = params;
  return message;
}

function success(id, result) {
  return { jsonrpc: VERSION, id, result: result === undefined ? null : result };
}

function failure(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: VERSION, id: id === undefined ? null : id, error };
}

function serialize(message) {
  return JSON.stringify(message);
}

function parse(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (failure) {
    throw new RpcError(ERROR_CODES.PARSE_ERROR, `Invalid JSON: ${failure.message}`);
  }
  if (Array.isArray(message)) {
    if (!message.length) {
      throw new RpcError(ERROR_CODES.INVALID_REQUEST, 'An empty batch is not a request.');
    }
    for (const item of message) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new RpcError(ERROR_CODES.INVALID_REQUEST, 'Every batch entry must be a JSON-RPC object.');
      }
      if (item.jsonrpc !== VERSION) {
        throw new RpcError(ERROR_CODES.INVALID_REQUEST, 'Unsupported JSON-RPC version; expected "2.0".');
      }
    }
    return message;
  }
  if (!message || typeof message !== 'object') {
    throw new RpcError(ERROR_CODES.INVALID_REQUEST, 'A JSON-RPC message must be an object.');
  }
  if (message.jsonrpc !== VERSION) {
    throw new RpcError(ERROR_CODES.INVALID_REQUEST, 'Unsupported JSON-RPC version; expected "2.0".');
  }
  return message;
}

function isRequest(message) {
  return Boolean(message) && typeof message.method === 'string' && message.id !== undefined;
}

function isNotification(message) {
  return Boolean(message) && typeof message.method === 'string' && message.id === undefined;
}

function isResponse(message) {
  return Boolean(message) && typeof message === 'object'
    && (Object.prototype.hasOwnProperty.call(message, 'result')
      || Object.prototype.hasOwnProperty.call(message, 'error'));
}

module.exports = {
  VERSION,
  ERROR_CODES,
  RpcError,
  request,
  notification,
  success,
  failure,
  serialize,
  parse,
  isRequest,
  isNotification,
  isResponse,
};
