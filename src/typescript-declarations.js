'use strict';

// Conservative TypeScript declaration (.d.ts) importer.
//
// This is intentionally a declaration-subset translator, not a TypeScript
// parser. It accepts constructs that have a direct PlainScript equivalent and
// emits a diagnostic for everything else. It never turns an unsupported type
// into `any` silently: the declaration is omitted (or the unsupported member is
// reported) so a caller cannot mistake a partial translation for a complete
// one.

const fs = require('fs');
const path = require('path');
const { Diagnostic, Span, error } = require('./diagnostics');

const UNSUPPORTED = 'PS7001';
const IMPORT_MISSING = 'PS7002';
const SYNTAX = 'PS7003';
const GENERIC_DEFAULT = 'PS7004';
const WIDENED = 'PS7005';

class TypeScriptDeclarationError extends Error {
  constructor(diagnostic) {
    super(diagnostic.message);
    this.diagnostic = diagnostic;
  }
}

function tokenize(source, file) {
  const tokens = [];
  let index = 0;
  let line = 1;
  let column = 1;
  const advance = () => {
    const char = source[index++];
    if (char === '\n') { line += 1; column = 1; } else column += 1;
    return char;
  };
  const push = (t, v, startLine, startColumn) => tokens.push({ t, v, line: startLine, col: startColumn });
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { advance(); continue; }
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') advance();
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      advance(); advance();
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) advance();
      if (index < source.length) { advance(); advance(); }
      continue;
    }
    const startLine = line;
    const startColumn = column;
    if (char === '"' || char === "'") {
      const quote = advance();
      let value = '';
      while (index < source.length && source[index] !== quote) {
        let next = advance();
        if (next === '\\') {
          const escaped = advance();
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped === 'r' ? '\r' : escaped;
        } else {
          value += next;
        }
      }
      if (index >= source.length) throw new TypeScriptDeclarationError(error(SYNTAX, 'Unterminated string in declaration.', new Span(file, startLine, startColumn)));
      advance();
      push('string', value, startLine, startColumn);
      continue;
    }
    if (char === '`') {
      advance();
      let value = '';
      while (index < source.length && source[index] !== '`') value += advance();
      if (index < source.length) advance();
      push('template', value, startLine, startColumn);
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      let value = '';
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) value += advance();
      push('ident', value, startLine, startColumn);
      continue;
    }
    if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(source[index + 1] || ''))) {
      let value = '';
      if (char === '-') value += advance();
      while (index < source.length && /[0-9.eE+-]/.test(source[index])) value += advance();
      push('number', value, startLine, startColumn);
      continue;
    }
    if (source.startsWith('...', index)) { advance(); advance(); advance(); push('punct', '...', startLine, startColumn); continue; }
    if (source.startsWith('=>', index)) { advance(); advance(); push('punct', '=>', startLine, startColumn); continue; }
    if ('{}()[]<>,;:?|&=.-+*'.includes(char)) { advance(); push('punct', char, startLine, startColumn); continue; }
    throw new TypeScriptDeclarationError(error(SYNTAX, `Unsupported character ${JSON.stringify(char)} in declaration.`, new Span(file, startLine, startColumn)));
  }
  tokens.push({ t: 'eof', v: '<eof>', line, col: column });
  return tokens;
}

class TypeParser {
  constructor(source, file) {
    this.file = file;
    this.tokens = tokenize(source, file);
    this.index = 0;
    this.diagnostics = [];
    this.unsupported = false;
    this.usedNames = new Set();
    // Interfaces with the same name merge in TypeScript. Remember where each
    // was emitted so a later declaration can extend the first one.
    this.interfaceDecls = new Map();
    this.thisTypeName = null;
  }

  peek(offset = 0) { return this.tokens[this.index + offset] || this.tokens[this.tokens.length - 1]; }
  at(value, offset = 0) { const token = this.peek(offset); return token.t === 'ident' || token.t === 'punct' ? token.v === value : false; }
  atPunct(value) { return this.peek().t === 'punct' && this.peek().v === value; }
  next() { return this.tokens[this.index++]; }
  eat(value) { return this.at(value) ? this.next() : null; }
  expect(value, message) {
    if (this.at(value)) return this.next();
    throw new TypeScriptDeclarationError(this.error(SYNTAX, message || `Expected ${JSON.stringify(value)} but found ${JSON.stringify(this.peek().v)}.`));
  }
  error(code, message, token = this.peek(), severity = 'error') {
    const diagnostic = error(code, message, new Span(this.file, token.line, token.col), { severity });
    this.diagnostics.push(diagnostic);
    return diagnostic;
  }
  skipStatement() {
    let depth = 0;
    while (this.peek().t !== 'eof') {
      const token = this.next();
      if ('{[('.includes(token.v)) depth += 1;
      else if ('}])'.includes(token.v)) {
        if (depth === 0) { this.index -= 1; return; }
        depth -= 1;
        if (depth === 0) { this.eat(';'); return; }
      } else if (token.v === ';' && depth === 0) return;
    }
  }

  parseTypeParameters() {
    const params = [];
    if (!this.atPunct('<')) return params;
    this.next();
    while (!this.atPunct('>')) {
      const name = this.expectIdentifier('a type parameter').v;
      let constraint = null;
      let defaultValue = null;
      if (this.at('extends')) {
        this.next();
        constraint = this.parseType();
      }
      if (this.atPunct('=')) {
        this.next();
        const token = this.peek();
        defaultValue = this.parseType();
        this.error(GENERIC_DEFAULT, `Generic default for "${name}" has no PlainScript equivalent and was omitted.`, token, 'warning');
      }
      params.push({ name, constraint, defaultValue });
      if (this.atPunct(',')) this.next();
      else break;
    }
    this.expect('>', 'Expected ">" after type parameters.');
    return params;
  }

  expectIdentifier(message = 'an identifier') {
    const token = this.peek();
    if (token.t !== 'ident') throw new TypeScriptDeclarationError(this.error(SYNTAX, `Expected ${message} but found ${JSON.stringify(token.v)}.`, token));
    this.next();
    return token;
  }

