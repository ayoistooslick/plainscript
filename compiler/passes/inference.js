// compiler/passes/inference.js
// Semantic Type Inference & Compile-Time Rigor Engine for PlainScript.
// Provides bidirectional type inference, incompatible reassignment detection,
// SQL query schema typing, and symbol type lookup for LSP hover.

const { mapTypeName } = require('./types');

// Canonical PlainScript Primitive & Compound Types:
// 'number' | 'text' | 'boolean' | 'list' | 'list<T>' | 'record' | 'record<Kind>' | 'promise<T>' | 'function' | 'null' | 'any'

function isCompatible(expected, actual) {
  if (!expected || !actual) return true;
  if (expected === 'any' || actual === 'any') return true;
  if (expected === actual) return true;
  if (expected === 'text' && (actual === 'string' || actual === 'text')) return true;
  if (expected === 'string' && (actual === 'string' || actual === 'text')) return true;
  if (expected === 'number' && actual === 'number') return true;
  if (expected === 'boolean' && actual === 'boolean') return true;
  if (expected.startsWith('list') && actual.startsWith('list')) return true;
  if (expected.startsWith('record') && actual.startsWith('record')) return true;
  if (expected.startsWith('promise') && actual.startsWith('promise')) return true;
  return false;
}

function parseSqlSelectColumns(sql) {
  if (typeof sql !== 'string') return null;
  const match = /select\s+(.+?)\s+from\s+/i.exec(sql.trim());
  if (!match) return null;
  const cols = match[1].split(',').map((c) => {
    const parts = c.trim().split(/\s+as\s+/i);
    const colName = parts[parts.length - 1].trim().replace(/^['"`]|['"`]$/g, '');
    const cleanName = colName.split('.').pop();
    return cleanName;
  });
  return cols.filter(Boolean);
}

// Built-in stdlib signature table
const STDLIB_RETURN_TYPES = {
  range: 'list<number>',
  uppercase: 'text',
  lowercase: 'text',
  trim: 'text',
  truncate: 'text',
  padStart: 'text',
  padEnd: 'text',
  startsWith: 'boolean',
  endsWith: 'boolean',
  includes: 'boolean',
  contains: 'boolean',
  jsonEncode: 'text',
  jsonDecode: 'any',
  clamp: 'number',
  similarity: 'number',
  sha256: 'text',
  base64Encode: 'text',
  base64Decode: 'text',
  textToBytes: 'list<number>',
  bytesToText: 'text',
  chat: 'promise<text>',
  chatWith: 'promise<text>',
  embedText: 'promise<list<number>>',
  paginate: 'record<{ items: list, count: number, page: number, pages: number }>',
  flatten: 'list',
  first: 'any',
  last: 'any',
  pick: 'record',
  omit: 'record',
  groupBy: 'record',
};

class Scope {
  constructor(parent = null) {
    this.parent = parent;
    this.bindings = new Map(); // name -> { type, line, col, isConst }
  }

  declare(name, type, meta = {}) {
    this.bindings.set(name, {
      type: type || 'any',
      line: meta.line,
      col: meta.col,
      isConst: Boolean(meta.isConst),
    });
  }

  lookup(name) {
    if (this.bindings.has(name)) return this.bindings.get(name);
    if (this.parent) return this.parent.lookup(name);
    return null;
  }

  update(name, newType) {
    if (this.bindings.has(name)) {
      const current = this.bindings.get(name);
      this.bindings.set(name, { ...current, type: newType });
      return current;
    }
    if (this.parent) return this.parent.update(name, newType);
    return null;
  }
}

function inferTypes(ast, options = {}) {
  const errors = [];
  const warnings = [];
  const symbolMap = new Map(); // "line:col:name" -> { name, type, kind, doc }
  const nameToType = new Map(); // name -> type
  const functionSignatures = new Map(); // fnName -> { returnType, paramTypes }
  const kinds = new Map(); // kindName -> Map(fieldName -> type)

  const globalScope = new Scope();

  // Helper to record symbol hover metadata
  function recordSymbol(name, type, kind, line, col, doc = '') {
    if (!name) return;
    nameToType.set(name, type);
    if (line != null) {
      symbolMap.set(`${line}:${col}:${name}`, { name, type, kind, line, col, doc });
    }
  }

  // Pass 1: Collect declared Record Kinds
  function collectKinds(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'DefineKindStatement') {
      const fieldMap = new Map();
      if (Array.isArray(node.fields)) {
        for (const f of node.fields) {
          const fName = f.key || f.name;
          const fType = inferExprNode(f.value || f.default, globalScope);
          fieldMap.set(fName, fType);
        }
      }
      kinds.set(node.name, fieldMap);
      recordSymbol(node.name, `kind ${node.name}`, 'kind', node.line, node.col);
    }
    if (Array.isArray(node.body)) node.body.forEach(collectKinds);
  }
  collectKinds(ast);

  // Expression type inference
  function inferExprNode(expr, scope) {
    if (!expr || typeof expr !== 'object') return 'any';

    switch (expr.type) {
      case 'NumberLiteral':
        return 'number';

      case 'StringLiteral':
      case 'TemplateLiteral':
        return 'text';

      case 'BooleanLiteral':
        return 'boolean';

      case 'NullLiteral':
        return 'null';

      case 'ArrayLiteral':
      case 'ListLiteral': {
        if (!expr.elements || expr.elements.length === 0) return 'list';
        const firstType = inferExprNode(expr.elements[0], scope);
        return `list<${firstType}>`;
      }

      case 'ObjectLiteral':
      case 'InlineObjectLiteral':
      case 'RecordLiteral': {
        if (expr.properties && Array.isArray(expr.properties)) {
          const fieldDescs = expr.properties.map((p) => {
            const k = p.key || p.name;
            const vType = inferExprNode(p.value, scope);
            return `${k}: ${vType}`;
          });
          return `record<{ ${fieldDescs.join(', ')} }>`;
        }
        return 'record';
      }

      case 'Identifier': {
        const found = scope.lookup(expr.name);
        if (found) {
          recordSymbol(expr.name, found.type, 'variable', expr.line, expr.col);
          return found.type;
        }
        return 'any';
      }

      case 'BinaryExpression': {
        const leftType = inferExprNode(expr.left, scope);
        const rightType = inferExprNode(expr.right, scope);
        const op = expr.operator;

        if (op === '+') {
          if (leftType === 'text' || rightType === 'text') return 'text';
          if (leftType === 'number' && rightType === 'number') return 'number';
          return 'number';
        }
        if (['- ', '-', '*', '/', '%'].includes(op)) {
          return 'number';
        }
        return 'any';
      }

      case 'BinaryCondition':
      case 'UnaryCondition':
      case 'BetweenCondition':
      case 'StringCondition':
      case 'LogicalCondition':
      case 'InCondition':
      case 'NotInCondition':
        return 'boolean';

      case 'CallExpression': {
        const callee = expr.callee;
        const calleeName = typeof callee === 'string'
          ? callee
          : (callee && callee.name ? callee.name : expr.name);

        if (calleeName) {
          if (STDLIB_RETURN_TYPES[calleeName]) {
            return STDLIB_RETURN_TYPES[calleeName];
          }
          if (functionSignatures.has(calleeName)) {
            return functionSignatures.get(calleeName).returnType || 'any';
          }
        }
        return 'any';
      }

      case 'CreateKindExpression': {
        const kindName = expr.kind;
        return `record<${kindName}>`;
      }

      case 'CountOfExpression':
      case 'LengthExpression':
        return 'number';

      case 'FirstItemExpression':
      case 'LastItemExpression':
      case 'NumberedItem':
        return 'any';

      case 'SpreadExpression':
        return 'list';

      case 'AwaitExpression': {
        const inner = inferExprNode(expr.argument, scope);
        if (inner.startsWith('promise<') && inner.endsWith('>')) {
          return inner.slice(8, -1);
        }
        return inner;
      }

      case 'QueryStatement': {
        const sql = expr.sql;
        const cols = parseSqlSelectColumns(sql);
        if (cols && cols.length > 0) {
          const colTypes = cols.map((c) => `${c}: any`).join(', ');
          return `list<record<{ ${colTypes} }>>`;
        }
        return 'list<record>';
      }

      default:
        return 'any';
    }
  }

  // Pass 2: Function return type deduction
  function inspectFunctions(node) {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'FunctionDeclaration') {
      const fnName = node.name;
      let returnType = 'void';

      function findReturns(n) {
        if (!n || typeof n !== 'object') return;
        if (n.type === 'GiveStatement') {
          if (n.value) {
            returnType = inferExprNode(n.value, globalScope);
          } else {
            returnType = 'null';
          }
        }
        for (const k of Object.keys(n)) {
          if (Array.isArray(n[k])) n[k].forEach(findReturns);
          else if (typeof n[k] === 'object') findReturns(n[k]);
        }
      }

      findReturns(node);
      const paramTypes = (node.params || []).map((p) => {
        const pName = typeof p === 'string' ? p : p.name;
        return { name: pName, type: 'any' };
      });

      functionSignatures.set(fnName, { returnType, paramTypes });
      recordSymbol(fnName, `function ${fnName}(...): ${returnType}`, 'function', node.line, node.col);
    }

    if (Array.isArray(node.body)) node.body.forEach(inspectFunctions);
  }
  inspectFunctions(ast);

  // Pass 3: Statement Analysis & Reassignment Checking
  function analyzeNode(node, scope) {
    if (!node || typeof node !== 'object') return;

    // 1. Variable Declarations: remember / let
    if (node.type === 'RememberStatement' || node.type === 'VariableDeclaration') {
      const varName = node.name;
      const initVal = node.value || node.initializer;
      const inferredType = inferExprNode(initVal, scope);

      if (typeof varName === 'string') {
        scope.declare(varName, inferredType, { line: node.line, col: node.col, isConst: node.isConstant });
        recordSymbol(varName, inferredType, 'variable', node.line, node.col);
      }
    }

    // 2. Variable Reassignment: becomes / is now / set to
    if (node.type === 'BecomeStatement') {
      const target = node.target;
      const valNode = node.value;
      const newType = inferExprNode(valNode, scope);

      if (target && target.type === 'Identifier') {
        const varName = target.name;
        const binding = scope.lookup(varName);

        if (binding) {
          const origType = binding.type;

          // Check incompatible reassignment
          if (origType !== 'any' && newType !== 'any' && !isCompatible(origType, newType)) {
            errors.push({
              line: node.line || target.line,
              col: node.col || target.col,
              message: `Type mismatch: cannot assign "${newType}" to variable "${varName}" declared as "${origType}".`,
              varName,
              expectedType: origType,
              actualType: newType,
            });
          } else {
            // Refine type
            scope.update(varName, newType);
          }
          recordSymbol(varName, newType, 'variable', target.line, target.col);
        }
      }
    }

    // 3. Database Query Statements
    if (node.type === 'RememberSqlStatement') {
      const varName = node.name;
      const sql = node.sql;
      let resultType = 'any';
      if (node.kind === 'query') {
        const cols = parseSqlSelectColumns(sql);
        resultType = cols && cols.length > 0
          ? `list<record<{ ${cols.map((c) => `${c}: any`).join(', ')} }>>`
          : 'list<record>';
      } else {
        resultType = 'record<{ changes: number, lastInsertRowid: number }>';
      }
      scope.declare(varName, resultType, { line: node.line, col: node.col });
      recordSymbol(varName, resultType, 'variable', node.line, node.col);
    }

    if (node.type === 'QueryStatement') {
      const targetVar = node.into;
      if (targetVar) {
        const cols = parseSqlSelectColumns(node.sql);
        const resultType = cols && cols.length > 0
          ? `list<record<{ ${cols.map((c) => `${c}: any`).join(', ')} }>>`
          : 'list<record>';
        scope.declare(targetVar, resultType, { line: node.line, col: node.col });
        recordSymbol(targetVar, resultType, 'variable', node.line, node.col);
      }
    }

    // 4. Function Scopes
    if (node.type === 'FunctionDeclaration') {
      const fnScope = new Scope(scope);
      if (Array.isArray(node.params)) {
        for (const p of node.params) {
          const pName = typeof p === 'string' ? p : p.name;
          fnScope.declare(pName, 'any', { line: node.line, col: node.col });
          recordSymbol(pName, 'any', 'parameter', node.line, node.col);
        }
      }
      if (Array.isArray(node.body)) {
        for (const stmt of node.body) {
          analyzeNode(stmt, fnScope);
        }
      }
      return;
    }

    // 5. Block Scopes (if, while, repeat, for)
    if (node.type === 'IfStatement' || node.type === 'WhileStatement' ||
        node.type === 'RepeatTimesStatement' || node.type === 'ForEachStatement' ||
        node.type === 'ForIndexStatement') {
      const blockScope = new Scope(scope);
      if (node.type === 'ForEachStatement' && node.item) {
        blockScope.declare(node.item, 'any', { line: node.line, col: node.col });
      }
      if (node.type === 'ForIndexStatement' && node.variable) {
        blockScope.declare(node.variable, 'number', { line: node.line, col: node.col });
      }
      if (Array.isArray(node.body)) {
        for (const stmt of node.body) {
          analyzeNode(stmt, blockScope);
        }
      }
      if (Array.isArray(node.otherwise)) {
        for (const stmt of node.otherwise) {
          analyzeNode(stmt, blockScope);
        }
      }
      return;
    }

    // Recurse into children
    for (const k of Object.keys(node)) {
      if (k === 'body' || k === 'otherwise') continue;
      const child = node[k];
      if (Array.isArray(child)) {
        for (const c of child) analyzeNode(c, scope);
      } else if (child && typeof child === 'object' && child.type) {
        analyzeNode(child, scope);
      }
    }
  }

  if (Array.isArray(ast.body)) {
    for (const stmt of ast.body) {
      analyzeNode(stmt, globalScope);
    }
  }

  // Lookup helper for LSP hover: find type by symbol name or coordinates
  function getTypeInfo(name, line, col) {
    if (line != null && col != null) {
      const key = `${line}:${col}:${name}`;
      if (symbolMap.has(key)) return symbolMap.get(key);
    }
    if (name && nameToType.has(name)) {
      return { name, type: nameToType.get(name) };
    }
    if (name && functionSignatures.has(name)) {
      const sig = functionSignatures.get(name);
      return { name, type: `function(...): ${sig.returnType}` };
    }
    return null;
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    types: nameToType,
    symbols: symbolMap,
    functions: functionSignatures,
    kinds,
    getTypeInfo,
  };
}

module.exports = {
  inferTypes,
  isCompatible,
  parseSqlSelectColumns,
  STDLIB_RETURN_TYPES,
};
