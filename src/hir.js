'use strict';

const T = require('./types');

// The high-level IR is where PlainScript stops looking like source and starts
// looking like a program. Every construct that the source grammar offers as a
// convenience is desugared here exactly once:
//
//   "a {b} c"            -> template literal
//   xs |> filter(f)      -> filter(xs, f)
//   render ... element   -> return createElement(tag, props, ...children)
//   Circle(1)            -> { $kind: "Circle", radius: 1 }
//   Empty                -> "Empty"
//   x as T               -> x
//
// The backend consumes only HIR, so a future backend (WASM, bytecode) can reuse
// this pass and the checker unchanged. `plainscript ir` prints this tree.

const JS_RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'yield', 'let', 'static', 'await', 'implements', 'interface', 'package',
  'private', 'protected', 'public', 'arguments', 'eval', 'undefined', 'NaN', 'Infinity',
]);

function jsName(name) {
  return JS_RESERVED.has(name) ? `$${name}` : name;
}

class Lowerer {
  constructor(options) {
    this.checker = options.checker;
    this.file = options.file;
    this.matchCounter = 0;
    this.childrenCounter = 0;
    this.unitVariants = options.unitVariants || new Set();
    this.variantFields = options.variantFields || new Map();
    this.typeOnlyImports = options.typeOnlyImports || new Set();
  }

  program(ast) {
    const body = [];
    for (const statement of ast.body) {
      const lowered = this.statement(statement);
      if (Array.isArray(lowered)) body.push(...lowered);
      else if (lowered) body.push(lowered);
    }
    return { kind: 'Program', file: this.file, body };
  }

  statement(node) {
    switch (node.kind) {
      case 'Import': {
        const names = node.names.filter((name) => !this.typeOnlyImports.has(name.local));
        // A module imported only for its types has no runtime dependency.
        if (!node.defaultName && !node.namespace && names.length === 0) return null;
        return {
          kind: 'Import',
          spec: node.spec,
          defaultName: node.defaultName,
          namespace: node.namespace,
          names,
          line: node.line,
          col: node.col,
        };
      }
      case 'ExportNamed':
        if (node.spec) {
          return { kind: 'ReExport', names: node.names, spec: node.spec, line: node.line, col: node.col };
        }
        return { kind: 'ExportNamed', names: node.names, line: node.line, col: node.col };
      case 'ExportDefault':
        return { kind: 'ExportDefault', value: this.expression(node.value), line: node.line, col: node.col };
      case 'TypeDecl':
      case 'DeclareFunction':
      case 'DeclareValue':
      case 'OverloadDecl':
        return null;
      case 'FunctionDecl':
        return this.functionDeclaration(node);
      case 'VarDecl':
        return {
          kind: 'VarDecl',
          declKind: node.declKind,
          pattern: this.pattern(node.pattern),
          init: this.expression(node.init),
          exported: node.exported,
          line: node.line,
          col: node.col,
        };
      case 'Assignment':
        return {
          kind: 'Assignment',
          target: this.expression(node.target),
          operator: node.operator,
          value: this.expression(node.value),
          line: node.line,
          col: node.col,
        };
      case 'ExprStmt':
        return { kind: 'ExprStmt', expression: this.expression(node.expression), line: node.line, col: node.col };
      case 'Conditional':
        return {
          kind: 'Conditional',
          branches: node.branches.map((branch) => ({
            condition: this.expression(branch.condition),
            body: this.block(branch.body),
          })),
          otherwise: node.otherwise ? this.block(node.otherwise) : null,
          line: node.line,
          col: node.col,
        };
      case 'ForEach':
        return {
          kind: 'ForEach',
          pattern: this.pattern(node.pattern),
          iterable: this.expression(node.iterable),
          body: this.block(node.body),
          line: node.line,
          col: node.col,
        };
      case 'ForRange':
        return {
          kind: 'ForRange',
          pattern: this.pattern(node.pattern),
          from: this.expression(node.from),
          to: this.expression(node.to),
          body: this.block(node.body),
          line: node.line,
          col: node.col,
        };
      case 'While':
        return {
          kind: 'While',
          condition: this.expression(node.condition),
          body: this.block(node.body),
          line: node.line,
          col: node.col,
        };
      case 'Match':
        return {
          kind: 'Match',
          subject: this.expression(node.subject),
          cases: node.cases.map((branch) => ({
            pattern: branch.pattern,
            guard: branch.guard ? this.expression(branch.guard) : null,
            body: this.block(branch.body),
          })),
          line: node.line,
          col: node.col,
        };
      case 'Try':
        return {
          kind: 'Try',
          body: this.block(node.body),
          errorName: node.errorName,
          handler: node.handler ? this.block(node.handler) : null,
          finalizer: node.finalizer ? this.block(node.finalizer) : null,
          line: node.line,
          col: node.col,
        };
      case 'Throw':
        return { kind: 'Throw', value: this.expression(node.value), line: node.line, col: node.col };
      case 'Return':
        return { kind: 'Return', value: this.expression(node.value), line: node.line, col: node.col };
      case 'Break':
        return { kind: 'Break', line: node.line, col: node.col };
      case 'Continue':
        return { kind: 'Continue', line: node.line, col: node.col };
      case 'Render':
        return {
          kind: 'Render',
          call: this.elementCall(node.children),
          line: node.line,
          col: node.col,
        };
      case 'Element':
        return {
          kind: 'ExprStmt',
          expression: this.elementCall([node]),
          line: node.line,
          col: node.col,
        };
      default:
        throw new Error(`Lowering does not support statement ${node.kind}`);
    }
  }

