'use strict';

// Declaration (.d.pln) generation.
// A compiled PlainScript library should be consumable by another PlainScript
// project without shipping sources. A `.d.pln` file describes the module's
// public surface — exported types, function signatures (including inferred
// return types), exported values and re-exports — and is read by the checker
// exactly like the hand-written files under `stdlib/`.
// Signatures come from the checked module, not from the source text: a return
// type that was inferred is printed from the checker's resolved type, so the
// declaration matches what the compiler actually enforced.

function printTypeNode(node) {
  if (!node) return 'any';
  switch (node.kind) {
    case 'NamedType': {
      const args = node.args && node.args.length ? `<${node.args.map(printTypeNode).join(', ')}>` : '';
      return `${node.name}${args}`;
    }
    case 'ListType':
      return `list of ${atomNode(node.elem)}`;
    case 'MapType':
      return `map of ${atomNode(node.key)} to ${atomNode(node.value)}`;
    case 'PromiseType':
      return `Promise of ${atomNode(node.value)}`;
    case 'OptionalType':
      return `${atomNode(node.inner)}?`;
    case 'UnionType':
      return node.members
        .map((member) => (member.kind === 'FunctionType' ? `(${printTypeNode(member)})` : printTypeNode(member)))
        .join(' or ');
    case 'IntersectionType':
      return node.members
        .map((member) => (member.kind === 'UnionType' || member.kind === 'FunctionType' ? `(${printTypeNode(member)})` : printTypeNode(member)))
        .join(' & ');
    case 'TupleType':
      return `[${node.elements.map(printTypeNode).join(', ')}]`;
    case 'LiteralType':
      return typeof node.value === 'string' ? JSON.stringify(node.value) : String(node.value);
    case 'ConditionalType':
      return `${printTypeNode(node.check)} extends ${printTypeNode(node.extendsType)} ? ${printTypeNode(node.trueType)} : ${printTypeNode(node.falseType)}`;
    case 'MappedType':
      return `{ [${node.keyName} in ${printTypeNode(node.keyType)}]${node.optional ? '?' : ''}: ${printTypeNode(node.valueType)} }`;
    case 'KeyofType':
      return `keyof ${printTypeNode(node.target)}`;
    case 'IndexedAccessType':
      return `${printTypeNode(node.target)}[${printTypeNode(node.index)}]`;
    case 'TypeofType':
      return node.value && node.value.kind === 'Name' ? `typeof ${node.value.name}` : 'any';
    case 'PredicateType':
      return `${node.parameter} is ${printTypeNode(node.target)}`;
    case 'FunctionType': {
      const params = node.params.map((parameter) => {
        const rest = parameter.rest ? '...' : '';
        const optional = parameter.optional && !parameter.rest ? '?' : '';
        const name = parameter.name ? `${parameter.name}${optional}: ` : '';
        return `${rest}${name}${printTypeNode(parameter.type)}`;
      }).join(', ');
      return `(${params}) -> ${printTypeNode(node.ret)}`;
    }
    case 'RecordType':
      return node.fields.length
        ? `{ ${node.fields.map((field) => `${field.name}${field.optional ? '?' : ''}: ${printTypeNode(field.type)}`).join(', ')} }`
        : '{ }';
    case 'VariantType':
      return `${node.name}(${node.fields.map((field) => `${field.name}: ${printTypeNode(field.type)}`).join(', ')})`;
    default:
      return 'any';
  }
}

// `list of`, `map … to`, `Promise of` and `?` take a primary type, so a union
// or function type in that position needs parentheses.
function atomNode(node) {
  if (!node) return 'any';
  const text = printTypeNode(node);
  return node.kind === 'UnionType' || node.kind === 'FunctionType' ? `(${text})` : text;
}

