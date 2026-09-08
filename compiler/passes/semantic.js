const { inferTypes } = require('./inference');

function analyzeSemantics(ast, options = {}) {
  const errors = [];
  const warnings = [];
  const kinds = new Map(); // kindName -> Set of field names

  // Pass 1: Collect defined kinds
  function collectDeclarations(node) {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'DefineKindStatement') {
      const fieldNames = new Set();
      if (Array.isArray(node.fields)) {
        for (const f of node.fields) {
          if (f.key) fieldNames.add(f.key);
        }
      }
      kinds.set(node.name, fieldNames);
    }

    if (Array.isArray(node.body)) {
      node.body.forEach(collectDeclarations);
    }
  }

  collectDeclarations(ast);

  // Pass 2: Contextual semantic checking
  function checkNode(node, context) {
    if (!node || typeof node !== 'object') return;

    // Check CreateKindExpression (create a Player with ...)
    if (node.type === 'CreateKindExpression') {
      const kindName = node.kind;
      if (kinds.has(kindName)) {
        const allowedFields = kinds.get(kindName);
        if (Array.isArray(node.pairs)) {
          for (const pair of node.pairs) {
            if (pair.key && !allowedFields.has(pair.key)) {
              errors.push({
                line: node.line,
                col: node.col,
                message: `Unknown field "${pair.key}" on kind "${kindName}". Allowed fields are: ${Array.from(allowedFields).join(', ')}.`,
              });
            }
          }
        }
      } else {
        // Unknown kind name
        warnings.push({
          line: node.line,
          col: node.col,
          message: `Unknown kind "${kindName}". Make sure it is defined with 'define a kind called "${kindName}"'.`,
        });
      }
    }

    // Check loop control flow (break / continue outside loops)
    if (node.type === 'BreakStatement' || node.type === 'ContinueStatement') {
      if (!context.inLoop) {
        errors.push({
          line: node.line,
          col: node.col,
          message: `"${node.type === 'BreakStatement' ? 'break' : 'continue'}" can only be used inside loops (for / while).`,
        });
      }
    }

    // Prepare child context
    const childContext = {
      ...context,
      inLoop: context.inLoop || (node.type === 'ForStatement' || node.type === 'WhileStatement' || node.type === 'ForEachStatement' || node.type === 'ForIndexStatement' || node.type === 'RepeatTimesStatement'),
      inFunction: context.inFunction || (node.type === 'FunctionDeclaration'),
    };

    // Recurse into children
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (Array.isArray(val)) {
        val.forEach((item) => checkNode(item, childContext));
      } else if (val && typeof val === 'object' && val.type) {
        checkNode(val, childContext);
      }
    }
  }

  checkNode(ast, { inLoop: false, inFunction: false });

  // Pass 3: Type inference and strict type conflict checking
  const inference = inferTypes(ast, options);
  errors.push(...inference.errors);
  warnings.push(...inference.warnings);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    types: inference.types,
    symbols: inference.symbols,
    functions: inference.functions,
    kinds: inference.kinds,
    getTypeInfo: inference.getTypeInfo,
  };
}

module.exports = { analyzeSemantics };
