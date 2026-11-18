'use strict';

class ContractError extends TypeError {
  constructor(path, expected, received) {
    super(`${path || 'value'}: expected ${expected}, received ${describe(received)}`);
    this.name = 'ContractError';
    this.path = path || 'value';
    this.expected = expected;
  }
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function makeSchema(kind, check, metadata = {}) {
  return Object.freeze({ kind, ...metadata, parse(value, path = 'value') { return check(value, path); } });
}

function text(options = {}) {
  const min = options.minLength ?? 0;
  const max = options.maxLength ?? Infinity;
  return makeSchema('text', (value, path) => {
    if (typeof value !== 'string') throw new ContractError(path, 'text', value);
    if (value.length < min) throw new ContractError(path, `text with at least ${min} characters`, value);
    if (value.length > max) throw new ContractError(path, `text with at most ${max} characters`, value);
    if (options.pattern && !new RegExp(options.pattern).test(value)) throw new ContractError(path, `text matching ${options.pattern}`, value);
    return value;
  });
}

function number(options = {}) {
  return makeSchema('number', (value, path) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new ContractError(path, 'finite number', value);
    if (options.min !== undefined && value < options.min) throw new ContractError(path, `number >= ${options.min}`, value);
    if (options.max !== undefined && value > options.max) throw new ContractError(path, `number <= ${options.max}`, value);
    return value;
  });
}

function boolean() {
  return makeSchema('boolean', (value, path) => {
    if (typeof value !== 'boolean') throw new ContractError(path, 'boolean', value);
    return value;
  });
}

function literal(expected) {
  return makeSchema('literal', (value, path) => {
    if (value !== expected) throw new ContractError(path, JSON.stringify(expected), value);
    return value;
  }, { expected });
}

function enumeration(values) {
  const allowed = new Set(values);
  return makeSchema('enum', (value, path) => {
    if (!allowed.has(value)) throw new ContractError(path, `one of ${[...allowed].map((v) => JSON.stringify(v)).join(', ')}`, value);
    return value;
  }, { values: [...values] });
}

function optional(inner) {
  return makeSchema('optional', (value, path) => value === undefined || value === null ? value : inner.parse(value, path), { inner });
}

function array(inner, options = {}) {
  return makeSchema('array', (value, path) => {
    if (!Array.isArray(value)) throw new ContractError(path, 'array', value);
    if (options.minLength !== undefined && value.length < options.minLength) throw new ContractError(path, `array with at least ${options.minLength} items`, value);
    return value.map((item, index) => inner.parse(item, `${path}[${index}]`));
  }, { element: inner, options });
}

function object(shape, options = {}) {
  const keys = Object.keys(shape);
  return makeSchema('object', (value, path) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ContractError(path, 'object', value);
    const output = {};
    for (const key of keys) {
      const result = shape[key].parse(value[key], `${path}.${key}`);
      if (result !== undefined) output[key] = result;
    }
    if (options.unknownKeys === 'strict') {
      for (const key of Object.keys(value)) if (!Object.hasOwn(shape, key)) throw new ContractError(`${path}.${key}`, 'no additional property', value[key]);
    } else if (options.unknownKeys === 'passthrough') {
      for (const key of Object.keys(value)) if (!Object.hasOwn(shape, key)) output[key] = value[key];
    }
    return output;
  }, { shape, options });
}

function oneOf(schemas) {
  if (!Array.isArray(schemas) || !schemas.length) throw new TypeError('oneOf expects a non-empty list of schemas');
  return makeSchema('oneOf', (value, path) => {
    const failures = [];
    for (const schema of schemas) {
      try { return schema.parse(value, path); }
      catch (error) { failures.push(error.message); }
    }
    throw new ContractError(path, 'one of the declared error shapes', value);
  }, { schemas });
}

function parse(schema, value) {
  if (!schema || typeof schema.parse !== 'function') throw new TypeError('parse expects a PlainScript contract schema');
  return schema.parse(value, 'value');
}

function safeParse(schema, value) {
  try { return { success: true, data: parse(schema, value), error: null }; }
  catch (error) { if (error instanceof ContractError) return { success: false, data: null, error }; throw error; }
}

class OperationError extends Error {
  constructor(operation, stage, cause) {
    super(`${operation}: ${stage} failed: ${cause.message}`, { cause });
    this.name = 'OperationError';
    this.operation = operation;
    this.stage = stage;
    this.cause = cause;
  }
}

function operation(name, input, output) {
  if (typeof name !== 'string' || !name) throw new TypeError('operation name must be non-empty text');
  if (!input || typeof input.parse !== 'function' || !output || typeof output.parse !== 'function') {
    throw new TypeError('operation input and output must be contract schemas');
  }
  return Object.freeze({ name, input, output });
}

function implement(contract, handler, options = {}) {
  if (!contract || typeof handler !== 'function') throw new TypeError('implement expects an operation and handler');
  return async (untrustedInput, context) => {
    let input;
    try { input = parse(contract.input, untrustedInput); }
    catch (cause) { throw new OperationError(contract.name, 'input validation', cause); }
    if (options.authorize && !(await options.authorize(context, input))) {
      const cause = new Error('authorization denied');
      cause.code = 'FORBIDDEN';
      throw new OperationError(contract.name, 'authorization', cause);
    }
    let result;
    try { result = await handler(input, context); }
    catch (cause) { throw new OperationError(contract.name, 'handler', cause); }
    try { return parse(contract.output, result); }
    catch (cause) { throw new OperationError(contract.name, 'output validation', cause); }
  };
}