function printType(type) {
  if (!type) return 'any';
  switch (type.k) {
    case 'prim':
    case 'var':
    case 'named':
    case 'unit':
      return type.name;
    case 'list':
      return `list of ${atomType(type.elem)}`;
    case 'tuple':
      return `[${(type.elements || []).map(printType).join(', ')}]`;
    case 'literal':
      return typeof type.value === 'string' ? JSON.stringify(type.value) : String(type.value);
    case 'conditional':
      return `${printType(type.check)} extends ${printType(type.extends)} ? ${printType(type.trueType)} : ${printType(type.falseType)}`;
    case 'keyof':
      return `keyof ${atomType(type.target)}`;
    case 'indexed':
      return `${atomType(type.target)}[${printType(type.index)}]`;
    case 'mapped':
      return `{ [${type.variable || 'K'} in ${printType(type.key)}]${type.optional ? '?' : ''}: ${printType(type.value)} }`;
    case 'map':
      return `map of ${atomType(type.key)} to ${atomType(type.value)}`;
    case 'promise':
      return `Promise of ${atomType(type.value)}`;
    case 'union':
      return type.members
        .map((member) => (member.k === 'fn' ? `(${printType(member)})` : printType(member)))
        .join(' or ');
    case 'fn': {
      const params = type.params.map((parameter) => {
        const rest = parameter.rest ? '...' : '';
        const optional = parameter.optional && !parameter.rest ? '?' : '';
        const name = parameter.name ? `${parameter.name}${optional}: ` : '';
        return `${rest}${name}${printType(parameter.type)}`;
      }).join(', ');
      return `(${params}) -> ${printType(type.ret)}`;
    }
    case 'record': {
      if (type.name) return type.name;
      const fields = [...type.fields.entries()]
        .map(([name, field]) => `${name}${field.optional ? '?' : ''}: ${printType(field.type)}`)
        .join(', ');
      return `{ ${fields} }`;
    }
    case 'variant':
      return `${type.name}(${type.fields.map((field) => `${field.name}: ${printType(field.type)}`).join(', ')})`;
    default:
      return 'any';
  }
}

function atomType(type) {
  if (!type) return 'any';
  const text = printType(type);
  return type.k === 'union' || type.k === 'fn' ? `(${text})` : text;
}

function typeParamsOf(names) {
  return names && names.length ? `<${names.join(', ')}>` : '';
}

function declareType(statement) {
  const keyword = statement.exported ? 'export type' : 'type';
  const head = `${keyword} ${statement.name}${typeParamsOf(statement.typeParams)}`;
  if (statement.recordFields) {
    if (!statement.recordFields.length) return `${head}\nend`;
    const lines = statement.recordFields.map((field) =>
      `    ${field.name}${field.optional ? '?' : ''}: ${printTypeNode(field.type)}`);
    return `${head}\n${lines.join('\n')}\nend`;
  }
  return `${head} = ${printTypeNode(statement.value)}`;
}

function functionLine(statement, signature, prefix) {
  // Prefer the written annotation: it keeps imported aliases by name
  // (`status: Status`) instead of expanding them structurally. Inferred
  // return types fall back to the checker's resolved type.
  const params = statement.params.map((parameter) => {
    const rest = parameter.rest ? '...' : '';
    const optional = parameter.optional && !parameter.rest ? '?' : '';
    const name = parameter.name ? `${parameter.name}${optional}: ` : '';
    const type = parameter.type ? printTypeNode(parameter.type) : printType(null);
    return `${rest}${name}${type}`;
  }).join(', ');
  const result = statement.returnType ? printTypeNode(statement.returnType) : printType(signature.ret);
  const params_ = typeParamsOf(signature.typeParams);
  const name = statement.name || '__defaultExport';
  return `${prefix} ${name}${params_}(${params}) -> ${result}`;
}

function declareFunction(statement) {
  const signature = statement.__signature;
  if (!signature) return null;
  const lines = [];
  for (const overload of signature.overloads || []) {
    if (overload.node) lines.push(functionLine(overload.node, overload, 'export overload function'));
  }
  lines.push(functionLine(statement, signature, 'export declare function'));
  if (statement.defaultExport) lines.push(`export default ${statement.name || '__defaultExport'}`);
  return lines.join('\n');
}

function declareValue(statement, exports) {
  const name = statement.pattern && statement.pattern.kind === 'NamePattern' ? statement.pattern.name : null;
  if (!name) return null;
  const entry = exports.get(name);
  return `export declare const ${name}: ${printType(entry ? entry.type : null)}`;
}

function importLines(program, mentions) {
  const lines = [];
  for (const statement of program.body) {
    if (statement.kind !== 'Import') continue;
    const names = statement.names.filter((name) => mentions(name.local));
    const defaultName = statement.defaultName && mentions(statement.defaultName) ? statement.defaultName : null;
    const namespace = statement.namespace && mentions(statement.namespace) ? statement.namespace : null;
    if (!defaultName && !namespace && names.length === 0) continue;

    const parts = [];
    if (defaultName) parts.push(defaultName);
    if (namespace) parts.push(`* as ${namespace}`);
    if (names.length) {
      parts.push(`{ ${names.map((name) => (name.imported === name.local
        ? name.imported
        : `${name.imported} as ${name.local}`)).join(', ')} }`);
    }
    lines.push(`import ${parts.join(', ')} from ${JSON.stringify(statement.spec)}`);
  }
  return lines;
}

