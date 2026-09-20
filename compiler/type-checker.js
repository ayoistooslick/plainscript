// Static type checking for PlainScript contracts and v1.1 language depth.
//
// The checker is intentionally conservative: unknown expressions remain `any`,
// while declared contracts, typed bindings, known literals, calls, members,
// collections, and branch-local null checks receive deterministic diagnostics.

const { lowerToIR } = require('./ir');

const PRIMITIVES = new Set(['any', 'number', 'text', 'boolean', 'null', 'object', 'list', 'dictionary']);

function diagnostic(message, node, code = 'PLN-TYPE') {
  const line = node && node.line ? node.line : 1;
  const column = node && node.col ? node.col : 1;
  return {
    severity: 1,
    source: 'plainscript',
    code,
    message,
    ...(node && node.sourceFile ? { file: node.sourceFile } : {}),
    range: {
      start: { line: line - 1, character: column - 1 },
      end: { line: line - 1, character: column },
    },
  };
}

function typeName(spec) {
  if (!spec) return 'any';
  if (typeof spec === 'string') return spec;
  if (spec.kind === 'name') return spec.name;
  if (spec.kind === 'optional') return `optional ${typeName(spec.value)}`;
  if (spec.kind === 'list') return `list of ${typeName(spec.value)}`;
  if (spec.kind === 'dictionary') return `dictionary of ${typeName(spec.value)}`;
  if (spec.kind === 'union') return spec.values.map(typeName).join(' or ');
  return 'any';
}

function nameSpec(name) { return { kind: 'name', name }; }
function listSpec(value = 'any') { return { kind: 'list', value }; }
function dictionarySpec(value = 'any') { return { kind: 'dictionary', value }; }

function isNullSpec(spec) {
  return spec && ((spec.kind === 'name' && spec.name === 'null') || spec === 'null');
}

function isOptionalSpec(spec) {
  return spec && (spec.kind === 'optional' || (spec.kind === 'union' && spec.values.some(isNullSpec)));
}

function withoutNull(spec) {
  if (!spec) return spec;
  if (spec.kind === 'optional') return spec.value;
  if (spec.kind === 'union') {
    const values = spec.values.filter(value => !isNullSpec(value));
    return values.length === 1 ? values[0] : { kind: 'union', values };
  }
  return spec;
}

