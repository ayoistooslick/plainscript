'use strict';

const T = require('./types');
const { Span, error } = require('./diagnostics');

const PRIMITIVES = new Set(['number', 'text', 'boolean', 'nothing', 'any', 'unknown', 'never']);

class Scope {
  constructor(parent) {
    this.parent = parent || null;
    this.names = new Map();
  }

  define(name, entry) {
    this.names.set(name, entry);
  }

  lookup(name) {
    let scope = this;
    while (scope) {
      if (scope.names.has(name)) return scope.names.get(name);
      scope = scope.parent;
    }
    return null;
  }

  child() {
    return new Scope(this);
  }

  visibleNames() {
    const names = new Set();
    let scope = this;
    while (scope) {
      for (const name of scope.names.keys()) names.add(name);
      scope = scope.parent;
    }
    return [...names];
  }
}

function spanOf(node, file) {
  return new Span(file, node.line, node.col, node.endColumn ? node.endColumn - node.col : 1);
}

function editDistance(a, b) {
  const rows = b.length + 1;
  const cols = a.length + 1;
  const dp = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 1; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[j - 1] === b[i - 1] ? 0 : 1),
      );
    }
  }
  return dp[rows - 1][cols - 1];
}

function closest(name, candidates) {
  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = editDistance(name, candidate);
    if (score < bestScore) { bestScore = score; best = candidate; }
  }
  return bestScore <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
}

class Checker {
  constructor(options) {
    this.file = options.file;
    this.source = options.source || '';
    this.program = options.program;
    this.resolveImportFn = options.resolveImport || (() => null);
    this.diagnostics = [];
    this.typeDecls = new Map();
    this.typeExports = new Map();
    this.variantCtors = new Map();
    this.global = new Scope(null);
    this.scope = this.global;
    this.functionStack = [];
    this.loopDepth = 0;
    this.asyncDepth = 0;
    this.exports = new Map();
    this.exportedNames = new Set();
    // Named imports that resolve to types only. They are erased at codegen.
    this.typeOnlyImports = new Set();
    this.defaultExport = null;
    this.inferredFunctions = new Map();
  }

  report(code, message, node, hint) {
    this.diagnostics.push(error(code, message, spanOf(node, this.file), hint ? { hint } : {}));
  }

  aliasKey(name) {
    return `${this.file}::${name}`;
  }

  define(name, entry, node) {
    if (this.scope === this.global && this.global.names.has(name)) {
      this.report('PS3308', `"${name}" is already declared in this module.`, node);
      return;
    }
    entry.name = name;
    entry.declFile = this.file;
    if (node && !entry.declNode) entry.declNode = node;
    if (!entry.references) entry.references = [];
    this.scope.define(name, entry);
  }

  lookup(name) {
    return this.scope.lookup(name);
  }

  // --------------------------------------------------------------- type layer

  typeEnvironment(typeParams, constraints = {}) {
    const environment = new Map();
    for (const name of typeParams) environment.set(name, T.typeVar(name));
    for (const [name, constraintNode] of Object.entries(constraints || {})) {
      const variable = environment.get(name);
      if (variable && constraintNode) variable.constraint = this.resolveType(constraintNode, environment);
    }
    return environment;
  }

  resolveType(node, typeEnv = new Map()) {
    return T.evaluate(this.resolveTypeRaw(node, typeEnv));
  }

  resolveTypeRaw(node, typeEnv = new Map()) {
    if (!node) return T.PRIM.any;
    switch (node.kind) {
      case 'NamedType': {
        const { name } = node;
        if (typeEnv.has(name)) return typeEnv.get(name);
        if (PRIMITIVES.has(name)) return T.PRIM[name];
        if (name === 'error') return T.PRIM.error;
        const declaration = this.typeDecls.get(name);
        if (declaration) node.__typeDecl = declaration;
        if (!declaration) {
          const suggestion = closest(name, [...PRIMITIVES, ...this.typeDecls.keys()]);
          this.report('PS3201', `Unknown type "${name}".`, node, suggestion ? `Did you mean "${suggestion}"?` : null);
          return T.PRIM.error;
        }
        if (declaration.importedType) {
          const imported = declaration.importedType;
          if (imported.k !== 'genericAlias') return imported;
          if (imported.params.length !== node.args.length) {
            this.report(
              'PS3202',
              `Type "${name}" expects ${imported.params.length} type argument(s) but got ${node.args.length}.`,
              node,
            );
            return T.PRIM.error;
          }
          const substitutions = new Map();
          imported.params.forEach((param, index) => {
            substitutions.set(param, this.resolveType(node.args[index], typeEnv));
          });
          return T.substitute(imported.body, substitutions);
        }
        if (declaration.typeParams.length !== node.args.length) {
          this.report(
            'PS3202',
            `Type "${name}" expects ${declaration.typeParams.length} type argument(s) but got ${node.args.length}.`,
            node,
          );
          return T.PRIM.error;
        }
        if (declaration.typeParams.length === 0) {
          return T.namedRef(this.aliasKey(name), name);
        }
        const localEnv = new Map();
        declaration.typeParams.forEach((param, index) => {
          localEnv.set(param, this.resolveType(node.args[index], typeEnv));
        });
        return this.resolveTypeDeclarationBody(declaration, localEnv);
      }
      case 'ListType':
        return T.listOf(this.resolveType(node.elem, typeEnv));
      case 'TupleType':
        return T.tupleOf(
          node.elements.map((element) => this.resolveType(element, typeEnv)),
          node.rest ? this.resolveType(node.rest, typeEnv) : null,
        );
      case 'KeyofType': {
        const target = T.deref(this.resolveType(node.target, typeEnv));
        if (target.k === 'var' || T.isDeferred(target)) return T.keyofType(target);
        if (target.k === 'record') {
          return T.union([...target.fields.keys()].map((name) => T.literalType(name, T.PRIM.text)));
        }
        if (target.k === 'map') return target.key;
        if (target.k === 'union') {
          const keys = [];
          for (const member of target.members) {
            const resolved = T.deref(member);
            if (resolved.k === 'record') {
              for (const name of resolved.fields.keys()) keys.push(T.literalType(name, T.PRIM.text));
            }
          }
          return keys.length ? T.union(keys) : T.PRIM.text;
        }
        return T.PRIM.text;
      }
      case 'TypeofType':
        return this.typeOf(node.value);
      case 'MapType':
        return T.mapOf(this.resolveType(node.key, typeEnv), this.resolveType(node.value, typeEnv));
      case 'PromiseType':
        return T.promiseOf(this.resolveType(node.value, typeEnv));
      case 'OptionalType':
        return T.union([this.resolveType(node.inner, typeEnv), T.PRIM.nothing]);
      case 'LiteralType': {
        const base = typeof node.value === 'text' || typeof node.value === 'string'
          ? T.PRIM.text
          : typeof node.value === 'number' ? T.PRIM.number : T.PRIM.boolean;
        return T.literalType(node.value, base);
      }
      case 'ConditionalType': {
        const check = this.resolveType(node.check, typeEnv);
        return T.conditionalType(
          check,
          this.resolveType(node.extendsType, typeEnv),
          this.resolveType(node.trueType, typeEnv),
          this.resolveType(node.falseType, typeEnv),
          check.k === 'var',
        );
      }
      case 'MappedType': {
        const keyType = T.typeVar(node.keyName);
        const localEnv = new Map(typeEnv);
        localEnv.set(node.keyName, keyType);
        return T.mappedType(
          node.keyName,
          this.resolveType(node.keyType, typeEnv),
          this.resolveType(node.valueType, localEnv),
          Boolean(node.optional),
        );
      }
      case 'UnionType':
        return T.union(node.members.map((member) => this.resolveType(member, typeEnv)));
      case 'IntersectionType':
        return this.intersectionType(node.members, typeEnv, node);
      case 'IndexedAccessType':
        return this.indexedAccessType(
          this.resolveType(node.target, typeEnv),
          this.resolveType(node.index, typeEnv),
          node,
        );
      case 'FunctionType':
        return T.fnType(
          node.params.map((parameter) => ({
            name: parameter.name,
            type: this.resolveType(parameter.type, typeEnv),
            optional: parameter.optional,
            rest: parameter.rest,
          })),
          this.resolveType(node.ret, typeEnv),
        );
      case 'RecordType': {
        const fields = new Map();
        for (const field of node.fields) {
          fields.set(field.name, { type: this.resolveType(field.type, typeEnv), optional: field.optional, readonly: Boolean(field.readonly) });
        }
        return T.record(fields);
      }
      case 'VariantType': {
        const fields = node.fields.map((field) => ({ name: field.name, type: this.resolveType(field.type, typeEnv) }));
        return T.variant(node.name, fields, null);
      }
      default:
        return T.PRIM.any;
    }
  }

  intersectionType(members, typeEnv, node) {
    const resolved = members.map((member) => T.deref(this.resolveType(member, typeEnv)));
    if (resolved.some((member) => member.k !== 'record')) {
      this.report('PS3208', 'Intersection types currently require every member to resolve to a record.', node);
      return T.PRIM.error;
    }
    const fields = new Map();
    for (const member of resolved) {
      for (const [name, field] of member.fields) {
        const existing = fields.get(name);
        if (!existing) fields.set(name, field);
        else fields.set(name, { type: this.intersectField(existing.type, field.type), optional: existing.optional && field.optional, readonly: Boolean(existing.readonly || field.readonly) });
      }
    }
    return T.record(fields);
  }

  intersectField(left, right) {
    if (T.sameType(left, right)) return left;
    const a = T.deref(left);
    const b = T.deref(right);
    if (a.k === 'record' && b.k === 'record') {
      const fields = new Map(a.fields);
      for (const [name, field] of b.fields) {
        const existing = fields.get(name);
        fields.set(name, existing
          ? { type: this.intersectField(existing.type, field.type), optional: existing.optional && field.optional, readonly: Boolean(existing.readonly || field.readonly) }
          : field);
      }
      return T.record(fields);
    }
    if (a.k === 'prim' && b.k === 'prim' && a.name === b.name) return a;
    if (a.k === 'literal' && b.k === 'literal' && a.value === b.value) return a;
    if (a.k === 'literal') return T.assignable(a, b) ? a : T.PRIM.never;
    if (b.k === 'literal') return T.assignable(b, a) ? b : T.PRIM.never;
    return T.PRIM.never;
  }