  block(statements) {
    const body = [];
    for (const statement of statements) {
      const lowered = this.statement(statement);
      if (Array.isArray(lowered)) body.push(...lowered);
      else if (lowered) body.push(lowered);
    }
    return body;
  }

  pattern(node) {
    if (!node) return null;
    if (node.kind === 'NamePattern') return { kind: 'Name', name: node.name };
    if (node.kind === 'TuplePattern') {
      return { kind: 'ArrayPattern', items: node.items.map((item) => this.pattern(item)) };
    }
    if (node.kind === 'RecordPattern') {
      return {
        kind: 'ObjectPattern',
        fields: node.fields.map((field) => ({ key: field.key, target: this.pattern(field.target) })),
      };
    }
    return { kind: 'Name', name: node.name };
  }

  functionDeclaration(node) {
    const body = this.block(node.body);
    return {
      kind: 'FunctionDecl',
      name: node.name,
      params: node.params.map((parameter) => ({
        name: parameter.name,
        defaultValue: parameter.defaultValue ? this.expression(parameter.defaultValue) : null,
        rest: Boolean(parameter.rest),
        optional: Boolean(parameter.optional),
        line: parameter.line,
        col: parameter.col,
      })),
      body,
      async: Boolean(node.async) || containsAwait(node.body),
      exported: Boolean(node.exported),
      defaultExport: Boolean(node.defaultExport),
      line: node.line,
      col: node.col,
    };
  }

  expression(node) {
    if (!node) return { kind: 'Nothing' };
    switch (node.kind) {
      case 'Number':
        return { kind: 'Number', value: node.value, line: node.line, col: node.col };
      case 'Text':
        return { kind: 'Text', value: node.value, line: node.line, col: node.col };
      case 'Boolean':
        return { kind: 'Boolean', value: node.value, line: node.line, col: node.col };
      case 'Nothing':
        return { kind: 'Nothing', line: node.line, col: node.col };
      case 'Template':
        return {
          kind: 'Template',
          parts: node.parts.map((part) => part.kind === 'TemplateText'
            ? { kind: 'TemplateText', value: part.value }
            : { kind: 'TemplateExpression', expression: this.expression(part.expression) }),
          line: node.line,
          col: node.col,
        };
      case 'Name': {
        // A variant with no fields has no state to carry, so it is its own name
        // at runtime: `Empty` is "Empty". Variants with fields construct tagged
        // records (see call()).
        if (this.unitVariants.has(node.name)) {
          return { kind: 'Text', value: node.name, line: node.line, col: node.col };
        }
        return { kind: 'Name', name: node.name, line: node.line, col: node.col };
      }
      case 'ListLiteral':
        return { kind: 'List', items: node.items.map((item) => this.expression(item)), line: node.line, col: node.col };
      case 'RecordLiteral':
        return {
          kind: 'Record',
          fields: node.fields.map((field) => field.spread
            ? { spread: this.expression(field.spread) }
            : { key: field.key, value: this.expression(field.value) }),
          line: node.line,
          col: node.col,
        };
      case 'Member':
        return {
          kind: 'Member',
          object: this.expression(node.object),
          property: node.property,
          optional: Boolean(node.optional),
          line: node.line,
          col: node.col,
        };
      case 'Index':
        return {
          kind: 'Index',
          object: this.expression(node.object),
          index: this.expression(node.index),
          optional: Boolean(node.optional),
          line: node.line,
          col: node.col,
        };
      case 'Call':
        return this.call(node);
      case 'Await':
        return { kind: 'Await', value: this.expression(node.value), line: node.line, col: node.col };
      case 'Unary':
        return { kind: 'Unary', operator: node.operator, operand: this.expression(node.operand), line: node.line, col: node.col };
      case 'Binary':
        return {
          kind: 'Binary',
          operator: node.operator,
          left: this.expression(node.left),
          right: this.expression(node.right),
          line: node.line,
          col: node.col,
        };
      case 'TypeTest':
        return {
          kind: 'TypeTest',
          value: this.expression(node.value),
          type: this.checker.resolveType(node.type),
          line: node.line,
          col: node.col,
        };
      case 'Cast':
        return this.expression(node.value);
      case 'Pipe':
        return this.pipe(node);
      case 'FunctionExpression':
        return {
          kind: 'Lambda',
          params: node.params.map((parameter) => ({
            name: parameter.name,
            defaultValue: parameter.defaultValue ? this.expression(parameter.defaultValue) : null,
            rest: Boolean(parameter.rest),
          })),
          expression: node.expression ? this.expression(node.expression) : null,
          body: node.body ? this.block(node.body) : null,
          async: Boolean(node.async) || (node.body ? containsAwait(node.body) : false),
          line: node.line,
          col: node.col,
        };
      case 'New':
        return { kind: 'New', callee: this.expression(node.callee), line: node.line, col: node.col };
      case 'Spread':
        return { kind: 'Spread', value: this.expression(node.value), line: node.line, col: node.col };
      case 'Element':
        return this.elementCall([node]);
      default:
        throw new Error(`Lowering does not support expression ${node.kind}`);
    }
  }