function generateDeclarations(record) {
  if (!record || !record.check || !record.check.checker) return null;
  const checker = record.check.checker;
  const program = record.ast;
  const blocks = [];

  // Every type declaration is emitted; only exported ones carry `export`, so a
  // private type referenced by a public signature stays in scope without
  // becoming part of the module's surface.
  for (const statement of program.body) {
    if (statement.kind === 'TypeDecl') blocks.push(declareType(statement));
  }

  for (const statement of program.body) {
    if (statement.kind !== 'FunctionDecl') continue;
    if (!statement.exported && !statement.defaultExport) continue;
    const text = declareFunction(statement);
    if (text) blocks.push(text);
  }

  for (const statement of program.body) {
    if (statement.kind === 'DeclareFunction') {
      const params = statement.params.map((parameter) => {
        const rest = parameter.rest ? '...' : '';
        const optional = parameter.optional && !parameter.rest ? '?' : '';
        const name = parameter.name ? `${parameter.name}${optional}: ` : '';
        return `${rest}${name}${printTypeNode(parameter.type)}`;
      }).join(', ');
      const result = statement.returnType ? ` -> ${printTypeNode(statement.returnType)}` : '';
      blocks.push(`export declare function ${statement.name}${typeParamsOf(statement.typeParams)}(${params})${result}`);
      continue;
    }
    if (statement.kind === 'DeclareValue') {
      blocks.push(`export declare const ${statement.name}: ${printTypeNode(statement.type)}`);
    }
  }

  for (const statement of program.body) {
    if (statement.kind !== 'VarDecl' || !statement.exported) continue;
    const text = declareValue(statement, record.check.exports.values);
    if (text) blocks.push(text);
  }

  // Renamed value exports keep their local name in the declaration and add the
  // public alias, which is how the source module expresses them too.
  for (const [exported, local] of checker.exports) {
    if (exported !== local) blocks.push(`export { ${local} as ${exported} }`);
  }

  for (const statement of program.body) {
    if (statement.kind !== 'ExportNamed' || !statement.spec) continue;
    const names = statement.names.map((name) => (name.local === name.exported
      ? name.local
      : `${name.local} as ${name.exported}`)).join(', ');
    blocks.push(`export { ${names} } from ${JSON.stringify(statement.spec)}`);
  }

  // `export default expression` needs a name to point at from a declaration.
  const defaultExpression = program.body.find((statement) => statement.kind === 'ExportDefault');
  if (defaultExpression) {
    const value = defaultExpression.value;
    if (value.kind === 'Name') {
      const entry = record.check.exports.values.get('default');
      const declared = program.body.some((statement) =>
        (statement.kind === 'FunctionDecl' && statement.name === value.name && statement.exported) ||
        (statement.kind === 'VarDecl' && statement.exported &&
          statement.pattern && statement.pattern.kind === 'NamePattern' && statement.pattern.name === value.name));
      if (!declared) blocks.push(`export declare const ${value.name}: ${printType(entry ? entry.type : null)}`);
      blocks.push(`export default ${value.name}`);
    } else {
      blocks.push(`export declare const __defaultExport: ${printType(record.check.exports.values.has('default') ? record.check.exports.values.get('default').type : null)}`);
      blocks.push('export default __defaultExport');
    }
  }

  // Body of emitted declarations, used by mentions regex and the final output.
  const body = blocks.filter(Boolean).join('\n\n');

  // Mentions regex needs `body` to be defined first.
  const mentions = (name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`).test(body);

  const imports = importLines(program, mentions);

  // Preserve source `#` comments from the original program, so API docs
  // ship with the types. Comments appear before the header and before the
  // declarations they document.
  const sourceComments = (program.comments || [])
    .filter((c) => c.v.trim().length > 0)
    .map((c) => `# ${c.v}`);

  const header = `# Generated from ${record.display} by "plainscript build --declarations". Do not edit.`;
  const sourceSection = sourceComments.length > 0 ? sourceComments.join('\n') + '\n' : '';

  const importsSection = imports.length ? `${imports.join('\n')}\n` : '';

  return `${sourceSection}${header}\n${importsSection}${body}\n`;
}

module.exports = { generateDeclarations, printType, printTypeNode };