  parseFile() {
    const imports = [];
    const declarations = [];
    const functions = [];
    while (this.peek().t !== 'eof') {
      const statementStart = this.index;
      try {
        if (this.at('import')) { this.parseImport(imports); continue; }
        if (this.at('export')) { this.parseExport(imports, declarations, functions); continue; }
        if (this.at('interface')) { this.parseInterface(false, declarations); continue; }
        if (this.at('type')) { this.parseAlias(false, declarations); continue; }
        if (this.at('declare')) { this.parseDeclare(false, declarations, functions); continue; }
        if (this.at('function')) { this.parseFunction(false, functions); continue; }
        if (this.at('const') || this.at('let') || this.at('var')) { this.parseVariable(false, declarations); continue; }
        if (this.at('class')) { this.parseClass(false, declarations); continue; }
        if (this.at('namespace') || this.at('module') || this.at('enum')) {
          const token = this.peek();
          this.error(UNSUPPORTED, `TypeScript ${token.v} declarations are not supported; keep this declaration in JavaScript or migrate it manually.`, token);
          this.skipStatement();
          continue;
        }
        const token = this.peek();
        this.error(UNSUPPORTED, `Unsupported top-level TypeScript declaration ${JSON.stringify(token.v)}.`, token);
        this.skipStatement();
      } catch (failure) {
        if (!(failure instanceof TypeScriptDeclarationError)) throw failure;
        this.diagnostics.push(failure.diagnostic || this.error(SYNTAX, failure.message));
        if (this.index <= statementStart) this.next();
        this.skipStatement();
      }
    }
    // Group overload signatures. A single declaration is emitted with
    // `declare function`; repeated names use PlainScript's overload syntax.
    const counts = new Map();
    for (const fn of functions) counts.set(fn.name, (counts.get(fn.name) || 0) + 1);
    const renderedFunctions = functions.map((fn) => {
      const prefix = `${fn.exported ? 'export ' : ''}${counts.get(fn.name) > 1 ? 'overload ' : 'declare '}function`;
      return `${prefix} ${fn.name}${renderTypeParams(fn.typeParams)}(${fn.params.map((parameter) => renderParameter(parameter)).join(', ')}) -> ${renderType(fn.returnType)}`;
    });
    const importLines = imports.map((entry) => entry.line);
    const body = [...declarations, ...renderedFunctions].join('\n\n');
    const header = `# Generated from ${path.basename(this.file)} by "plainscript interop". Do not edit.`;
    return {
      source: `${importLines.length ? `${importLines.join('\n')}\n\n` : ''}${header}\n${body}${body ? '\n' : ''}`,
      diagnostics: this.diagnostics,
      imports,
    };
  }

  parseImport(imports) {
    const start = this.next();
    let typeOnly = false;
    if (this.at('type')) { this.next(); typeOnly = true; }
    if (this.peek().t === 'string') {
      this.next();
      this.eat(';');
      return;
    }
    let names = [];
    if (this.atPunct('{')) {
      this.next();
      while (!this.atPunct('}')) {
        const imported = this.expectIdentifier('an imported name');
        let local = imported.v;
        if (this.at('as')) { this.next(); local = this.expectIdentifier('an import alias').v; }
        names.push({ imported: imported.v, local });
        if (this.atPunct(',')) this.next();
        else break;
      }
      this.expect('}');
    } else if (this.atPunct('*')) {
      this.next();
      this.expect('as');
      const name = this.expectIdentifier('a namespace name');
      this.error(UNSUPPORTED, `Namespace import "${name.v}" cannot be represented without namespace types.`, name);
      this.skipToSemicolon();
      return;
    } else {
      const token = this.expectIdentifier('a default import');
      this.error(UNSUPPORTED, `Default import "${token.v}" is not translated; use a named type export.`, token);
      this.skipToSemicolon();
      return;
    }
    this.expect('from');
    const spec = this.peek();
    if (spec.t !== 'string') throw new TypeScriptDeclarationError(this.error(SYNTAX, 'An import path must be a string literal.', spec));
    this.next();
    this.eat(';');
    const normalized = normalizeSpecifier(spec.v);
    const line = `import ${names.length ? `{ ${names.map((entry) => (entry.imported === entry.local ? entry.imported : `${entry.imported} as ${entry.local}`)).join(', ')} } from ` : ''}${JSON.stringify(normalized)}`;
    imports.push({ line: names.length ? line : null, spec: spec.v, normalized, names, file: this.file, typeOnly });
    this.resolveImport(spec.v, spec);
  }