  indexedAccessType(targetType, indexType, node) {
    let target = T.deref(targetType);
    if (target.k === 'var' && target.constraint) target = T.deref(target.constraint);
    const index = T.deref(indexType);
    if (target.k === 'var' || index.k === 'var' || T.isDeferred(target) || T.isDeferred(index)) {
      return T.indexedAccessType(target, index);
    }
    if (index.k === 'union') {
      return T.union(index.members.map((member) => this.indexedAccessType(target, member, node)));
    }
    const literal = index.k === 'literal' ? index.value : null;
    if (target.k === 'record' && literal !== null) {
      const field = target.fields.get(String(literal));
      if (!field) {
        this.report('PS3207', `Type ${T.showType(target)} has no field "${literal}".`, node);
        return T.PRIM.error;
      }
      return field.optional ? T.union([field.type, T.PRIM.nothing]) : field.type;
    }
    if (target.k === 'tuple' && typeof literal === 'number') {
      const element = target.elements[literal] || (target.rest && literal >= target.elements.length ? target.rest : null);
      if (!element) {
        this.report('PS3207', `Tuple index ${literal} is out of range for ${T.showType(target)}.`, node);
        return T.PRIM.error;
      }
      return element;
    }
    if (target.k === 'list' && index.k === 'prim' && index.name === 'number') return target.elem;
    if (target.k === 'map' && index.k === 'prim' && index.name === 'text') return target.value;
    if (target.k === 'map' && literal !== null) return target.value;
    this.report(
      'PS3207',
      `Cannot index ${T.showType(target)} with ${T.showType(indexType)}; use a record field literal, tuple index, or map key.`,
      node,
    );
    return T.PRIM.error;
  }

  // Registers `type X ...` declarations, then resolves them. Variant aliases
  // also introduce constructor values (Circle(...)) and unit values (Empty).
  collectTypes() {
    for (const statement of this.program.body) {
      if (statement.kind !== 'TypeDecl') continue;
      if (this.typeDecls.has(statement.name)) {
        this.report('PS3203', `Type "${statement.name}" is already declared in this module.`, statement);
        continue;
      }
      this.typeDecls.set(statement.name, statement);
    }
  }

  resolveAllTypes() {
    for (const [name, declaration] of this.typeDecls) {
      const key = this.aliasKey(name);
      // Place the indirection first so recursive aliases can refer to it.
      T.registerAlias(key, T.PRIM.any);
      const typeEnv = this.typeEnvironment(declaration.typeParams, declaration.typeParamConstraints);
      const resolved = this.resolveTypeDeclarationBody(declaration, typeEnv);
      declaration.__type = resolved;
      T.registerAlias(key, resolved);
      // Only exported types cross a module boundary; local aliases stay local.
      if (declaration.exported) {
        this.typeExports.set(name, declaration.typeParams.length
          ? { k: 'genericAlias', params: [...declaration.typeParams], body: resolved }
          : resolved);
        this.exportedNames.add(name);
      }
    }
  }

  resolveTypeDeclarationBody(declaration, typeEnv) {
    if (declaration.recordFields) {
      const fields = new Map();
      for (const field of declaration.recordFields) {
        fields.set(field.name, {
          type: this.resolveType(field.type, typeEnv),
          optional: Boolean(field.optional),
          readonly: Boolean(field.readonly),
        });
      }
      return T.record(fields, { name: declaration.name });
    }
    const body = declaration.value;
    if (!body) return T.PRIM.any;

    if (body.kind === 'UnionType') {
      // Inside a variant alias, bare capitalised names are unit variants.
      const variantNames = new Set();
      for (const member of body.members) {
        if (member.kind === 'VariantType') variantNames.add(member.name);
        else if (member.kind === 'NamedType' && !PRIMITIVES.has(member.name) &&
          !this.typeDecls.has(member.name) && !typeEnv.has(member.name)) {
          variantNames.add(member.name);
        }
      }
      const members = body.members.map((member) => {
        if (member.kind === 'VariantType') {
          const fields = member.fields.map((field) => ({ name: field.name, type: this.resolveType(field.type, typeEnv) }));
          const type = T.variant(member.name, fields, declaration.name);
          this.registerVariant(member.name, type, declaration, fields);
          return type;
        }
        if (member.kind === 'NamedType' && variantNames.has(member.name)) {
          const type = T.unitVariant(member.name, declaration.name);
          this.registerVariant(member.name, type, declaration, []);
          return type;
        }
        return this.resolveType(member, typeEnv);
      });
      return T.union(members);
    }

    if (body.kind === 'VariantType') {
      const fields = body.fields.map((field) => ({ name: field.name, type: this.resolveType(field.type, typeEnv) }));
      const type = T.variant(body.name, fields, declaration.name);
      this.registerVariant(body.name, type, declaration, fields);
      return type;
    }

    return this.resolveType(body, typeEnv);
  }

  registerVariant(name, type, declaration, fields) {
    if (this.variantCtors.has(name)) {
      this.report('PS3204', `Variant "${name}" is already declared in this module.`, declaration);
      return;
    }
    if (fields.length === 0) {
      this.variantCtors.set(name, { kind: 'value', type });
      return;
    }
    this.variantCtors.set(name, {
      kind: 'function',
      type: T.fnType(fields.map((field) => ({ name: field.name, type: field.type, optional: false })), type),
    });
  }

  registerImportedVariants(type) {
    if (!type) return;
    const members = type.k === 'union' ? type.members : [type];
    for (const member of members) {
      if (!member || (member.k !== 'variant' && member.k !== 'unit')) continue;
      if (this.variantCtors.has(member.name)) continue;
      if (member.k === 'unit' || member.fields.length === 0) {
        this.variantCtors.set(member.name, { kind: 'value', type: member });
        continue;
      }
      this.variantCtors.set(member.name, {
        kind: 'function',
        type: T.fnType(member.fields.map((field) => ({ name: field.name, type: field.type, optional: false })), member),
      });
    }
  }

  // A function imported from another module can expose a variant type without
  // the importing module also naming that type in an import. The checker still
  // needs constructor field names for lowering and exhaustive matches.
  registerVariantsDeep(type, seen = new Set()) {
    if (!type || typeof type !== 'object') return;
    if (seen.has(type)) return;
    seen.add(type);
    const resolved = T.deref(type);
    if (resolved !== type) this.registerVariantsDeep(resolved, seen);
    if (resolved.k === 'variant' || resolved.k === 'unit') {
      this.registerImportedVariants(resolved);
      for (const field of resolved.fields || []) this.registerVariantsDeep(field.type, seen);
      return;
    }
    if (resolved.k === 'union') {
      for (const member of resolved.members) this.registerVariantsDeep(member, seen);
      return;
    }
    if (resolved.k === 'list' || resolved.k === 'promise') return this.registerVariantsDeep(resolved.elem || resolved.value, seen);
    if (resolved.k === 'map') {
      this.registerVariantsDeep(resolved.key, seen);
      this.registerVariantsDeep(resolved.value, seen);
      return;
    }
    if (resolved.k === 'record') {
      for (const field of resolved.fields.values()) this.registerVariantsDeep(field.type, seen);
      return;
    }
    if (resolved.k === 'fn') {
      for (const parameter of resolved.params) this.registerVariantsDeep(parameter.type, seen);
      this.registerVariantsDeep(resolved.ret, seen);
    }
  }

  // ------------------------------------------------------------- value layer

  signatureOf(node) {
    if (node.__signature) return node.__signature;
    const typeEnv = this.typeEnvironment(node.typeParams, node.typeParamConstraints);
    const params = node.params.map((parameter) => ({
      name: parameter.name,
      type: this.resolveType(parameter.type, typeEnv),
      optional: Boolean(parameter.optional),
      rest: Boolean(parameter.rest),
      defaultValue: parameter.defaultValue,
      node: parameter,
    }));
    const predicateNode = node.returnType && node.returnType.kind === 'PredicateType' ? node.returnType : null;
    const declared = node.returnType && !predicateNode ? this.resolveType(node.returnType, typeEnv) : null;
    let predicate = null;
    if (predicateNode) {
      const parameter = node.params.find((item) => item.name === predicateNode.parameter);
      if (!parameter) {
        this.report('PS3353', `Type predicate refers to \"${predicateNode.parameter}\", which is not a parameter of this function.`, predicateNode);
      } else if (node.async) {
        this.report('PS3353', 'A type predicate function cannot be async.', predicateNode);
      } else {
        predicate = { parameter: predicateNode.parameter, type: this.resolveType(predicateNode.target, typeEnv) };
      }
    }
    const declaredReturn = predicate ? T.PRIM.boolean : declared;
    const ret = node.async
      ? (declaredReturn && declaredReturn.k === 'promise' ? declaredReturn : T.promiseOf(declaredReturn || T.PRIM.any))
      : (declaredReturn || null);
    const signature = {
      params, ret, declaredReturn, predicate, typeParams: node.typeParams,
      typeParamConstraints: node.typeParamConstraints || {}, typeEnv, async: Boolean(node.async), node,
    };
    node.__signature = signature;
    return signature;
  }

  overloadsFrom(statements) {
    const overloads = new Map();
    for (const statement of statements) {
      if (statement.kind !== 'OverloadDecl') continue;
      if (!overloads.has(statement.name)) overloads.set(statement.name, []);
      overloads.get(statement.name).push(statement);
    }
    return overloads;
  }

  // Function declarations are hoisted within the block that contains them, so
  // a function body may call a sibling declared further down.
  hoistFunctions(statements, knownOverloads = null) {
    const overloads = knownOverloads || this.overloadsFrom(statements);
    for (const statement of statements) {
      if (statement.kind !== 'FunctionDecl') continue;
      // An anonymous `export default function () ... end` has no local name.
      if (!statement.name) continue;
      if (this.scope.names.has(statement.name)) continue;
      const signature = this.signatureOf(statement);
      const declarations = overloads.get(statement.name);
      if (declarations && declarations.length) {
        signature.overloads = declarations.map((declaration) => this.signatureOf(declaration));
      }
      statement.__signature = signature;
      this.define(statement.name, {
        kind: 'function',
        type: T.fnType(signature.params, signature.ret, signature.typeParams, signature.predicate),
        signature,
        overloads: signature.overloads || null,
        node: statement,
        mutable: false,
      }, statement);
      statement.__symbol = this.lookup(statement.name);
      if (statement.exported) this.exportedNames.add(statement.name);
    }
  }