function specMatches(actual, expected, schemas) {
  if (!expected || expected === 'any' || (expected.kind === 'name' && expected.name === 'any') || !actual || actual === 'any') return true;
  if (expected.kind === 'optional') return isNullSpec(actual) || specMatches(actual, expected.value, schemas);
  if (expected.kind === 'union') return expected.values.some(item => specMatches(actual, item, schemas));
  if (expected.kind === 'name') {
    if (expected.name === 'any') return true;
    if (expected.name === 'null') return isNullSpec(actual);
    if (expected.name === 'object') return typeName(actual) === 'object' || typeName(actual) === 'dictionary';
    if (expected.name === 'list' || expected.name === 'dictionary') return typeName(actual) === expected.name || actual.kind === expected.name;
    if (typeof actual === 'string') return expected.name === actual;
    if (actual.kind === 'name') return expected.name === actual.name;
    return schemas.has(expected.name) && (typeName(actual) === 'object' || actual.kind === 'name');
  }
  if (expected.kind === 'list') {
    if (actual === 'list') return true;
    if (!actual || actual.kind !== 'list') return false;
    return specMatches(actual.value, expected.value, schemas);
  }
  if (expected.kind === 'dictionary') {
    if (actual === 'dictionary' || actual === 'object') return true;
    if (!actual || actual.kind !== 'dictionary') return false;
    return specMatches(actual.value, expected.value, schemas);
  }
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
      if (!PRIMITIVES.has(spec.name) && !schemas.has(spec.name)) {
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
      symbols.set(node.name, { kind: 'type', node, type: nameSpec(node.name) });
    }
    if (node.type === 'FunctionDeclaration' || node.type === 'IntentDeclaration') {
      functions.set(node.name, node);
      symbols.set(node.name, { kind: node.type === 'IntentDeclaration' ? 'intent' : 'function', node, type: node.returnType || 'any' });
    }
    if (node.type === 'RememberStatement' && typeof node.name === 'string') symbols.set(node.name, { kind: 'variable', node, type: node.typeAnnotation || 'any' });
  }

  for (const node of ast.body || []) {
    if (node.type === 'TypeDeclaration') {
      for (const field of node.fields || []) addTypeSpecErrors(field.type, field);
    }
    if (node.type === 'FunctionDeclaration' || node.type === 'IntentDeclaration') {
      for (const param of node.params || []) if (param.typeAnnotation) addTypeSpecErrors(param.typeAnnotation, param);
      if (node.returnType) addTypeSpecErrors(node.returnType, node);
    }
    if (node.type === 'RememberStatement' && node.typeAnnotation) addTypeSpecErrors(node.typeAnnotation, node);
  }

  function fieldSpec(schemaName, fieldName) {
    const schema = schemas.get(schemaName);
    const field = schema && (schema.fields || []).find(item => item.key === fieldName);
    return field ? field.type : null;
  }

  function infer(node, env, origin = node) {
    if (!node) return 'any';
    if (node.type === 'Identifier') {
      const entry = env.get(node.name) || symbols.get(node.name);
      return entry && entry.type ? entry.type : 'any';
    }
    const literal = literalType(node);
    if (literal === 'list') {
      const elements = (node.elements || []).filter(item => item && item.type !== 'SpreadElement').map(item => infer(item, env, origin));
      const first = elements[0] || 'any';
      return listSpec(elements.every(item => specMatches(item, first, schemas)) ? first : 'any');
    }
    if (literal === 'object') return node.type === 'ObjectLiteral' ? dictionarySpec('any') : 'object';
    if (literal) return literal;
    if (node.type === 'MemberExpression') {
      let objectType = infer(node.object, env, origin);
      if (isOptionalSpec(objectType)) {
        diagnostics.push(diagnostic(`Value may be null before accessing field "${node.property}". Check it first.`, origin, 'PLN-TYPE-OPTIONAL'));
        objectType = withoutNull(objectType);
      }
      const schemaName = objectType && objectType.kind === 'name' ? objectType.name : objectType;
      if (schemaName && schemas.has(schemaName)) {
        const field = fieldSpec(schemaName, node.property);
        if (!field) diagnostics.push(diagnostic(`Type "${schemaName}" has no field named "${node.property}".`, origin, 'PLN-TYPE-FIELD'));
        return field || 'any';
      }
      if (objectType && objectType.kind === 'dictionary') return objectType.value;
      return 'any';
    }
    if (node.type === 'IndexExpression') {
      const objectType = infer(node.object, env, origin);
      if (objectType && (objectType.kind === 'list' || objectType.kind === 'dictionary')) return objectType.value;
      return 'any';
    }
    if (node.type === 'CallExpression') {
      const fn = functions.get(node.name);
      return fn && fn.returnType ? fn.returnType : 'any';
    }
    if (node.type === 'BinaryExpression') {
      if (['===', '!==', '>', '<', '>=', '<=', 'in'].includes(node.operator)) return 'boolean';
      const left = infer(node.left, env, origin);
      const right = infer(node.right, env, origin);
      if (node.operator === '+' && (typeName(left) === 'text' || typeName(right) === 'text')) return 'text';
      if (['+', '-', '*', '/', '%'].includes(node.operator) && typeName(left) === 'number' && typeName(right) === 'number') return 'number';
      return 'any';
    }
    if (node.type === 'ConditionalExpression') {
      const left = infer(node.consequent, env, origin);
      const right = infer(node.alternate, env, origin);
      return typeName(left) === typeName(right) ? left : { kind: 'union', values: [left, right] };
    }
    if (node.type === 'ConditionExpression' || node.type === 'BinaryCondition' || node.type === 'UnaryCondition' ||
        node.type === 'BetweenCondition' || node.type === 'StringCondition' || node.type === 'InCondition' ||
        node.type === 'NotInCondition' || node.type === 'LogicalCondition') return 'boolean';
    return 'any';
  }

  function expectedMatchesNode(node, expected, env, origin, path, emit = true) {
    if (!node || !expected) return true;
    if (expected.kind === 'optional') {
      if (node.type === 'NullLiteral') return true;
      return expectedMatchesNode(node, expected.value, env, origin, path, emit);
    }
    if (expected.kind === 'union') {
      const start = diagnostics.length;
      for (const option of expected.values) {
        diagnostics.length = start;
        if (expectedMatchesNode(node, option, env, origin, path, false)) {
          diagnostics.length = start;
          return expectedMatchesNode(node, option, env, origin, path, emit);
        }
      }
      diagnostics.length = start;
      if (emit) diagnostics.push(diagnostic(`${path ? `${path} ` : ''}expects ${typeName(expected)}, received ${typeName(infer(node, env, origin))}.`, origin, 'PLN-TYPE-ELEMENT'));
      return false;
    }
    if (expected.kind === 'list') {
      const actual = infer(node, env, origin);
      if (node.type !== 'ArrayLiteral') {
        const ok = specMatches(actual, expected, schemas);
        if (!ok && emit) diagnostics.push(diagnostic(`${path ? `${path} ` : ''}expects ${typeName(expected)}, received ${typeName(actual)}.`, origin, 'PLN-TYPE-COLLECTION'));
        return ok;
      }
      let ok = true;
      (node.elements || []).forEach((element, index) => {
        if (element && element.type === 'SpreadElement') return;
        if (!expectedMatchesNode(element, expected.value, env, origin, `${path || 'Collection'} element ${index + 1}`, emit)) ok = false;
      });
      return ok;
    }
    if (expected.kind === 'dictionary') {
      const actual = infer(node, env, origin);
      if (node.type !== 'ObjectLiteral' && node.type !== 'InlineObjectLiteral') {
        const ok = specMatches(actual, expected, schemas);
        if (!ok && emit) diagnostics.push(diagnostic(`${path ? `${path} ` : ''}expects ${typeName(expected)}, received ${typeName(actual)}.`, origin, 'PLN-TYPE-COLLECTION'));
        return ok;
      }
      let ok = true;
      (node.properties || []).forEach(property => {
        if (property.type === 'SpreadProperty') return;
        if (!expectedMatchesNode(property.value, expected.value, env, origin, `${path || 'Dictionary'} value "${property.key}"`, emit)) ok = false;
      });
      return ok;
    }
    if (expected.kind === 'name' && schemas.has(expected.name) &&
        (node.type === 'InlineObjectLiteral' || node.type === 'ObjectLiteral')) {
      const schema = schemas.get(expected.name);
      const properties = new Map((node.properties || []).map(property => [property.key, property]));
      let ok = true;
      for (const field of schema.fields || []) {
        const property = properties.get(field.key);
        if (!property) {
          if (!isOptionalSpec(field.type)) {
            if (emit) diagnostics.push(diagnostic(`${path ? `${path} ` : ''}is missing required field "${field.key}" for type "${expected.name}".`, origin, 'PLN-TYPE-FIELD'));
            ok = false;
          }
          continue;
        }
        const start = diagnostics.length;
        if (!expectedMatchesNode(property.value, field.type, env, origin, `${path ? `${path} ` : ''}field "${field.key}"`, emit)) ok = false;
        for (let index = start; index < diagnostics.length; index += 1) {
          const item = diagnostics[index];
          if (item.code === 'PLN-TYPE-ARG' || item.code === 'PLN-TYPE-ELEMENT' || item.code === 'PLN-TYPE-COLLECTION') item.code = 'PLN-TYPE-FIELD';
        }
      }
      for (const property of node.properties || []) {
        if (!(schema.fields || []).some(field => field.key === property.key)) {
          if (emit) diagnostics.push(diagnostic(`${path ? `${path} ` : ''}type "${expected.name}" has no field named "${property.key}".`, origin, 'PLN-TYPE-FIELD'));
          ok = false;
        }
      }
      return ok;
    }
    const actual = infer(node, env, origin);
    const ok = specMatches(actual, expected, schemas);
    if (!ok && emit) diagnostics.push(diagnostic(`${path ? `${path} ` : ''}expects ${typeName(expected)}, received ${typeName(actual)}.`, origin, 'PLN-TYPE-ARG'));
    return ok;
  }

  function checkExpression(node, env, origin = node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'MemberExpression' || node.type === 'IndexExpression') {
      infer(node, env, origin);
      checkExpression(node.object, env, origin);
      if (node.index) checkExpression(node.index, env, origin);
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
          if (param && param.typeAnnotation) expectedMatchesNode(arg, param.typeAnnotation, env, origin, `Argument ${index + 1} of "${node.name}"`);
          checkExpression(arg, env, origin);
        });
      } else {
        node.args.forEach(arg => checkExpression(arg, env, origin));
      }
      return;
    }
    if (node.type === 'BinaryExpression') {
      checkExpression(node.left, env, origin);
      checkExpression(node.right, env, origin);
      return;
    }
    if (node.type === 'ConditionalExpression') {
      checkExpression(node.condition, env, origin);
      checkExpression(node.consequent, env, origin);
      checkExpression(node.alternate, env, origin);
      return;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) value.forEach(item => checkExpression(item, env, origin));
        else if (value.type) checkExpression(value, env, origin);
      }
    }
  }

  function narrowEnvironment(env, condition, truthy) {
    const next = new Map(env);
    function apply(left, operator, right) {
      if (!left || left.type !== 'Identifier' || !right || right.type !== 'NullLiteral') return;
      const entry = next.get(left.name);
      if (!entry || !isOptionalSpec(entry.type)) return;
      const isNonNull = operator === 'is not' || operator === '!==' || operator === 'different from';
      if (truthy === isNonNull) next.set(left.name, { ...entry, type: withoutNull(entry.type) });
    }
    if (condition && condition.type === 'ConditionExpression') return narrowEnvironment(next, condition.value, truthy);
    if (condition && condition.type === 'BinaryCondition') apply(condition.left, condition.op, condition.right);
    if (condition && condition.type === 'LogicalCondition' && condition.op === 'and' && truthy) {
      narrowEnvironment(narrowEnvironment(next, condition.left, true), condition.right, true).forEach((value, key) => next.set(key, value));
    }
    return next;
  }

  function checkStatements(statements, env, returnType = null, functionName = null) {
    for (const node of statements || []) {
      if (!node) continue;
      if (node.type === 'RememberStatement' && typeof node.name === 'string') {
        if (node.typeAnnotation) expectedMatchesNode(node.value, node.typeAnnotation, env, node, `Variable "${node.name}"`);
        const inferred = node.typeAnnotation || infer(node.value, env, node);
        env.set(node.name, { type: inferred || 'any', node });
        symbols.set(node.name, { kind: 'variable', node, type: inferred || 'any' });
        checkExpression(node.value, env, node);
      } else if (node.type === 'FunctionDeclaration' || node.type === 'IntentDeclaration') {
        const nested = new Map(env);
        for (const param of node.params || []) if (param.name) nested.set(param.name, { type: param.typeAnnotation || 'any', node: param });
        checkStatements(node.body, nested, node.returnType || null, node.name);
        checkFunctionReturns(node, nested);
      } else if (node.type === 'IfStatement') {
        checkExpression(node.condition, env, node);
        checkStatements(node.consequent, narrowEnvironment(env, node.condition, true), returnType, functionName);
        if (node.alternate) checkStatements(node.alternate, narrowEnvironment(env, node.condition, false), returnType, functionName);
      } else if (node.type === 'BecomeStatement') {
        checkExpression(node.value, env, node);
        const actual = infer(node.value, env, node);
        if (node.target && node.target.type === 'Identifier') {
          const entry = env.get(node.target.name);
          if (entry && entry.type && !specMatches(actual, entry.type, schemas)) {
            diagnostics.push(diagnostic(`Assignment to "${node.target.name}" expects ${typeName(entry.type)}, received ${typeName(actual)}.`, node, 'PLN-TYPE-ASSIGN'));
          }
          if (entry && node.op === '=') env.set(node.target.name, { ...entry, type: actual });
        }
      } else if (node.type === 'GiveStatement' || node.type === 'ReturnStatement') {
        checkExpression(node.value, env, node);
        if (returnType && node.value) {
          const start = diagnostics.length;
          expectedMatchesNode(node.value, returnType, env, node, `Function "${functionName}" return`);
          for (let index = start; index < diagnostics.length; index += 1) {
            const item = diagnostics[index];
            if (item.code === 'PLN-TYPE-ARG' || item.code === 'PLN-TYPE-ELEMENT' || item.code === 'PLN-TYPE-COLLECTION') item.code = 'PLN-TYPE-RETURN';
          }
        }
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

  function collectReturns(statements, result = []) {
    for (const node of statements || []) {
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'GiveStatement' || node.type === 'ReturnStatement') result.push(node);
      for (const key of ['body', 'consequent', 'alternate', 'handlers', 'finalizer']) {
        const child = node[key];
        if (Array.isArray(child)) collectReturns(child, result);
        else if (child && typeof child === 'object') collectReturns([child], result);
      }
    }
    return result;
  }

  function checkFunctionReturns(fn, env) {
    if (!fn.returnType) return;
    const returns = collectReturns(fn.body);
    if (returns.length === 0) {
      diagnostics.push(diagnostic(`Function "${fn.name}" declares ${typeName(fn.returnType)} but does not return a value.`, fn, 'PLN-TYPE-RETURN-MISSING'));
      return;
    }
    if (returns.some(statement => !statement.value) && !isOptionalSpec(fn.returnType)) {
      diagnostics.push(diagnostic(`Function "${fn.name}" returns ${typeName(fn.returnType)} but this return has no value.`, fn, 'PLN-TYPE-RETURN'));
    }
  }

  // Imports are resolved by the bundler before this checker receives a graph.
  // A flattened graph therefore exposes declarations from every local module;
  // report only names that are genuinely absent and ignore npm imports.
  for (const node of ast.body || []) {
    if (node.type !== 'ImportStatement' || !node.path || !node.path.endsWith('.pln') && !node.path.startsWith('.') && !node.path.startsWith('@/') && !node.path.startsWith('/')) continue;
    const imported = node.names || (node.defaultImport ? [node.defaultImport] : []);
    for (const name of imported) {
      if (!symbols.has(name)) diagnostics.push(diagnostic(`Imported symbol "${name}" was not found in the resolved module graph.`, node, 'PLN-MODULE-UNKNOWN'));
    }
  }

  checkStatements(ast.body, new Map());
  return { diagnostics, ir };
}

module.exports = { checkTypes, typeName, specMatches };