  resolveImport(spec, token) {
    if (!spec.startsWith('.') || !this.resolveImportFile) return;
    const base = path.resolve(path.dirname(this.file), normalizeSpecifier(spec));
    const candidates = [base, `${base}.d.ts`, `${base}.ts`, `${base}.d.pln`, `${base}.pln`, path.join(base, 'index.d.ts'), path.join(base, 'index.ts')];
    if (!candidates.some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())) {
      this.error(IMPORT_MISSING, `Cannot resolve relative declaration import "${spec}".`, token);
    }
  }

  parseExport(imports, declarations, functions) {
    const start = this.next();
    if (this.at('default')) {
      this.error(UNSUPPORTED, 'Default exports are not representable in PlainScript declarations.', this.peek());
      this.skipStatement();
      return;
    }
    if (this.atPunct('{')) {
      this.next();
      const names = [];
      while (!this.atPunct('}')) {
        const local = this.expectIdentifier('an exported name').v;
        let exported = local;
        if (this.at('as')) { this.next(); exported = this.expectIdentifier('an export alias').v; }
        names.push({ local, exported });
        if (this.atPunct(',')) this.next();
        else break;
      }
      this.expect('}');
      let spec = null;
      if (this.at('from')) {
        this.next();
        const token = this.peek();
        if (token.t !== 'string') throw new TypeScriptDeclarationError(this.error(SYNTAX, 'A re-export path must be a string literal.', token));
        this.next();
        spec = normalizeSpecifier(token.v);
      }
      this.eat(';');
      const rendered = names.map((entry) => (entry.local === entry.exported ? entry.local : `${entry.local} as ${entry.exported}`)).join(', ');
      declarations.push(`export { ${rendered} }${spec ? ` from ${JSON.stringify(spec)}` : ''}`);
      return;
    }
    if (this.at('interface')) { this.parseInterface(true, declarations); return; }
    if (this.at('type')) {
      if (this.peek(1).t === 'punct' && this.peek(1).v === '{') { this.parseExportList(declarations); return; }
      this.parseAlias(true, declarations);
      return;
    }
    if (this.at('declare')) { this.parseDeclare(true, declarations, functions); return; }
    if (this.at('function')) { this.parseFunction(true, functions); return; }
    if (this.at('const') || this.at('let') || this.at('var')) { this.parseVariable(true, declarations); return; }
    if (this.at('class')) { this.parseClass(true, declarations); return; }
    if (this.atPunct('*')) {
      this.error(UNSUPPORTED, 'Star re-exports (export * from "…") are not translated; list the exported names explicitly.', this.peek());
      this.skipStatement();
      return;
    }
    if (this.at('namespace') || this.at('module') || this.at('enum')) {
      this.error(UNSUPPORTED, `TypeScript ${this.peek().v} declarations are not supported.`, this.peek());
      this.skipStatement();
      return;
    }
    this.error(UNSUPPORTED, `Unsupported export construct ${JSON.stringify(this.peek().v)}.`, this.peek());
    this.skipStatement();
  }

  parseExportList(declarations) {
    this.next(); // type
    this.expect('{');
    const names = [];
    while (!this.atPunct('}')) {
      const local = this.expectIdentifier('an exported type').v;
      let exported = local;
      if (this.at('as')) { this.next(); exported = this.expectIdentifier('an export alias').v; }
      names.push({ local, exported });
      if (this.atPunct(',')) this.next();
      else break;
    }
    this.expect('}');
    let spec = null;
    if (this.at('from')) {
      this.next();
      const token = this.peek();
      if (token.t !== 'string') throw new TypeScriptDeclarationError(this.error(SYNTAX, 'A re-export path must be a string literal.', token));
      this.next();
      spec = normalizeSpecifier(token.v);
    }
    this.eat(';');
    declarations.push(`export { ${names.map((entry) => (entry.local === entry.exported ? entry.local : `${entry.local} as ${entry.exported}`)).join(', ')} }${spec ? ` from ${JSON.stringify(spec)}` : ''}`);
  }

  parseInterface(exported, declarations) {
    const start = this.next();
    const name = this.expectIdentifier('an interface name').v;
    const typeParams = this.parseTypeParameters();
    const bases = [];
    if (this.at('extends')) {
      this.next();
      while (true) {
        bases.push(this.parseType());
        if (this.atPunct(',')) { this.next(); continue; }
        break;
      }
    }
    const members = this.parseObjectMembers(true);
    // A declaration with an unsupported member is omitted as a whole: a
    // partial interface would silently narrow the real package type.
    if (members.unsupported) return;
    const key = `${name}${renderTypeParams(typeParams)}`;
    const existing = this.interfaceDecls.get(key);
    const fields = existing ? mergeFields(existing.fields, members.fields) : members.fields;
    const allBases = existing ? [...existing.bases, ...bases] : bases;
    const base = allBases.map(renderType).filter(Boolean).join(' & ');
    const object = renderRecord(fields);
    const type = base ? (fields.length ? `${object} & ${base}` : base) : object;
    const isExported = exported || Boolean(existing && existing.exported);
    const rendered = `${isExported ? 'export ' : ''}type ${name}${renderTypeParams(typeParams)} = ${type}`;
    if (existing) {
      existing.fields = fields;
      existing.bases = allBases;
      existing.exported = isExported;
      declarations[existing.index] = rendered;
    } else {
      this.interfaceDecls.set(key, { index: declarations.length, fields, bases: allBases, exported: isExported });
      declarations.push(rendered);
    }
  }

  parseObjectMembers(interfaceBody = false, classBody = false) {
    this.expect('{');
    const fields = [];
    let unsupported = false;
    while (!this.atPunct('}') && this.peek().t !== 'eof') {
      const start = this.peek();
      let readonly = false;
      let optional = false;
      let isStatic = false;
      let ignored = false;
      // Class member modifiers: `readonly` is meaningful, the visibility and
      // binding modifiers only decide whether the member is part of the
      // instance shape. `private`/`protected` members are not public surface.
      let scanning = true;
      while (scanning) {
        scanning = false;
        if (this.at('readonly')) { this.next(); readonly = true; scanning = true; continue; }
        if (!classBody) continue;
        if (this.at('static')) { this.next(); isStatic = true; scanning = true; continue; }
        if (this.at('public')) { this.next(); scanning = true; continue; }
        if (this.at('private') || this.at('protected')) { this.next(); ignored = true; scanning = true; continue; }
        if (this.at('abstract') || this.at('override') || this.at('declare') || this.at('accessor')) { this.next(); scanning = true; }
      }
      // Private/protected members are not public surface, and static members
      // live on the constructor value rather than the instance. Neither can be
      // expressed as a record field, so skip them without poisoning the class.
      if (ignored) { this.skipToSemicolon(); continue; }
      if (isStatic) {
        if (!this.staticMembersWarned) {
          this.error(WIDENED, 'Static class members are not part of the instance type and were omitted.', start, 'warning');
          this.staticMembersWarned = true;
        }
        // A static signature ends with `;` even when it has a parameter list,
        // so skip to the terminator rather than to the first balanced brace.
        this.skipToSemicolon();
        continue;
      }
      // A constructor contributes no instance field. Its parameters are still
      // parsed so the rest of the class body stays aligned, but `new` is an
      // untyped JavaScript boundary in PlainScript.
      if (classBody && this.at('constructor') && this.peek(1).t === 'punct' && this.peek(1).v === '(') {
        this.next();
        const constructorParams = this.parseTypeParameters();
        if (constructorParams.length) this.error(UNSUPPORTED, 'A generic constructor is not representable in a class declaration.', start);
        this.parseParameters();
        if (this.atPunct(':')) { this.next(); this.parseType(); }
        this.eat(';');
        continue;
      }
      if (this.atPunct('[')) {
        this.error(UNSUPPORTED, 'Index signatures and mapped members are not translated in this position; use a map type.', this.peek());
        unsupported = true;
        this.skipBalanced('[', ']');
        if (this.atPunct('?')) this.next();
        if (this.atPunct(':')) { this.next(); this.parseType(); }
        this.eat(';');
        this.eat(',');
        continue;
      }
      if (this.atPunct('(') || this.atPunct('<') || this.at('new')) {
        this.error(UNSUPPORTED, 'Call/construct signatures are not representable as PlainScript fields.', this.peek());
        unsupported = true;
        this.skipStatement();
        continue;
      }
      const nameToken = this.peek();
      let name;
      if (nameToken.t === 'string' || nameToken.t === 'number') { this.next(); name = nameToken.v; }
      else if (nameToken.t === 'ident') { this.next(); name = nameToken.v; }
      else {
        this.error(SYNTAX, `Expected a member name but found ${JSON.stringify(nameToken.v)}.`, nameToken);
        unsupported = true;
        this.skipStatement();
        continue;
      }
      let field = null;
      if (this.atPunct('?')) { this.next(); optional = true; }
      if (this.atPunct('(') || this.atPunct('<')) {
        const typeParams = this.parseTypeParameters();
        const params = this.parseParameters();
        let returnType;
        if (this.atPunct(':')) { this.next(); returnType = this.parseType(); }
        else { this.error(SYNTAX, `Method "${name}" is missing a return type.`, start); unsupported = true; returnType = { kind: 'prim', name: 'any' }; }
        if (typeParams.length) {
          // PlainScript function types cannot carry their own type parameters,
          // so a generic method is widened to its constraints (or any) with an
          // explicit warning instead of dropping the whole declaration.
          this.error(WIDENED, `Generic method "${name}" was widened to its constraints; PlainScript record fields cannot declare type parameters.`, start, 'warning');
          field = { name, optional, readonly, type: eraseTypeParams(renderFunctionType(params, returnType), typeParams) };
        } else {
          field = { name, optional, readonly, type: renderFunctionType(params, returnType) };
        }
      } else {
        if (!this.atPunct(':')) {
          this.error(SYNTAX, `Property "${name}" is missing a type annotation.`, start);
          unsupported = true;
          this.skipStatement();
          continue;
        }
        this.next();
        const type = this.parseType();
        if (!type) { unsupported = true; continue; }
        field = { name, optional, readonly, type: renderType(type) };
      }
      if (field) fields.push(field);
      this.eat(';');
      this.eat(',');
    }
    this.expect('}');
    return { fields, unsupported };
  }

  // A declared class is a runtime constructor plus an instance shape. With
  // PlainScript 2.3 classes, the declaration preserves the constructor
  // signature, static members and methods instead of flattening the class into
  // an untyped `any` value.
  parseClass(exported, declarations) {
    this.next();
    const name = this.expectIdentifier('a class name').v;
    const typeParams = this.parseTypeParameters();
    let extendsType = null;
    const implementsTypes = [];
    if (this.at('extends')) {
      this.next();
      extendsType = this.parseType();
    }
    if (this.at('implements')) {
      this.next();
      while (true) {
        const implemented = this.parseType();
        if (implemented) implementsTypes.push(implemented);
        if (this.atPunct(',')) { this.next(); continue; }
        break;
      }
    }
    const previousThis = this.thisTypeName;
    this.thisTypeName = name;
    const members = this.parseClassMembers();
    this.thisTypeName = previousThis;
    if (members.unsupported) return;
    // Constructor parameter properties also declare instance fields.
    if (members.constructorParams) {
      const promoted = new Set(members.constructorParams.filter((parameter) => parameter.parameterProperty && !parameter.parameterPrivate).map((parameter) => parameter.name));
      members.fields = members.fields.filter((field) => !promoted.has(field.name)).concat(
        members.constructorParams
          .filter((parameter) => parameter.parameterProperty && !parameter.parameterPrivate && parameter.type)
          .map((parameter) => ({ name: parameter.name, optional: parameter.optional, readonly: parameter.parameterReadonly, static: false, type: renderType(parameter.type) })),
      );
    }

    const head = `${exported ? 'export ' : ''}declare class ${name}${renderTypeParams(typeParams)}${extendsType && extendsType.kind === 'ref' ? ` extends ${renderType(extendsType)}` : ''}`;
    const lines = [head];
    if (extendsType && extendsType.kind !== 'ref') {
      this.error(WIDENED, `Base type of \"${name}\" was omitted from the class header; only a named base class is representable.`, this.peek(), 'warning');
    }
    for (const type of implementsTypes) {
      if (type && type.kind === 'ref') {
        this.error(UNSUPPORTED, `\"implements ${renderType(type)}\" has no PlainScript equivalent and was omitted.`, this.peek(), 'warning');
      }
    }
    for (const field of members.fields) {
      const modifiers = `${field.static ? 'static ' : ''}${field.readonly ? 'readonly ' : ''}`;
      lines.push(`    ${modifiers}${field.name}${field.optional ? '?' : ''}: ${field.type}`);
    }
    if (members.constructorParams) {
      lines.push(`    constructor(${members.constructorParams.map((parameter) => renderParameter(parameter)).join(', ')})`);
    }
    for (const method of members.methods) {
      const modifiers = `${method.static ? 'static ' : ''}${method.async ? 'async ' : ''}`;
      lines.push(`    ${modifiers}function ${method.name}${renderTypeParams(method.typeParams)}(${method.params.map((parameter) => renderParameter(parameter)).join(', ')}) -> ${renderType(method.returnType)}`);
    }
    lines.push('end');
    declarations.push(lines.join('\n'));
  }

  // Class members keep their kind (field vs method) and static flag, which the
  // flat record used for interfaces deliberately discards.
  parseClassMembers() {
    this.expect('{');
    const fields = [];
    const methods = [];
    let constructorParams = null;
    let unsupported = false;
    while (!this.atPunct('}') && this.peek().t !== 'eof') {
      const start = this.peek();
      let readonly = false;
      let isStatic = false;
      let privateMember = false;
      let async = false;
      let accessor = null;
      let scanning = true;
      while (scanning) {
        scanning = false;
        if (this.at('readonly')) { this.next(); readonly = true; scanning = true; continue; }
        if (this.at('static')) { this.next(); isStatic = true; scanning = true; continue; }
        if (this.at('public')) { this.next(); scanning = true; continue; }
        if (this.at('private') || this.at('protected')) { this.next(); privateMember = true; scanning = true; continue; }
        if (this.at('abstract') || this.at('override') || this.at('declare') || this.at('accessor') || this.at('async')) {
          if (this.at('async')) async = true;
          this.next(); scanning = true; continue;
        }
        if (this.at('get') || this.at('set')) { accessor = this.next().v; scanning = true; }
      }
      if (privateMember) { this.skipToSemicolon(); continue; }
      if (this.atPunct('[')) {
        this.error(UNSUPPORTED, 'Index signatures are not supported; use a map type.', this.peek());
        unsupported = true;
        this.skipBalanced('[', ']');
        if (this.atPunct(':')) { this.next(); this.parseType(); }
        this.eat(';');
        continue;
      }
      if (isStatic && this.atPunct('{')) {
        this.error(UNSUPPORTED, 'Static initialization blocks have no declaration equivalent and were omitted.', this.peek(), 'warning');
        this.skipBalanced('{', '}');
        continue;
      }
      if (this.at('constructor') && this.peek(1).t === 'punct' && this.peek(1).v === '(') {
        this.next();
        const constructorTypeParams = this.parseTypeParameters();
        if (constructorTypeParams.length) {
          this.error(UNSUPPORTED, 'A generic constructor is not representable in a class declaration.', start, 'warning');
        }
        constructorParams = this.parseParameters();
        if (this.atPunct(':')) { this.next(); this.parseType(); }
        this.eat(';');
        continue;
      }
      // An overload signature and its implementation repeat the same name.
      // PlainScript methods are not overloaded in a declare class, so the
      // first signature wins and the duplicate is ignored.
      const memberName = this.peek();
      let name;
      if (memberName.t === 'string' || memberName.t === 'number') { this.next(); name = memberName.v; }
      else if (memberName.t === 'ident') { this.next(); name = memberName.v; }
      else if (memberName.t === 'kw') {
        // Keywords other than `end` are legal PlainScript identifiers in this
        // position; `end` terminates the class and cannot name a member.
        if (memberName.v === 'end') {
          this.error(UNSUPPORTED, 'A class member named "end" cannot be declared in PlainScript; the member was omitted.', memberName, 'warning');
          unsupported = true;
          this.skipStatement();
          continue;
        }
        this.next();
        name = memberName.v;
      }
      else {
        this.error(SYNTAX, `Expected a class member but found ${JSON.stringify(memberName.v)}.`, memberName);
        unsupported = true;
        this.skipStatement();
        continue;
      }
      const optional = Boolean(this.eat('?'));
      if (this.atPunct('(') || this.atPunct('<')) {
        const methodTypeParams = this.parseTypeParameters();
        const params = this.parseParameters();
        let returnType = { kind: 'prim', name: 'nothing' };
        if (this.atPunct(':')) { this.next(); returnType = this.parseType(); }
        else if (!accessor) this.error(SYNTAX, `Method \"${name}\" is missing a return type.`, start);
        this.eat(';');
        if (accessor === 'set') continue;
        if (accessor === 'get') {
          fields.push({ name, optional, readonly: true, static: isStatic, type: renderType(returnType || { kind: 'prim', name: 'any' }) });
          continue;
        }
        if (methods.some((method) => method.name === name && method.static === isStatic)) continue;
        methods.push({ name, static: isStatic, async, typeParams: methodTypeParams, params, returnType: returnType || { kind: 'prim', name: 'any' } });
        continue;
      }
      if (!this.atPunct(':')) {
        this.error(SYNTAX, `Property \"${name}\" is missing a type annotation.`, start);
        unsupported = true;
        this.skipStatement();
        continue;
      }
      this.next();
      const type = this.parseType();
      this.eat(';');
      if (type) fields.push({ name, optional, readonly: readonly || accessor === 'get', static: isStatic, type: renderType(type) });
    }
    this.expect('}');
    return { fields, methods, constructorParams, unsupported };
  }

  parseAlias(exported, declarations) {
    this.next();
    const name = this.expectIdentifier('a type alias name').v;
    const typeParams = this.parseTypeParameters();
    if (!this.atPunct('=')) {
      this.error(SYNTAX, `Type alias "${name}" is missing "=".`, this.peek());
      this.skipStatement();
      return;
    }
    this.next();
    const type = this.parseType();
    this.eat(';');
    if (!type) return;
    declarations.push(`${exported ? 'export ' : ''}type ${name}${renderTypeParams(typeParams)} = ${renderType(type)}`);
  }

  parseDeclare(exported, declarations, functions) {
    this.next();
    if (this.at('function')) { this.parseFunction(exported, functions); return; }
    if (this.at('const') || this.at('let') || this.at('var')) { this.parseVariable(exported, declarations); return; }
    if (this.at('class')) { this.parseClass(exported, declarations); return; }
    if (this.at('module')) {
      this.error(UNSUPPORTED, 'Ambient module declarations cannot be translated; move the declarations to the package root or translate them by hand.', this.peek());
      this.skipStatement();
      return;
    }
    if (this.at('interface')) { this.parseInterface(exported, declarations); return; }
    if (this.at('type')) { this.parseAlias(exported, declarations); return; }
    this.error(UNSUPPORTED, `Unsupported declare construct ${JSON.stringify(this.peek().v)}.`, this.peek());
    this.skipStatement();
  }

  parseFunction(exported, functions) {
    this.next();
    const name = this.expectIdentifier('a function name').v;
    const typeParams = this.parseTypeParameters();
    const params = this.parseParameters();
    if (!this.atPunct(':')) {
      this.error(SYNTAX, `Function "${name}" is missing a return type.`, this.peek());
      this.skipStatement();
      return;
    }
    this.next();
    const returnType = this.parseType();
    this.eat(';');
    functions.push({ name, exported, typeParams, params, returnType });
  }

  parseParameters() {
    this.expect('(');
    const params = [];
    while (!this.atPunct(')')) {
      // A TypeScript `this` parameter only annotates the receiver; it is not a
      // runtime argument and must not shift the remaining parameters.
      if (this.at('this') && this.peek(1).t === 'punct' && this.peek(1).v === ':') {
        this.next(); this.next(); this.parseType();
        if (this.atPunct(',')) { this.next(); continue; }
        break;
      }
      let rest = false;
      if (this.atPunct('...')) { this.next(); rest = true; }
      // Parameter properties (`constructor(public id: string)`) are legal in
      // declaration files. They are fields as well as parameters; the flag is
      // read by parseClassMembers.
      let parameterProperty = false;
      let parameterReadonly = false;
      let parameterPrivate = false;
      let scanning = true;
      while (scanning) {
        scanning = false;
        if (['public', 'private', 'protected', 'readonly'].some((modifier) => this.at(modifier)) && this.peek(1).t === 'ident') {
          const modifier = this.next().v;
          parameterProperty = true;
          if (modifier === 'readonly') parameterReadonly = true;
          if (modifier === 'private' || modifier === 'protected') parameterPrivate = true;
          scanning = true;
        }
      }
      const name = this.expectIdentifier('a parameter name').v;
      let optional = false;
      if (this.atPunct('?')) { this.next(); optional = true; }
      if (!this.atPunct(':')) throw new TypeScriptDeclarationError(this.error(SYNTAX, `Parameter "${name}" is missing a type.`, this.peek()));
      this.next();
      let type = this.parseType();
      if (rest && type && type.kind === 'list') type = { kind: 'list', inner: type.inner };
      else if (rest && type && type.kind === 'ref' && type.name === 'Array' && type.args[0]) type = { kind: 'list', inner: type.args[0] };
      else if (rest) { this.error(UNSUPPORTED, `Rest parameter "${name}" must use an array type.`, this.peek()); type = null; }
      params.push({ name, optional, rest, type, parameterProperty, parameterReadonly, parameterPrivate });
      this.eat('='); // declaration defaults are ignored
      if (this.atPunct(',')) this.next();
      else break;
    }
    this.expect(')');
    return params;
  }

  parseVariable(exported, declarations) {
    this.next();
    const name = this.expectIdentifier('a value name').v;
    if (this.atPunct(':')) {
      this.next();
      const type = this.parseType();
      this.eat(';');
      if (type) declarations.push(`${exported ? 'export ' : ''}declare const ${name}: ${renderType(type)}`);
    } else {
      this.error(UNSUPPORTED, `Value declaration "${name}" needs an explicit type annotation.`, this.peek());
      this.skipStatement();
    }
  }

  parseType() {
    return this.parseConditionalType();
  }

  parseConditionalType() {
    const check = this.parseUnionType();
    if (this.at('extends')) {
      this.next();
      const extendsType = this.parseUnionType();
      this.expect('?');
      const trueType = this.parseType();
      this.expect(':');
      const falseType = this.parseType();
      return { kind: 'conditional', check, extendsType, trueType, falseType };
    }
    return check;
  }

  parseUnionType() {
    const members = [this.parseIntersectionType()];
    while (this.atPunct('|')) { this.next(); members.push(this.parseIntersectionType()); }
    return members.length === 1 ? members[0] : { kind: 'union', members };
  }

  parseIntersectionType() {
    const members = [this.parsePostfixType()];
    while (this.atPunct('&')) { this.next(); members.push(this.parsePostfixType()); }
    return members.length === 1 ? members[0] : { kind: 'intersection', members };
  }

  parsePostfixType() {
    let type = this.parsePrimaryType();
    while (this.atPunct('[') && (this.peek(1).t === 'punct' && this.peek(1).v === ']')) {
      this.next(); this.next();
      type = { kind: 'list', inner: type };
    }
    while (this.atPunct('[')) {
      this.next();
      const index = this.parseType();
      this.expect(']');
      type = { kind: 'indexed', target: type, index };
    }
    return type;
  }

  parsePrimaryType() {
    const token = this.peek();
    if (token.t === 'string') { this.next(); return { kind: 'literal', value: token.v, base: 'text' }; }
    if (token.t === 'number') { this.next(); return { kind: 'literal', value: Number(token.v), base: 'number' }; }
    if (token.t === 'template') {
      this.next();
      const expansion = expandTemplateLiteral(token.v);
      if (expansion) {
        const members = expansion.map((value) => ({ kind: 'literal', value, base: 'text' }));
        return members.length === 1 ? members[0] : { kind: 'union', members };
      }
      this.error(WIDENED, 'Template literal type was translated as text; PlainScript does not model template literal types.', token, 'warning');
      return { kind: 'prim', name: 'text' };
    }
    if (token.t === 'punct' && token.v === '(') {
      const checkpoint = this.index;
      const diagnosticCheckpoint = this.diagnostics.length;
      try {
        const params = this.parseParameters();
        if (this.atPunct('=>')) {
          this.next();
          return { kind: 'function', params, ret: this.parseType() };
        }
      } catch (failure) {
        if (!(failure instanceof TypeScriptDeclarationError)) throw failure;
      }
      this.index = checkpoint;
      this.diagnostics.length = diagnosticCheckpoint;
      this.next();
      const type = this.parseType();
      this.expect(')');
      return type;
    }
    if (token.t === 'punct' && token.v === '[') {
      this.next();
      const elements = [];
      let rest = null;
      while (!this.atPunct(']')) {
        if (this.atPunct('...')) {
          this.next();
          rest = this.parseType();
          if (!this.atPunct(']')) this.error(UNSUPPORTED, 'A tuple rest element must be last.', token);
          break;
        }
        if (this.atPunct('?')) {
          this.next();
          this.error(UNSUPPORTED, 'Optional tuple elements are not supported; use a union element.', this.peek());
        }
        elements.push(this.parseType());
        if (this.atPunct(',')) this.next();
        else break;
      }
      this.expect(']');
      if (rest && rest.kind === 'list') rest = rest.inner;
      return { kind: 'tuple', elements, rest };
    }
    if (token.t === 'punct' && token.v === '{') return this.parseObjectType();
    if (token.t === 'ident') {
      const word = token.v;
      this.next();
      if (word === 'keyof') return { kind: 'keyof', target: this.parsePrimaryType() };
      if (word === 'typeof') {
        const value = this.expectIdentifier('a value name');
        return { kind: 'typeof', name: value.v };
      }
      if (word === 'readonly') {
        const inner = this.parsePrimaryType();
        this.error(UNSUPPORTED, 'Type-level readonly on arrays/objects is only preserved on record fields.', token, 'warning');
        return inner;
      }
      if (word === 'infer') {
        this.error(UNSUPPORTED, 'infer is not supported in declaration translation.', token);
        return null;
      }
      if (word === 'true' || word === 'false') return { kind: 'literal', value: word === 'true', base: 'boolean' };
      if (word === 'null' || word === 'undefined' || word === 'void') return { kind: 'prim', name: 'nothing' };
      const primitive = { string: 'text', number: 'number', boolean: 'boolean', any: 'any', unknown: 'unknown', never: 'never', object: 'object' }[word];
      if (primitive) {
        if (primitive === 'object') return { kind: 'record', fields: [] };
        return { kind: 'prim', name: primitive };
      }
      if (word === 'this') {
        if (this.thisTypeName) return { kind: 'ref', name: this.thisTypeName, args: [] };
        this.error(UNSUPPORTED, 'TypeScript "this" is only representable inside a declared class.', token);
        return null;
      }
      if (word === 'bigint') return { kind: 'prim', name: 'bigint' };
      if (word === 'symbol') {
        this.error(UNSUPPORTED, 'TypeScript "symbol" is not representable in PlainScript.', token);
        return null;
      }
      let args = [];
      if (this.atPunct('<')) {
        this.next();
        while (!this.atPunct('>')) {
          args.push(this.parseType());
          if (this.atPunct(',')) this.next();
          else break;
        }
        this.expect('>');
      }
      if (this.atPunct('.')) {
        this.error(UNSUPPORTED, `Qualified type name "${word}.…" is not supported; import the type directly.`, token);
        while (this.atPunct('.')) { this.next(); this.expectIdentifier('a qualified name'); }
      }
      if (word === 'Array' || word === 'ReadonlyArray') {
        if (word === 'ReadonlyArray') this.error(UNSUPPORTED, 'ReadonlyArray is translated as a mutable list.', token, 'warning');
        if (!args.length) {
          this.error(UNSUPPORTED, `${word} requires an element type; untyped arrays are not translated.`, token);
          return null;
        }
        return { kind: 'list', inner: args[0] };
      }
      if (word === 'Promise') {
        if (!args.length) {
          this.error(UNSUPPORTED, 'Promise requires a value type; untyped promises are not translated.', token);
          return null;
        }
        return { kind: 'promise', inner: args[0] };
      }
      if (word === 'Record') {
        if (args.length < 2) {
          this.error(UNSUPPORTED, 'Record requires key and value type arguments.', token);
          return null;
        }
        return { kind: 'map', key: args[0], value: args[1] };
      }
      // The structural utility types map directly onto PlainScript's mapped
      // types, so importing them keeps real field types instead of widening.
      if (word === 'Partial' || word === 'Required' || word === 'Readonly') {
        if (!args.length) {
          this.error(UNSUPPORTED, `${word} requires a type argument.`, token);
          return null;
        }
        if (word === 'Readonly') {
          this.error(UNSUPPORTED, 'Readonly<T> is translated as a mutable mapped type; PlainScript mapped types cannot mark every field readonly.', token, 'warning');
        }
        return {
          kind: 'mapped', key: 'K', keyType: { kind: 'keyof', target: args[0] },
          optional: word === 'Partial', value: { kind: 'indexed', target: args[0], index: { kind: 'ref', name: 'K', args: [] } },
        };
      }
      if (word === 'Pick') {
        if (args.length < 2) {
          this.error(UNSUPPORTED, 'Pick requires an object type and a key type.', token);
          return null;
        }
        return {
          kind: 'mapped', key: 'P', keyType: args[1], optional: false,
          value: { kind: 'indexed', target: args[0], index: { kind: 'ref', name: 'P', args: [] } },
        };
      }
      if (['Omit', 'Exclude', 'Extract', 'NonNullable', 'ReturnType', 'Parameters', 'Awaited'].includes(word)) {
        this.error(UNSUPPORTED, `${word}<…> has no structural PlainScript equivalent and was translated as any.`, token, 'warning');
        return { kind: 'prim', name: 'any' };
      }
      if (word === 'Error') return { kind: 'ref', name: 'Error', args: [] };
      if (word === 'Date') return { kind: 'ref', name: 'Date', args: [] };
      if (word === 'RegExp') return { kind: 'prim', name: 'regex' };
      if (word === 'Function') return { kind: 'function', params: [{ name: 'args', rest: true, optional: true, type: { kind: 'prim', name: 'any' } }], ret: { kind: 'prim', name: 'any' } };
      if (['Map', 'Set', 'WeakMap', 'WeakSet'].includes(word)) {
        this.error(UNSUPPORTED, `Platform type "${word}" has no structural PlainScript equivalent; use std/map, a list, or declare the shape you use.`, token);
        return null;
      }
      return { kind: 'ref', name: word, args };
    }
    this.error(SYNTAX, `Expected a type but found ${JSON.stringify(token.v)}.`, token);
    this.skipStatement();
    return null;
  }

  parseObjectType() {
    this.expect('{');
    if (this.atPunct('[')) {
      // Mapped type: { [K in keyof T]?: V }
      this.next();
      const key = this.expectIdentifier('a mapped key').v;
      if (!this.at('in')) {
        this.error(UNSUPPORTED, 'Index signatures are not supported; use a map type.', this.peek());
        this.skipBalanced('[', ']');
        this.expect('}');
        return null;
      }
      this.next();
      const keyType = this.parseType();
      this.expect(']');
      const optional = Boolean(this.eat('?'));
      this.expect(':');
      const valueType = this.parseType();
      this.expect('}');
      return { kind: 'mapped', key, keyType, value: valueType, optional };
    }
    const fields = [];
    while (!this.atPunct('}') && this.peek().t !== 'eof') {
      let readonly = false;
      if (this.at('readonly')) { this.next(); readonly = true; }
      const nameToken = this.peek();
      if (nameToken.t !== 'ident' && nameToken.t !== 'string' && nameToken.t !== 'number') {
        this.error(SYNTAX, `Expected a property name but found ${JSON.stringify(nameToken.v)}.`, nameToken);
        this.skipStatement();
        continue;
      }
      this.next();
      const optional = Boolean(this.eat('?'));
      if (this.atPunct('(') || this.atPunct('<')) {
        const typeParams = this.parseTypeParameters();
        const params = this.parseParameters();
        if (!this.atPunct(':')) {
          this.error(SYNTAX, `Method "${nameToken.v}" is missing a return type.`, nameToken);
          this.skipStatement();
          continue;
        }
        this.next();
        const ret = this.parseType();
        if (typeParams.length) {
          this.error(WIDENED, `Generic method "${nameToken.v}" was widened to its constraints; PlainScript record fields cannot declare type parameters.`, nameToken, 'warning');
          if (ret) fields.push({ name: nameToken.v, optional, readonly, type: eraseTypeParams(renderFunctionType(params, ret), typeParams) });
        } else if (ret) fields.push({ name: nameToken.v, optional, readonly, type: renderFunctionType(params, ret) });
        this.eat(';');
        this.eat(',');
        continue;
      }
      if (!this.atPunct(':')) {
        this.error(SYNTAX, `Property "${nameToken.v}" is missing a type.`, nameToken);
        this.skipStatement();
        continue;
      }
      this.next();
      const type = this.parseType();
      if (type) fields.push({ name: nameToken.v, optional, readonly, type });
      this.eat(';');
      this.eat(',');
    }
    this.expect('}');
    return { kind: 'record', fields };
  }

  skipToSemicolon() {
    while (this.peek().t !== 'eof' && !this.atPunct(';')) this.next();
    this.eat(';');
  }

  skipBalanced(open, close) {
    if (!this.atPunct(open)) return;
    let depth = 0;
    while (this.peek().t !== 'eof') {
      const token = this.next();
      if (token.v === open) depth += 1;
      else if (token.v === close) { depth -= 1; if (depth === 0) return; }
    }
  }
}

