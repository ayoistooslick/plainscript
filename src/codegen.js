'use strict';

const { jsName } = require('./hir');
const { SourceMap } = require('./sourcemap');
const { deref } = require('./types');

const INDENT = '    ';

class Lines {
  constructor() {
    this.items = [];
  }

  push(depth, text, node) {
    this.items.push({ depth, text, node });
  }

  toString() {
    return this.items.map((item) => `${INDENT.repeat(item.depth)}${item.text}`).join('\n');
  }
}

class CodeGen {
  constructor(options = {}) {
    this.file = options.file || '<input>';
    this.outFile = options.outFile || null;
    this.mapSpecifier = options.mapSpecifier || ((spec) => spec);
    this.lines = new Lines();
    this.matchId = 0;
  }

  generate(program) {
    for (const statement of program.body) {
      if (statement.kind === 'Import') this.importStatement(statement);
    }
    for (const statement of program.body) {
      if (statement.kind !== 'Import') this.statement(statement, 0);
    }

    const code = `${this.lines.toString()}\n`;
    const map = new SourceMap(this.outFile);
    this.lines.items.forEach((item, index) => {
      if (!item.node || !item.node.line) return;
      map.add(index + 1, 0, item.node.line, item.node.col || 1, this.file);
    });
    return { code, map };
  }

  // ---------------------------------------------------------------- statements

  importStatement(node) {
    const specifier = this.mapSpecifier(node.spec);
    const quote = JSON.stringify(specifier);

    if (!node.defaultName && !node.namespace && node.names.length === 0) {
      this.lines.push(0, `import ${quote};`, node);
      return;
    }

    if (node.namespace) {
      this.lines.push(0, `import * as ${jsName(node.namespace)} from ${quote};`, node);
      return;
    }

    const named = node.names.length
      ? `{ ${node.names.map((name) => (name.imported === name.local
        ? jsName(name.imported)
        : `${jsName(name.imported)} as ${jsName(name.local)}`)).join(', ')} }`
      : '';
    const parts = [node.defaultName ? jsName(node.defaultName) : null, named].filter(Boolean);
    this.lines.push(0, `import ${parts.join(', ')} from ${quote};`, node);
  }

  statement(node, depth) {
    switch (node.kind) {
      case 'Import':
        return;
      case 'FunctionDecl':
        this.functionDeclaration(node, depth);
        return;
      case 'VarDecl': {
        const keyword = node.exported ? 'export ' : '';
        const declaration = node.declKind === 'let' ? 'let' : 'const';
        this.lines.push(depth, `${keyword}${declaration} ${this.pattern(node.pattern)} = ${this.expr(node.init)};`, node);
        return;
      }
      case 'Assignment': {
        const operator = node.operator === '=' ? '=' : `${node.operator}=`;
        this.lines.push(depth, `${this.expr(node.target)} ${operator} ${this.expr(node.value)};`, node);
        return;
      }
      case 'ExprStmt':
        this.lines.push(depth, `${this.expr(node.expression)};`, node);
        return;
      case 'Conditional': {
        node.branches.forEach((branch, index) => {
          const keyword = index === 0 ? 'if' : '} else if';
          this.lines.push(depth, `${keyword} (${this.expr(branch.condition)}) {`, branch.condition);
          this.block(branch.body, depth + 1);
        });
        if (node.otherwise) {
          this.lines.push(depth, '} else {', node);
          this.block(node.otherwise, depth + 1);
        }
        this.lines.push(depth, '}', node);
        return;
      }
      case 'ForEach': {
        const pattern = node.pattern.kind === 'Name'
          ? this.pattern(node.pattern)
          : `$${this.matchId += 1}`;
        this.lines.push(depth, `for (const ${pattern} of ${this.expr(node.iterable)}) {`, node);
        if (node.pattern.kind !== 'Name') {
          this.lines.push(depth + 1, `const ${this.pattern(node.pattern)} = ${pattern};`, node);
        }
        this.block(node.body, depth + 1);
        this.lines.push(depth, '}', node);
        return;
      }
      case 'ForRange': {
        const name = node.pattern.kind === 'Name' ? jsName(node.pattern.name) : '$i';
        const upper = `$to${this.matchId += 1}`;
        this.lines.push(depth, `for (let ${name} = ${this.expr(node.from)}, ${upper} = ${this.expr(node.to)}; ${name} <= ${upper}; ${name} += 1) {`, node);
        if (node.pattern.kind !== 'Name') {
          this.lines.push(depth + 1, `const ${this.pattern(node.pattern)} = ${name};`, node);
        }
        this.block(node.body, depth + 1);
        this.lines.push(depth, '}', node);
        return;
      }
      case 'While':
        this.lines.push(depth, `while (${this.expr(node.condition)}) {`, node);
        this.block(node.body, depth + 1);
        this.lines.push(depth, '}', node);
        return;
      case 'Match':
        this.matchStatement(node, depth);
        return;
      case 'Try': {
        this.lines.push(depth, 'try {', node);
        this.block(node.body, depth + 1);
        if (node.handler) {
          this.lines.push(depth, `} catch (${jsName(node.errorName)}) {`, node);
          this.block(node.handler, depth + 1);
        }
        if (node.finalizer) {
          this.lines.push(depth, '} finally {', node);
          this.block(node.finalizer, depth + 1);
        }
        this.lines.push(depth, '}', node);
        return;
      }
      case 'Throw':
        this.lines.push(depth, `throw ${this.expr(node.value)};`, node);
        return;
      case 'Return':
        this.lines.push(depth, `return ${this.expr(node.value)};`, node);
        return;
      case 'Break':
        this.lines.push(depth, 'break;', node);
        return;
      case 'Continue':
        this.lines.push(depth, 'continue;', node);
        return;
      case 'Render':
        this.lines.push(depth, `return ${this.expr(node.call)};`, node);
        return;
      case 'ExportNamed':
        this.lines.push(depth, `export { ${node.names.map((name) => (name.local === name.exported
          ? jsName(name.local)
          : `${jsName(name.local)} as ${jsName(name.exported)}`)).join(', ')} };`, node);
        return;
      case 'ReExport': {
        const specifier = this.mapSpecifier(node.spec);
        this.lines.push(depth, `export { ${node.names.map((name) => (name.local === name.exported
          ? jsName(name.local)
          : `${jsName(name.local)} as ${jsName(name.exported)}`)).join(', ')} } from ${JSON.stringify(specifier)};`, node);
        return;
      }
      case 'ExportDefault':
        this.lines.push(depth, `export default ${this.expr(node.value)};`, node);
        return;
      default:
        throw new Error(`The JavaScript backend does not support ${node.kind}`);
    }
  }

