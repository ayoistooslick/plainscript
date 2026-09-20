// Static type-checking foundation for PlainScript contracts.
//
// This checker is intentionally conservative: untyped programs remain valid,
// while declared contracts, typed parameters, known fields, and literal call
// arguments receive useful diagnostics before code generation.

const { lowerToIR } = require('./ir');

function diagnostic(message, node, code = 'PLN-TYPE') {
  const line = node && node.line ? node.line : 1;
  const column = node && node.col ? node.col : 1;
  return {
    severity: 1,
    source: 'plainscript',
    code,
    message,
    range: {
      start: { line: line - 1, character: column - 1 },
      end: { line: line - 1, character: column },
    },
  };
}

function typeName(spec) {
  if (!spec) return 'any';
  if (spec.kind === 'name') return spec.name;
  if (spec.kind === 'optional') return `optional ${typeName(spec.value)}`;
  if (spec.kind === 'list') return `list of ${typeName(spec.value)}`;
  if (spec.kind === 'dictionary') return `dictionary of ${typeName(spec.value)}`;
  if (spec.kind === 'union') return spec.values.map(typeName).join(' or ');
  return 'any';
}

function isNullSpec(spec) {
  return spec && spec.kind === 'name' && spec.name === 'null';
}

function isOptionalSpec(spec) {
  return spec && (spec.kind === 'optional' || (spec.kind === 'union' && spec.values.some(isNullSpec)));
}

function specMatches(actual, expected, schemas) {
  if (!expected || expected.kind === 'name' && expected.name === 'any' || !actual) return true;
  if (expected.kind === 'optional') return actual === 'null' || specMatches(actual, expected.value, schemas);
  if (expected.kind === 'union') return expected.values.some(item => specMatches(actual, item, schemas));
  if (expected.kind === 'name') {
    if (expected.name === 'null') return actual === 'null';
    if (expected.name === 'object') return actual === 'object' || typeof actual === 'object';
    if (expected.name === actual) return true;
    if (schemas.has(expected.name) && actual === 'object') return true;
    return false;
  }
  if (expected.kind === 'list') return actual === 'list' || actual === 'any';
  if (expected.kind === 'dictionary') return actual === 'dictionary' || actual === 'object' || actual === 'any';
  return true;
}

function literalType(node) {
  if (!node) return 'any';
  switch (node.type) {
    case 'NumberLiteral': return 'number';
    case 'StringLiteral':
    case 'TemplateLiteral': return 'text';
    case 'BooleanLiteral': return 'boolean';
    case 'NullLiteral': return 'null';
    case 'ArrayLiteral': return 'list';
    case 'InlineObjectLiteral':
    case 'ObjectLiteral': return 'object';
    default: return null;
  }
}

