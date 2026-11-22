'use strict';

const { tokenize } = require('./lexer');
const { Span, error, CompileError } = require('./diagnostics');

// PlainScript 2.0 grammar (recursive descent, LL(1) with token lookahead).
//
// There is exactly one spelling per concept. Blocks close with `end`.
// Statements are newline-insensitive, which keeps formatting free without
// making semantics depend on indentation.
//
//   value        syntax
//   ---------    ---------------------------------------------------------
//   binding      let x: number = 1        const y = "fixed"
//   function     function f(a: number) -> text ... end
//   conditional  if c ... else ... end
//   loop         for x in xs ... end      for i in 0 to 9 ... end
//   pattern      match v { case ... }     written with case ... end
//   type         type User <fields> end   type Shape = Circle(r: number) or Empty
//   module       import { a } from "./m"  export function f ...
//   component    render <element "div" ... end> end

class ParseAbort extends Error {
  constructor(diagnostic) {
    super(diagnostic.message);
    this.name = 'ParseAbort';
    this.diagnostic = diagnostic;
  }
}

const STATEMENT_START = new Set([
  'import', 'export', 'type', 'declare', 'function', 'async', 'let', 'const',
  'if', 'for', 'while', 'match', 'try', 'throw', 'return', 'break',
  'continue', 'render', 'element',
]);

class Parser {
  constructor(tokens, file, source, dialect = '2.0') {
    this.tokens = tokens;
    this.file = file || '<input>';
    this.source = source || '';
    this.dialect = dialect;
    this.index = 0;
    this.errors = [];
  }

  // ------------------------------------------------------------ 2.1 dialect

  // Contextual 2.1 words. Each introduces a construct only where that
  // construct can appear, so `value`, `set`, `change`, `define`, `returns` and
  // `each` remain usable as identifiers elsewhere.
  atWord(value, offset = 0) {
    const token = this.peek(offset);
    return token.t === 'ident' && token.v === value;
  }

  // Decides whether the identifier at the cursor opens a 2.1 statement. A
  // call such as `set(handler)` or an expression such as `change + 1` is not a
  // declaration; `set { a, b } to pair` is.
  englishStatementKind() {
    if (this.dialect !== '2.1') return null;
    const token = this.peek();
    if (token.t !== 'ident') return null;
    const next = this.peek(1);

    if (token.v === 'define') {
      const after = this.peek(2);
      return next.t === 'ident' && after.t === 'punct' && (after.v === '(' || after.v === '<')
        ? 'define' : null;
    }
    if (token.v === 'change') return next.t === 'ident' ? 'change' : null;
    // `val` is a short alias for an immutable 2.1 binding: `val x is 1`.
    if (token.v === 'value' || token.v === 'val' || token.v === 'set') {
      const immutable = token.v !== 'set';
      const kind = immutable ? 'value' : 'set';
      if (next.t === 'ident') return kind;
      if (next.t === 'punct' && (next.v === '{' || next.v === '(')) {
        const separator = immutable ? 'is' : 'to';
        return this.groupIsFollowedBy(1, separator) ? kind : null;
      }
    }
    return null;
  }

  // True when the balanced group starting at `offset` is followed by `separator`.
  groupIsFollowedBy(offset, separator) {
    let depth = 0;
    for (let index = this.index + offset; index < this.tokens.length; index += 1) {
      const token = this.tokens[index];
      if (!token || token.t === 'eof') return false;
      if (token.t === 'punct' && (token.v === '(' || token.v === '[' || token.v === '{')) depth += 1;
      else if (token.t === 'punct' && (token.v === ')' || token.v === ']' || token.v === '}')) {
        depth -= 1;
        if (depth === 0) {
          const after = this.tokens[index + 1];
          return Boolean(after) && after.v === separator;
        }
      }
    }
    return false;
  }

  englishVariable(token) {
    const declKind = token.v === 'set' ? 'let' : 'const';
    this.next();
    const pattern = this.bindingPattern();
    let type = null;
    if (this.atPunct(':')) {
      this.next();
      type = this.typeExpression();
    }
    const separator = declKind === 'const' ? 'is' : 'to';
    if (!(this.peek().v === separator && (this.peek().t === 'kw' || this.peek().t === 'ident'))) {
      this.fail('PS2001', `Expected "${separator}" but found ${describe(this.peek())}.`, this.peek(),
        `A 2.1 binding reads "${token.v} name ${separator} value".`);
    }
    this.next();
    const init = this.expression();
    return this.node('VarDecl', token, { declKind, pattern, type, init, exported: false });
  }

  englishAssignment(token) {
    this.next();
    const target = this.expression();
    if (!isAssignable(target)) {
      this.fail('PS2020', 'The left side of a "change" must be a name, field, or index.', token);
    }
    this.expectKw('to', 'PS2016');
    const value = this.expression();
    return this.node('Assignment', token, { target, operator: '=', value });
  }

  atReturnArrow() {
    return this.atPunct('->') || (this.dialect === '2.1' && this.atWord('returns'));
  }

  consumeReturnArrow() {
    if (this.atPunct('->') || (this.dialect === '2.1' && this.atWord('returns'))) {
      this.next();
      return true;
    }
    return false;
  }