// Replace each declared type parameter with its constraint (or `any`) in an
// already-rendered signature. Used where a generic signature is widened.
function eraseTypeParams(text, typeParams) {
  if (!typeParams.length) return text;
  const names = typeParams.map((param) => param.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`\\b(${names.join('|')})\\b`, 'g');
  const replacements = new Map(typeParams.map((param) => [param.name, param.constraint ? renderType(param.constraint) : 'any']));
  return text.replace(pattern, (name) => replacements.get(name));
}

function renderRecord(fields) {
  return fields.length
    ? `{ ${fields.map((field) => `${field.readonly ? 'readonly ' : ''}${field.name}${field.optional ? '?' : ''}: ${field.type}`).join(', ')} }`
    : '{ }';
}

function mergeFields(first, second) {
  const merged = [...first];
  const seen = new Set(first.map((field) => field.name));
  for (const field of second) {
    if (seen.has(field.name)) continue;
    seen.add(field.name);
    merged.push(field);
  }
  return merged;
}

// Template literal types have no PlainScript equivalent. Expand the common
// finite case (`\`key-${'down' | 'up'}\``); otherwise widen to text with an
// explicit warning rather than pretending the pattern was preserved.
function expandTemplateLiteral(raw) {
  const parts = raw.split(/\$\{([^}]*)\}/);
  const choices = [];
  for (let index = 0; index < parts.length; index += 1) {
    if (index % 2 === 0) { choices.push([parts[index]]); continue; }
    const expression = parts[index].trim();
    const values = literalChoices(expression);
    if (!values) return null;
    choices.push(values);
  }
  let combinations = [''];
  for (const options of choices) {
    const next = [];
    for (const prefix of combinations) {
      for (const option of options) next.push(prefix + option);
    }
    if (next.length > 50) return null;
    combinations = next;
  }
  return combinations;
}