  block(statements, depth) {
    if (!statements.length) {
      this.lines.push(depth, '// empty', null);
      return;
    }
    for (const statement of statements) this.statement(statement, depth);
  }

  functionDeclaration(node, depth) {
    const keyword = node.defaultExport ? 'export default ' : (node.exported ? 'export ' : '');
    const asyncKeyword = node.async ? 'async ' : '';
    const params = node.params.map((parameter) => {
      const rest = parameter.rest ? '...' : '';
      const defaultValue = parameter.defaultValue ? ` = ${this.expr(parameter.defaultValue)}` : '';
      return `${rest}${jsName(parameter.name)}${defaultValue}`;
    }).join(', ');
    const declaredName = node.name ? ` ${jsName(node.name)}` : '';
    this.lines.push(depth, `${keyword}${asyncKeyword}function${declaredName}(${params}) {`, node);
    this.block(node.body, depth + 1);
    this.lines.push(depth, '}', node);
  }

  pattern(node) {
    switch (node.kind) {
      case 'Name':
        return jsName(node.name);
      case 'ArrayPattern': {
        const items = node.items.map((item) => (item ? this.pattern(item) : ''));
        return `[${items.join(', ')}]`;
      }
      case 'ObjectPattern': {
        const fields = node.fields.map((field) => {
          const target = this.pattern(field.target);
          return field.key === target ? field.key : `${field.key}: ${target}`;
        });
        return `{ ${fields.join(', ')} }`;
      }
      default:
        throw new Error(`Unsupported binding pattern ${node.kind}`);
    }
  }

  // ------------------------------------------------------------------- match

  matchStatement(node, depth) {
    const id = this.matchId += 1;
    const subject = `$match${id}`;
    const label = `$arm${id}`;
    this.lines.push(depth, '{', node);
    this.lines.push(depth + 1, `const ${subject} = ${this.expr(node.subject)};`, node.subject);
    this.lines.push(depth + 1, `${label}: {`, node);

    for (const branch of node.cases) {
      const compiled = this.patternCondition(branch.pattern, subject);
      this.lines.push(depth + 2, `if (${compiled.condition}) {`, branch.pattern);
      for (const binding of compiled.bindings) this.lines.push(depth + 3, binding, branch.pattern);
      if (branch.guard) {
        this.lines.push(depth + 3, `if (${this.expr(branch.guard)}) {`, branch.guard);
        for (const statement of branch.body) this.statement(statement, depth + 4);
        this.lines.push(depth + 4, `break ${label};`, branch.guard);
        this.lines.push(depth + 3, '}', branch.guard);
      } else {
        for (const statement of branch.body) this.statement(statement, depth + 3);
        this.lines.push(depth + 3, `break ${label};`, branch.pattern);
      }
      this.lines.push(depth + 2, '}', branch.pattern);
    }

    this.lines.push(depth + 1, '}', node);
    this.lines.push(depth, '}', node);
  }