  // A 2.1 file has exactly one spelling per concept. Tokens produced by the
  // dialect normaliser carry `alias: true`, so a literal 2.0 keyword is still
  // reported with the 2.1 word that the author meant.
  rejectLegacySpelling(token, suggestion) {
    if (this.dialect !== '2.1') return;
    if (!token || token.t !== 'kw' || token.alias) return;
    this.fail(
      'PS2030',
      `In PlainScript 2.1, write "${suggestion}" instead of "${token.v}".`,
      token,
      'Remove the ``#syntax 2.1`` pragma to keep the 2.0 spelling, or see docs/MIGRATION_2_1.md.',
    );
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)];
  }

  next() {
    const token = this.tokens[this.index];
    if (this.index < this.tokens.length - 1) this.index += 1;
    return token;
  }

  atEof() {
    return this.peek().t === 'eof';
  }

  atPunct(value) {
    const token = this.peek();
    return token.t === 'punct' && token.v === value;
  }

  atKw(value) {
    const token = this.peek();
    return token.t === 'kw' && token.v === value;
  }

  atIdent() {
    return this.peek().t === 'ident';
  }

  spanOf(token, length = 1) {
    return new Span(this.file, token.line, token.col, length);
  }

  fail(code, message, token = this.peek(), hint) {
    throw new ParseAbort(error(code, message, this.spanOf(token, token.t === 'eof' ? 1 : String(token.v || '').length || 1), hint ? { hint } : {}));
  }

  expectPunct(value, code = 'PS2001') {
    if (this.atPunct(value)) return this.next();
    this.fail(code, `Expected "${value}" but found ${describe(this.peek())}.`);
  }

  expectKw(value, code = 'PS2001') {
    if (this.atKw(value)) return this.next();
    this.fail(code, `Expected "${value}" but found ${describe(this.peek())}.`);
  }

  expectIdent(what = 'a name') {
    if (this.atIdent()) return this.next();
    this.fail('PS2002', `Expected ${what} but found ${describe(this.peek())}.`);
  }

  node(kind, token, properties) {
    return Object.assign({ kind, line: token.line, col: token.col }, properties);
  }

  parseProgram() {
    const body = [];
    while (!this.atEof()) {
      const startIndex = this.index;
      try {
        body.push(this.statement());
      } catch (failure) {
        if (!(failure instanceof ParseAbort)) throw failure;
        this.errors.push(failure.diagnostic);
        this.recover(startIndex);
      }
    }
    return { kind: 'Program', body, file: this.file, comments: this.comments || [] };
  }

  // Skips forward to the next token that plausibly starts a statement, so one
  // bad line does not hide the rest of the file's errors.
  recover(startIndex) {
    if (this.index === startIndex) this.next();
    let depth = 0;
    while (!this.atEof()) {
      const token = this.peek();
      if (token.t === 'kw') {
        if (token.v === 'end') {
          if (depth === 0) { this.next(); return; }
          depth -= 1;
          this.next();
          continue;
        }
        if (depth === 0 && STATEMENT_START.has(token.v) && this.index > startIndex) return;
      }
      this.next();
    }
  }

  statement() {
    const token = this.peek();

    if (this.dialect === '2.1' && token.t === 'ident') {
      const english = this.englishStatementKind();
      if (english === 'value' || english === 'set') return this.englishVariable(token);
      if (english === 'change') return this.englishAssignment(token);
      if (english === 'define') return this.functionDeclaration({ exported: false });
    }

    if (token.t === 'ident' && token.v === 'overload' && this.peek(1).t === 'kw' && this.peek(1).v === 'function') {
      return this.overloadDeclaration({ exported: false });
    }

    if (token.t === 'kw') {
      switch (token.v) {
        case 'import': return this.importDeclaration();
        case 'export': return this.exportDeclaration();
        case 'type': return this.typeDeclaration(false);
        case 'declare': return this.declareDeclaration();
        case 'function': return this.functionDeclaration({ exported: false });
        case 'async':
          this.next();
          if (!this.atKw('function') && !(this.dialect === '2.1' && this.atWord('define'))) {
            this.fail('PS2003', this.dialect === '2.1' ? 'Expected "define" after "async".' : 'Expected "function" after "async".');
          }
          return this.functionDeclaration({ exported: false, async: true });
        case 'let':
        case 'const': return this.variableDeclaration({ exported: false });
        case 'if': return this.conditional();
        case 'for': return this.forLoop();
        case 'while': return this.whileLoop();
        case 'match': return this.matchStatement();
        case 'try': return this.tryStatement();
        case 'throw': {
          this.next();
          return this.node('Throw', token, { value: this.expression() });
        }
        case 'return': {
          // `return` always takes a value. Using `return nothing` for an early
          // exit removes the only ambiguity newline-insensitive parsing has.
          this.next();
          return this.node('Return', token, { value: this.expression() });
        }
        case 'break': this.next(); return this.node('Break', token, {});
        case 'continue': this.next(); return this.node('Continue', token, {});
        case 'render': return this.renderStatement();
        case 'element': return this.elementStatement();
        default:
          break;
      }
    }

    return this.expressionStatement();
  }

  // ---------------------------------------------------------------- modules

  importDeclaration() {
    const start = this.expectKw('import');
    if (this.peek().t === 'text') {
      const spec = this.next();
      return this.node('Import', start, { spec: spec.v, defaultName: null, namespace: null, names: [] });
    }

    let defaultName = null;
    let namespace = null;
    const names = [];

    let defaultToken = null;
    let namespaceToken = null;
    if (this.atPunct('{')) {
      this.next();
      while (!this.atPunct('}')) {
        const imported = this.expectIdent('an import name');
        let local = imported.v;
        let localToken = imported;
        if (this.atKw('as')) {
          this.next();
          localToken = this.expectIdent('a local name');
          local = localToken.v;
        }
        names.push(withHiddenPositions({ imported: imported.v, local }, {
          line: localToken.line, col: localToken.col, importedLine: imported.line, importedCol: imported.col,
        }));
        if (this.atPunct(',')) this.next();
        else break;
      }
      this.expectPunct('}');
    } else if (this.atPunct('*')) {
      this.next();
      this.expectKw('as');
      namespaceToken = this.expectIdent('a namespace name');
      namespace = namespaceToken.v;
    } else {
      defaultToken = this.expectIdent('an import name');
      defaultName = defaultToken.v;
      if (this.atPunct(',')) {
        this.next();
        this.expectPunct('{');
        while (!this.atPunct('}')) {
          const imported = this.expectIdent('an import name');
          let local = imported.v;
          let localToken = imported;
          if (this.atKw('as')) { this.next(); localToken = this.expectIdent('a local name'); local = localToken.v; }
          names.push(withHiddenPositions({ imported: imported.v, local }, {
            line: localToken.line, col: localToken.col, importedLine: imported.line, importedCol: imported.col,
          }));
          if (this.atPunct(',')) this.next();
          else break;
        }
        this.expectPunct('}');
      }
    }

    this.expectKw('from');
    const spec = this.peek();
    if (spec.t !== 'text') this.fail('PS2004', 'An import path must be a text literal.');
    this.next();
    return this.node('Import', start, {
      spec: spec.v, defaultName, namespace, names,
      defaultLine: defaultToken ? defaultToken.line : null, defaultCol: defaultToken ? defaultToken.col : null,
      namespaceLine: namespaceToken ? namespaceToken.line : null, namespaceCol: namespaceToken ? namespaceToken.col : null,
    });
  }

  exportDeclaration() {
    const start = this.expectKw('export');
    if (this.atKw('default')) {
      this.next();
      // `export default define name(...) ... end` is a declaration, not an
      // expression: the name is bound for recursion and the emitter writes a
      // real function declaration. Anonymous default functions are allowed.
      if (this.atKw('function') || (this.dialect === '2.1' && this.atWord('define'))) {
        return this.functionDeclaration({ exported: false, defaultExport: true, token: start });
      }
      if (this.atKw('async')) {
        this.next();
        if (!this.atKw('function') && !(this.dialect === '2.1' && this.atWord('define'))) {
          this.fail('PS2003', this.dialect === '2.1' ? 'Expected "define" after "async".' : 'Expected "function" after "async".');
        }
        return this.functionDeclaration({ exported: false, async: true, defaultExport: true, token: start });
      }
      return this.node('ExportDefault', start, { value: this.expression() });
    }
    if (this.atPunct('{')) {
      this.next();
      const names = [];
      while (!this.atPunct('}')) {
        const local = this.expectIdent('an exported name');
        let exported = local.v;
        if (this.atKw('as')) { this.next(); exported = this.expectIdent('an exported name').v; }
        names.push({ local: local.v, exported });
        if (this.atPunct(',')) this.next();
        else break;
      }
      this.expectPunct('}');
      let spec = null;
      if (this.atKw('from')) {
        this.next();
        const pathToken = this.peek();
        if (pathToken.t !== 'text') this.fail('PS2004', 'A re-export path must be a text literal.');
        this.next();
        spec = pathToken.v;
      }
      return this.node('ExportNamed', start, { names, spec });
    }
    if (this.atKw('type')) return this.typeDeclaration(true);
    if (this.dialect === '2.1' && this.peek().t === 'ident') {
      const english = this.englishStatementKind();
      if (english === 'value' || english === 'set') {
        const declaration = this.englishVariable(this.peek());
        declaration.exported = true;
        return declaration;
      }
      if (english === 'define') return this.functionDeclaration({ exported: true, token: start });
    }
    if (this.atKw('declare')) {
      const declaration = this.declareDeclaration();
      declaration.exported = true;
      return declaration;
    }
    if (this.atKw('async')) {
      this.next();
      if (!this.atKw('function') && !(this.dialect === '2.1' && this.atWord('define'))) {
        this.fail('PS2003', this.dialect === '2.1' ? 'Expected "define" after "async".' : 'Expected "function" after "async".');
      }
      return this.functionDeclaration({ exported: true, async: true, token: start });
    }
    if (this.atIdent() && this.peek().v === 'overload' && this.peek(1).t === 'kw' && this.peek(1).v === 'function') {
      return this.overloadDeclaration({ exported: true, token: start });
    }
    if (this.atKw('function') || (this.dialect === '2.1' && this.atWord('define'))) {
      return this.functionDeclaration({ exported: true, token: start });
    }
    if (this.atKw('let') || this.atKw('const')) return this.variableDeclaration({ exported: true, token: start });
    this.fail('PS2005', 'Expected a declaration after "export".', start);
    return null;
  }

  // ------------------------------------------------------------------ types

  typeDeclaration(exported) {
    const start = this.expectKw('type');
    const nameToken = this.expectIdent('a type name');
    const name = nameToken.v;
    const typeParameterInfo = this.typeParameterList();
    const typeParams = typeParameterInfo.params;

    if (this.atPunct('=')) {
      this.next();
      const value = this.typeExpression();
      const node = this.node('TypeDecl', start, { name, nameLine: nameToken.line, nameCol: nameToken.col, typeParams, value, recordFields: null, exported });
      if (Object.keys(typeParameterInfo.constraints).length) node.typeParamConstraints = typeParameterInfo.constraints;
      return node;
    }

    if (this.atKw('end')) {
      this.next();
      const node = this.node('TypeDecl', start, { name, nameLine: nameToken.line, nameCol: nameToken.col, typeParams, value: { k: 'record', fields: [] }, recordFields: [], exported });
      if (Object.keys(typeParameterInfo.constraints).length) node.typeParamConstraints = typeParameterInfo.constraints;
      return node;
    }

    const fields = [];
    while (!this.atKw('end') && !this.atEof()) {
      let readonly = false;
      if (this.atIdent() && this.peek().v === 'readonly' && this.peek(1).t === 'ident') { this.next(); readonly = true; }
      const fieldName = this.expectIdent('a field name');
      const optional = this.atPunct('?');
      if (optional) this.next();
      this.expectPunct(':');
      fields.push({ name: fieldName.v, optional, readonly, type: this.typeExpression() });
      if (this.atPunct(',')) this.next();
    }
    this.expectKw('end');
    const node = this.node('TypeDecl', start, { name, nameLine: nameToken.line, nameCol: nameToken.col, typeParams, value: null, recordFields: fields, exported });
    if (Object.keys(typeParameterInfo.constraints).length) node.typeParamConstraints = typeParameterInfo.constraints;
    return node;
  }

  declareDeclaration() {
    const start = this.expectKw('declare');
    if (this.atKw('function')) {
      const fnToken = this.next();
      const nameToken = this.expectIdent('a function name');
      const name = nameToken.v;
      const typeParameterInfo = this.typeParameterList();
      const typeParams = typeParameterInfo.params;
      const params = this.parameterList();
      let returnType = null;
      if (this.atReturnArrow()) {
        this.next();
        returnType = this.returnAnnotation();
      }
      const node = this.node('DeclareFunction', fnToken, { name, nameLine: nameToken.line, nameCol: nameToken.col, typeParams, params, returnType, exported: false, line: start.line, col: start.col });
      if (Object.keys(typeParameterInfo.constraints).length) node.typeParamConstraints = typeParameterInfo.constraints;
      return node;
    }
    if (this.atKw('const')) {
      this.next();
      const nameToken = this.expectIdent('a name');
      const name = nameToken.v;
      this.expectPunct(':');
      return this.node('DeclareValue', start, { name, nameLine: nameToken.line, nameCol: nameToken.col, type: this.typeExpression(), exported: false });
    }
    this.fail('PS2006', 'Expected "function" or "const" after "declare".');
    return null;
  }

  typeParameterList() {
    if (!this.atPunct('<')) return { params: [], constraints: {} };
    this.next();
    const params = [];
    const constraints = {};
    while (!this.atPunct('>')) {
      const name = this.expectIdent('a type parameter').v;
      params.push(name);
      if (this.atPunct(':')) {
        this.next();
        constraints[name] = this.typeExpression();
      }
      if (this.atPunct(',')) this.next();
      else break;
    }
    this.expectPunct('>');
    return { params, constraints };
  }

  // `typeExpression` is the union level. Collection elements and map keys use
  // `typeOptional` so that `list of number or text` means a list of two kinds
  // of element, not a list-or-text. Parenthesise to group: `(number or text)?`.
  typeExpression() {
    const start = this.peek();
    const check = this.typeUnion();
    if (this.atIdent() && this.peek().v === 'extends') {
      this.next();
      const extendsType = this.typeUnion(false);
      this.expectPunct('?');
      const trueType = this.typeExpression();
      this.expectPunct(':');
      const falseType = this.typeExpression();
      return this.node('ConditionalType', start, { check, extendsType, trueType, falseType });
    }
    return check;
  }

  typeUnion(allowOptional = true) {
    const start = this.peek();
    const members = [this.typeIntersection(allowOptional)];
    while (this.atKw('or')) {
      this.next();
      members.push(this.typeIntersection(allowOptional));
    }
    if (members.length > 1) return this.node('UnionType', start, { members });
    return members[0];
  }

  typeIntersection(allowOptional = true) {
    const start = this.peek();
    const members = [this.typeOptional(allowOptional)];
    while (this.atPunct('&')) {
      this.next();
      members.push(this.typeOptional(allowOptional));
    }
    if (members.length > 1) return this.node('IntersectionType', start, { members });
    return members[0];
  }

  typeOptional(allowOptional = true) {
    const start = this.peek();
    let type = this.typePrimary(allowOptional);
    while (this.atPunct('[')) {
      this.next();
      const index = this.typeExpression();
      this.expectPunct(']');
      type = this.node('IndexedAccessType', start, { target: type, index });
    }
    if (allowOptional && this.atPunct('?')) {
      this.next();
      return this.node('OptionalType', start, { inner: type });
    }
    return type;
  }

  typePrimary(allowOptional = true) {
    const token = this.peek();

    if (token.t === 'text' || token.t === 'number') {
      this.next();
      return this.node('LiteralType', token, { value: token.t === 'number' ? Number(token.v) : token.v });
    }
    if (token.t === 'kw' && (token.v === 'true' || token.v === 'false')) {
      this.next();
      return this.node('LiteralType', token, { value: token.v === 'true' });
    }
    if (token.t === 'kw' && token.v === 'nothing') {
      this.next();
      return this.node('NamedType', token, { name: 'nothing', args: [] });
    }
    if (token.t === 'punct' && token.v === '(') {
      this.next();
      const params = [];
      while (!this.atPunct(')')) {
        if (this.atPunct('...')) {
          this.next();
          const name = this.expectIdent('a parameter name').v;
          this.expectPunct(':');
          params.push({ name, type: this.typeExpression(), rest: true, optional: false });
        } else {
          let name = null;
          let optional = false;
          if (this.atIdent() && this.peek(1).t === 'punct' && this.peek(1).v === ':') {
            name = this.next().v;
            this.expectPunct(':');
          } else if (this.atIdent() && this.peek(1).t === 'punct' && this.peek(1).v === '?' && this.peek(2).t === 'punct' && this.peek(2).v === ':') {
            name = this.next().v;
            this.next();
            this.next();
            optional = true;
          }
          const type = this.typeExpression();
          params.push({ name, type, optional, rest: false });
        }
        if (this.atPunct(',')) this.next();
        else break;
      }
      if (this.atPunct('->')) {
        this.next();
        const ret = this.typeExpression();
        return this.node('FunctionType', token, { params, ret });
      }
      this.expectPunct(')');
      if (!this.atPunct('->')) {
        // Parenthesised type used for grouping: (number or text)?
        if (params.length !== 1 || params[0].name !== null) {
          this.fail('PS2008', 'Expected "->" in a function type.', token);
        }
        return params[0].type;
      }
      // Handle -> consumed above but expectPunct failed; re-consume
      this.next();
      const ret = this.typeExpression();
      return this.node('FunctionType', token, { params, ret });
    }
    if (token.t === 'punct' && token.v === '[') {
      this.next();
      const elements = [];
      let rest = null;
      while (!this.atPunct(']')) {
        if (this.atPunct('...')) {
          this.next();
          rest = this.typeExpression();
          if (!this.atPunct(']')) this.fail('PS2008', 'A tuple rest element must be last.', token);
          break;
        }
        elements.push(this.typeExpression());
        if (this.atPunct(',')) this.next();
        else break;
      }
      this.expectPunct(']');
      return this.node('TupleType', token, { elements, rest });
    }
    if (token.t === 'punct' && token.v === '{') {
      this.next();
      if (this.atPunct('[')) {
        this.next();
        const keyName = this.expectIdent('a mapped-type key').v;
        this.expectKw('in', 'PS2007');
        const keyType = this.typeExpression();
        this.expectPunct(']');
        const optional = this.atPunct('?');
        if (optional) this.next();
        this.expectPunct(':');
        const valueType = this.typeExpression();
        this.expectPunct('}');
        return this.node('MappedType', token, { keyName, keyType, valueType, optional });
      }
      const fields = [];
      while (!this.atPunct('}')) {
        let readonly = false;
        if (this.atIdent() && this.peek().v === 'readonly' && this.peek(1).t === 'ident') { this.next(); readonly = true; }
        const name = this.expectIdent('a field name').v;
        const optional = this.atPunct('?');
        if (optional) this.next();
        this.expectPunct(':');
        fields.push({ name, optional, readonly, type: this.typeExpression() });
        if (this.atPunct(',')) this.next();
        else break;
      }
      this.expectPunct('}');
      return this.node('RecordType', token, { fields });
    }

    if (token.t === 'ident') {
      this.next();
      if (token.v === 'list' && this.atKw('of')) {
        this.next();
        return this.node('ListType', token, { elem: this.typeOptional(allowOptional) });
      }
      if (token.v === 'map' && this.atKw('of')) {
        this.next();
        const key = this.typeOptional(allowOptional);
        this.expectKw('to', 'PS2007');
        return this.node('MapType', token, { key, value: this.typeOptional(allowOptional) });
      }
      if (token.v === 'Promise' && this.atKw('of')) {
        this.next();
        return this.node('PromiseType', token, { value: this.typeOptional(allowOptional) });
      }
      if (token.v === 'keyof') {
        return this.node('KeyofType', token, { target: this.typePrimary() });
      }
      if (token.v === 'typeof') {
        return this.node('TypeofType', token, { value: this.primaryExpression() });
      }
      // Bare `list` and `map` mean "a list/map of anything", which is what a
      // runtime type test needs.
      if (token.v === 'list' && !this.atPunct('<')) {
        return this.node('ListType', token, { elem: { kind: 'NamedType', name: 'any', args: [], line: token.line, col: token.col } });
      }
      if (token.v === 'map' && !this.atPunct('<')) {
        return this.node('MapType', token, {
          key: { kind: 'NamedType', name: 'any', args: [], line: token.line, col: token.col },
          value: { kind: 'NamedType', name: 'any', args: [], line: token.line, col: token.col },
        });
      }
      const args = [];
      if (this.atPunct('<')) {
        this.next();
        while (!this.atPunct('>')) {
          args.push(this.typeExpression());
          if (this.atPunct(',')) this.next();
          else break;
        }
        this.expectPunct('>');
      }
      if (this.atPunct('(')) {
        this.next();
        const fields = [];
        while (!this.atPunct(')')) {
          const nameToken = this.peek();
          if (nameToken.t === 'text') {
            this.next();
            this.expectPunct(':');
            fields.push({ name: nameToken.v, type: this.typeExpression() });
          } else {
            const name = this.expectIdent('a field name').v;
            this.expectPunct(':');
            fields.push({ name, type: this.typeExpression() });
          }
          if (this.atPunct(',')) this.next();
          else break;
        }
        this.expectPunct(')');
        return this.node('VariantType', token, { name: token.v, fields, args });
      }
      return this.node('NamedType', token, { name: token.v, args });
    }

    this.fail('PS2008', `Expected a type but found ${describe(token)}.`, token);
    return null;
  }

  // --------------------------------------------------------------- functions

  returnAnnotation() {
    if (this.atIdent() && this.peek(1).t === 'kw' && this.peek(1).v === 'is') {
      const token = this.next();
      const parameter = token.v;
      this.next();
      return this.node('PredicateType', token, { parameter, target: this.typeExpression() });
    }
    return this.typeExpression();
  }

  parameterList() {
    this.expectPunct('(');
    const params = [];
    while (!this.atPunct(')')) {
      let rest = false;
      if (this.atPunct('...')) { this.next(); rest = true; }
      const nameToken = this.expectIdent('a parameter name');
      const name = nameToken.v;
      const optional = this.atPunct('?');
      if (optional) this.next();
      this.expectPunct(':');
      const type = this.typeExpression();
      let defaultValue = null;
      if (this.atPunct('=')) {
        this.next();
        defaultValue = this.expression();
      }
      params.push({ name, nameLine: nameToken.line, nameCol: nameToken.col, type, rest, optional: optional || defaultValue !== null, defaultValue });
      if (this.atPunct(',')) this.next();
      else break;
    }
    this.expectPunct(')');
    return params;
  }

  overloadDeclaration(options = {}) {
    const start = options.token || this.peek();
    if (this.atIdent() && this.peek().v === 'overload') this.next();
    if (this.dialect === '2.1' && this.atWord('define')) this.next();
    else {
      this.rejectLegacySpelling(this.peek(), 'define');
      this.expectKw('function');
    }
    const nameToken = this.expectIdent('an overloaded function name');
    const typeParameterInfo = this.typeParameterList();
    const params = this.parameterList();
    let returnType = null;
    if (this.atReturnArrow()) {
      this.next();
      returnType = this.returnAnnotation();
    }
    const node = this.node('OverloadDecl', start, {
      name: nameToken.v, nameLine: nameToken.line, nameCol: nameToken.col,
      typeParams: typeParameterInfo.params, params, returnType,
      async: false, exported: Boolean(options.exported),
    });
    if (Object.keys(typeParameterInfo.constraints).length) node.typeParamConstraints = typeParameterInfo.constraints;
    return node;
  }

  functionDeclaration(options = {}) {
    const token = options.token || this.peek();
    if (this.dialect === '2.1' && this.atWord('define')) this.next();
    else {
      this.rejectLegacySpelling(this.peek(), 'define');
      this.expectKw('function');
    }
    let name = null;
    let nameToken = null;
    if (this.atIdent()) { nameToken = this.next(); name = nameToken.v; }
    else if (!options.defaultExport) this.fail('PS2002', `Expected a function name but found ${describe(this.peek())}.`);
    const typeParameterInfo = this.typeParameterList();
    const typeParams = typeParameterInfo.params;
    const params = this.parameterList();
    let returnType = null;
    if (this.atReturnArrow()) {
      this.next();
      returnType = this.returnAnnotation();
    }
    const body = this.blockBody('function');
    const node = this.node('FunctionDecl', token, {
      name, nameLine: nameToken ? nameToken.line : null, nameCol: nameToken ? nameToken.col : null,
      typeParams, params, returnType, body, async: Boolean(options.async),
      exported: Boolean(options.exported), defaultExport: Boolean(options.defaultExport),
    });
    if (Object.keys(typeParameterInfo.constraints).length) node.typeParamConstraints = typeParameterInfo.constraints;
    return node;
  }

  // Collects statements until one of `stoppers` appears, without consuming it.
  statementsUntil(stoppers, context = 'block') {
    const body = [];
    while (!this.atEof() && !(this.peek().t === 'kw' && stoppers.has(this.peek().v))) {
      body.push(this.statement());
    }
    if (this.atEof()) this.fail('PS2010', `Unterminated ${context}; expected "end" before the end of the file.`);
    return body;
  }

  blockBody(context = 'block') {
    const body = this.statementsUntil(new Set(['end']), context);
    this.expectKw('end');
    return body;
  }

  variableDeclaration(options = {}) {
    const token = options.token || this.peek();
    this.rejectLegacySpelling(this.peek(), this.peek().v === 'const' ? 'value' : 'set');
    const kindToken = this.next(); // let | const
    const pattern = this.bindingPattern();
    let type = null;
    if (this.atPunct(':')) {
      this.next();
      type = this.typeExpression();
    }
    this.expectPunct('=');
    const init = this.expression();
    return this.node('VarDecl', token, {
      declKind: kindToken.v, pattern, type, init, exported: Boolean(options.exported),
    });
  }

  bindingPattern() {
    const token = this.peek();
    if (token.t === 'ident') {
      this.next();
      return this.node('NamePattern', token, { name: token.v });
    }
    if (this.atPunct('(')) {
      this.next();
      const items = [];
      while (!this.atPunct(')')) {
        items.push(this.bindingPattern());
        if (this.atPunct(',')) this.next();
        else break;
      }
      this.expectPunct(')');
      return this.node('TuplePattern', token, { items });
    }
    if (this.atPunct('{')) {
      this.next();
      const fields = [];
      while (!this.atPunct('}')) {
        const key = this.expectIdent('a field name').v;
        let target = { kind: 'NamePattern', name: key, line: token.line, col: token.col };
        if (this.atPunct(':')) {
          this.next();
          target = this.bindingPattern();
        }
        fields.push({ key, target });
        if (this.atPunct(',')) this.next();
        else break;
      }
      this.expectPunct('}');
      return this.node('RecordPattern', token, { fields });
    }
    this.fail('PS2011', `Expected a binding name but found ${describe(token)}.`);
    return null;
  }

  // ------------------------------------------------------------- control flow

  conditional() {
    this.rejectLegacySpelling(this.peek(), 'when');
    const start = this.expectKw('if');
    const stoppers = new Set(['else', 'end']);
    const branches = [{ condition: this.expression(), body: null, line: start.line, col: start.col }];
    branches[0].body = this.statementsUntil(stoppers, 'conditional');
    let alternate = null;

    while (this.atKw('else')) {
      this.rejectLegacySpelling(this.peek(), 'otherwise');
      this.next();
      if (this.atKw('if')) {
        this.next();
        const condition = this.expression();
        const body = this.statementsUntil(stoppers, 'conditional');
        branches.push({ condition, body, line: start.line, col: start.col });
        continue;
      }
      alternate = this.statementsUntil(new Set(['end']), 'conditional');
      break;
    }

    this.expectKw('end', 'PS2009');
    return this.node('Conditional', start, { branches, otherwise: alternate });
  }

  eachMarksLoop() {
    const following = this.peek(1);
    if (!following || following.t === 'eof') return false;
    if (following.t === 'ident') return true;
    return following.t === 'punct' && (following.v === '[' || following.v === '{');
  }

  forLoop() {
    const start = this.expectKw('for');

    // 2.1 loops spell their direction: `for each x in xs` and
    // `for i from 0 to 9`. The 2.0 `for x in xs` shortcut is not accepted
    // there, which keeps one spelling per loop shape.
    if (this.dialect === '2.1') {
      // `each` introduces a foreach loop only when a binding pattern follows
      // it. When the next word is `in` or `from`, `each` is the loop variable
      // itself: `for each in names` binds a variable named `each`.
      const eachMarker = this.atWord('each') && this.eachMarksLoop();
      const bindsEach = !eachMarker && this.atWord('each');
      if (eachMarker) this.next();
      const pattern = this.bindingPattern();
      // A foreach loop used the `each` marker, or bound a variable literally
      // named `each` (where `in` follows directly). Every other loop spells
      // its direction with `from`, so `for x in xs` stays an error.
      if (eachMarker || (bindsEach && this.atKw('in'))) {
        this.expectKw('in');
        const iterable = this.expression();
        const body = this.blockBody('loop');
        return this.node('ForEach', start, { pattern, iterable, body });
      }
      this.expectKw('from', 'PS2014');
      const from = this.expression();
      this.expectKw('to', 'PS2015');
      const to = this.expression();
      const body = this.blockBody('loop');
      return this.node('ForRange', start, { pattern, from, to, body });
    }

    const pattern = this.bindingPattern();
    this.expectKw('in');
    const iterable = this.expression();
    let end = null;
    if (this.atKw('to')) {
      this.next();
      end = this.expression();
    }
    const body = this.blockBody('loop');
    if (end) return this.node('ForRange', start, { pattern, from: iterable, to: end, body });
    return this.node('ForEach', start, { pattern, iterable, body });
  }

  whileLoop() {
    const start = this.expectKw('while');
    const condition = this.expression();
    const body = this.blockBody('while loop');
    return this.node('While', start, { condition, body });
  }

  matchStatement() {
    const start = this.expectKw('match');
    const subject = this.expression();
    const cases = [];
    while (this.atKw('case')) {
      const caseToken = this.next();
      const pattern = this.pattern();
      let guard = null;
      if (this.atKw('if')) {
        this.next();
        guard = this.expression();
      }
      const body = [];
      const stopAtOtherwise = this.dialect === '2.1';
      while (!this.atKw('case') && !this.atKw('end') && !this.atEof()
        && !(stopAtOtherwise && this.atKw('else'))) {
        body.push(this.statement());
      }
      cases.push({ pattern, guard, body, line: caseToken.line, col: caseToken.col });
    }
    // 2.1 lets `otherwise` close a match, so the fallback arm reads the same as
    // the fallback branch of `when`.
    if (this.dialect === '2.1' && this.atKw('else')) {
      const otherwiseToken = this.next();
      const body = [];
      while (!this.atKw('end') && !this.atEof()) body.push(this.statement());
      cases.push({
        pattern: { kind: 'WildcardPattern', line: otherwiseToken.line, col: otherwiseToken.col },
        guard: null, body, line: otherwiseToken.line, col: otherwiseToken.col,
      });
    }
    this.expectKw('end', 'PS2012');
    if (cases.length === 0) this.fail('PS2013', 'A match needs at least one "case".', start);
    return this.node('Match', start, { subject, cases });
  }

  pattern() {
    const token = this.peek();
    if (token.t === 'number') {
      this.next();
      return this.node('LiteralPattern', token, { value: { kind: 'Number', value: Number(token.v) } });
    }
    if (token.t === 'text') {
      this.next();
      return this.node('LiteralPattern', token, { value: { kind: 'Text', value: token.v } });
    }
    if (token.t === 'kw' && (token.v === 'true' || token.v === 'false')) {
      this.next();
      return this.node('LiteralPattern', token, { value: { kind: 'Boolean', value: token.v === 'true' } });
    }
    if (token.t === 'kw' && token.v === 'nothing') {
      this.next();
      return this.node('LiteralPattern', token, { value: { kind: 'Nothing' } });
    }
    if (this.atPunct('-')) {
      this.next();
      const number = this.peek();
      if (number.t !== 'number') this.fail('PS2014', 'Only number literals may be negated in a pattern.');
      this.next();
      return this.node('LiteralPattern', token, { value: { kind: 'Number', value: -Number(number.v) } });
    }
    if (this.atPunct('[')) {
      this.next();
      const items = [];
      let rest = null;
      while (!this.atPunct(']')) {
        if (this.atPunct('...')) {
          this.next();
          rest = this.expectIdent('a rest binding').v;
          break;
        }
        items.push(this.pattern());
        if (this.atPunct(',')) this.next();
        else break;
      }
      this.expectPunct(']');
      return this.node('ListPattern', token, { items, rest });
    }
    if (this.atPunct('{')) {
      this.next();
      const fields = [];
      while (!this.atPunct('}')) {
        const key = this.expectIdent('a field name').v;
        let pattern = { kind: 'NamePattern', name: key, line: token.line, col: token.col };
        if (this.atPunct(':')) {
          this.next();
          pattern = this.pattern();
        }
        fields.push({ key, pattern });
        if (this.atPunct(',')) this.next();
        else break;
      }
      this.expectPunct('}');
      return this.node('RecordMatchPattern', token, { fields });
    }
    if (this.atPunct('(')) {
      this.next();
      const items = [];
      while (!this.atPunct(')')) {
        items.push(this.pattern());
        if (this.atPunct(',')) this.next();
        else break;
      }
      this.expectPunct(')');
      return this.node('TuplePattern', token, { items });
    }
    if (token.t === 'ident') {
      this.next();
      if (this.atPunct('(')) {
        this.next();
        const fields = [];
        while (!this.atPunct(')')) {
          fields.push(this.pattern());
          if (this.atPunct(',')) this.next();
          else break;
        }
        this.expectPunct(')');
        return this.node('VariantPattern', token, { name: token.v, fields });
      }
      if (token.v === '_') return this.node('WildcardPattern', token, {});
      return this.node('NamePattern', token, { name: token.v });
    }
    this.fail('PS2015', `Expected a pattern but found ${describe(token)}.`);
    return null;
  }

  tryStatement() {
    const start = this.expectKw('try');
    const body = this.statementsUntil(new Set(['catch', 'finally', 'end']), 'try block');
    let errorName = null;
    let handler = null;
    let finalizer = null;
    if (this.atKw('catch')) {
      this.next();
      errorName = this.expectIdent('an error name').v;
      handler = this.statementsUntil(new Set(['finally', 'end']), 'catch block');
    }
    if (this.atKw('finally')) {
      this.next();
      finalizer = this.statementsUntil(new Set(['end']), 'finally block');
    }
    this.expectKw('end', 'PS2016');
    return this.node('Try', start, { body, errorName, handler, finalizer });
  }

  // --------------------------------------------------------------- rendering

  renderStatement() {
    const start = this.expectKw('render');
    return this.node('Render', start, { children: this.renderChildren('render') });
  }

  // Inside render and element blocks a child is an expression statement, a
  // nested element, or a spread of an existing list of children.
  renderChildren(context) {
    const children = [];
    while (!this.atKw('end') && !this.atEof()) {
      if (this.atPunct('...')) {
        const token = this.next();
        const spread = this.node('Spread', token, { value: this.expression() });
        children.push(this.node('ExprStmt', token, { expression: spread }));
        continue;
      }
      children.push(this.statement());
    }
    this.expectKw('end', context === 'render' ? 'PS2017' : 'PS2019');
    return children;
  }

  elementStatement() {
    const start = this.expectKw('element');
    const tag = this.expression();
    const props = [];
    if (this.atKw('with')) {
      this.next();
      while (true) {
        const keyToken = this.peek();
        let key;
        // Keywords are valid property names: `with type: "submit"`.
        if (keyToken.t === 'text' || keyToken.t === 'ident' || keyToken.t === 'kw') key = this.next().v;
        else this.fail('PS2018', 'An element property name must be a name or text literal.');
        if (this.atPunct(':')) {
          this.next();
          props.push({ key, value: this.expression() });
        } else {
          props.push({ key, value: { kind: 'Name', name: key, line: keyToken.line, col: keyToken.col } });
        }
        if (this.atPunct(',')) { this.next(); continue; }
        break;
      }
    }
    return this.node('Element', start, { tag, props, children: this.renderChildren('element') });
  }

  // -------------------------------------------------------------- expressions

  expressionStatement() {
    const start = this.peek();
    const expr = this.expression();
    if (this.atPunct('=') || this.isAssignmentOperator()) {
      const operatorToken = this.next();
      if (!isAssignable(expr)) {
        this.fail('PS2020', 'The left side of an assignment must be a name, field, or index.', start);
      }
      const value = this.expression();
      const op = operatorToken.v === '=' ? '=' : operatorToken.v.slice(0, -1);
      return this.node('Assignment', start, { target: expr, operator: op, value });
    }
    return this.node('ExprStmt', start, { expression: expr });
  }

  isAssignmentOperator() {
    const token = this.peek();
    return token.t === 'punct' && ['+=', '-=', '*=', '/=', '%='].includes(token.v);
  }

  expression() {
    return this.pipeline();
  }

  pipeline() {
    let left = this.orExpression();
    while (this.atPunct('|>')) {
      const token = this.next();
      const right = this.orExpression();
      left = this.node('Pipe', token, { left, right });
    }
    return left;
  }

  orExpression() {
    let left = this.andExpression();
    while (this.atKw('or')) {
      const token = this.next();
      left = this.node('Binary', token, { operator: 'or', left, right: this.andExpression() });
    }
    return left;
  }

  andExpression() {
    let left = this.nullishExpression();
    while (this.atKw('and')) {
      const token = this.next();
      left = this.node('Binary', token, { operator: 'and', left, right: this.nullishExpression() });
    }
    return left;
  }

  nullishExpression() {
    let left = this.equalityExpression();
    while (this.atPunct('??')) {
      const token = this.next();
      left = this.node('Binary', token, { operator: '??', left, right: this.equalityExpression() });
    }
    return left;
  }

  equalityExpression() {
    let left = this.comparisonExpression();
    while (this.atPunct('==') || this.atPunct('!=')) {
      const token = this.next();
      left = this.node('Binary', token, { operator: token.v, left, right: this.comparisonExpression() });
    }
    return left;
  }

  comparisonExpression() {
    let left = this.additiveExpression();
    while (true) {
      if (this.atPunct('<') || this.atPunct('<=') || this.atPunct('>') || this.atPunct('>=')) {
        const token = this.next();
        left = this.node('Binary', token, { operator: token.v, left, right: this.additiveExpression() });
        continue;
      }
      if (this.atKw('is')) {
        const token = this.next();
        const type = this.typeExpression();
        left = this.node('TypeTest', token, { value: left, type });
        continue;
      }
      break;
    }
    return left;
  }

  additiveExpression() {
    let left = this.multiplicativeExpression();
    while (this.atPunct('+') || this.atPunct('-')) {
      const token = this.next();
      left = this.node('Binary', token, { operator: token.v, left, right: this.multiplicativeExpression() });
    }
    return left;
  }

  multiplicativeExpression() {
    let left = this.powerExpression();
    while (this.atPunct('*') || this.atPunct('/') || this.atPunct('%')) {
      const token = this.next();
      left = this.node('Binary', token, { operator: token.v, left, right: this.powerExpression() });
    }
    return left;
  }

  powerExpression() {
    const left = this.unaryExpression();
    if (this.atPunct('**')) {
      const token = this.next();
      return this.node('Binary', token, { operator: '**', left, right: this.powerExpression() });
    }
    return left;
  }

  unaryExpression() {
    if (this.atKw('new')) {
      const token = this.next();
      // `new` applies to the postfix expression, so `new Parser(a, b)` keeps
      // its call and arguments and emits `new Parser(a, b)`.
      return this.castSuffix(this.node('New', token, { callee: this.postfixExpression() }));
    }
    if (this.atKw('not') || this.atPunct('-')) {
      const token = this.next();
      const operand = this.unaryExpression();
      return this.castSuffix(this.node('Unary', token, { operator: token.v, operand }));
    }
    if (this.atKw('await')) {
      const token = this.next();
      // `await value as T` casts the awaited value, not the Promise.
      const awaited = this.node('Await', token, { value: this.postfixExpression() });
      return this.castSuffix(awaited);
    }
    return this.castSuffix(this.postfixExpression());
  }

  castSuffix(node) {
    let value = node;
    while (this.atKw('as')) {
      const token = this.next();
      value = this.node('Cast', token, { value, type: this.typeExpression() });
    }
    return value;
  }

  postfixExpression() {
    let value = this.primaryExpression();
    while (true) {
      if (this.atPunct('.')) {
        const token = this.next();
        const property = this.expectPropertyName();
        value = this.node('Member', token, { object: value, property: property.v, optional: false });
        continue;
      }
      if (this.atPunct('?.')) {
        const token = this.next();
        if (this.atPunct('(')) {
          const args = this.callArguments();
          value = this.node('Call', token, { callee: value, args, optional: true });
          continue;
        }
        if (this.atPunct('[')) {
          this.next();
          const index = this.expression();
          this.expectPunct(']');
          value = this.node('Index', token, { object: value, index, optional: true });
          continue;
        }
        const property = this.expectPropertyName();
        value = this.node('Member', token, { object: value, property: property.v, optional: true });
        continue;
      }
      if (this.atPunct('[')) {
        const token = this.next();
        const index = this.expression();
        this.expectPunct(']');
        value = this.node('Index', token, { object: value, index, optional: false });
        continue;
      }
      if (this.atPunct('(')) {
        const token = this.peek();
        const args = this.callArguments();
        value = this.node('Call', token, { callee: value, args, optional: false });
        continue;
      }
      break;
    }
    return value;
  }

  expectPropertyName() {
    const token = this.peek();
    if (token.t === 'ident' || token.t === 'kw') return this.next();
    return this.expectIdent('a property name');
  }

  callArguments() {
    this.expectPunct('(');
    const args = [];
    while (!this.atPunct(')')) {
      if (this.atPunct('...')) {
        const token = this.next();
        args.push(this.node('Spread', token, { value: this.expression() }));
      } else {
        args.push(this.expression());
      }
      if (this.atPunct(',')) this.next();
      else break;
    }
    this.expectPunct(')', 'PS2021');
    return args;
  }

  primaryExpression() {
    const token = this.peek();

    if (token.t === 'number') {
      this.next();
      return this.node('Number', token, { value: Number(token.v) });
    }
    if (token.t === 'text') {
      this.next();
      return this.node('Text', token, { value: token.v });
    }
    if (token.t === 'template') {
      this.next();
      return this.node('Template', token, { parts: this.templateParts(token) });
    }
    if (token.t === 'regex') {
      this.next();
      return this.node('Regex', token, { pattern: token.pattern, flags: token.flags, raw: token.v });
    }
    if (token.t === 'jsx') {
      this.next();
      return this.jsxNode(token.node, token);
    }
    if (token.t === 'kw') {
      if (token.v === 'true' || token.v === 'false') {
        this.next();
        return this.node('Boolean', token, { value: token.v === 'true' });
      }
      if (token.v === 'nothing') {
        this.next();
        return this.node('Nothing', token, {});
      }
      if (token.v === 'function') {
        return this.functionExpression();
      }
      if (token.v === 'element') {
        // Elements are usable in expression position too, so dynamic child
        // lists can be built with ordinary code.
        return this.elementStatement();
      }
      if (token.v === 'async') {
        this.next();
        if (this.atKw('function')) {
          const expression = this.functionExpression();
          expression.async = true;
          return expression;
        }
        if (this.atPunct('(')) {
          const lambda = this.tryLambda();
          if (!lambda) this.fail('PS2029', 'Expected lambda parameters after "async".');
          lambda.async = true;
          return lambda;
        }
        this.fail('PS2029', 'Expected "function" or a lambda after "async".');
      }
      if (token.v === 'await') {
        this.next();
        return this.node('Await', token, { value: this.unaryExpression() });
      }
      this.fail('PS2022', `Unexpected keyword "${token.v}" in an expression.`);
    }
    if (token.t === 'ident') {
      this.next();
      return this.node('Name', token, { name: token.v });
    }
    if (this.atPunct('(')) {
      const lambda = this.tryLambda();
      if (lambda) return lambda;
      this.next();
      const inner = this.expression();
      this.expectPunct(')', 'PS2023');
      return inner;
    }
    if (this.atPunct('[')) {
      this.next();
      const items = [];
      while (!this.atPunct(']')) {
        if (this.atPunct('...')) {
          const spreadToken = this.next();
          items.push(this.node('Spread', spreadToken, { value: this.expression() }));
        } else {
          items.push(this.expression());
        }
        if (this.atPunct(',')) this.next();
        else break;
      }
      this.expectPunct(']', 'PS2024');
      return this.node('ListLiteral', token, { items });
    }
    if (this.atPunct('{')) {
      this.next();
      const fields = [];
      while (!this.atPunct('}')) {
        if (this.atPunct('...')) {
          const spreadToken = this.next();
          fields.push({ spread: this.expression(), token: spreadToken });
        } else {
          const keyToken = this.peek();
          let key;
          if (keyToken.t === 'ident' || keyToken.t === 'kw') key = this.next().v;
          else if (keyToken.t === 'text' || keyToken.t === 'number') key = this.next().v;
          else this.fail('PS2025', `Expected a field name but found ${describe(keyToken)}.`);
          let value;
          if (this.atPunct(':')) {
            this.next();
            value = this.expression();
          } else {
            value = { kind: 'Name', name: key, line: keyToken.line, col: keyToken.col };
          }
          fields.push({ key, value, token: keyToken });
        }
        if (this.atPunct(',')) this.next();
        else break;
      }
      this.expectPunct('}', 'PS2026');
      return this.node('RecordLiteral', token, { fields });
    }

    this.fail('PS2027', `Expected an expression but found ${describe(token)}.`);
    return null;
  }

  // ---------------------------------------------------------------- JSX

  // The lexer captured a JSX region structurally; these methods turn it into
  // ordinary AST nodes with ordinary positions. Embedded expression sources
  // are re-tokenised in the surrounding dialect, so `{items.map(x => <li/>)}`
  // type-checks with the rest of the file.
  jsxNode(spec, token) {
    if (spec.type === 'fragment') {
      return this.node('JSXFragment', token, {
        children: spec.children.map((child) => this.jsxChild(child)).filter(Boolean),
      });
    }
    const tag = this.jsxTag(spec.tag, spec.line, spec.column);
    const attrs = [];
    for (const attr of spec.attrs || []) {
      if (attr.kind === 'spread') {
        const source = attr.src && typeof attr.src.src === 'string'
          ? { ...attr.src, src: attr.src.src.replace(/^\s*\.\.\./, '') }
          : attr.src;
        const value = this.parseInlineExpression(source, attr.line, attr.col);
        if (value) attrs.push({ kind: 'spread', value });
        continue;
      }
      let value;
      if (attr.valueKind === 'text') value = { kind: 'Text', value: attr.value, line: attr.line, col: attr.col };
      else if (attr.valueKind === 'boolean') value = { kind: 'Boolean', value: true, line: attr.line, col: attr.col };
      else value = this.parseInlineExpression(attr.value, attr.line, attr.col);
      attrs.push({ kind: 'attribute', name: attr.name, value });
    }
    return this.node('JSXElement', token, {
      tagName: spec.tag,
      tag,
      attrs,
      children: (spec.children || []).map((child) => this.jsxChild(child)).filter(Boolean),
      selfClosing: Boolean(spec.selfClosing),
    });
  }

  jsxChild(child) {
    if (!child) return null;
    if (child.type === 'text') return { kind: 'JSXText', value: child.value, line: child.line, col: child.column };
    if (child.type === 'expression') return this.parseInlineExpression(child.src, child.line, child.col);
    if (child.type === 'spread') {
      const source = child.src && typeof child.src.src === 'string'
        ? { ...child.src, src: child.src.src.replace(/^\s*\.\.\./, '') }
        : child.src;
      const value = this.parseInlineExpression(source, child.line, child.col);
      return value ? { kind: 'JSXSpreadChild', value, line: child.line, col: child.col } : null;
    }
    return this.jsxNode(child, child);
  }

  jsxTag(name, line, column) {
    const first = name.split('.')[0];
    const intrinsic = /^[a-z]/.test(first) || name.includes('-') || name.includes(':');
    if (intrinsic) return { kind: 'Text', value: name, line, col: column };
    const parts = name.split('.');
    let node = { kind: 'Name', name: parts[0], line, col: column };
    for (const part of parts.slice(1)) node = { kind: 'Member', object: node, property: part, optional: false, line, col: column };
    return node;
  }

  parseInlineExpression(spec, line, column) {
    if (!spec || !String(spec.src || '').trim()) return null;
    const source = spec.src;
    const result = tokenize(source, this.file, { dialect: this.dialect });
    for (const token of result.tokens) {
      token.line = line + token.line - 1;
      if (token.line === line) token.col = column + 1 + token.col - 1;
    }
    this.errors.push(...result.errors);
    const parser = new Parser(result.tokens, this.file, source, this.dialect);
    try {
      const expression = parser.expression();
      if (!parser.atEof()) {
        this.errors.push(error('PS2032', 'Unexpected tokens after a JSX expression.', this.spanOf(parser.peek())));
      }
      this.errors.push(...parser.errors);
      return expression;
    } catch (failure) {
      if (failure instanceof ParseAbort) {
        this.errors.push(failure.diagnostic);
        return { kind: 'Nothing', line, col: column };
      }
      throw failure;
    }
  }

  functionExpression() {
    const token = this.expectKw('function');
    const typeParameterInfo = this.typeParameterList();
    const typeParams = typeParameterInfo.params;
    const params = this.parameterList();
    let returnType = null;
    if (this.atPunct('->')) {
      this.next();
      returnType = this.returnAnnotation();
    }
    const body = this.blockBody('function expression');
    const node = this.node('FunctionExpression', token, { typeParams, params, returnType, body, async: false });
    if (Object.keys(typeParameterInfo.constraints).length) node.typeParamConstraints = typeParameterInfo.constraints;
    return node;
  }

  // A parenthesised expression and a lambda parameter list both start with
  // '('. Parse speculatively and fall back without consuming tokens.
  tryLambda() {
    const savedIndex = this.index;
    const savedErrors = this.errors.length;
    try {
      const start = this.expectPunct('(');
      const params = [];
      while (!this.atPunct(')')) {
        const name = this.expectIdent('a parameter name').v;
        let type = null;
        if (this.atPunct(':')) {
          this.next();
          type = this.typeExpression();
        }
        params.push({ name, type, rest: false, optional: false });
        if (this.atPunct(',')) this.next();
        else break;
      }
      this.expectPunct(')');
      if (!this.atPunct('=>')) throw new Error('not a lambda');
      this.next();
      let body;
      if (this.atKw('do')) {
        this.next();
        body = this.blockBody('lambda');
        return this.node('FunctionExpression', start, { params, returnType: null, body, async: false, expression: null });
      }
      const expression = this.expression();
      return this.node('FunctionExpression', start, { params, returnType: null, body: null, expression, async: false });
    } catch (failure) {
      this.index = savedIndex;
      this.errors.length = savedErrors;
      return null;
    }
  }

  templateParts(token) {
    const parts = [];
    for (const part of token.parts) {
      if (part.t === 'text') {
        parts.push({ kind: 'TemplateText', value: part.v });
        continue;
      }
      const sub = tokenize(part.src, this.file, { dialect: this.dialect });
      if (sub.errors.length) {
        this.errors.push(...sub.errors);
        continue;
      }
      const shifted = sub.tokens.map((t) => ({
        ...t,
        line: part.line + t.line - 1,
        col: t.line === 1 ? part.col + t.col - 1 : t.col,
      }));
      const parser = new Parser(shifted, this.file, part.src, this.dialect);
      try {
        const expression = parser.expression();
        if (!parser.atEof()) parser.fail('PS2028', 'Interpolation must contain exactly one expression.');
        this.errors.push(...parser.errors);
        parts.push({ kind: 'TemplateExpression', expression });
      } catch (failure) {
        if (failure instanceof ParseAbort) {
          this.errors.push(failure.diagnostic);
        } else {
          throw failure;
        }
      }
    }
    return parts;
  }
}

function describe(token) {
  if (!token) return 'the end of the file';
  if (token.t === 'eof') return 'the end of the file';
  if (token.t === 'text') return 'a text literal';
  if (token.t === 'number') return `number ${token.v}`;
  if (token.t === 'template') return 'a template literal';
  if (token.t === 'ident') return `"${token.v}"`;
  return `"${token.v}"`;
}

function isAssignable(node) {
  return node && (node.kind === 'Name' || node.kind === 'Member' || node.kind === 'Index');
}

function withHiddenPositions(value, positions) {
  for (const [key, position] of Object.entries(positions)) {
    Object.defineProperty(value, key, { value: position, enumerable: false, writable: true, configurable: true });
  }
  return value;
}

function parse(source, file, options = {}) {
  const result = tokenize(source, file, options);
  const parser = new Parser(result.tokens, file, source, result.dialect);
  parser.comments = result.comments;
  const program = parser.parseProgram();
  const diagnostics = [...result.errors, ...parser.errors];
  if (diagnostics.length) throw new CompileError(diagnostics);
  return program;
}

module.exports = { parse, Parser, ParseAbort };