function literalChoices(expression) {
  // `${string}` is an open pattern, not an empty substitution; widening to
  // text is the only honest translation.
  if (expression === 'string' || expression === 'number' || expression === 'boolean') return null;
  const members = expression.split('|').map((member) => member.trim()).filter(Boolean);
  if (!members.length) return null;
  const values = [];
  for (const member of members) {
    if ((member.startsWith("'") && member.endsWith("'")) || (member.startsWith('"') && member.endsWith('"'))) {
      values.push(member.slice(1, -1));
      continue;
    }
    if (/^-?[0-9]+$/.test(member)) { values.push(member); continue; }
    return null;
  }
  return values;
}

function normalizeSpecifier(spec) {
  if (!spec.startsWith('.')) return spec;
  return spec.replace(/\.d\.ts$/, '').replace(/\.ts$/, '').replace(/\.js$/, '');
}

function renderTypeParams(params) {
  return params.length ? `<${params.map((param) => `${param.name}${param.constraint ? `: ${renderType(param.constraint)}` : ''}`).join(', ')}>` : '';
}

const PLAINSCRIPT_PARAMETER_KEYWORDS = new Set([
  'and', 'as', 'async', 'await', 'break', 'case', 'catch', 'const', 'continue',
  'declare', 'default', 'do', 'else', 'end', 'export', 'extends', 'false', 'finally',
  'for', 'from', 'function', 'if', 'import', 'in', 'is', 'let', 'match', 'new',
  'not', 'nothing', 'of', 'or', 'otherwise', 'return', 'super', 'this', 'throw', 'to',
  'true', 'try', 'type', 'typeof', 'when', 'while', 'with', 'yield',
]);