  hoist() {
    const topLevelOverloads = this.overloadsFrom(this.program.body);
    for (const statement of this.program.body) {
      switch (statement.kind) {
        case 'Import': {
          const resolved = this.resolveImportFn(statement.spec, statement);
          const values = resolved && resolved.values ? resolved.values : null;
          const types = resolved && resolved.types ? resolved.types : null;
          if (statement.defaultName) {
            const entry = values && values.get('default');
            this.define(statement.defaultName, {
              kind: 'const',
              name: statement.defaultName,
              nameLine: statement.defaultLine,
              nameCol: statement.defaultCol,
              type: entry ? entry.type : T.PRIM.any,
              importType: true,
              importSpec: statement.spec,
              importedName: 'default',
              node: statement,
            }, statement);
          }
          if (statement.namespace) {
            this.define(statement.namespace, {
              kind: 'const',
              name: statement.namespace,
              nameLine: statement.namespaceLine,
              nameCol: statement.namespaceCol,
              type: T.PRIM.any,
              node: statement,
            }, statement);
          }
          for (const name of statement.names) {
            const entry = values ? values.get(name.imported) : null;
            const importedType = types ? types.get(name.imported) : null;

            if (importedType) {
              this.typeDecls.set(name.local, {
                name: name.local,
                typeParams: [],
                value: null,
                recordFields: null,
                importedType,
                importNode: statement,
                importSpec: statement.spec,
                importedName: name.imported,
                nameLine: name.line,
                nameCol: name.col,
              });
              T.registerAlias(this.aliasKey(name.local), importedType);
              // A variant alias carries its constructors: importing the type is
              // what makes `case Published(views)` (and `Published(3)`)
              // meaningful in this module.
              this.registerImportedVariants(importedType);
            }

            // A name that exists only as a type is a compile-time import and
            // disappears from the emitted JavaScript.
            if (!entry && importedType) {
              this.typeOnlyImports.add(name.local);
              continue;
            }

            if (values && !entry) {
              this.report('PS3205', `"${name.imported}" is not exported by "${statement.spec}".`, statement);
            }
            this.define(name.local, {
              kind: entry && entry.kind ? entry.kind : 'const',
              overloads: entry && entry.overloads ? entry.overloads : null,
              name: name.local,
              nameLine: name.line,
              nameCol: name.col,
              type: entry ? entry.type : T.PRIM.any,
              importType: true,
              importSpec: statement.spec,
              importedName: name.imported,
              importedLine: name.importedLine,
              importedCol: name.importedCol,
              node: statement,
            }, statement);
          }
          break;
        }
        case 'FunctionDecl':
          this.hoistFunctions([statement], topLevelOverloads);
          break;
        case 'DeclareFunction': {
          const signature = this.signatureOf(statement);
          const declarations = topLevelOverloads.get(statement.name);
          if (declarations && declarations.length) signature.overloads = declarations.map((declaration) => this.signatureOf(declaration));
          this.define(statement.name, {
            kind: 'function',
            type: T.fnType(signature.params, signature.ret, signature.typeParams, signature.predicate),
            signature,
            overloads: signature.overloads || null,
            node: statement,
            mutable: false,
          }, statement);
          if (statement.exported) this.exportedNames.add(statement.name);
          break;
        }
        case 'DeclareValue': {
          this.define(statement.name, {
            kind: 'const',
            type: this.resolveType(statement.type),
            mutable: false,
            node: statement,
          }, statement);
          if (statement.exported) this.exportedNames.add(statement.name);
          break;
        }
        case 'OverloadDecl': {
          // A declaration file may publish overload signatures without an
          // implementation, just as a .d.ts file does. The first declaration
          // defines the imported function; all of them become its overloads.
          if (!/\.d\.pln$/.test(this.file)) break;
          const declarations = topLevelOverloads.get(statement.name) || [statement];
          if (declarations.some((declaration) => declaration.exported)) {
            this.exportedNames.add(statement.name);
          }
          if (this.global.names.has(statement.name)) break;
          // Generated declarations carry overload signatures plus a
          // `declare function` implementation signature. Let the implementation
          // define the symbol and attach the overloads; only declaration-only
          // overloads define it here.
          const hasImplementation = this.program.body.some((candidate) =>
            (candidate.kind === 'DeclareFunction' || candidate.kind === 'FunctionDecl')
            && candidate.name === statement.name);
          if (hasImplementation) break;
          const signature = this.signatureOf(declarations[0]);
          signature.overloads = declarations.map((declaration) => this.signatureOf(declaration));
          this.define(statement.name, {
            kind: 'function',
            type: T.fnType(signature.params, signature.ret, signature.typeParams, signature.predicate),
            signature,
            overloads: signature.overloads,
            node: statement,
            mutable: false,
          }, statement);
          break;
        }
        case 'TypeDecl':
          if (statement.exported) this.exportedNames.add(statement.name);
          break;
        default:
          break;
      }
    }

    for (const [name, constructor] of this.variantCtors) {
      if (this.global.names.has(name)) continue;
      this.global.define(name, {
        kind: constructor.kind === 'function' ? 'function' : 'const',
        type: constructor.type,
        variant: true,
        mutable: false,
      });
    }
  }

  // ------------------------------------------------------------------ driver

  run() {
    this.collectTypes();
    // Imports and function signatures are hoisted before type bodies resolve,
    // so a `type` declaration can name a type that was imported from another
    // module (`type Entry = { task: Task }`).
    this.hoist();
    if (!/\.d\.pln$/.test(this.file)) {
      for (const [name, declarations] of this.overloadsFrom(this.program.body)) {
        const entry = this.lookup(name);
        if (!entry || entry.kind !== 'function') {
          this.report('PS3355', `Overloads for \"${name}\" have no function implementation.`, declarations[0]);
        }
      }
    }
    this.resolveAllTypes();
    this.checkStatements(this.program.body);
    this.collectExports();
    return {
      diagnostics: this.diagnostics,
      exports: { values: this.buildExportValues(), types: this.typeExports },
      inferredFunctions: this.inferredFunctions,
      typeOnlyImports: this.typeOnlyImports,
    };
  }

  collectExports() {
    for (const statement of this.program.body) {
      if (statement.kind === 'ExportNamed') {
        for (const name of statement.names) {
          if (statement.spec) continue; // re-exports are resolved by the module graph
          if (!this.lookup(name.local)) {
            this.report('PS3206', `Cannot export "${name.local}": it is not declared in this module.`, statement);
            continue;
          }
          this.exports.set(name.exported, name.local);
          this.exportedNames.add(name.local);
        }
      }
      if (statement.kind === 'ExportDefault') {
        this.defaultExport = statement.value;
      }
    }
  }

  buildExportValues() {
    const values = new Map();
    for (const exported of this.exportedNames) {
      const entry = this.lookup(exported);
      if (!entry) continue;
      values.set(exported, { kind: entry.kind, type: entry.type, overloads: entry.overloads || null });
    }
    for (const [exported, local] of this.exports) {
      const entry = this.lookup(local);
      if (!entry) continue;
      values.set(exported, { kind: entry.kind, type: entry.type, overloads: entry.overloads || null });
    }
    if (this.defaultExportType) {
      values.set('default', { kind: 'const', type: this.defaultExportType });
    } else if (this.defaultExport) {
      // `export default name` takes the type of the local it names, so a
      // declaration file can re-export an existing declaration with its type.
      const local = this.defaultExport.kind === 'Name' ? this.lookup(this.defaultExport.name) : null;
      values.set('default', { kind: local ? local.kind : 'const', type: local ? local.type : T.PRIM.any });
    }
    return values;
  }

  checkStatements(statements) {
    for (const statement of statements) this.checkStatement(statement);
  }

  checkBlock(statements) {
    const previous = this.scope;
    this.scope = previous.child();
    this.hoistFunctions(statements);
    this.checkStatements(statements);
    this.scope = previous;
  }

  checkStatement(node) {
    switch (node.kind) {
      case 'Import':
      case 'TypeDecl':
      case 'DeclareFunction':
      case 'DeclareValue':
      case 'OverloadDecl':
      case 'ExportNamed':
        return;
      case 'ExportDefault':
        this.defaultExportType = this.typeOf(node.value);
        return;
      case 'FunctionDecl':
        this.checkFunction(node);
        return;
      case 'VarDecl':
        this.checkVarDecl(node);
        return;
      case 'Assignment':
        this.checkAssignment(node);
        return;
      case 'ExprStmt':
        this.typeOf(node.expression);
        return;
      case 'Conditional':
        this.checkConditional(node);
        return;
      case 'ForEach':
      case 'ForRange':
        this.checkFor(node);
        return;
      case 'While':
        this.checkWhile(node);
        return;
      case 'Match':
        this.checkMatch(node);
        return;
      case 'Try':
        this.checkTry(node);
        return;
      case 'Throw':
        this.typeOf(node.value);
        return;
      case 'Return':
        this.checkReturn(node);
        return;
      case 'Break':
      case 'Continue':
        if (this.loopDepth === 0) {
          this.report('PS3309', `"${node.kind.toLowerCase()}" can only be used inside a loop.`, node);
        }
        return;
      case 'Render':
        this.checkRender(node);
        return;
      case 'Element':
        this.typeOf(node);
        return;
      default:
        this.report('PS3310', `The checker does not know how to handle a ${node.kind} statement.`, node);
    }
  }

  checkVarDecl(node) {
    let declared = null;
    if (node.type) declared = this.resolveType(node.type);
    let initType = this.typeOf(node.init, declared);
    if (declared && !T.assignable(initType, declared)) {
      this.report('PS3311', `Cannot initialise "${describePattern(node.pattern)}" with ${T.showType(initType)}; expected ${T.showType(declared)}.`, node);
      initType = declared;
    }
    const type = declared || initType;

    if (node.pattern.kind === 'NamePattern') {
      this.define(node.pattern.name, {
        kind: 'var',
        name: node.pattern.name,
        nameLine: node.pattern.line,
        nameCol: node.pattern.col,
        type,
        mutable: node.declKind === 'let',
        node,
      }, node);
      node.pattern.__symbol = this.lookup(node.pattern.name);
      node.pattern.__type = type;
      node.__symbol = node.pattern.__symbol;
      node.__type = type;
      if (node.exported) this.exportedNames.add(node.pattern.name);
      return;
    }

    this.bindPattern(node.pattern, type, { mutable: node.declKind === 'let', node });
    if (node.exported) this.report('PS3312', 'Only a single name may be exported, not a destructuring pattern.', node);
  }