function createClient(contract, transport) {
  if (!contract || typeof transport !== 'function') throw new TypeError('createClient expects an operation and transport');
  return async (input) => {
    let validated;
    try { validated = parse(contract.input, input); }
    catch (cause) { throw new OperationError(contract.name, 'client input validation', cause); }
    const result = await transport(contract.name, validated);
    try { return parse(contract.output, result); }
    catch (cause) { throw new OperationError(contract.name, 'client output validation', cause); }
  };
}

function success(value) {
  return Object.freeze({ $kind: 'Success', value });
}

function failure(error) {
  return Object.freeze({ $kind: 'Failure', error });
}

function fallibleOperation(name, input, output, errors) {
  if (!errors || typeof errors.parse !== 'function') throw new TypeError('fallibleOperation expects an error schema');
  return Object.freeze({ name, input, output, errors, fallible: true });
}

function implementFallible(contract, handler, options = {}) {
  if (!contract || !contract.fallible || typeof handler !== 'function') {
    throw new TypeError('implementFallible expects a fallible operation and handler');
  }
  return async (untrustedInput, context) => {
    let input;
    try { input = parse(contract.input, untrustedInput); }
    catch (cause) { throw new OperationError(contract.name, 'input validation', cause); }

    if (options.authorize) {
      let allowed;
      try { allowed = await options.authorize(context, input); }
      catch (cause) { throw new OperationError(contract.name, 'authorization', cause); }
      if (!allowed) {
        const raw = options.unauthorized && await options.unauthorized(context, input);
        const candidate = raw === undefined ? { code: 'FORBIDDEN', message: 'authorization denied' } : raw;
        try { return failure(parse(contract.errors, candidate)); }
        catch (cause) { throw new OperationError(contract.name, 'authorization', cause); }
      }
    }

    let outcome;
    try { outcome = await handler(input, context); }
    catch (cause) { throw new OperationError(contract.name, 'handler', cause); }
    if (!outcome || (outcome.$kind !== 'Success' && outcome.$kind !== 'Failure')) {
      const cause = new TypeError('a fallible handler must return success(value) or failure(error)');
      throw new OperationError(contract.name, 'result validation', cause);
    }
    try {
      if (outcome.$kind === 'Success') return success(parse(contract.output, outcome.value));
      return failure(parse(contract.errors, outcome.error));
    } catch (cause) {
      throw new OperationError(contract.name, outcome.$kind === 'Success' ? 'output validation' : 'error validation', cause);
    }
  };
}

function createFallibleClient(contract, transport) {
  if (!contract || !contract.fallible || typeof transport !== 'function') {
    throw new TypeError('createFallibleClient expects a fallible operation and transport');
  }
  return async (input) => {
    let validated;
    try { validated = parse(contract.input, input); }
    catch (cause) { throw new OperationError(contract.name, 'client input validation', cause); }
    const wire = await transport(contract.name, validated);
    try { return resultFromWire(wire, contract); }
    catch (cause) { throw new OperationError(contract.name, 'client result validation', cause); }
  };
}

function resultToWire(result) {
  if (!result || (result.$kind !== 'Success' && result.$kind !== 'Failure')) {
    throw new TypeError('resultToWire expects an operation result');
  }
  return result.$kind === 'Success'
    ? { ok: true, value: result.value }
    : { ok: false, error: result.error };
}

function resultFromWire(wire, contract) {
  if (!wire || typeof wire !== 'object') throw new TypeError('operation transport returned a non-object result');
  if (wire.$kind === 'Success') return success(parse(contract.output, wire.value));
  if (wire.$kind === 'Failure') return failure(parse(contract.errors, wire.error));
  if (wire.ok === true) return success(parse(contract.output, wire.value));
  if (wire.ok === false) return failure(parse(contract.errors, wire.error));
  if (wire.error !== undefined) return failure(parse(contract.errors, wire.error));
  return success(parse(contract.output, wire));
}

function router(endpoints) {
  if (!endpoints || typeof endpoints !== 'object') throw new TypeError('router expects a map of operation names to endpoints');
  const table = new Map(Object.entries(endpoints));
  const result = {
    names() { return [...table.keys()]; },
    has(name) { return table.has(name); },
    async handle(name, input, context) {
      const endpoint = table.get(name);
      if (!endpoint) {
        const cause = new Error(`unknown operation ${name}`);
        cause.code = 'NOT_FOUND';
        throw new OperationError(name || '<unknown>', 'routing', cause);
      }
      return endpoint(input, context);
    },
  };
  return result;
}

function httpTransport(baseUrl, options = {}) {
  const root = String(baseUrl).replace(/\/$/, '');
  return async (name, input) => {
    const response = await globalThis.fetch(`${root}/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      body: JSON.stringify(input),
    });
    const payload = await response.json();
    if (!response.ok && (!payload || (payload.ok === undefined && payload.$kind === undefined))) {
      const error = new Error(payload && payload.message ? payload.message : `operation failed with ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  };
}

export { ContractError, OperationError, text, number, boolean, literal, enumeration, optional, array, object, oneOf, parse, safeParse, operation, implement, createClient, success, failure, fallibleOperation, implementFallible, createFallibleClient, resultToWire, resultFromWire, router, httpTransport };
