// Stable, backend-neutral PlainScript intermediate representation.
//
// The current JavaScript backend still consumes the rich AST directly. This
// module establishes a serializable semantic boundary for tooling, diagnostics,
// contract analysis, and future backends without changing generated programs.

const IR_VERSION = 1;

function spanOf(node) {
  if (!node || typeof node !== 'object' || node.line == null) return undefined;
  return { line: node.line, column: node.col == null ? 1 : node.col };
}

function lowerValue(value) {
  if (Array.isArray(value)) return value.map(lowerValue);
  if (!value || typeof value !== 'object') return value;
  if (value.type === 'FunctionDeclaration' || value.type === 'IntentDeclaration') {
    return lowerDeclaration(value);
  }
  const out = { kind: value.type || 'Object' };
  const span = spanOf(value);
  if (span) out.span = span;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'type' || key === 'line' || key === 'col') continue;
    out[key] = lowerValue(child);
  }
  return out;
}

function lowerDeclaration(node) {
  const out = {
    kind: node.type === 'IntentDeclaration' ? 'IntentDeclaration' : 'FunctionDeclaration',
    name: node.name,
    parameters: lowerValue(node.params || []),
    body: lowerValue(node.body || []),
  };
  if (node.type === 'IntentDeclaration') {
    out.intent = lowerValue(node.intent || { kind: 'declaration', name: node.name });
  }
  const span = spanOf(node);
  if (span) out.span = span;
  return out;
}

function lowerToIR(ast) {
  if (!ast || ast.type !== 'Program') {
    throw new Error(`Expected a Program AST but got "${ast && ast.type}".`);
  }
  return {
    irVersion: IR_VERSION,
    language: 'PlainScript',
    kind: 'Program',
    body: ast.body.map(lowerValue),
  };
}

function serializeIR(ast, space = 2) {
  return JSON.stringify(lowerToIR(ast), null, space) + '\n';
}

module.exports = { IR_VERSION, lowerToIR, serializeIR };