function renderParameter(parameter) {
  if (!parameter || !parameter.type) return `${parameter.name}: any`;
  const name = PLAINSCRIPT_PARAMETER_KEYWORDS.has(parameter.name) ? `${parameter.name}Value` : parameter.name;
  return `${parameter.rest ? '...' : ''}${name}${parameter.optional ? '?' : ''}: ${renderType(parameter.type)}`;
}

function renderFunctionType(params, ret, typeParams = []) {
  return `(${params.map(renderParameter).join(', ')})${typeParams.length ? renderTypeParams(typeParams) : ''} -> ${renderType(ret)}`;
}

function renderType(type) {
  if (!type) return 'any';
  switch (type.kind) {
    case 'prim': return type.name;
    case 'literal': return typeof type.value === 'string' ? JSON.stringify(type.value) : String(type.value);
    case 'ref': return `${type.name}${type.args && type.args.length ? `<${type.args.map(renderType).join(', ')}>` : ''}`;
    case 'list': return `list of ${atomic(type.inner)}`;
    case 'promise': return `Promise of ${atomic(type.inner)}`;
    case 'map': return `map of ${atomic(type.key)} to ${atomic(type.value)}`;
    case 'tuple': {
      const elements = type.elements.map(renderType);
      if (type.rest) elements.push(`...${renderType(type.rest)}`);
      return `[${elements.join(', ')}]`;
    }
    case 'union': return type.members.map(renderType).join(' or ');
    case 'intersection': return type.members.map(renderType).join(' & ');
    case 'keyof': return `keyof ${atomic(type.target)}`;
    case 'indexed': return `${atomic(type.target)}[${renderType(type.index)}]`;
    case 'conditional': return `${renderType(type.check)} extends ${renderType(type.extendsType)} ? ${renderType(type.trueType)} : ${renderType(type.falseType)}`;
    case 'typeof': return `typeof ${type.name}`;
    case 'mapped': return `{ [${type.key} in ${renderType(type.keyType)}]${type.optional ? '?' : ''}: ${renderType(type.value)} }`;
    case 'record': return type.fields.length
      ? `{ ${type.fields.map((field) => `${field.readonly ? 'readonly ' : ''}${field.name}${field.optional ? '?' : ''}: ${renderType(field.type)}`).join(', ')} }`
      : '{ }';
    case 'function': return renderFunctionType(type.params, type.ret);
    default: return 'any';
  }
}

function atomic(type) {
  const text = renderType(type);
  return type && (type.kind === 'union' || type.kind === 'function' || type.kind === 'conditional') ? `(${text})` : text;
}

function translateTypeScript(source, options = {}) {
  const file = options.file || '<declaration.d.ts>';
  const parser = new TypeParser(source, file);
  parser.resolveImportFile = options.resolveImports !== false;
  try {
    const result = parser.parseFile();
    return { code: result.source, diagnostics: result.diagnostics, imports: result.imports };
  } catch (failure) {
    if (failure instanceof TypeScriptDeclarationError) {
      return { code: '', diagnostics: [...parser.diagnostics, failure.diagnostic], imports: [] };
    }
    throw failure;
  }
}

function translateFile(file, options = {}) {
  const source = fs.readFileSync(file, 'utf8');
  return { ...translateTypeScript(source, { ...options, file }), file };
}

module.exports = {
  translateTypeScript,
  translateFile,
  normalizeSpecifier,
  TypeParser,
};