  bindPattern(pattern, type, options = {}) {
    if (pattern.kind === 'NamePattern') {
      this.define(pattern.name, {
        kind: 'var',
        name: pattern.name,
        nameLine: pattern.line,
        nameCol: pattern.col,
        type,
        mutable: options.mutable !== false,
        node: pattern,
      }, pattern);
      pattern.__symbol = this.lookup(pattern.name);
      pattern.__type = type;
      return;
    }
    if (pattern.kind === 'TuplePattern') {
      const resolved = T.deref(type);
      if (resolved.k === 'tuple') {
        pattern.items.forEach((item, index) => this.bindPattern(item, resolved.elements[index] || T.PRIM.nothing, options));
      } else {
        const element = elementTypeOf(type);
        for (const item of pattern.items) this.bindPattern(item, element, options);
      }
      return;
    }
    if (pattern.kind === 'RecordPattern') {
      const resolved = T.deref(type);
      for (const field of pattern.fields) {
        let fieldType = T.PRIM.any;
        if (resolved.k === 'record') {
          const found = resolved.fields.get(field.key);
          if (!found) this.report('PS3313', `Cannot destructure unknown field "${field.key}".`, pattern);
          else fieldType = found.type;
        }
        this.bindPattern(field.target, fieldType, options);
      }
    }
  }

  checkFunction(node) {
    const signature = node.__signature || this.signatureOf(node);
    const previous = this.scope;
    // Closures capture the enclosing scope, not the module scope.
    this.scope = previous.child();

    for (const parameter of signature.params) {
      this.scope.define(parameter.name, {
        kind: 'param',
        name: parameter.name,
        declFile: this.file,
        declNode: parameter.node,
        nameLine: parameter.node && parameter.node.nameLine,
        nameCol: parameter.node && parameter.node.nameCol,
        references: [],
        type: parameter.type,
        mutable: true,
        node: parameter.node,
      });
      if (parameter.node) {
        parameter.node.__symbol = this.scope.lookup(parameter.name);
        parameter.node.__type = parameter.type;
      }
      if (parameter.defaultValue) {
        const defaultType = this.typeOf(parameter.defaultValue, parameter.type);
        if (!T.assignable(defaultType, parameter.type)) {
          this.report('PS3314', `Default value for "${parameter.name}" is ${T.showType(defaultType)}; expected ${T.showType(parameter.type)}.`, parameter.defaultValue);
        }
      }
      if (parameter.rest) {
        const resolved = T.deref(parameter.type);
        if (resolved.k !== 'list') {
          this.report('PS3315', `A rest parameter ("...${parameter.name}") must be a list type.`, parameter.node);
        }
      }
    }

    this.functionStack.push({
      node,
      declaredReturn: signature.declaredReturn,
      async: Boolean(node.async),
      inferred: null,
    });
    if (node.async) this.asyncDepth += 1;

    this.hoistFunctions(node.body);
    this.checkStatements(node.body);
    const frame = this.functionStack.pop();
    if (node.async) this.asyncDepth -= 1;

    if (signature.declaredReturn) {
      const returns = inspectReturns(node.body);
      const expected = signature.declaredReturn;
      const label = node.name ? `"${node.name}"` : 'the default export';
      if (!T.containsNothing(expected) && !T.sameType(expected, T.PRIM.nothing) && !alwaysReturns(node.body)) {
        this.report('PS3401', `Function ${label} declares a ${T.showType(expected)} result but can finish without returning one.`, node);
      }
      if (returns.missingValue && !T.containsNothing(expected) && !(expected.k === 'prim' && expected.name === 'nothing')) {
        this.report('PS3402', `Function ${label} must return a value of type ${T.showType(expected)}.`, node);
      }
    }

    if (!signature.declaredReturn) {
      const returns = inspectReturns(node.body);
      let inferred = returns.types.length ? T.union(returns.types) : T.PRIM.nothing;
      if (returns.types.length && !alwaysReturns(node.body)) inferred = T.union([inferred, T.PRIM.nothing]);
      const ret = node.async ? (inferred.k === 'promise' ? inferred : T.promiseOf(inferred)) : inferred;
      node.__signature.ret = ret;
      node.__signature.inferred = true;
      const entry = node.name ? this.global.names.get(node.name) : null;
      if (entry && entry.kind === 'function') entry.type = T.fnType(signature.params, ret, signature.typeParams, signature.predicate);
      if (node.name) this.inferredFunctions.set(node.name, ret);
    }

    if (signature.overloads) {
      for (const overload of signature.overloads) {
        const overloadRequired = overload.params.filter((parameter) => !parameter.optional && !parameter.rest).length;
        const implementationRequired = signature.params.filter((parameter) => !parameter.optional && !parameter.rest).length;
        if (overloadRequired < implementationRequired) {
          this.report('PS3355', `Overload of \"${node.name}\" requires ${overloadRequired} argument(s), but its implementation requires ${implementationRequired}.`, node);
        }
        for (let index = 0; index < overload.params.length; index += 1) {
          const implementation = signature.params[index];
          if (!implementation) {
            this.report('PS3355', `Overload parameter ${index + 1} of \"${node.name}\" has no matching implementation parameter.`, overload.node || node);
            break;
          }
          if (!implementation.rest && !T.assignable(overload.params[index].type, implementation.type)) {
            this.report('PS3355', `Overload parameter ${index + 1} of \"${node.name}\" is ${T.showType(overload.params[index].type)}, which the implementation parameter ${T.showType(implementation.type)} does not accept.`, node);
          }
        }
        if (!T.assignable(overload.ret, signature.ret)) {
          this.report('PS3355', `Overload of \"${node.name}\" returns ${T.showType(overload.ret)}, but the implementation returns ${T.showType(signature.ret)}.`, node);
        }
      }
    }

    if (node.defaultExport) {
      this.defaultExportType = T.fnType(signature.params, signature.ret, signature.typeParams, signature.predicate);
    }

    this.scope = previous;
  }

  checkAssignment(node) {
    const target = node.target;
    let targetType = T.PRIM.any;

    if (target.kind === 'Name') {
      const entry = this.lookup(target.name);
      if (!entry) {
        this.report('PS3301', `Unknown name "${target.name}".`, target, this.suggestionFor(target.name));
        this.typeOf(node.value);
        return;
      }
      if (entry.kind === 'const' || entry.kind === 'function' || entry.mutable === false) {
        this.report('PS3307', `"${target.name}" is immutable; declare it with "let" to reassign it.`, target);
      }
      targetType = entry.type;
    } else if (target.kind === 'Member') {
      targetType = this.memberType(target, true);
    } else if (target.kind === 'Index') {
      targetType = this.indexType(target, true);
    } else {
      this.report('PS3316', 'Invalid assignment target.', target);
    }

    const valueType = this.typeOf(node.value, targetType);
    if (!T.assignable(valueType, targetType)) {
      this.report('PS3317', `Cannot assign ${T.showType(valueType)} to ${T.showType(targetType)}.`, node);
    }
  }

  checkConditional(node) {
    const facts = [];
    for (const branch of node.branches) {
      const conditionType = this.typeOf(branch.condition);
      if (!T.assignable(conditionType, T.PRIM.boolean) && !T.isAny(conditionType)) {
        this.report('PS3318', `A condition must be boolean, found ${T.showType(conditionType)}.`, branch.condition);
      }
      facts.push(narrowFacts(branch.condition));
      this.checkBlockWithNarrowing(branch.body, facts[facts.length - 1]);
    }
    if (node.otherwise) {
      const negative = [];
      for (const fact of facts) negative.push(negateFacts(fact));
      this.checkBlockWithNarrowing(node.otherwise, mergeFacts(negative));
    }
  }

  checkBlockWithNarrowing(statements, facts) {
    const previous = this.scope;
    this.scope = previous.child();
    this.scope.checker = this;
    applyFacts(this.scope, facts);
    this.hoistFunctions(statements);
    this.checkStatements(statements);
    this.scope = previous;
  }

  checkFor(node) {
    this.loopDepth += 1;
    const previous = this.scope;
    this.scope = previous.child();

    if (node.kind === 'ForEach') {
      const iterableType = T.deref(this.typeOf(node.iterable));
      let elementType = T.PRIM.any;
      if (iterableType.k === 'list') elementType = iterableType.elem;
      else if (iterableType.k === 'prim' && iterableType.name === 'text') elementType = T.PRIM.text;
      else if (iterableType.k === 'map') elementType = T.record(new Map([
        ['key', { type: iterableType.key, optional: false }],
        ['value', { type: iterableType.value, optional: false }],
      ]));
      else if (!T.isAny(iterableType)) {
        this.report('PS3319', `Cannot iterate over ${T.showType(iterableType)}; expected a list, map, or text.`, node.iterable);
      }
      this.bindPattern(node.pattern, elementType, { mutable: false, node });
    } else {
      const fromType = this.typeOf(node.from);
      const toType = this.typeOf(node.to);
      if (!T.assignable(fromType, T.PRIM.number) || !T.assignable(toType, T.PRIM.number)) {
        this.report('PS3320', 'A numeric range needs number bounds.', node);
      }
      this.bindPattern(node.pattern, T.PRIM.number, { mutable: false, node });
    }

    this.checkStatements(node.body);
    this.scope = previous;
    this.loopDepth -= 1;
  }

  checkWhile(node) {
    this.loopDepth += 1;
    const conditionType = this.typeOf(node.condition);
    if (!T.assignable(conditionType, T.PRIM.boolean) && !T.isAny(conditionType)) {
      this.report('PS3318', `A condition must be boolean, found ${T.showType(conditionType)}.`, node.condition);
    }
    this.checkBlockWithNarrowing(node.body, narrowFacts(node.condition));
    this.loopDepth -= 1;
  }

  checkMatch(node) {
    const subjectType = this.typeOf(node.subject);
    const covered = new Set();
    let hasCatchAll = false;

    for (const branch of node.cases) {
      const previous = this.scope;
      this.scope = previous.child();
      const patternInfo = this.bindMatchPattern(branch.pattern, subjectType);
      for (const name of patternInfo.coverage) covered.add(name);
      if (patternInfo.catchAll) hasCatchAll = true;
      if (branch.guard) {
        const guardType = this.typeOf(branch.guard);
        if (!T.assignable(guardType, T.PRIM.boolean) && !T.isAny(guardType)) {
          this.report('PS3318', `A case guard must be boolean, found ${T.showType(guardType)}.`, branch.guard);
        }
      }
      this.checkStatements(branch.body);
      this.scope = previous;
    }

    const missing = missingCoverage(subjectType, covered, hasCatchAll);
    if (missing.length) {
      this.report('PS3321', `match on ${T.showType(subjectType)} does not handle ${missing.join(', ')}. Add those cases or "case _".`, node);
    }
  }

