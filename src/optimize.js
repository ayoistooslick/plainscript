'use strict';

// A small, semantics-preserving HIR optimizer. It folds literals whose result
// is exactly what JavaScript would compute and removes statements that can
// never run. It deliberately keeps declarations after a terminator because
// function declarations are hoisted and may be called from before the return.

const SKIP_KEYS = new Set(['line', 'col', 'file', 'type', 'nameLine', 'nameCol']);
const BLOCK_KEYS = new Set(['body', 'handler', 'finalizer', 'otherwise']);
const HOISTED = new Set(['FunctionDecl', 'ClassDecl', 'VarDecl', 'Import']);
const TERMINATORS = new Set(['Return', 'Throw', 'Break', 'Continue']);

function literal(node) {
  switch (node.kind) {
    case 'Number':
    case 'BigInt':
    case 'Text':
    case 'Boolean':
    case 'Nothing':
      return node;
    default:
      return null;
  }
}

function number(value, node) {
  if (!Number.isFinite(value)) return null;
  return { kind: 'Number', value, line: node.line, col: node.col };
}

function bigint(value, node) {
  return { kind: 'BigInt', value: String(value), line: node.line, col: node.col };
}

function boolean(value, node) {
  return { kind: 'Boolean', value, line: node.line, col: node.col };
}

function text(value, node) {
  return { kind: 'Text', value, line: node.line, col: node.col };
}

function foldUnary(node) {
  const value = literal(node.operand);
  if (!value) return node;
  if (node.operator === 'not' && value.kind === 'Boolean') return boolean(!value.value, node);
  if (node.operator === '-' && value.kind === 'Number' && value.value !== 0) return number(-value.value, node);
  if (node.operator === '+' && value.kind === 'Number') return value;
  if (node.operator === '-' && value.kind === 'BigInt') return bigint(-BigInt(value.value), node);
  return node;
}

function foldBinary(node) {
  const left = literal(node.left);
  const right = literal(node.right);
  if (!left || !right) return node;
  const operator = node.operator;

  if (left.kind === 'Boolean' && right.kind === 'Boolean') {
    if (operator === 'and') return boolean(left.value && right.value, node);
    if (operator === 'or') return boolean(left.value || right.value, node);
    if (operator === '==' || operator === '===') return boolean(left.value === right.value, node);
    if (operator === '!=' || operator === '!==') return boolean(left.value !== right.value, node);
  }

  if (left.kind === 'Text' && right.kind === 'Text') {
    if (operator === '==' || operator === '===') return boolean(left.value === right.value, node);
    if (operator === '!=' || operator === '!==') return boolean(left.value !== right.value, node);
  }

  if ((left.kind === 'Nothing' || right.kind === 'Nothing')) {
    if (operator === '==' || operator === '===') return boolean(left.kind === right.kind, node);
    if (operator === '!=' || operator === '!==') return boolean(left.kind !== right.kind, node);
  }

  if (left.kind === 'Number' && right.kind === 'Number') {
    const a = left.value;
    const b = right.value;
    switch (operator) {
      case '+': return number(a + b, node);
      case '-': return number(a - b, node);
      case '*': return number(a * b, node);
      case '/': return b === 0 ? null : number(a / b, node);
      case '%': return b === 0 ? null : number(a % b, node);
      case '**': return number(a ** b, node);
      case '==':
      case '===': return boolean(a === b, node);
      case '!=':
      case '!==': return boolean(a !== b, node);
      case '<': return boolean(a < b, node);
      case '>': return boolean(a > b, node);
      case '<=': return boolean(a <= b, node);
      case '>=': return boolean(a >= b, node);
      default: return node;
    }
  }

  if (left.kind === 'BigInt' && right.kind === 'BigInt') {
    const a = BigInt(left.value);
    const b = BigInt(right.value);
    switch (operator) {
      case '+': return bigint(a + b, node);
      case '-': return bigint(a - b, node);
      case '*': return bigint(a * b, node);
      case '/': return b === 0n ? null : bigint(a / b, node);
      case '%': return b === 0n ? null : bigint(a % b, node);
      case '**': return bigint(a ** b, node);
      case '==':
      case '===': return boolean(a === b, node);
      case '!=':
      case '!==': return boolean(a !== b, node);
      case '<': return boolean(a < b, node);
      case '>': return boolean(a > b, node);
      case '<=': return boolean(a <= b, node);
      case '>=': return boolean(a >= b, node);
      default: return node;
    }
  }

  return node;
}

function fold(node) {
  switch (node.kind) {
    case 'Unary':
      return foldUnary(node) || node;
    case 'Binary':
      return foldBinary(node) || node;
    case 'Ternary': {
      const condition = literal(node.condition);
      if (condition && condition.kind === 'Boolean') return condition.value ? node.whenTrue : node.whenFalse;
      return node;
    }
    case 'Template': {
      if (node.parts.every((part) => part.kind === 'TemplateText')) {
        return text(node.parts.map((part) => part.value).join(''), node);
      }
      return node;
    }
    default:
      return node;
  }
}

function prune(statements, stats) {
  let terminated = false;
  const kept = [];
  for (const statement of statements) {
    if (terminated && !HOISTED.has(statement.kind)) {
      stats.removed += 1;
      continue;
    }
    kept.push(statement);
    if (TERMINATORS.has(statement.kind)) terminated = true;
  }
  if (kept.length !== statements.length) statements.splice(0, statements.length, ...kept);
  return statements;
}

function optimizeValue(value, stats, seen) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = optimizeValue(value[index], stats, seen);
    }
    return value;
  }

  for (const key of Object.keys(value)) {
    if (SKIP_KEYS.has(key)) continue;
    const child = value[key];
    if (child && typeof child === 'object') {
      value[key] = optimizeValue(child, stats, seen);
      if (Array.isArray(value[key]) && BLOCK_KEYS.has(key)) prune(value[key], stats);
    }
  }

  const before = value.kind;
  const optimized = fold(value);
  if (optimized !== value && before !== optimized.kind) stats.folded += 1;
  return optimized;
}

function optimizeProgram(program) {
  const stats = { folded: 0, removed: 0 };
  optimizeValue(program, stats, new WeakSet());
  return stats;
}

module.exports = { optimizeProgram };