  call(node) {
    // Variant construction with fields becomes a tagged record.
    if (node.callee.kind === 'Name' && this.variantFields.has(node.callee.name)) {
      const fields = this.variantFields.get(node.callee.name);
      return {
        kind: 'Record',
        fields: [
          { key: '$kind', value: { kind: 'Text', value: node.callee.name } },
          ...fields.map((field, index) => ({
            key: field,
            value: node.args[index] ? this.expression(node.args[index]) : { kind: 'Nothing' },
          })),
        ],
        line: node.line,
        col: node.col,
      };
    }
    return {
      kind: 'Call',
      callee: this.expression(node.callee),
      args: node.args.map((argument) => this.expression(argument)),
      optional: Boolean(node.optional),
      line: node.line,
      col: node.col,
    };
  }

  pipe(node) {
    if (node.right.kind === 'Call') {
      return this.call({ ...node.right, args: [node.left, ...node.right.args] });
    }
    // A pipeline stage may be a named function, a member function, or a lambda.
    // `items |> (x: number) => x * 2` is the lambda form.
    return this.call({ kind: 'Call', callee: node.right, args: [node.left], line: node.line, col: node.col });
  }

  // A render/element child is one of: a nested element, an expression, or a
  // control-flow statement that contributes zero or more children. Loops and
  // branches are how a render block builds a dynamic child list without
  // leaving the language; they are lowered to an inline array builder below.
  childExpression(child) {
    if (child.kind === 'Element') return this.elementExpression(child);
    if (child.kind === 'ExprStmt') return this.expression(child.expression);
    if (child.kind === 'Render') return this.elementCall(child.children);
    return null;
  }

  isControlFlow(node) {
    return node.kind === 'ForEach' || node.kind === 'ForRange' || node.kind === 'Conditional'
      || node.kind === 'While' || node.kind === 'Match';
  }

  // Rewrite a render body so every produced child is pushed onto `target`.
  // Control flow nests recursively: a loop inside an `otherwise` branch still
  // only contributes the children its executed path creates.
  pushChildren(target, statements) {
    const out = [];
    for (const statement of statements) {
      const value = this.childExpression(statement);
      if (value) {
        out.push({
          kind: 'ExprStmt',
          expression: {
            kind: 'Call',
            callee: { kind: 'Member', object: { kind: 'Name', name: target }, property: 'push' },
            args: [value],
            line: statement.line,
            col: statement.col,
          },
          line: statement.line,
          col: statement.col,
        });
        continue;
      }
      if (this.isControlFlow(statement)) {
        out.push(this.controlFlowInRender(statement, target));
        continue;
      }
      const lowered = this.statement(statement);
      if (lowered) out.push(lowered);
    }
    return out;
  }