  bindMatchPattern(pattern, subjectType) {
    const coverage = new Set();
    const info = { coverage, catchAll: false };

    switch (pattern.kind) {
      case 'WildcardPattern':
        info.catchAll = true;
        return info;
      case 'LiteralPattern': {
        const value = pattern.value;
        if (value.kind === 'Nothing') coverage.add('nothing');
        else if (value.kind === 'Boolean') {
          coverage.add(String(value.value));
          coverage.add(`literal:${JSON.stringify(value.value)}`);
        }
        else if (value.kind === 'Text') coverage.add(`literal:${JSON.stringify(value.v || value.value)}`);
        else coverage.add(`literal:${String(value.value)}`);
        const literalType = value.kind === 'Nothing' ? T.PRIM.nothing
          : value.kind === 'Boolean' ? T.literalType(value.value, T.PRIM.boolean)
            : value.kind === 'Text' ? T.literalType(value.v || value.value, T.PRIM.text)
              : T.literalType(value.value, T.PRIM.number);
        if (!T.assignable(literalType, subjectType)) {
          this.report('PS3322', `This case can never match: ${T.showType(literalType)} is not a ${T.showType(subjectType)}.`, pattern);
        }
        return info;
      }
      case 'NamePattern': {
        const constructor = this.variantCtors.get(pattern.name);
        if (constructor && constructor.kind === 'value') {
          coverage.add(`variant:${pattern.name}`);
          return info;
        }
        if (pattern.name === '_') { info.catchAll = true; return info; }
        this.define(pattern.name, { kind: 'var', type: subjectType, mutable: false, node: pattern }, pattern);
        pattern.__symbol = this.lookup(pattern.name);
        pattern.__type = subjectType;
        info.catchAll = true;
        return info;
      }
      case 'VariantPattern': {
        const resolved = T.deref(subjectType);
        const candidates = resolved.k === 'union' ? resolved.members : [resolved];
        const match = candidates.find((member) => T.deref(member).k === 'variant' && T.deref(member).name === pattern.name);
        if (!match) {
          this.report('PS3323', `Variant "${pattern.name}" is not part of ${T.showType(subjectType)}.`, pattern);
          for (const item of pattern.fields) this.bindMatchPattern(item, T.PRIM.any);
          return info;
        }
        coverage.add(`variant:${pattern.name}`);
        const variantType = T.deref(match);
        if (pattern.fields.length !== variantType.fields.length) {
          this.report(
            'PS3324',
            `Variant "${pattern.name}" has ${variantType.fields.length} field(s) but this pattern binds ${pattern.fields.length}.`,
            pattern,
          );
        }
        pattern.fields.forEach((field, index) => {
          const declared = variantType.fields[index];
          this.bindMatchPattern(field, declared ? declared.type : T.PRIM.any);
        });
        return info;
      }
      case 'ListPattern': {
        const resolved = T.deref(subjectType);
        const element = resolved.k === 'list' ? resolved.elem : T.PRIM.any;
        for (const item of pattern.items) this.bindMatchPattern(item, element);
        if (pattern.rest) {
          this.define(pattern.rest, { kind: 'var', type: T.listOf(element), mutable: false, node: pattern }, pattern);
        }
        coverage.add('list');
        return info;
      }
      case 'TuplePattern': {
        const resolved = T.deref(subjectType);
        const element = resolved.k === 'list' ? resolved.elem : T.PRIM.any;
        for (const item of pattern.items) this.bindMatchPattern(item, element);
        coverage.add('list');
        return info;
      }
      case 'RecordMatchPattern': {
        const resolved = T.deref(subjectType);
        for (const field of pattern.fields) {
          let fieldType = T.PRIM.any;
          if (resolved.k === 'record') {
            const found = resolved.fields.get(field.key);
            if (found) fieldType = found.type;
          } else if (resolved.k === 'union') {
            const types = resolved.members.map((member) => {
              const memberType = T.deref(member);
              return memberType.k === 'record' ? memberType.fields.get(field.key) : null;
            }).filter(Boolean);
            if (types.length) fieldType = T.union(types.map((item) => item.type));
          }
          this.bindMatchPattern(field.pattern, fieldType);
        }
        coverage.add('record');
        return info;
      }
      default:
        return info;
    }
  }

  checkTry(node) {
    this.checkBlock(node.body);
    if (node.handler) {
      const previous = this.scope;
      this.scope = previous.child();
      this.scope.define(node.errorName, { kind: 'var', type: T.PRIM.any, mutable: false });
      this.checkStatements(node.handler);
      this.scope = previous;
    }
    if (node.finalizer) this.checkBlock(node.finalizer);
  }

  checkReturn(node) {
    const frame = this.functionStack[this.functionStack.length - 1];
    const valueType = this.typeOf(node.value, frame ? frame.declaredReturn : null);
    node.__type = valueType;
    if (!frame) {
      this.report('PS3403', '"return" can only be used inside a function.', node);
      return;
    }
    if (frame.declaredReturn && !T.assignable(valueType, frame.declaredReturn)) {
      this.report('PS3404', `This function returns ${T.showType(frame.declaredReturn)}, but the value is ${T.showType(valueType)}.`, node);
    }
  }

  checkRender(node) {
    const factory = this.lookup('createElement');
    if (!factory) {
      this.report('PS3405', 'A render block needs "createElement" in scope. Import it from React or "std/dom".', node);
    }
    for (const child of node.children) this.checkStatement(child);
  }

  // ------------------------------------------------------------- expressions

  typeOf(node, expected) {
    if (!node) return T.PRIM.nothing;
    switch (node.kind) {
      case 'Number': return this.primitiveOrLiteral(T.PRIM.number, node.value, expected);
      case 'Text': return this.primitiveOrLiteral(T.PRIM.text, node.value, expected);
      case 'Boolean': return this.primitiveOrLiteral(T.PRIM.boolean, node.value, expected);
      case 'Nothing': return T.PRIM.nothing;
      case 'Template': {
        for (const part of node.parts) {
          if (part.kind === 'TemplateExpression') this.typeOf(part.expression);
        }
        return T.PRIM.text;
      }
      case 'Name': return this.nameType(node);
      case 'ListLiteral': {
        const expectedType = expected ? T.deref(expected) : null;
        const expectedElement = expectedType && expectedType.k === 'list' ? expectedType.elem : null;
        const expectedTuple = expectedType && expectedType.k === 'tuple' ? expectedType.elements : null;
        const types = [];
        let hasSpread = false;
        for (const item of node.items) {
          if (item.kind === 'Spread') {
            hasSpread = true;
            const spreadType = T.deref(this.typeOf(item.value));
            if (spreadType.k === 'list') types.push(spreadType.elem);
            else if (spreadType.k === 'tuple') types.push(...spreadType.elements);
            else if (!T.isAny(spreadType)) this.report('PS3325', `Only a list can be spread into a list, found ${T.showType(spreadType)}.`, item);
          } else {
            const index = types.length;
            types.push(this.typeOf(item, expectedTuple ? expectedTuple[index] : expectedElement));
          }
        }
        if (expectedTuple && !hasSpread) return T.tupleOf(types);
        return T.listOf(types.length ? T.union(types) : (expectedElement || T.PRIM.any));
      }
      case 'RecordLiteral': {
        const fields = new Map();
        const expectedResolved = expected ? T.deref(expected) : null;
        const expectedRecord = expectedResolved && expectedResolved.k === 'record' ? expectedResolved : null;
        const expectedRecords = expectedResolved && expectedResolved.k === 'union'
          ? expectedResolved.members.map((member) => T.deref(member)).filter((member) => member.k === 'record')
          : [];
        for (const field of node.fields) {
          if (field.spread) {
            const spreadType = T.deref(this.typeOf(field.spread));
            if (spreadType.k === 'record') {
              for (const [key, value] of spreadType.fields) fields.set(key, value);
            } else if (!T.isAny(spreadType)) {
              this.report('PS3326', `Only a record can be spread into a record, found ${T.showType(spreadType)}.`, field.spread);
            }
            continue;
          }
          let expectedFieldType = expectedRecord && expectedRecord.fields.get(field.key)
            ? expectedRecord.fields.get(field.key).type
            : null;
          if (!expectedFieldType && expectedRecords.length) {
            const fieldTypes = expectedRecords
              .map((record) => record.fields.get(field.key))
              .filter(Boolean)
              .map((fieldInfo) => fieldInfo.type);
            if (fieldTypes.length) expectedFieldType = fieldTypes.length === 1 ? fieldTypes[0] : T.union(fieldTypes);
          }
          fields.set(field.key, { type: this.typeOf(field.value, expectedFieldType), optional: false });
        }
        return T.record(fields);
      }
      case 'Member': return this.memberType(node, false);
      case 'Index': return this.indexType(node, false);
      case 'Call': return this.callType(node, expected);
      case 'Await': {
        const frame = this.functionStack[this.functionStack.length - 1];
        if (frame && !frame.async) {
          this.report('PS3406', '"await" can only be used inside an async function.', node);
        }
        const valueType = this.typeOf(node.value);
        const resolved = T.deref(valueType);
        if (resolved.k === 'promise') return resolved.value;
        if (T.isAny(resolved)) return T.PRIM.any;
        this.report('PS3327', `"await" needs a Promise, found ${T.showType(valueType)}.`, node);
        return T.PRIM.any;
      }
      case 'New':
        this.typeOf(node.callee);
        // Constructors cross the JavaScript boundary as untyped values.
        return T.PRIM.any;
      case 'Unary': {
        const operandType = this.typeOf(node.operand);
        if (node.operator === 'not') {
          if (!T.assignable(operandType, T.PRIM.boolean) && !T.isAny(operandType)) {
            this.report('PS3328', `"not" needs a boolean, found ${T.showType(operandType)}.`, node);
          }
          return T.PRIM.boolean;
        }
        if (!T.assignable(operandType, T.PRIM.number) && !T.isAny(operandType)) {
          this.report('PS3329', `Unary "-" needs a number, found ${T.showType(operandType)}.`, node);
        }
        return T.PRIM.number;
      }
      case 'Binary': return this.binaryType(node);
      case 'TypeTest': {
        if (!node.value || node.value.kind !== 'Name') this.typeOf(node.value);
        const target = this.resolveType(node.type);
        const valueType = node.value && node.value.kind === 'Name' ? this.nameType(node.value) : T.PRIM.any;
        if (!T.assignable(target, valueType) && !T.assignable(valueType, target) && !T.isAny(valueType)) {
          this.report('PS3330', `"is ${T.showType(target)}" can never be true for ${T.showType(valueType)}.`, node);
        }
        return T.PRIM.boolean;
      }
      case 'Cast': {
        const valueType = this.typeOf(node.value);
        const target = this.resolveType(node.type);
        const source = T.deref(valueType);
        if (!T.assignable(valueType, target) && !T.assignable(target, valueType) && !T.isAny(source) && !T.isAny(T.deref(target))) {
          this.report('PS3331', `Cannot cast ${T.showType(valueType)} to ${T.showType(target)}; the types do not overlap.`, node);
        }
        return target;
      }
      case 'Pipe': return this.pipeType(node);
      case 'FunctionExpression': return this.functionExpressionType(node, expected);
      case 'Spread': return this.typeOf(node.value);
      case 'Element': {
        this.typeOf(node.tag);
        for (const property of node.props) this.typeOf(property.value);
        for (const child of node.children) this.checkStatement(child);
        return T.PRIM.any;
      }
      default:
        this.report('PS3332', `The checker does not know how to type a ${node.kind} expression.`, node);
        return T.PRIM.error;
    }
  }