  patternCondition(pattern, subject, bindings = []) {
    switch (pattern.kind) {
      case 'WildcardPattern':
        return { condition: 'true', bindings };
      case 'LiteralPattern': {
        const value = pattern.value;
        const literal = value.kind === 'Nothing' ? 'null'
          : value.kind === 'Boolean' ? String(value.value)
            : value.kind === 'Text' ? JSON.stringify(value.value)
              : String(value.value);
        return { condition: `${subject} === ${literal}`, bindings };
      }
      case 'NamePattern':
        // A name that is a unit variant is a value pattern, not a binding.
        if (this.unitVariants && this.unitVariants.has(pattern.name)) {
          return { condition: `${subject} === ${JSON.stringify(pattern.name)}`, bindings };
        }
        bindings.push(`const ${jsName(pattern.name)} = ${subject};`);
        return { condition: 'true', bindings };
      case 'VariantPattern': {
        bindings.push('');
        bindings.pop();
        const fields = (this.variantFields && this.variantFields.get(pattern.name)) || [];
        const checks = [`${subject} !== null`, `typeof ${subject} === "object"`, `${subject}.$kind === ${JSON.stringify(pattern.name)}`];
        pattern.fields.forEach((field, index) => {
          const fieldName = fields[index] || `field${index}`;
          const nested = this.patternCondition(field, `${subject}[${JSON.stringify(fieldName)}]`, bindings);
          if (nested.condition !== 'true') checks.push(nested.condition);
        });
        return { condition: checks.join(' && '), bindings };
      }
      case 'ListPattern': {
        const checks = [`Array.isArray(${subject})`, `${subject}.length >= ${pattern.items.length}`];
        pattern.items.forEach((item, index) => {
          const nested = this.patternCondition(item, `${subject}[${index}]`, bindings);
          if (nested.condition !== 'true') checks.push(nested.condition);
        });
        if (pattern.rest) bindings.push(`const ${jsName(pattern.rest)} = ${subject}.slice(${pattern.items.length});`);
        return { condition: checks.join(' && '), bindings };
      }
      case 'TuplePattern': {
        const checks = [`Array.isArray(${subject})`];
        pattern.items.forEach((item, index) => {
          const nested = this.patternCondition(item, `${subject}[${index}]`, bindings);
          if (nested.condition !== 'true') checks.push(nested.condition);
        });
        return { condition: checks.join(' && '), bindings };
      }
      case 'RecordMatchPattern': {
        const checks = [`${subject} !== null`, `typeof ${subject} === "object"`];
        for (const field of pattern.fields) {
          checks.push(`${JSON.stringify(field.key)} in ${subject}`);
          const nested = this.patternCondition(field.pattern, `${subject}[${JSON.stringify(field.key)}]`, bindings);
          if (nested.condition !== 'true') checks.push(nested.condition);
        }
        return { condition: checks.join(' && '), bindings };
      }
      default:
        throw new Error(`Unsupported pattern ${pattern.kind}`);
    }
  }

  // -------------------------------------------------------------- expressions