function checkTypes(ast, options = {}) {
  const ir = options.ir || lowerToIR(ast);
  const diagnostics = [];
  const schemas = new Map();
  const functions = new Map();
  const symbols = new Map();

  function addTypeSpecErrors(spec, node) {
    if (!spec) return;
    if (spec.kind === 'name') {
      const primitives = new Set(['any', 'number', 'text', 'boolean', 'null', 'object']);
      if (!primitives.has(spec.name) && !schemas.has(spec.name)) {
        diagnostics.push(diagnostic(`Unknown type "${spec.name}". Declare it with type ${spec.name} ... done.`, node, 'PLN-TYPE-UNKNOWN'));
      }
    } else if (spec.kind === 'optional' || spec.kind === 'list' || spec.kind === 'dictionary') {
      addTypeSpecErrors(spec.value, node);
    } else if (spec.kind === 'union') {
      spec.values.forEach(value => addTypeSpecErrors(value, node));
    }
  }

  for (const node of ast.body || []) {
    if (node.type === 'TypeDeclaration') {
      if (schemas.has(node.name)) diagnostics.push(diagnostic(`Type "${node.name}" is declared more than once.`, node, 'PLN-TYPE-DUPLICATE'));
      schemas.set(node.name, node);
    }
    if (node.type === 'FunctionDeclaration' || node.type === 'IntentDeclaration') {
      functions.set(node.name, node);
      symbols.set(node.name, { kind: node.type === 'IntentDeclaration' ? 'intent' : 'function', node });
    }
    if (node.type === 'RememberStatement' && typeof node.name === 'string') symbols.set(node.name, { kind: 'variable', node });
  }

  for (const node of ast.body || []) {
    if (node.type === 'TypeDeclaration') {
      for (const field of node.fields || []) addTypeSpecErrors(field.type, field);
    }
    if (node.type === 'FunctionDeclaration' || node.type === 'IntentDeclaration') {
      for (const param of node.params || []) {
        if (param.typeAnnotation) addTypeSpecErrors(param.typeAnnotation, node);
      }
    }
  }

  function fieldSpec(schemaName, fieldName) {
    const schema = schemas.get(schemaName);
    const field = schema && (schema.fields || []).find(item => item.key === fieldName);
    return field ? field.type : null;
  }

  function infer(node, env, origin = node) {
    if (!node) return 'any';
    const literal = literalType(node);
    if (literal) return literal;
    if (node.type === 'Identifier') {
      const entry = env.get(node.name) || symbols.get(node.name);
      return entry && entry.type ? entry.type : 'any';
    }
    if (node.type === 'MemberExpression') {
      const objectType = infer(node.object, env, origin);
      if (objectType && schemas.has(objectType)) {
        const field = fieldSpec(objectType, node.property);
        if (!field) diagnostics.push(diagnostic(`Type "${objectType}" has no field named "${node.property}".`, origin, 'PLN-TYPE-FIELD'));
        return field ? typeName(field) : 'any';
      }
      return 'any';
    }
    if (node.type === 'CallExpression') {
      const fn = functions.get(node.name);
      if (fn) return 'any';
      return 'any';
    }
    return 'any';
  }

  function checkExpression(node, env, origin = node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'MemberExpression') {
      infer(node, env, origin);
      checkExpression(node.object, env, origin);
      return;
    }
    if (node.type === 'CallExpression') {
      const fn = functions.get(node.name);
      if (fn) {
        const params = (fn.params || []).filter(param => param.name);
        if (node.args.length !== params.length && !params.some(param => param.type === 'RestElement')) {
          diagnostics.push(diagnostic(`Intent/function "${node.name}" expects ${params.length} argument(s), received ${node.args.length}.`, origin, 'PLN-TYPE-ARITY'));
        }
        node.args.forEach((arg, index) => {
          const param = params[index];
          if (!param || !param.typeAnnotation) return;
          const actual = infer(arg, env, origin);
          if (!specMatches(actual, param.typeAnnotation, schemas)) {
            diagnostics.push(diagnostic(`Argument ${index + 1} of "${node.name}" expects ${typeName(param.typeAnnotation)}, received ${actual}.`, origin, 'PLN-TYPE-ARG'));
          }
          validateLiteralAgainstSpec(arg, param.typeAnnotation, origin);
        });
      }
      node.args.forEach(arg => checkExpression(arg, env, origin));
      return;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) value.forEach(item => checkExpression(item, env, origin));
        else if (value.type) checkExpression(value, env, origin);
      }
    }
  }

  function validateLiteralAgainstSpec(node, expected, origin) {
    if (!node || !expected) return;
    if (expected.kind === 'optional') {
      if (node.type !== 'NullLiteral') validateLiteralAgainstSpec(node, expected.value, origin);
      return;
    }
    if (expected.kind === 'union') {
      const actual = literalType(node);
      if (!expected.values.some(item => specMatches(actual, item, schemas))) {
        diagnostics.push(diagnostic(`Expected ${typeName(expected)}, received ${actual || 'an expression'}.`, origin, 'PLN-TYPE-ARG'));
      }
      return;
    }
    if (expected.kind !== 'name' || !schemas.has(expected.name) || node.type !== 'InlineObjectLiteral') return;
    const schema = schemas.get(expected.name);
    const properties = new Map((node.properties || []).map(property => [property.key, property]));
    for (const field of schema.fields || []) {
      const property = properties.get(field.key);
      if (!property) {
        if (!isOptionalSpec(field.type)) diagnostics.push(diagnostic(`Argument is missing required field "${field.key}" for type "${expected.name}".`, origin, 'PLN-TYPE-FIELD'));
        continue;
      }
      const actual = literalType(property.value);
      if (actual && !specMatches(actual, field.type, schemas)) {
        diagnostics.push(diagnostic(`Field "${field.key}" expects ${typeName(field.type)}, received ${actual}.`, origin, 'PLN-TYPE-FIELD'));
      }
      validateLiteralAgainstSpec(property.value, field.type, origin);
    }
    for (const property of node.properties || []) {
      if (!(schema.fields || []).some(field => field.key === property.key)) {
        diagnostics.push(diagnostic(`Type "${expected.name}" has no field named "${property.key}".`, origin, 'PLN-TYPE-FIELD'));
      }
    }
  }

  function checkStatements(statements, env) {
    for (const node of statements || []) {
      if (!node) continue;
      if (node.type === 'RememberStatement' && typeof node.name === 'string') {
        const type = literalType(node.value);
        env.set(node.name, { type: type || 'any', node });
        checkExpression(node.value, env, node);
      } else if (node.type === 'FunctionDeclaration' || node.type === 'IntentDeclaration') {
        const nested = new Map(env);
        for (const param of node.params || []) {
          if (param.name) nested.set(param.name, { type: param.typeAnnotation && param.typeAnnotation.kind === 'name' ? param.typeAnnotation.name : 'any', node: param });
        }
        checkStatements(node.body, nested);
      } else {
        for (const value of Object.values(node)) {
          if (value && typeof value === 'object') {
            if (Array.isArray(value)) value.forEach(item => item && (item.type ? checkExpression(item, env, node) : checkStatements([item], env)));
            else if (value.type && value.type !== 'TypeDeclaration') checkExpression(value, env, node);
          }
        }
      }
    }
  }

  checkStatements(ast.body, new Map());
  return { diagnostics, ir };
}

module.exports = { checkTypes, typeName };
