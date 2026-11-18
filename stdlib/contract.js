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

function makeSchema(kind, check) {
  return Object.freeze({ kind, parse(value, path = 'value') { return check(value, path); } });
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
  });
}

function enumeration(values) {
  const allowed = new Set(values);
  return makeSchema('enum', (value, path) => {
    if (!allowed.has(value)) throw new ContractError(path, `one of ${[...allowed].map((v) => JSON.stringify(v)).join(', ')}`, value);
    return value;
  });
}

function optional(inner) {
  return makeSchema('optional', (value, path) => value === undefined || value === null ? value : inner.parse(value, path));
}

function array(inner, options = {}) {
  return makeSchema('array', (value, path) => {
    if (!Array.isArray(value)) throw new ContractError(path, 'array', value);
    if (options.minLength !== undefined && value.length < options.minLength) throw new ContractError(path, `array with at least ${options.minLength} items`, value);
    return value.map((item, index) => inner.parse(item, `${path}[${index}]`));
  });
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
  });
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

export { ContractError, OperationError, text, number, boolean, literal, enumeration, optional, array, object, parse, safeParse, operation, implement, createClient };