  expr(node) {
    switch (node.kind) {
      case 'Number':
        return Number.isFinite(node.value) ? String(node.value) : 'NaN';
      case 'Text':
        return JSON.stringify(node.value);
      case 'Boolean':
        return node.value ? 'true' : 'false';
      case 'Nothing':
        return 'null';
      case 'Template': {
        const parts = node.parts.map((part) => (part.kind === 'TemplateText'
          ? escapeTemplate(part.value)
          : `\${${this.expr(part.expression)}}`)).join('');
        return `\`${parts}\``;
      }
      case 'Name':
        return jsName(node.name);
      case 'List':
        return `[${node.items.map((item) => (item.kind === 'Spread'
          ? `...${this.expr(item.value)}`
          : this.expr(item))).join(', ')}]`;
      case 'Record': {
        const fields = node.fields.map((field) => {
          if (field.spread) return `...${this.expr(field.spread)}`;
          const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field.key) ? field.key : JSON.stringify(field.key);
          return `${key}: ${this.expr(field.value)}`;
        });
        return `{ ${fields.join(', ')} }`;
      }
      case 'Member': {
        const object = wrap(this.expr(node.object));
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(node.property)) {
          return `${object}${node.optional ? '?.' : '.'}${node.property}`;
        }
        return `${object}${node.optional ? '?.' : ''}[${JSON.stringify(node.property)}]`;
      }
      case 'Index': {
        const object = this.expr(node.object);
        const index = this.expr(node.index);
        return `${wrap(object)}${node.optional ? '?.' : ''}[${index}]`;
      }
      case 'Call': {
        const callee = this.expr(node.callee);
        const args = node.args.map((argument) => (argument.kind === 'Spread'
          ? `...${this.expr(argument.value)}`
          : this.expr(argument))).join(', ');
        return `${wrap(callee)}${node.optional ? '?.' : ''}(${args})`;
      }
      case 'Await':
        return `(await ${this.expr(node.value)})`;
      case 'Unary':
        return `(${node.operator === 'not' ? '!' : '-'}${wrap(this.expr(node.operand))})`;
      case 'Binary':
        return `(${this.expr(node.left)} ${jsOperator(node.operator)} ${this.expr(node.right)})`;
      case 'TypeTest':
        return this.typeTest(node.type, this.expr(node.value));
      case 'New': {
        const callee = node.callee;
        if (callee.kind === 'Call') {
          const args = callee.args.map((argument) => (argument.kind === 'Spread'
            ? `...${this.expr(argument.value)}`
            : this.expr(argument))).join(', ');
          return `new ${wrap(this.expr(callee.callee))}(${args})`;
        }
        return `new ${wrap(this.expr(callee))}()`;
      }
      case 'Lambda': {
        const asyncKeyword = node.async ? 'async ' : '';
        const params = node.params.map((parameter) => `${parameter.rest ? '...' : ''}${jsName(parameter.name)}${parameter.defaultValue ? ` = ${this.expr(parameter.defaultValue)}` : ''}`).join(', ');
        if (node.expression) return `${asyncKeyword}(${params}) => ${wrap(this.expr(node.expression))}`;
        const inner = new CodeGen({ file: this.file, outFile: this.outFile, mapSpecifier: this.mapSpecifier });
        inner.unitVariants = this.unitVariants;
        inner.variantFields = this.variantFields;
        inner.matchId = this.matchId;
        for (const statement of node.body) inner.statement(statement, 1);
        this.matchId = inner.matchId;
        const rendered = inner.lines.items.map((item) => `${INDENT.repeat(item.depth)}${item.text}`).join('\n');
        return `${asyncKeyword}(${params}) => {\n${rendered}\n}`;
      }
      case 'Spread':
        return `...${this.expr(node.value)}`;
      default:
        throw new Error(`The JavaScript backend does not support ${node.kind}`);
    }
  }

  typeTest(type, value) {
    const v = wrap(value);
    switch (type.k) {
      case 'prim':
        switch (type.name) {
          case 'number': return `(typeof ${v} === "number")`;
          case 'text': return `(typeof ${v} === "string")`;
          case 'boolean': return `(typeof ${v} === "boolean")`;
          case 'nothing': return `(${v} === null || ${v} === undefined)`;
          case 'any':
          case 'unknown': return 'true';
          case 'never': return 'false';
          default: return 'false';
        }
      case 'list': return `Array.isArray(${v})`;
      case 'map': return `(${v} !== null && typeof ${v} === "object" && !Array.isArray(${v}))`;
      case 'promise': return `(${v} !== null && typeof ${v} === "object" && typeof ${v}.then === "function")`;
      case 'fn': return `(typeof ${v} === "function")`;
      case 'record': {
        const checks = [`${v} !== null`, `typeof ${v} === "object"`];
        for (const [name, field] of type.fields) {
          if (!field.optional) checks.push(`${JSON.stringify(name)} in ${v}`);
        }
        return `(${checks.join(' && ')})`;
      }
      case 'variant':
        return `(${v} !== null && typeof ${v} === "object" && ${v}.$kind === ${JSON.stringify(type.name)})`;
      case 'unit':
        return `(${v} === ${JSON.stringify(type.name)})`;
      case 'union':
        return `(${type.members.map((member) => this.typeTest(member, value)).join(' || ')})`;
      case 'var':
        return 'true';
      case 'named':
        return this.typeTest(deref(type), value);
      default:
        return 'true';
    }
  }
}

function jsOperator(operator) {
  switch (operator) {
    case 'and': return '&&';
    case 'or': return '||';
    default: return operator;
  }
}

// Parenthesise anything that is not a plain identifier or dotted path. The
// conservative rule keeps precedence correct for calls, members and indexes
// without a second pass over the emitted expression.
const SIMPLE_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

function wrap(code) {
  return SIMPLE_PATH.test(code) ? code : `(${code})`;
}

function escapeTemplate(text) {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function generate(program, options) {
  const generator = new CodeGen(options);
  generator.unitVariants = options.unitVariants || new Set();
  generator.variantFields = options.variantFields || new Map();
  return generator.generate(program);
}

module.exports = { generate, CodeGen };