  primitiveOrLiteral(base, value, expected) {
    if (!expected) return base;
    const target = T.deref(expected);
    if (target.k === 'literal' && target.value === value) return target;
    if (target.k === 'union') {
      const match = target.members.find((member) => {
        const resolved = T.deref(member);
        return resolved.k === 'literal' && resolved.value === value;
      });
      if (match) return match;
    }
    return base;
  }

  nameType(node) {
    const entry = this.lookup(node.name);
    if (entry) {
      node.__symbol = entry;
      node.__type = entry.type;
      node.__file = this.file;
      if (!entry.references) entry.references = [];
      entry.references.push({ file: this.file, line: node.line, col: node.col, name: node.name });
      return entry.type;
    }
    const constructor = this.variantCtors.get(node.name);
    if (constructor) {
      node.__type = constructor.type;
      node.__variant = constructor;
      return constructor.type;
    }
    this.report('PS3301', `Unknown name "${node.name}".`, node, this.suggestionFor(node.name));
    return T.PRIM.error;
  }

  suggestionFor(name) {
    const candidate = closest(name, [...this.scope.visibleNames(), ...this.variantCtors.keys()]);
    return candidate ? `Did you mean "${candidate}"?` : null;
  }

  memberType(node, forAssignment) {
    let objectType = T.deref(this.typeOf(node.object));
    if (objectType.k === 'var' && objectType.constraint) objectType = T.deref(objectType.constraint);
    if (T.isAny(objectType)) return T.PRIM.any;
    if (objectType.k === 'record') {
      const field = objectType.fields.get(node.property);
      if (!field) {
        this.report('PS3333', `Type ${T.showType(objectType)} has no field "${node.property}".`, node);
        return T.PRIM.error;
      }
      if (forAssignment && field.readonly) {
        this.report('PS3319', `Field "${node.property}" is readonly and cannot be assigned.`, node);
        return field.type;
      }
      if (forAssignment && field.optional) return field.type;
      // An optional field is absent-able, so reading it is a maybe-value.
      if (field.optional || node.optional) return T.union([field.type, T.PRIM.nothing]);
      return field.type;
    }
    if (objectType.k === 'union') {
      const types = [];
      let nullable = false;
      for (const member of objectType.members) {
        const resolved = T.deref(member);
        if (resolved.k === 'prim' && resolved.name === 'nothing') {
          nullable = true;
          if (!node.optional) {
            this.report('PS3350', `This value may be nothing; guard it or use "?." to access "${node.property}".`, node);
          }
          continue;
        }
        if (resolved.k === 'record' || resolved.k === 'variant') {
          const field = resolved.k === 'record'
            ? resolved.fields.get(node.property)
            : resolved.fields.find((item) => item.name === node.property);
          if (!field) {
            this.report('PS3351', `Not every member of ${T.showType(objectType)} has a field "${node.property}"; narrow the value first.`, node);
            return T.PRIM.error;
          }
          if (forAssignment && field.readonly) {
            this.report('PS3319', `Field "${node.property}" is readonly and cannot be assigned.`, node);
          }
          types.push(field.type);
        } else if (!T.isAny(resolved)) {
          this.report('PS3351', `Not every member of ${T.showType(objectType)} has a field "${node.property}"; narrow the value first.`, node);
          return T.PRIM.error;
        }
      }
      const result = T.union(types);
      return node.optional || nullable ? T.union([result, T.PRIM.nothing]) : result;
    }
    if (objectType.k === 'variant') {
      const field = objectType.fields.find((item) => item.name === node.property);
      if (!field) {
        this.report('PS3333', `Variant ${objectType.name} has no field "${node.property}".`, node);
        return T.PRIM.error;
      }
      return field.type;
    }
    if (objectType.k === 'map') {
      // A text-keyed map exposes its values through field access too: JSON and
      // most npm APIs are spelled with dots at the boundary.
      const keyType = T.deref(objectType.key);
      if (keyType.k !== 'prim' || keyType.name !== 'text') {
        this.report('PS3352', `Type ${T.showType(objectType)} is not keyed by text; index it with [].`, node);
        return T.PRIM.error;
      }
      return node.optional ? T.union([objectType.value, T.PRIM.nothing]) : objectType.value;
    }
    if (objectType.k === 'prim' && objectType.name === 'text') {
      this.report('PS3336', 'Text has no fields. Use functions from "std/text".', node);
      return T.PRIM.error;
    }
    this.report('PS3335', `Type ${T.showType(objectType)} has no field "${node.property}".`, node);
    return T.PRIM.error;
  }

  indexType(node, forAssignment) {
    let objectType = T.deref(this.typeOf(node.object));
    if (objectType.k === 'var' && objectType.constraint) objectType = T.deref(objectType.constraint);
    const indexType = this.typeOf(node.index);
    if (T.isAny(objectType)) return T.PRIM.any;
    if (objectType.k === 'list') {
      if (!T.assignable(indexType, T.PRIM.number) && !T.isAny(indexType)) {
        this.report('PS3337', `A list index must be a number, found ${T.showType(indexType)}.`, node.index);
      }
      return node.optional || !forAssignment ? T.union([objectType.elem, T.PRIM.nothing]) : objectType.elem;
    }
    if (objectType.k === 'tuple') {
      if (!T.assignable(indexType, T.PRIM.number) && !T.isAny(indexType)) {
        this.report('PS3337', `A tuple index must be a number, found ${T.showType(indexType)}.`, node.index);
      }
      const indexNode = node.index;
      if (indexNode && indexNode.kind === 'Number') {
        const element = objectType.elements[indexNode.value]
          || (objectType.rest && indexNode.value >= objectType.elements.length ? objectType.rest : null);
        if (element) return element;
        this.report('PS3340', `Tuple index ${indexNode.value} is out of range.`, node.index);
        return T.PRIM.nothing;
      }
      return T.union([...objectType.elements, ...(objectType.rest ? [objectType.rest] : []), T.PRIM.nothing]);
    }
    if (objectType.k === 'map') {
      if (!T.assignable(indexType, objectType.key)) {
        this.report('PS3338', `This map is keyed by ${T.showType(objectType.key)}, not ${T.showType(indexType)}.`, node.index);
      }
      return node.optional ? T.union([objectType.value, T.PRIM.nothing]) : objectType.value;
    }
    if (objectType.k === 'prim' && objectType.name === 'text') {
      if (!T.assignable(indexType, T.PRIM.number) && !T.isAny(indexType)) {
        this.report('PS3337', `A text index must be a number, found ${T.showType(indexType)}.`, node.index);
      }
      return T.PRIM.text;
    }
    if (objectType.k === 'record') {
      if (!T.assignable(indexType, T.PRIM.text) && !T.isAny(indexType)) {
        this.report('PS3339', 'A record index must be text.', node.index);
      }
      return T.PRIM.any;
    }
    this.report('PS3340', `Type ${T.showType(objectType)} cannot be indexed.`, node);
    return T.PRIM.error;
  }