  controlFlowInRender(node, target) {
    switch (node.kind) {
      case 'ForEach':
        return {
          kind: 'ForEach',
          pattern: this.pattern(node.pattern),
          iterable: this.expression(node.iterable),
          body: this.pushChildren(target, node.body),
          line: node.line,
          col: node.col,
        };
      case 'ForRange':
        return {
          kind: 'ForRange',
          pattern: this.pattern(node.pattern),
          from: this.expression(node.from),
          to: this.expression(node.to),
          body: this.pushChildren(target, node.body),
          line: node.line,
          col: node.col,
        };
      case 'While':
        return {
          kind: 'While',
          condition: this.expression(node.condition),
          body: this.pushChildren(target, node.body),
          line: node.line,
          col: node.col,
        };
      case 'Conditional':
        return {
          kind: 'Conditional',
          branches: node.branches.map((branch) => ({
            condition: this.expression(branch.condition),
            body: this.pushChildren(target, branch.body),
          })),
          otherwise: node.otherwise ? this.pushChildren(target, node.otherwise) : null,
          line: node.line,
          col: node.col,
        };
      case 'Match':
        return {
          kind: 'Match',
          subject: this.expression(node.subject),
          cases: node.cases.map((branch) => ({
            pattern: branch.pattern,
            guard: branch.guard ? this.expression(branch.guard) : null,
            body: this.pushChildren(target, branch.body),
          })),
          line: node.line,
          col: node.col,
        };
      default:
        throw new Error(`Lowering does not support ${node.kind} inside a render block`);
    }
  }

  // Build the child list for a control-flow statement as an immediately
  // invoked arrow: `...(() => { const $children1 = []; ...; return $children1; })()`.
  controlFlowChildren(node) {
    const id = this.childrenCounter += 1;
    const name = `$children${id}`;
    const body = [
      {
        kind: 'VarDecl',
        declKind: 'let',
        pattern: { kind: 'Name', name },
        init: { kind: 'List', items: [] },
        line: node.line,
        col: node.col,
      },
      this.controlFlowInRender(node, name),
      { kind: 'Return', value: { kind: 'Name', name }, line: node.line, col: node.col },
    ];
    const call = {
      kind: 'Call',
      callee: {
        kind: 'Lambda',
        params: [],
        expression: null,
        body,
        async: containsAwait([node]),
      },
      args: [],
      line: node.line,
      col: node.col,
    };
    // Only an async lambda needs the enclosing function to await its result.
    if (call.callee.async) return { kind: 'Spread', value: { kind: 'Await', value: call } };
    return { kind: 'Spread', value: call };
  }

  elementCall(children) {
    // A render block is exactly one element tree; plain child expressions are
    // wrapped by the factory as-is. Multiple top-level children keep the
    // original `div` wrapper so existing programs emit the same markup.
    if (children.length === 1 && children[0].kind === 'Element') {
      return this.elementExpression(children[0]);
    }
    const args = [];
    for (const child of children) {
      const value = this.childExpression(child);
      if (value) { args.push(value); continue; }
      if (this.isControlFlow(child)) args.push(this.controlFlowChildren(child));
      // A statement that cannot produce a child (return/throw/break) is left to
      // the checker, which reports it; dropping it here avoids a crash.
    }
    return {
      kind: 'Call',
      callee: { kind: 'Name', name: 'createElement' },
      args: [
        { kind: 'Text', value: 'div' },
        { kind: 'Nothing' },
        ...args,
      ],
    };
  }

  elementExpression(node) {
    const props = node.props.length
      ? {
        kind: 'Record',
        fields: node.props.map((property) => ({ key: property.key, value: this.expression(property.value) })),
      }
      : { kind: 'Nothing' };
    const children = [];
    for (const child of node.children) {
      const value = this.childExpression(child);
      if (value) { children.push(value); continue; }
      if (this.isControlFlow(child)) children.push(this.controlFlowChildren(child));
    }
    return {
      kind: 'Call',
      callee: { kind: 'Name', name: 'createElement' },
      args: [this.expression(node.tag), props, ...children],
    };
  }
}

function containsAwait(statements) {
  let found = false;
  const walk = (value) => {
    if (found || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    if (value.kind === 'FunctionDecl' || value.kind === 'FunctionExpression') return;
    if (value.kind === 'Await') { found = true; return; }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'line' || key === 'col' || key === 'kind' || key.startsWith('__')) continue;
      walk(child);
    }
  };
  walk(statements);
  return found;
}

function lowerProgram(ast, options) {
  const lowerer = new Lowerer(options);
  const program = lowerer.program(ast);
  return program;
}

module.exports = { lowerProgram, Lowerer, jsName, JS_RESERVED, containsAwait };