  callOverloads(node, overloads) {
    const argumentTypes = node.args.map((argument) => this.typeOf(argument));
    for (const signature of overloads) {
      const required = signature.params.filter((parameter) => !parameter.optional && !parameter.rest).length;
      const hasRest = signature.params.some((parameter) => parameter.rest);
      if (node.args.length < required || (!hasRest && node.args.length > signature.params.length)) continue;
      const subst = new Map();
      let matches = true;
      for (let index = 0; index < node.args.length; index += 1) {
        const parameter = signature.params[index] || signature.params[signature.params.length - 1];
        if (!parameter) { matches = false; break; }
        const expectedType = parameter.rest ? elementTypeOf(parameter.type) : parameter.type;
        if (!T.infer(expectedType, argumentTypes[index], subst)
          || !T.assignable(argumentTypes[index], T.substitute(expectedType, subst))) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;
      if (signature.predicate) {
        const predicateIndex = signature.params.findIndex((parameter) => parameter.name === signature.predicate.parameter);
        if (predicateIndex >= 0 && node.args[predicateIndex]) {
          node.__predicate = { argument: node.args[predicateIndex], type: T.substitute(signature.predicate.type, subst) };
        }
      }
      const result = T.substitute(signature.ret, subst);
      this.registerVariantsDeep(result);
      return result;
    }
    const expected = overloads
      .map((signature) => `(${signature.params.map((parameter) => T.showType(parameter.type)).join(', ')}) -> ${T.showType(signature.ret)}`)
      .join(' or ');
    this.report('PS3354', `No overload matches this call; expected ${expected}.`, node);
    return T.PRIM.any;
  }

  callType(node, expected) {
    let calleeType;

    if (node.callee.kind === 'Name' && this.variantCtors.has(node.callee.name)) {
      calleeType = this.variantCtors.get(node.callee.name).type;
    } else {
      calleeType = this.typeOf(node.callee);
    }

    const resolved = T.deref(calleeType);
    const overloadEntry = node.callee.kind === 'Name' ? this.lookup(node.callee.name) : null;
    if (overloadEntry && overloadEntry.overloads && overloadEntry.overloads.length) {
      return this.callOverloads(node, overloadEntry.overloads);
    }
    if (T.isAny(resolved)) {
      for (const argument of node.args) this.typeOf(argument);
      return T.PRIM.any;
    }
    if (resolved.k !== 'fn') {
      for (const argument of node.args) this.typeOf(argument);
      this.report('PS3304', `${describeCallee(node.callee)} is ${T.showType(calleeType)} and cannot be called.`, node);
      return T.PRIM.error;
    }

    const subst = new Map();
    const required = resolved.params.filter((parameter) => !parameter.optional && !parameter.rest).length;
    const hasRest = resolved.params.some((parameter) => parameter.rest);
    if (node.args.length < required) {
      this.report('PS3341', `Expected at least ${required} argument(s) but got ${node.args.length}.`, node);
    }
    if (!hasRest && node.args.length > resolved.params.length) {
      this.report('PS3342', `Expected at most ${resolved.params.length} argument(s) but got ${node.args.length}.`, node);
    }

    const contractCall = node.callee.kind === 'Name' ? this.lookup(node.callee.name) : null;
    const argumentTypes = [];
    node.args.forEach((argument, index) => {
      const parameter = resolved.params[index] || resolved.params[resolved.params.length - 1];
      if (argument.kind === 'Spread') {
        const spreadType = T.deref(this.typeOf(argument.value));
        if (spreadType.k === 'list' && parameter) T.infer(parameter.type, spreadType.elem, subst);
        return;
      }
      // A rest parameter is declared as a list but each argument is one element.
      let expectedType = null;
      let declared = null;
      if (parameter) {
        declared = parameter.type;
        expectedType = parameter.rest ? elementTypeOf(parameter.type) : parameter.type;
      }
      // Earlier arguments can bind generic variables used by a later callback.
      // Contextual typing must see those substitutions before checking the body;
      // otherwise a lambda body like `request.id` is checked against unresolved I.
      let contextualType = expectedType ? T.substitute(expectedType, subst) : expectedType;
      if (contractCall && contractCall.importSpec === 'std/contract' && index === 0
        && (contractCall.importedName === 'failure' || contractCall.importedName === 'success')) {
        const variantName = contractCall.importedName === 'failure' ? 'Failure' : 'Success';
        const fieldName = contractCall.importedName === 'failure' ? 'error' : 'value';
        const expectedVariant = expectedVariantOf(expected, variantName);
        const payloadField = expectedVariant && expectedVariant.fields.find((field) => field.name === fieldName);
        if (payloadField) contextualType = payloadField.type;
      }
      const argumentType = this.typeOf(argument, contextualType);
      argumentTypes[index] = argumentType;
      if (parameter) {
        const callbackMismatch = argument.kind === 'FunctionExpression'
          && contextualType
          && T.deref(contextualType).k === 'fn'
          && !T.assignable(argumentType, contextualType);
        if (callbackMismatch) {
          this.report(
            'PS3343',
            `Argument ${index + 1} is ${T.showType(argumentType)}; expected ${T.showType(contextualType)}.`,
            argument,
          );
        } else {
          if (!T.infer(expectedType, argumentType, subst)) {
            this.report(
              'PS3343',
              `Argument ${index + 1} does not satisfy the generic constraint on ${T.showType(expectedType)}.`,
              argument,
            );
          }
          if (!T.assignable(argumentType, T.substitute(expectedType, subst))) {
            this.report(
              'PS3343',
              `Argument ${index + 1} is ${T.showType(argumentType)}; expected ${T.showType(T.substitute(expectedType, subst))}.`,
              argument,
            );
          }
        }
      }
    });

    for (const name of resolved.typeParams || []) {
      const variable = resolved.typeEnv && resolved.typeEnv.get(name);
      if (!variable || !variable.constraint || !subst.has(name)) continue;
      const constraint = T.substitute(variable.constraint, subst);
      if (!T.assignable(subst.get(name), constraint)) {
        this.report('PS3343', `Type argument ${T.showType(subst.get(name))} for "${name}" must satisfy ${T.showType(constraint)}.`, node);
      }
    }
    if (resolved.predicate) {
      const index = resolved.params.findIndex((parameter) => parameter.name === resolved.predicate.parameter);
      if (index >= 0 && node.args[index]) {
        node.__predicate = { argument: node.args[index], type: T.substitute(resolved.predicate.type, subst) };
      } else {
        this.report('PS3353', `A type predicate for \"${resolved.predicate.parameter}\" needs that argument at the call site.`, node);
      }
    }
    const resultType = T.substitute(resolved.ret, subst);
    this.registerVariantsDeep(resultType);
    if (node.callee.kind === 'Name') {
      const entry = contractCall;
      if (entry && entry.importSpec === 'std/contract') {
        if (entry.importedName === 'object') return this.schemaForRecord(argumentTypes[0], resultType);
        if (entry.importedName === 'literal') {
          const value = literalValueOf(node.args[0]);
          if (value !== null) return this.schemaWithOutput(resultType, value.type);
        }
        if (entry.importedName === 'enumeration') {
          const members = [];
          for (const item of (node.args[0] && node.args[0].kind === 'ListLiteral' ? node.args[0].items : [])) {
            const value = literalValueOf(item);
            if (value) members.push(value.type);
          }
          return this.schemaWithOutput(resultType, members.length ? T.union(members) : T.PRIM.any);
        }
        if (entry.importedName === 'oneOf') {
          const members = [];
          for (const schemaType of argumentTypes[0] && T.deref(argumentTypes[0]).k === 'list'
            ? T.deref(argumentTypes[0]).elem ? [T.deref(argumentTypes[0]).elem] : []
            : []) {
            const parse = T.deref(schemaType).k === 'record' ? T.deref(schemaType).fields.get('parse') : null;
            const parser = parse && T.deref(parse.type);
            if (parser && parser.k === 'fn') members.push(parser.ret);
          }
          return this.schemaWithOutput(resultType, members.length ? T.union(members) : T.PRIM.any);
        }
      }
    }
    return resultType;
  }

  schemaForRecord(shapeType, schemaTemplate) {
    const shape = T.deref(shapeType);
    if (!shape || shape.k !== 'record') return schemaTemplate;
    const fields = new Map();
    for (const [name, field] of shape.fields) {
      const fieldSchema = T.deref(field.type);
      const parseField = fieldSchema && fieldSchema.k === 'record' ? fieldSchema.fields.get('parse') : null;
      const parser = parseField && T.deref(parseField.type);
      if (!parser || parser.k !== 'fn') {
        fields.set(name, { type: T.PRIM.any, optional: false });
        continue;
      }
      const output = parser.ret;
      const optional = T.containsNothing(output);
      fields.set(name, { type: optional ? T.withoutNothing(output) : output, optional });
    }
    return this.schemaWithOutput(schemaTemplate, T.record(fields));
  }

  schemaWithOutput(schemaTemplate, outputType) {
    const template = T.deref(schemaTemplate);
    if (!template || template.k !== 'record') return schemaTemplate;
    const schemaFields = new Map(template.fields);
    const parse = schemaFields.get('parse');
    if (parse) {
      const signature = T.deref(parse.type);
      if (signature && signature.k === 'fn') {
        schemaFields.set('parse', { ...parse, type: T.fnType(signature.params, outputType) });
      }
    }
    return T.record(schemaFields, { name: template.name, open: template.open });
  }

  binaryType(node) {
    const left = this.typeOf(node.left);
    const right = this.typeOf(node.right);
    const leftResolved = T.deref(left);
    const rightResolved = T.deref(right);

    switch (node.operator) {
      case '+':
      case '-':
      case '*':
      case '/':
      case '%':
      case '**': {
        if (!T.assignable(left, T.PRIM.number) || !T.assignable(right, T.PRIM.number)) {
          this.report(
            'PS3344',
            `Arithmetic "${node.operator}" needs numbers, found ${T.showType(left)} and ${T.showType(right)}. Use "{a}{b}" to join text.`,
            node,
          );
          return T.PRIM.error;
        }
        return T.PRIM.number;
      }
      case '==':
      case '!=': {
        if (!T.assignable(left, right) && !T.assignable(right, left)) {
          this.report('PS3345', `Comparing ${T.showType(left)} with ${T.showType(right)} can never be true.`, node);
        }
        return T.PRIM.boolean;
      }
      case '<':
      case '<=':
      case '>':
      case '>=': {
        const comparable = (T.assignable(left, T.PRIM.number) && T.assignable(right, T.PRIM.number)) ||
          (T.assignable(left, T.PRIM.text) && T.assignable(right, T.PRIM.text));
        if (!comparable) {
          this.report('PS3346', `"${node.operator}" compares two numbers or two texts, found ${T.showType(left)} and ${T.showType(right)}.`, node);
        }
        return T.PRIM.boolean;
      }
      case 'and':
      case 'or': {
        if (!T.assignable(left, T.PRIM.boolean) || !T.assignable(right, T.PRIM.boolean)) {
          this.report('PS3318', `"${node.operator}" needs boolean operands, found ${T.showType(left)} and ${T.showType(right)}.`, node);
        }
        return T.PRIM.boolean;
      }
      case '??': {
        const fallback = T.union([T.withoutNothing(leftResolved), rightResolved]);
        return fallback;
      }
      default:
        this.report('PS3347', `Unknown operator "${node.operator}".`, node);
        return T.PRIM.error;
    }
  }

  pipeType(node) {
    this.typeOf(node.left);
    let call;
    if (node.right.kind === 'Call') {
      call = { ...node.right, args: [node.left, ...node.right.args] };
      if (node.right.callee.kind === 'Name' && this.variantCtors.has(node.right.callee.name)) {
        this.report('PS3348', 'A pipeline cannot construct a variant directly.', node);
      }
    } else if (node.right.kind === 'Name' || node.right.kind === 'Member' || node.right.kind === 'FunctionExpression') {
      call = { kind: 'Call', callee: node.right, args: [node.left], line: node.line, col: node.col };
    } else {
      this.report('PS3349', 'The right side of "|>" must be a function or a call.', node.right);
      return T.PRIM.error;
    }
    return this.callType(call);
  }

  functionExpressionType(node, expected) {
    const expectedFn = expected ? T.deref(expected) : null;
    const localEnv = this.typeEnvironment(node.typeParams || [], node.typeParamConstraints);
    const params = node.params.map((parameter, index) => {
      let type;
      if (parameter.type) {
        type = this.resolveType(parameter.type, localEnv);
      } else if (expectedFn && expectedFn.k === 'fn' && expectedFn.params[index]) {
        type = expectedFn.params[index].type;
      } else {
        type = T.PRIM.any;
      }
      return { name: parameter.name, type, optional: false, rest: false };
    });

    const previous = this.scope;
    this.scope = previous.child();
    for (const parameter of params) {
      this.scope.define(parameter.name, { kind: 'param', type: parameter.type, mutable: true });
    }

    // A lambda is its own function frame: `await` inside it belongs to the
    // lambda, not to the enclosing function. An async lambda is an async
    // function, so its result type is the Promise of the values it returns.
    const expectedReturn = expectedFn && expectedFn.k === 'fn' ? expectedFn.ret : null;
    const resolvedExpected = expectedReturn ? T.deref(expectedReturn) : null;
    const concreteReturn = node.async && resolvedExpected && resolvedExpected.k === 'promise'
      ? resolvedExpected.value
      : expectedReturn;
    this.functionStack.push({ node, declaredReturn: concreteReturn, async: Boolean(node.async), inferred: null });
    if (node.async) this.asyncDepth += 1;
    let ret;
    if (node.expression) {
      ret = this.typeOf(node.expression, expectedReturn);
    } else {
      this.checkStatements(node.body);
      const info = inspectReturns(node.body);
      ret = info.types.length ? T.union(info.types) : T.PRIM.nothing;
    }
    if (node.async) this.asyncDepth -= 1;
    this.functionStack.pop();
    this.scope = previous;
    if (node.async && T.deref(ret).k !== 'promise') ret = T.promiseOf(ret);
    if (expectedReturn && !T.assignable(ret, expectedReturn)) {
      this.report('PS3404', `This lambda returns ${T.showType(ret)}, but the expected result is ${T.showType(expectedReturn)}.`, node);
    }
    return T.fnType(params, ret);
  }
}

// --------------------------------------------------------------- narrowing

// A narrowable place is a name followed by plain field accesses:
// `value`, `user.email`, `order.customer.name`. Optional chains are excluded
// because they already produce a maybe-value.
function pathOf(node) {
  const segments = [];
  let current = node;
  while (current && current.kind === 'Member' && !current.optional) {
    segments.unshift(current.property);
    current = current.object;
  }
  if (current && current.kind === 'Name') {
    segments.unshift(current.name);
    return segments;
  }
  return null;
}

function narrowFacts(condition) {
  const facts = [];
  if (!condition) return facts;
  if (condition.kind === 'TypeTest') {
    const path = pathOf(condition.value);
    if (path) facts.push({ path, type: condition.type, negative: false });
  }
  if (condition.kind === 'Call' && condition.__predicate) {
    const path = pathOf(condition.__predicate.argument);
    if (path) facts.push({ path, type: condition.__predicate.type, negative: false });
  }
  if (condition.kind === 'Binary') {
    if (condition.operator === 'and') {
      facts.push(...narrowFacts(condition.left), ...narrowFacts(condition.right));
    }
    if (condition.operator === '==' || condition.operator === '!=') {
      const negative = condition.operator === '!=';
      const sides = [[condition.left, condition.right], [condition.right, condition.left]];
      for (const [left, right] of sides) {
        const path = pathOf(left);
        if (path && right.kind === 'Nothing') {
          facts.push({ path, type: { kind: 'NamedType', name: 'nothing', args: [] }, negative });
        }
      }
    }
  }
  if (condition.kind === 'Unary' && condition.operator === 'not') {
    for (const fact of narrowFacts(condition.operand)) facts.push({ ...fact, negative: !fact.negative });
  }
  return facts;
}

function removeType(type, target) {
  const resolved = T.deref(type);
  if (resolved.k === 'union') {
    const kept = resolved.members.filter((member) => !T.assignable(member, target));
    return kept.length ? T.union(kept) : T.PRIM.never;
  }
  return T.assignable(resolved, target) ? T.PRIM.never : type;
}

function narrowMember(type, segments, replacement, negative) {
  if (!segments.length) return replacement;
  const resolved = T.deref(type);
  if (resolved.k === 'union') {
    return T.union(resolved.members.map((member) => narrowMember(member, segments, replacement, negative)));
  }
  if (resolved.k !== 'record' && resolved.k !== 'variant') return type;
  const [head, ...rest] = segments;
  const fields = resolved.k === 'variant'
    ? new Map(resolved.fields.map((field) => [field.name, { type: field.type, optional: false }]))
    : new Map(resolved.fields);
  const field = fields.get(head);
  if (!field) return type;
  let narrowed;
  if (rest.length) {
    narrowed = narrowMember(field.type, rest, replacement, negative);
  } else {
    narrowed = negative ? T.withoutNothing(field.type) : replacement;
  }
  // Once a guard proves the field is present, it is no longer optional, so
  // reading it stops producing a maybe-value.
  fields.set(head, { ...field, type: narrowed, optional: T.containsNothing(narrowed) });
  return T.record(fields, { name: resolved.name, open: resolved.open });
}

function negateFacts(facts) {
  return facts.map((fact) => ({ ...fact, negative: !fact.negative }));
}

function mergeFacts(factGroups) {
  const merged = [];
  for (const group of factGroups) merged.push(...group);
  return merged;
}

function applyFacts(scope, facts) {
  const checker = scope.checker;
  for (const fact of facts || []) {
    const entry = scope.lookup(fact.path[0]);
    if (!entry) continue;
    const rest = fact.path.slice(1);
    const resolvedFact = fact.type && fact.type.k !== undefined && fact.type.kind === undefined;
    const isNothingFact = resolvedFact
      ? fact.type.k === 'prim' && fact.type.name === 'nothing'
      : fact.type.kind === 'NamedType' && fact.type.name === 'nothing';
    const replacement = isNothingFact
      ? T.PRIM.nothing
      : (resolvedFact ? fact.type : (checker ? checker.resolveType(fact.type) : T.PRIM.any));

    let type;
    if (!rest.length) {
      type = fact.negative ? removeType(entry.type, replacement) : replacement;
    } else {
      type = narrowMember(entry.type, rest, replacement, fact.negative);
    }
    scope.define(fact.path[0], { ...entry, type });
  }
}

// ------------------------------------------------------------- flow helpers

function inspectReturns(statements) {
  const types = [];
  let missingValue = false;

  const walk = (nodes) => {
    for (const node of nodes) {
      if (!node) continue;
      if (node.kind === 'Return') {
        if (!node.value || node.value.kind === 'Nothing') missingValue = true;
        else types.push(node.value.__type || T.PRIM.any);
      } else if (node.kind === 'Conditional') {
        for (const branch of node.branches) walk(branch.body);
        if (node.otherwise) walk(node.otherwise);
      } else if (node.kind === 'Try') {
        walk(node.body);
        if (node.handler) walk(node.handler);
        if (node.finalizer) walk(node.finalizer);
      } else if (node.kind === 'Match') {
        for (const branch of node.cases) walk(branch.body);
      } else if (node.kind === 'FunctionDecl' || node.kind === 'FunctionExpression') {
        // Nested functions own their returns.
      } else if (node.kind === 'ForEach' || node.kind === 'ForRange' || node.kind === 'While') {
        walk(node.body);
      }
    }
  };
  walk(statements);
  return { types, missingValue };
}

function alwaysReturns(statements) {
  if (!statements || statements.length === 0) return false;
  for (let index = statements.length - 1; index >= 0; index -= 1) {
    const node = statements[index];
    if (node.kind === 'Return' || node.kind === 'Throw') return true;
    if (node.kind === 'Render') return true;
    if (node.kind === 'Conditional') {
      if (!node.otherwise) return false;
      return node.branches.every((branch) => alwaysReturns(branch.body)) && alwaysReturns(node.otherwise);
    }
    if (node.kind === 'Match') {
      return node.cases.every((branch) => alwaysReturns(branch.body));
    }
    if (node.kind === 'Try') {
      const bodyReturns = alwaysReturns(node.body);
      const handlerReturns = node.handler ? alwaysReturns(node.handler) : false;
      return bodyReturns && (!node.handler || handlerReturns);
    }
    if (node.kind === 'FunctionDecl' || node.kind === 'TypeDecl' || node.kind === 'Import') continue;
    return false;
  }
  return false;
}

function expectedVariantOf(expected, name) {
  if (!expected) return null;
  const resolved = T.deref(expected);
  const members = resolved.k === 'union' ? resolved.members.map((member) => T.deref(member)) : [resolved];
  return members.find((member) => member.k === 'variant' && member.name === name) || null;
}

function literalValueOf(node) {
  if (!node) return null;
  if (node.kind === 'Text') return { value: node.v || node.value, type: T.literalType(node.v || node.value, T.PRIM.text) };
  if (node.kind === 'Number') return { value: node.value, type: T.literalType(node.value, T.PRIM.number) };
  if (node.kind === 'Boolean') return { value: node.value, type: T.literalType(node.value, T.PRIM.boolean) };
  if (node.kind === 'Unary' && node.operator === '-' && node.operand.kind === 'Number') {
    const value = -node.operand.value;
    return { value, type: T.literalType(value, T.PRIM.number) };
  }
  return null;
}

function missingCoverage(subjectType, covered, catchAll) {
  if (catchAll) return [];
  const resolved = T.deref(subjectType);
  const members = resolved.k === 'union' ? resolved.members.map((member) => T.deref(member)) : [resolved];
  const missing = [];

  for (const member of members) {
    if (member.k === 'prim' && member.name === 'boolean') {
      if (!covered.has('true')) missing.push('true');
      if (!covered.has('false')) missing.push('false');
    } else if (member.k === 'prim' && member.name === 'nothing') {
      if (!covered.has('nothing')) missing.push('nothing');
    } else if (member.k === 'literal') {
      const key = `literal:${JSON.stringify(member.value)}`;
      if (!covered.has(key)) missing.push(T.showType(member));
    } else if (member.k === 'variant' || member.k === 'unit') {
      if (!covered.has('variant:' + member.name)) missing.push(member.name);
    } else if (member.k === 'record' && hasVariantUnion(members)) {
      // Covered by variant arms.
    }
  }
  return missing;
}

function hasVariantUnion(members) {
  return members.some((member) => member.k === 'variant' || member.k === 'unit');
}

function elementTypeOf(type) {
  const resolved = T.deref(type);
  if (resolved.k === 'list') return resolved.elem;
  if (resolved.k === 'tuple') return T.union(resolved.elements);
  return T.PRIM.any;
}

function describePattern(pattern) {
  if (!pattern) return 'value';
  if (pattern.kind === 'NamePattern') return pattern.name;
  return 'this pattern';
}

function describeCallee(callee) {
  if (!callee) return 'This value';
  if (callee.kind === 'Name') return `"${callee.name}"`;
  if (callee.kind === 'Member') return `"${callee.property}"`;
  return 'This value';
}

function checkModule(options) {
  const checker = new Checker(options);
  const result = checker.run();
  return { ...result, checker };
}

module.exports = { checkModule, Checker, Scope, applyFacts, narrowFacts, alwaysReturns };
