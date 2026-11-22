'use strict';

const T = require('./types');
const { Span, error } = require('./diagnostics');
const { CONTEXTUAL_WORDS, PRAGMA } = require('./dialect');

const PRIMITIVES = new Set(['number', 'text', 'boolean', 'nothing', 'any', 'unknown', 'never', 'regex', 'bigint']);

const BUILTIN_ERRORS = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError'];

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
    // Values re-exported from another module, keyed by the exported name.
    this.reexports = new Map();
    // Resolved JSX settings (runtime, factory, fragment, import source). The
    // compiler resolves them per file before checking.
    this.jsx = options.jsx || { runtime: 'classic', factory: 'createElement', fragment: 'Fragment' };
    // Declared and built-in classes, keyed by source name.
    this.classes = new Map();
    // The instance type of the class whose method/constructor is being checked.
    this.thisStack = [];
    this.classStack = [];
    this.generatorDepth = 0;
    this.constructorDepth = 0;
    this.registerBuiltinClasses();
  }

  // The JavaScript platform's error classes are part of the language's error
  // contract: they can be thrown, caught by a typed catch, subclassed and
  // constructed without importing anything.
  registerBuiltinClasses() {
    for (const name of BUILTIN_ERRORS) {
      const fields = new Map([
        ['name', { type: T.PRIM.text, optional: false, readonly: false }],
        ['message', { type: T.PRIM.text, optional: false, readonly: false }],
        ['stack', { type: T.PRIM.text, optional: true, readonly: false }],
      ]);
      fields.set('toString', { type: T.fnType([], T.PRIM.text), optional: false, readonly: true });
      const instance = T.instanceOf(name, fields);
      const ctor = T.fnType([{ name: 'message', type: T.PRIM.text, optional: true }], instance);
      const classType = T.classOf(name, instance, { ctor });
      const info = {
        name, builtin: true, node: null, typeParams: [], typeEnv: new Map(),
        instance, statics: new Map(), ctor, classType, parent: null,
      };
      this.classes.set(name, info);
      // The error constructors are values in every module. They are defined
      // directly on the global scope so a user import of `Error` from a
      // declaration file does not collide with them.
      this.global.define(name, {
        kind: 'class', type: classType, classInfo: info, mutable: false, builtin: true,
      });
    }
    // Date is a platform class with a stable, structural surface. Typing it
    // natively means `.d.ts` files that mention Date keep working instead of
    // widening the value to any.
    const dateFields = new Map([
      ['getTime', { type: T.fnType([], T.PRIM.number), optional: false, readonly: true }],
      ['getFullYear', { type: T.fnType([], T.PRIM.number), optional: false, readonly: true }],
      ['getMonth', { type: T.fnType([], T.PRIM.number), optional: false, readonly: true }],
      ['getDate', { type: T.fnType([], T.PRIM.number), optional: false, readonly: true }],
      ['getHours', { type: T.fnType([], T.PRIM.number), optional: false, readonly: true }],
      ['getMinutes', { type: T.fnType([], T.PRIM.number), optional: false, readonly: true }],
      ['getSeconds', { type: T.fnType([], T.PRIM.number), optional: false, readonly: true }],
      ['getMilliseconds', { type: T.fnType([], T.PRIM.number), optional: false, readonly: true }],
      ['toISOString', { type: T.fnType([], T.PRIM.text), optional: false, readonly: true }],
      ['toJSON', { type: T.fnType([], T.PRIM.text), optional: false, readonly: true }],
      ['toString', { type: T.fnType([], T.PRIM.text), optional: false, readonly: true }],
    ]);
    const dateInstance = T.instanceOf('Date', dateFields);
    const dateCtor = T.fnType([{
      name: 'args', optional: true, rest: true, type: T.listOf(T.PRIM.any),
    }], dateInstance);
    const dateStatics = new Map([
      ['now', { type: T.fnType([], T.PRIM.number), optional: false, readonly: true }],
      ['parse', { type: T.fnType([{ name: 'value', type: T.PRIM.text }], T.PRIM.number), optional: false, readonly: true }],
    ]);
    const dateClassType = T.classOf('Date', dateInstance, { ctor: dateCtor, statics: dateStatics });
    const dateInfo = {
      name: 'Date', builtin: true, node: null, typeParams: [], typeEnv: new Map(),
      instance: dateInstance, statics: dateStatics, ctor: dateCtor, classType: dateClassType, parent: null,
    };
    this.classes.set('Date', dateInfo);
    this.global.define('Date', {
      kind: 'class', type: dateClassType, classInfo: dateInfo, mutable: false, builtin: true,
    });
  }

  classInfo(name) {
    return this.classes.get(name) || null;
  }

  // Class assignability is nominal where it matters: a thrown TypeError is not
  // a RangeError even though both expose the same Error-shaped fields.
  isClassSubclass(name, base) {
    let info = this.classes.get(name);
    while (info) {
      if (info.name === base) return true;
      info = info.parentInfo || null;
    }
    return false;
  }

  thrownTypeCompatible(valueType, declaredType) {
    const declared = T.deref(declaredType);
    if (declared.k === 'union') {
      return declared.members.some((member) => this.thrownTypeCompatible(valueType, member));
    }
    const value = T.deref(valueType);
    if (value.k === 'instance' && declared.k === 'instance') {
      return this.isClassSubclass(value.name, declared.name);
    }
    return T.assignable(valueType, declaredType);
  }

  // Class declarations are collected before type aliases resolve and before
  // statements are checked. Fields and methods live in one instance record, so
  // the ordinary structural member rules apply to `this`, parameters and
  // values crossing a function boundary.
  collectClasses() {
    const declarations = this.program.body.filter((statement) => statement.kind === 'ClassDecl');
    for (const declaration of declarations) {
      if (this.classes.has(declaration.name) && !this.classes.get(declaration.name).builtin) {
        this.report('PS3501', `Class "${declaration.name}" is already declared in this module.`, declaration);
        continue;
      }
      if (this.classes.has(declaration.name) && this.classes.get(declaration.name).builtin) {
        this.report('PS3501', `Class "${declaration.name}" shadows a built-in class.`, declaration);
        continue;
      }
      const typeEnv = this.typeEnvironment(declaration.typeParams || [], declaration.typeParamConstraints);
      const info = {
        name: declaration.name,
        node: declaration,
        typeParams: declaration.typeParams || [],
        typeEnv,
        instance: T.instanceOf(declaration.name, new Map()),
        statics: new Map(),
        ctor: null,
        parent: null,
        parentInfo: null,
        declared: Boolean(declaration.declared),
      };
      info.classType = T.classOf(declaration.name, info.instance, {
        typeParams: info.typeParams, typeEnv, node: declaration,
      });
      this.classes.set(declaration.name, info);
      this.define(declaration.name, {
        kind: 'class',
        name: declaration.name,
        nameLine: declaration.nameLine,
        nameCol: declaration.nameCol,
        type: info.classType,
        classInfo: info,
        mutable: true,
        node: declaration,
      }, declaration);
      if (declaration.exported) {
        this.exportedNames.add(declaration.name);
        // A class crosses a module boundary as both a value (its constructor)
        // and a type (its instance shape). Generic classes publish a type
        // constructor so `Box<number>` keeps working after import.
        this.typeExports.set(declaration.name, info.typeParams.length
          ? { k: 'genericAlias', params: [...info.typeParams], body: info.instance }
          : info.instance);
      }
    }

    for (const declaration of declarations) {
      const info = this.classes.get(declaration.name);
      if (!info || info.builtin) continue;
      this.populateClass(info, declaration);
    }
  }

  populateClass(info, declaration) {
    if (info.populated) return;
    const { name, typeEnv } = info;

    let parentInstance = null;
    if (declaration.superClass) {
      const resolved = this.resolveType(declaration.superClass, typeEnv);
      let parentInfo = this.classes.get(declaration.superClass.name);
      if (!parentInfo) {
        // An imported class has no local ClassDecl to inspect, but its value
        // type carries the constructor, statics and instance shape.
        const entry = this.lookup(declaration.superClass.name);
        const valueType = entry ? T.deref(entry.type) : null;
        if (valueType && valueType.k === 'class') {
          parentInfo = {
            name: valueType.name,
            instance: valueType.instance,
            statics: valueType.statics,
            ctor: valueType.ctor,
            parentInfo: null,
            imported: true,
            typeParams: valueType.typeParams || [],
          };
        }
      }
      if (!parentInfo || resolved.k !== 'instance') {
        this.report('PS3502', `Class "${name}" can only extend another class.`, declaration.superClass);
      } else {
        info.parentInfo = parentInfo;
        info.parent = parentInfo;
        parentInstance = resolved;
        // A class hierarchy cannot be cyclic: walk the base links before
        // accepting the parent.
        let cursor = parentInfo;
        const seen = new Set([name]);
        while (cursor) {
          if (seen.has(cursor.name)) {
            this.report('PS3503', `Class inheritance cycle: "${name}" extends itself through "${cursor.name}".`, declaration);
            parentInstance = null;
            info.parentInfo = null;
            info.parent = null;
            break;
          }
          seen.add(cursor.name);
          cursor = cursor.parentInfo;
        }
      }
    }

    // The placeholder instance's field map is the one published in the class
    // type. Filling it in place means a self-referential type such as
    // `function map(...) -> Box<U>` sees the same shape the caller sees.
    const fields = info.instance.fields;
    fields.clear();
    if (parentInstance) {
      // Parent instance fields are already substituted with the base type
      // arguments, because `resolveType` on `extends Base<T>` evaluates them.
      for (const [fieldName, field] of parentInstance.fields) fields.set(fieldName, field);
    }

    const statics = new Map();
    if (info.parentInfo) {
      for (const [fieldName, field] of info.parentInfo.statics) statics.set(fieldName, field);
    }

    for (const field of declaration.fields) {
      let fieldType = field.type ? this.resolveType(field.type, typeEnv) : null;
      if (!fieldType && field.defaultValue) fieldType = this.literalFieldType(field.defaultValue);
      if (!fieldType) fieldType = T.PRIM.any;
      const entry = { type: fieldType, optional: Boolean(field.optional), readonly: Boolean(field.readonly) };
      if (field.static) {
        if (statics.has(field.name)) this.report('PS3504', `Static member "${field.name}" is already declared.`, field);
        statics.set(field.name, entry);
      } else {
        if (fields.has(field.name) && !(info.parentInfo && info.parentInfo.instance.fields.has(field.name))) {
          this.report('PS3504', `Field "${field.name}" is already declared.`, field);
        }
        fields.set(field.name, entry);
      }
    }

    for (const method of declaration.methods) {
      const signature = this.classSignature(method, info);
      const methodType = T.fnType(signature.params, signature.ret, signature.typeParams, signature.predicate);
      method.__signature = signature;
      if (method.static) {
        if (statics.has(method.name)) this.report('PS3504', `Static member "${method.name}" is already declared.`, method);
        statics.set(method.name, { type: methodType, optional: false, readonly: false, method: true, node: method });
      } else {
        if (fields.has(method.name) && !(info.parentInfo && info.parentInfo.instance.fields.has(method.name))) {
          this.report('PS3504', `Member "${method.name}" is already declared.`, method);
        }
        fields.set(method.name, { type: methodType, optional: false, readonly: false, method: true, node: method });
      }
    }

    if (declaration.constructorDecl) {
      const signature = this.classSignature(declaration.constructorDecl, info);
      signature.ret = info.instance;
      declaration.constructorDecl.__signature = signature;
      info.ctor = T.fnType(signature.params, info.instance, signature.typeParams);
    } else if (info.parentInfo && info.parentInfo.ctor) {
      info.ctor = info.parentInfo.ctor;
    } else {
      info.ctor = T.fnType([], info.instance);
    }

    info.instance.name = name;
    info.instance.args = info.typeParams.map((parameter) => typeEnv.get(parameter));
    info.instance.parent = parentInstance;
    info.statics = statics;
    info.classType = T.classOf(name, info.instance, {
      statics, ctor: info.ctor, typeParams: info.typeParams, typeEnv, node: declaration,
    });
    info.populated = true;

    // A method can name its own class in a parameter or result (`map` returns
    // Box<U>`). The first pass resolved that reference while later methods were
    // still missing from the shape, so re-resolve every signature now that the
    // instance shape is complete. The field entries are overwritten in place.
    for (const method of declaration.methods) {
      delete method.__signature;
      const signature = this.classSignature(method, info);
      const methodType = T.fnType(signature.params, signature.ret, signature.typeParams, signature.predicate);
      const collection = method.static ? statics : fields;
      collection.set(method.name, { type: methodType, optional: false, readonly: false, method: true, node: method });
    }
    if (declaration.constructorDecl) {
      delete declaration.constructorDecl.__signature;
      const signature = this.classSignature(declaration.constructorDecl, info);
      signature.ret = info.instance;
      info.ctor = T.fnType(signature.params, info.instance, signature.typeParams);
    }

    const symbol = this.global.names.get(name);
    if (symbol && symbol.kind === 'class') {
      symbol.type = info.classType;
      symbol.classInfo = info;
    }
  }

  classSignature(node, info) {
    const signature = this.signatureOf(node, info.typeEnv);
    node.__signature = signature;
    return signature;
  }

  literalFieldType(value) {
    if (!value) return T.PRIM.any;
    if (value.kind === 'Number') return T.PRIM.number;
    if (value.kind === 'BigInt') return T.PRIM.bigint;
    if (value.kind === 'Text') return T.PRIM.text;
    if (value.kind === 'Boolean') return T.PRIM.boolean;
    if (value.kind === 'Nothing') return T.PRIM.nothing;
    if (value.kind === 'ListLiteral') return T.listOf(T.PRIM.any);
    if (value.kind === 'RecordLiteral') return T.record(new Map());
    if (value.kind === 'Regex') return T.PRIM.regex;
    return T.PRIM.any;
  }

  // The instance type a class name denotes in a type position, with its type
  // parameters substituted by the written arguments.
  classInstanceType(info, args, node) {
    // A bare generic class in a type position means "this class with unknown
    // arguments". That is what `value is Box` needs, and it keeps diagnostic
    // messages readable instead of demanding arguments at a type test.
    if (info.typeParams.length && args.length === 0) {
      args = info.typeParams.map(() => T.PRIM.any);
    }
    if (info.typeParams.length !== args.length) {
      this.report('PS3202', `Type "${info.name}" expects ${info.typeParams.length} type argument(s) but got ${args.length}.`, node);
      return T.PRIM.error;
    }
    if (!info.typeParams.length) return info.instance;
    const subst = new Map();
    info.typeParams.forEach((parameter, index) => subst.set(parameter, args[index]));
    const fields = new Map();
    for (const [fieldName, field] of info.instance.fields) {
      fields.set(fieldName, { ...field, type: T.substitute(field.type, subst) });
    }
    return T.instanceOf(info.name, fields, { args, parent: info.instance.parent });
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
    for (const name of typeParams || []) environment.set(name, T.typeVar(name));
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
        // A class name in a type position means an instance of that class, not
        // its constructor. The constructor type is what the class value has.
        const classInfo = this.classes.get(name);
        if (classInfo) {
          const args = (node.args || []).map((argument) => this.resolveType(argument, typeEnv));
          return this.classInstanceType(classInfo, args, node);
        }
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
        // A generic alias may mention itself through a field, as in
        // `type Box<T> = { value: T, next: Box<T>? }`. Expanding that eagerly
        // never terminates, so the recursion point becomes a named reference:
        // the alias is still visible to diagnostics and `deref`, but its body
        // is not re-expanded while it is already being expanded.
        const expansions = this.expandingAliases || (this.expandingAliases = new Set());
        const expansionKey = `${this.aliasKey(name)}<${declaration.typeParams
          .map((param) => T.showType(localEnv.get(param)))
          .join(', ')}>`;
        // The depth guard also stops pathological chains such as
        // `Wrap<Wrap<T>>` from growing without bound.
        if (expansions.has(expansionKey) || expansions.size > 32) return T.namedRef(this.aliasKey(name), name);
        expansions.add(expansionKey);
        try {
          return this.resolveTypeDeclarationBody(declaration, localEnv);
        } finally {
          expansions.delete(expansionKey);
        }
      }
      case 'ListType':
        return T.listOf(this.resolveType(node.elem, typeEnv));
      case 'IteratorType':
        return T.iteratorOf(this.resolveType(node.elem, typeEnv), Boolean(node.async));
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

  signatureOf(node, outerEnv = null) {
    if (node.__signature) return node.__signature;
    const typeEnv = this.typeEnvironment(node.typeParams, node.typeParamConstraints);
    if (outerEnv) {
      for (const [name, type] of outerEnv) if (!typeEnv.has(name)) typeEnv.set(name, type);
    }
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
    const declaredThrows = node.throwsType ? this.resolveType(node.throwsType, typeEnv) : null;
    // A generator's annotation names what it yields. Its call type is the
    // iterator that drives those values, so callers cannot mistake it for an
    // eagerly produced list.
    const ret = node.generator
      ? T.iteratorOf(declaredReturn || T.PRIM.any)
      : node.async
        ? (declaredReturn && declaredReturn.k === 'promise' ? declaredReturn : T.promiseOf(declaredReturn || T.PRIM.any))
        : (declaredReturn || null);
    const signature = {
      params, ret, declaredReturn, declaredThrows, predicate, typeParams: node.typeParams || [],
      typeParamConstraints: node.typeParamConstraints || {}, typeEnv, async: Boolean(node.async),
      generator: Boolean(node.generator), node,
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
    const onlyImports = Boolean(this.importsOnly);
    for (const statement of this.program.body) {
      if (onlyImports && statement.kind !== 'Import') continue;
      if (!onlyImports && this.importsHoisted && statement.kind === 'Import') continue;
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

  // Imports must be visible before class fields resolve, because a class field
  // can name an imported type or extend an imported base class. Running the
  // import half of hoisting first keeps the full hoist below idempotent.
  hoistImports() {
    if (this.importsHoisted) return;
    this.importsOnly = true;
    this.hoist();
    this.importsOnly = false;
    this.importsHoisted = true;
  }

  // ------------------------------------------------------------------ driver

  run() {
    this.collectTypes();
    this.hoistImports();
    // Classes are registered before aliases resolve, so a type alias can name
    // a class and a class field can name a type alias. Field types that refer
    // to not-yet-registered aliases remain named references; they resolve as
    // soon as the alias registry is filled below.
    this.collectClasses();
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
        if (statement.spec) {
          // A re-export forwards the target module's checked exports. The
          // module loader has already resolved the specifier.
          const target = this.resolveImportFn(statement.spec, statement);
          for (const name of statement.names) {
            const entry = target && target.values ? target.values.get(name.local) : null;
            if (!entry) {
              this.report('PS3205', `"${name.local}" is not exported by "${statement.spec}".`, statement);
              continue;
            }
            this.reexports.set(name.exported, entry);
          }
          continue;
        }
        for (const name of statement.names) {
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
    for (const [exported, entry] of this.reexports) {
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
        this.checkFunctionDecorators(node);
        return;
      case 'ClassDecl':
        this.checkClass(node);
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
        this.checkThrow(node);
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

  checkThrow(node) {
    const frame = this.functionStack[this.functionStack.length - 1];
    const valueType = this.typeOf(node.value);
    node.__type = valueType;
    if (!frame) return;
    // A function without a `throws` clause keeps the pre-2.3 unchecked
    // behaviour. Declaring one turns throws into a checked part of the
    // signature; `throws nothing` forbids throwing entirely.
    if (frame.declaredThrows === null || frame.declaredThrows === undefined) return;
    const declared = T.deref(frame.declaredThrows);
    if (declared.k === 'prim' && declared.name === 'nothing') {
      this.report('PS3521', 'This function declares "throws nothing" but throws a value.', node);
      return;
    }
    if (!this.thrownTypeCompatible(valueType, frame.declaredThrows) && !T.isAny(valueType)) {
      this.report(
        'PS3520',
        `This function declares that it throws ${T.showType(frame.declaredThrows)}, but this value is ${T.showType(valueType)}.`,
        node,
      );
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

  checkFunction(node, context = {}) {
    const signature = node.__signature || this.signatureOf(node);
    const previous = this.scope;
    // Closures capture the enclosing scope, not the module scope.
    this.scope = previous.child();
    if (context.thisType) this.thisStack.push(context.thisType);
    if (context.className) this.classStack.push(context.className);
    if (context.isConstructor) this.constructorDepth += 1;

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
      declaredThrows: signature.declaredThrows,
      async: Boolean(node.async),
      generator: Boolean(node.generator),
      yieldType: signature.declaredReturn,
      yieldTypes: [],
      isConstructor: Boolean(context.isConstructor),
      inferred: null,
    });
    if (node.async) this.asyncDepth += 1;
    if (node.generator) this.generatorDepth += 1;

    this.hoistFunctions(node.body);
    this.checkStatements(node.body);
    const frame = this.functionStack.pop();
    if (node.async) this.asyncDepth -= 1;
    if (node.generator) this.generatorDepth -= 1;

    if (node.generator) {
      let element = signature.declaredReturn;
      if (!element) {
        element = frame.yieldTypes.length ? T.union(frame.yieldTypes) : T.PRIM.nothing;
        node.__signature.ret = T.iteratorOf(element);
        node.__signature.inferred = true;
        const entry = node.name ? this.global.names.get(node.name) : null;
        if (entry && entry.kind === 'function') {
          entry.type = T.fnType(signature.params, node.__signature.ret, signature.typeParams, signature.predicate);
        }
        if (node.name) this.inferredFunctions.set(node.name, node.__signature.ret);
      }
    }

    if (signature.declaredReturn && !node.generator) {
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

    if (!signature.declaredReturn && !node.generator) {
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
    if (context.thisType) this.thisStack.pop();
    if (context.className) this.classStack.pop();
    if (context.isConstructor) this.constructorDepth -= 1;
  }

  checkFunctionDecorators(node) {
    if (!node.decorators || !node.decorators.length) return;
    const signature = node.__signature || this.signatureOf(node);
    const targetType = T.fnType(signature.params, signature.ret, signature.typeParams, signature.predicate);
    this.checkDecorators(node.decorators, targetType, node.name ? `function "${node.name}"` : 'function');
  }

  // ------------------------------------------------------------- decorators

  checkDecorators(decorators, targetType, label) {
    for (const decorator of decorators || []) {
      const type = T.deref(this.typeOf(decorator.expression));
      if (T.isAny(type)) continue;
      if (type.k !== 'fn') {
        this.report('PS3522', `A decorator on ${label} must be a function, found ${T.showType(type)}.`, decorator.expression);
        continue;
      }
      const first = type.params[0];
      if (first && !T.isAny(first.type) && !T.assignable(targetType, first.type)) {
        this.report(
          'PS3523',
          `The decorator's first parameter is ${T.showType(first.type)}, but ${label} is ${T.showType(targetType)}.`,
          decorator.expression,
        );
      }
      if (type.ret && !T.isAny(type.ret) && !T.assignable(type.ret, targetType)) {
        this.report(
          'PS3524',
          `The decorator returns ${T.showType(type.ret)}, which cannot replace ${label} (${T.showType(targetType)}).`,
          decorator.expression,
        );
      }
    }
  }

  // ---------------------------------------------------------------- classes

  checkClass(node) {
    const info = this.classes.get(node.name);
    if (!info) return;
    if (!node.declared) {
      this.checkDecorators(node.decorators, info.classType, `class "${node.name}"`);
      if (node.superClass && !info.parentInfo) {
        // The diagnostic was already reported while populating the class.
      }
      const synthetic = node.constructorDecl;
      for (const field of node.fields) {
        if (field.defaultValue) {
          const declared = field.type ? this.resolveType(field.type, info.typeEnv) : null;
          const valueType = this.typeOf(field.defaultValue, declared);
          if (declared && !T.assignable(valueType, declared)) {
            this.report(
              'PS3505',
              `Field "${field.name}" is ${T.showType(declared)}, but its initializer is ${T.showType(valueType)}.`,
              field.defaultValue,
            );
          }
        }
        if (field.decorators && field.decorators.length) {
          this.report('PS3526', 'Field decorators are not supported; decorate the class or a method instead.', field.decorators[0].expression);
        }
      }
      if (synthetic) {
        this.checkFunction(synthetic, {
          thisType: info.instance, className: node.name, isConstructor: true,
        });
        this.checkDecorators(synthetic.decorators, T.fnType([], info.instance), `constructor of "${node.name}"`);
        this.checkDefiniteAssignment(node, info, synthetic);
      } else {
        this.checkDefiniteAssignment(node, info, null);
      }
      for (const method of node.methods) {
        this.checkFunction(method, { thisType: info.instance, className: node.name });
        if (method.decorators && method.decorators.length) {
          const signature = method.__signature || this.classSignature(method, info);
          this.checkDecorators(
            method.decorators,
            T.fnType(signature.params, signature.ret, signature.typeParams, signature.predicate),
            `method "${method.name}"`,
          );
        }
      }
    } else {
      for (const method of node.methods) {
        if (method.body && method.body.length) {
          this.report('PS3527', 'A declare class member cannot have a body.', method);
        }
      }
    }
  }

  // Every non-optional instance field must be either initialised at its
  // declaration or assigned on every constructor path we can see. Assignments
  // inside branches and loops count, because the common `if (...) { a = ... }
  // else { a = ... }` form must be accepted; a missed runtime path is still
  // possible, which is why optional fields exist for genuinely maybe-values.
  checkDefiniteAssignment(node, info, constructor) {
    if (node.declared) return;
    const assigned = new Set();
    const visit = (statements) => {
      for (const statement of statements) {
        if (!statement) continue;
        if (statement.kind === 'ExprStmt' || statement.kind === 'Assignment') {
          const target = statement.kind === 'Assignment' ? statement.target : null;
          if (target && target.kind === 'Member' && target.object && target.object.kind === 'This') assigned.add(target.property);
        }
        if (statement.kind === 'Conditional') {
          for (const branch of statement.branches) visit(branch.body);
          if (statement.otherwise) visit(statement.otherwise);
        } else if (statement.kind === 'ForEach' || statement.kind === 'ForRange' || statement.kind === 'While') {
          visit(statement.body);
        } else if (statement.kind === 'Match') {
          for (const branch of statement.cases) visit(branch.body);
        } else if (statement.kind === 'Try') {
          visit(statement.body);
          if (statement.handler) visit(statement.handler);
          if (statement.finalizer) visit(statement.finalizer);
        }
      }
    };
    if (constructor) visit(constructor.body);
    for (const field of node.fields) {
      if (field.static || field.optional || field.defaultValue) continue;
      if (!assigned.has(field.name)) {
        this.report(
          'PS3506',
          `Field "${field.name}" is not initialised; give it a default value, mark it optional, or assign this.${field.name} in the constructor.`,
          field,
        );
      }
    }
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
      else if (iterableType.k === 'iterator') {
        if (iterableType.async) {
          this.report('PS3531', 'A for-each loop cannot consume an AsyncIterator; await the values first.', node.iterable);
        }
        elementType = iterableType.elem;
      }
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
      const caught = node.errorType ? this.resolveType(node.errorType) : T.PRIM.any;
      this.scope.define(node.errorName, {
        kind: 'var', type: caught, mutable: false, nameLine: node.line, nameCol: node.col,
      });
      node.__catchType = caught;
      this.checkStatements(node.handler);
      this.scope = previous;
    }
    if (node.finalizer) this.checkBlock(node.finalizer);
  }

  checkReturn(node) {
    const frame = this.functionStack[this.functionStack.length - 1];
    const valueType = this.typeOf(node.value, frame && !frame.generator ? frame.declaredReturn : null);
    node.__type = valueType;
    if (!frame) {
      this.report('PS3403', '"return" can only be used inside a function.', node);
      return;
    }
    if (frame.generator) {
      // A generator's result channel is `yield`; returning a final value would
      // leak into the iterator protocol without a type that expresses it.
      if (!T.sameType(T.deref(valueType), T.PRIM.nothing)) {
        this.report('PS3530', 'A generator cannot return a value; use "yield", or "return nothing" to stop early.', node);
      }
      return;
    }
    if (frame.declaredReturn && !T.assignable(valueType, frame.declaredReturn)) {
      this.report('PS3404', `This function returns ${T.showType(frame.declaredReturn)}, but the value is ${T.showType(valueType)}.`, node);
    }
  }

  // JSX is typed at the component boundary. An intrinsic tag (lowercase) has
  // no compile-time prop contract; a component whose first parameter is a
  // record type is checked attribute by attribute, including required fields.
  checkJSXElement(node) {
    if (this.jsx.runtime !== 'automatic') {
      const factoryRoot = String(this.jsx.factory || 'createElement').split('.')[0];
      if (!this.lookup(factoryRoot)) {
        this.report('PS3405', `JSX needs "${factoryRoot}" in scope. Import it from React, another JSX runtime, or "std/dom".`, node);
      }
    }

    const tagType = T.deref(this.typeOf(node.tag));
    const attrValues = [];
    let hasSpread = false;
    for (const attr of node.attrs || []) {
      if (!attr) continue;
      if (attr.kind === 'spread') {
        hasSpread = true;
        this.typeOf(attr.value);
        continue;
      }
      const valueType = attr.value ? this.typeOf(attr.value) : T.PRIM.any;
      attrValues.push({ name: attr.name, type: valueType, node: attr.value || node });
    }
    for (const child of node.children || []) this.typeOf(child);

    if (tagType.k !== 'fn') return T.PRIM.any;
    const param = tagType.params[0];
    const props = param ? T.deref(param.type) : null;
    if (!props || props.k !== 'record') return T.PRIM.any;

    const provided = new Set(attrValues.map((attr) => attr.name));
    if (node.children && node.children.length) provided.add('children');
    for (const attr of attrValues) {
      if (attr.name === 'key' || attr.name === 'ref') continue;
      const field = props.fields.get(attr.name);
      if (!field) {
        const known = [...props.fields.keys()].slice(0, 6).join(', ');
        this.report('PS3420', `Component <${node.tagName}> has no property "${attr.name}".`, attr.node,
          known ? `Declared properties: ${known}.` : null);
        continue;
      }
      if (attr.type && !T.isAny(attr.type) && !T.assignable(attr.type, field.type)) {
        this.report('PS3421', `Property "${attr.name}" of <${node.tagName}> expects ${T.showType(field.type)}, found ${T.showType(attr.type)}.`, attr.node);
      }
    }
    if (!hasSpread) {
      for (const [name, field] of props.fields) {
        if (field.optional || name === 'children') continue;
        if (!provided.has(name)) {
          this.report('PS3422', `Component <${node.tagName}> is missing required property "${name}".`, node);
        }
      }
    }
    return T.PRIM.any;
  }

  checkFragmentFactory(node) {
    if (this.jsx.runtime === 'automatic') return;
    const fragmentRoot = String(this.jsx.fragment || 'Fragment').split('.')[0];
    if (!this.lookup(fragmentRoot)) {
      this.report('PS3405', `A JSX fragment needs "${fragmentRoot}" in scope. Import Fragment from React or another JSX runtime.`, node);
    }
  }

  checkRender(node) {
    const factory = this.lookup('createElement');
    if (!factory) {
      this.report('PS3405', 'A render block needs "createElement" in scope. Import it from React or "std/dom".', node);
    }
    // Recursively check all statements in the render subtree so that returns,
    // throws, breaks, and continues nested inside loops or branches inside the
    // render block are caught and reported as PS3410 rather than silently
    // corrupting the generated child-list closure.
    this.checkRenderChildren(node.children);
  }

  // Walks the render subtree recursively, checking each statement and any
  // nested statements inside control-flow blocks (ForEach/ForRange/While/Conditional/Match).
  checkRenderChildren(statements) {
    for (const stmt of statements) {
      if (stmt.kind === 'Return' || stmt.kind === 'Throw' || stmt.kind === 'Break' || stmt.kind === 'Continue') {
        this.report('PS3410', `A "${stmt.kind.toLowerCase()}" statement cannot appear inside a render block.`, stmt);
        continue;
      }
      if (stmt.kind === 'Render') {
        this.checkRenderChildren(stmt.children);
        continue;
      }
      if (stmt.kind === 'ForEach' || stmt.kind === 'ForRange' || stmt.kind === 'While') {
        this.checkRenderChildren(stmt.body);
        continue;
      }
      if (stmt.kind === 'Conditional') {
        // stmt.branches is an array of {condition, body};
        // stmt.otherwise is the body of the otherwise branch.
        for (const branch of stmt.branches) {
          this.checkRenderChildren(branch.body);
        }
        if (stmt.otherwise) {
          this.checkRenderChildren(stmt.otherwise);
        }
        continue;
      }
      if (stmt.kind === 'Match') {
        // stmt.cases is an array of {pattern, guard, body}.
        for (const branch of stmt.cases) {
          this.checkRenderChildren(branch.body);
        }
        continue;
      }
      // For any other statement type, recurse into its checked children.
      this.checkStatement(stmt);
    }
  }

  // ------------------------------------------------------------- expressions

  typeOf(node, expected) {
    if (!node) return T.PRIM.nothing;
    switch (node.kind) {
      case 'Number': return this.primitiveOrLiteral(T.PRIM.number, node.value, expected);
      case 'BigInt': return T.PRIM.bigint;
      case 'Regex': {
        // The lexer validates the pattern and flags; a literal that reached the
        // checker is a usable RegExp value.
        return T.PRIM.regex;
      }
      case 'JSXText': return T.PRIM.text;
      case 'JSXSpreadChild': return this.typeOf(node.value);
      case 'JSXFragment':
        this.checkFragmentFactory(node);
        for (const child of node.children) this.typeOf(child);
        return T.PRIM.any;
      case 'JSXElement': return this.checkJSXElement(node);
      case 'Text': return this.primitiveOrLiteral(T.PRIM.text, node.value, expected);
      case 'Boolean': return this.primitiveOrLiteral(T.PRIM.boolean, node.value, expected);
      case 'Nothing': return T.PRIM.nothing;
      case 'This': {
        const type = this.thisStack[this.thisStack.length - 1];
        if (!type) {
          this.report('PS3510', '"this" can only be used inside class methods, constructors and field initializers.', node);
          return T.PRIM.error;
        }
        return type;
      }
      case 'Super': {
        const type = this.thisStack[this.thisStack.length - 1];
        const info = this.classStack.length ? this.classes.get(this.classStack[this.classStack.length - 1]) : null;
        if (!type || !info || !info.parentInfo) {
          this.report('PS3511', '"super" can only be used in a class that extends another class.', node);
          return T.PRIM.error;
        }
        return info.parentInfo.instance;
      }
      case 'Yield': {
        const frame = this.functionStack[this.functionStack.length - 1];
        if (!frame || !frame.generator) {
          this.report('PS3528', '"yield" can only be used inside a generator function.', node);
          return T.PRIM.nothing;
        }
        const valueType = this.typeOf(node.value);
        node.value.__type = valueType;
        frame.yieldTypes.push(valueType);
        if (frame.yieldType && !T.assignable(valueType, frame.yieldType) && !T.isAny(valueType)) {
          this.report('PS3529', `This generator yields ${T.showType(frame.yieldType)}, but the value is ${T.showType(valueType)}.`, node);
        }
        return T.PRIM.nothing;
      }
      case 'TypeOf': {
        this.typeOf(node.value);
        return T.PRIM.text;
      }
      case 'Ternary': {
        const conditionType = this.typeOf(node.condition);
        if (!T.assignable(conditionType, T.PRIM.boolean) && !T.isAny(conditionType)) {
          this.report('PS3318', `A condition must be boolean, found ${T.showType(conditionType)}.`, node.condition);
        }
        const whenTrue = this.typeOf(node.whenTrue, expected);
        const whenFalse = this.typeOf(node.whenFalse, expected);
        return T.union([whenTrue, whenFalse]);
      }
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
        let dynamic = null;
        const expectedResolved = expected ? T.deref(expected) : null;
        const expectedRecord = expectedResolved && expectedResolved.k === 'record' ? expectedResolved : null;
        const expectedRecords = expectedResolved && expectedResolved.k === 'union'
          ? expectedResolved.members.map((member) => T.deref(member)).filter((member) => member.k === 'record')
          : [];
        for (const field of node.fields) {
          if (field.spread) {
            const spreadType = T.deref(this.typeOf(field.spread));
            if (spreadType.k === 'record' || spreadType.k === 'instance') {
              for (const [key, value] of spreadType.fields) fields.set(key, value);
            } else if (!T.isAny(spreadType)) {
              this.report('PS3326', `Only a record can be spread into a record, found ${T.showType(spreadType)}.`, field.spread);
            }
            continue;
          }
          if (field.computed) {
            const keyType = T.deref(this.typeOf(field.computed));
            const valueType = this.typeOf(field.value);
            const literal = literalValueOf(field.computed);
            if (literal && (typeof literal.value === 'string' || typeof literal.value === 'number')) {
              fields.set(String(literal.value), { type: valueType, optional: false });
            } else if (keyType.k === 'prim' && (keyType.name === 'text' || keyType.name === 'number')) {
              dynamic = dynamic ? T.union([dynamic, valueType]) : valueType;
            } else if (!T.isAny(keyType)) {
              this.report('PS3535', `A computed key must be text or a number, found ${T.showType(keyType)}.`, field.computed);
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
        if (dynamic) {
          // A dynamic key makes the set of fields unknown, so the value is a
          // text-keyed map. Literal computed keys stay ordinary record fields.
          return T.mapOf(T.PRIM.text, dynamic);
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
      case 'New': return this.newType(node);
      case 'Unary': {
        const operandType = this.typeOf(node.operand);
        if (node.operator === 'not') {
          if (!T.assignable(operandType, T.PRIM.boolean) && !T.isAny(operandType)) {
            this.report('PS3328', `"not" needs a boolean, found ${T.showType(operandType)}.`, node);
          }
          return T.PRIM.boolean;
        }
        const numeric = T.deref(operandType);
        const bigint = numeric.k === 'prim' && numeric.name === 'bigint';
        if (!bigint && !T.assignable(operandType, T.PRIM.number) && !T.isAny(operandType)) {
          this.report('PS3329', `Unary "-" needs a number or bigint, found ${T.showType(operandType)}.`, node);
        }
        return bigint ? T.PRIM.bigint : T.PRIM.number;
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
    // The 2.1 declaration words are contextual, so a 2.1 program without its
    // pragma parses them as ordinary names and fails here first. Point at the
    // pragma instead of at a typo, which is what a diff-distance suggestion
    // would look like.
    if (CONTEXTUAL_WORDS.includes(name) && !this.hasSyntaxPragma()) {
      return 'This looks like PlainScript 2.1 code. Add "#syntax 2.1" as the first line of the file, or set "syntax": "2.1" in plainscript.config.json.';
    }
    const candidate = closest(name, [...this.scope.visibleNames(), ...this.variantCtors.keys()]);
    return candidate ? `Did you mean "${candidate}"?` : null;
  }

  hasSyntaxPragma() {
    return PRAGMA.test(String(this.source).split('\n', 1)[0]);
  }

  memberType(node, forAssignment) {
    let objectType = T.deref(this.typeOf(node.object));
    if (objectType.k === 'var' && objectType.constraint) objectType = T.deref(objectType.constraint);
    if (T.isAny(objectType)) return T.PRIM.any;
    if (objectType.k === 'class') {
      const field = objectType.statics.get(node.property);
      if (!field) {
        this.report('PS3532', `Class "${objectType.name}" has no static member "${node.property}".`, node);
        return T.PRIM.error;
      }
      if (forAssignment && field.readonly) {
        this.report('PS3319', `Static member "${node.property}" is readonly and cannot be assigned.`, node);
        return field.type;
      }
      return field.type;
    }
    if (objectType.k === 'iterator') {
      if (node.property === 'next') {
        const result = T.record(new Map([
          ['value', { type: T.union([objectType.elem, T.PRIM.nothing]), optional: false }],
          ['done', { type: T.PRIM.boolean, optional: false }],
        ]));
        return T.fnType([], result);
      }
      if (node.property === 'return' || node.property === 'throw') {
        return T.fnType([{ name: 'value', type: T.PRIM.any, optional: true }], T.PRIM.any);
      }
      this.report('PS3533', `An iterator exposes next, return and throw; there is no field "${node.property}".`, node);
      return T.PRIM.error;
    }
    if (objectType.k === 'prim' && objectType.name === 'bigint') {
      if (node.property === 'toString') {
        return T.fnType([{ name: 'radix', type: T.PRIM.number, optional: true }], T.PRIM.text);
      }
      if (node.property === 'valueOf') return T.fnType([], T.PRIM.bigint);
      this.report('PS3534', `BigInt exposes toString and valueOf; there is no field "${node.property}".`, node);
      return T.PRIM.error;
    }
    if (objectType.k === 'record' || objectType.k === 'instance') {
      const field = objectType.fields.get(node.property);
      if (!field) {
        this.report('PS3333', `Type ${T.showType(objectType)} has no field "${node.property}".`, node);
        return T.PRIM.error;
      }
      if (forAssignment && field.readonly
        && !(this.constructorDepth > 0 && node.object.kind === 'This')) {
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
        if (resolved.k === 'record' || resolved.k === 'instance' || resolved.k === 'variant') {
          const field = resolved.k === 'variant'
            ? resolved.fields.find((item) => item.name === node.property)
            : resolved.fields.get(node.property);
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
    if (objectType.k === 'prim' && objectType.name === 'regex') {
      // A regex value exposes the parts of the JavaScript RegExp surface that
      // are useful without leaking array-shaped match objects into the type
      // system. Captures are read with std/text helpers, which return records.
      const fields = {
        source: T.PRIM.text,
        flags: T.PRIM.text,
        global: T.PRIM.boolean,
        ignoreCase: T.PRIM.boolean,
        multiline: T.PRIM.boolean,
        sticky: T.PRIM.boolean,
        unicode: T.PRIM.boolean,
        dotAll: T.PRIM.boolean,
        lastIndex: T.PRIM.number,
      };
      if (Object.prototype.hasOwnProperty.call(fields, node.property)) return fields[node.property];
      if (node.property === 'test') {
        return T.fnType([{ name: 'text', type: T.PRIM.text }], T.PRIM.boolean);
      }
      if (node.property === 'toString') {
        return T.fnType([], T.PRIM.text);
      }
      this.report('PS3335', `A regex has no field "${node.property}"; use test() or the helpers in "std/text".`, node);
      return T.PRIM.error;
    }
    if (objectType.k === 'promise') {
      // Promises cross the JavaScript boundary, but their three standard
      // combinator methods have a precise shape. Typing them means rejection
      // handlers are checked while the resolved value stays known.
      const value = objectType.value;
      const anyFn = (params) => T.fnType(params, T.PRIM.any);
      if (node.property === 'then') {
        return T.fnType([
          { name: 'onFulfilled', type: anyFn([{ name: 'value', type: value }]), optional: true },
          { name: 'onRejected', type: anyFn([{ name: 'reason', type: T.PRIM.any }]), optional: true },
        ], T.promiseOf(T.PRIM.any));
      }
      if (node.property === 'catch') {
        return T.fnType([
          { name: 'onRejected', type: T.fnType([{ name: 'reason', type: T.PRIM.any }], T.union([value, T.promiseOf(value)])) },
        ], T.promiseOf(value));
      }
      if (node.property === 'finally') {
        return T.fnType([
          { name: 'onFinally', type: anyFn([]) },
        ], T.promiseOf(value));
      }
      this.report('PS3335', `Type ${T.showType(objectType)} has no field "${node.property}"; a Promise exposes then, catch and finally.`, node);
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

  currentClassInfo() {
    return this.classStack.length ? this.classes.get(this.classStack[this.classStack.length - 1]) : null;
  }

  // Shared argument checking for constructors and super calls, which are not
  // ordinary function calls: their result is an instance, and a generic class
  // infers its type arguments from constructor parameters.
  checkArgumentsDirect(fn, args, node, label) {
    const subst = new Map();
    if (!fn || fn.k !== 'fn') {
      for (const argument of args) this.typeOf(argument);
      return subst;
    }
    const required = fn.params.filter((parameter) => !parameter.optional && !parameter.rest).length;
    const hasRest = fn.params.some((parameter) => parameter.rest);
    if (args.length < required) {
      this.report('PS3538', `${label} expects at least ${required} argument(s) but got ${args.length}.`, node);
    }
    if (!hasRest && args.length > fn.params.length) {
      this.report('PS3538', `${label} expects at most ${fn.params.length} argument(s) but got ${args.length}.`, node);
    }
    args.forEach((argument, index) => {
      const parameter = fn.params[index] || fn.params[fn.params.length - 1];
      if (argument.kind === 'Spread') {
        this.typeOf(argument.value);
        return;
      }
      if (!parameter) {
        this.typeOf(argument);
        return;
      }
      const expected = parameter.rest ? elementTypeOf(parameter.type) : parameter.type;
      const argumentType = this.typeOf(argument, T.substitute(expected, subst));
      T.infer(expected, argumentType, subst);
      const resolvedExpected = T.substitute(expected, subst);
      if (!T.assignable(argumentType, resolvedExpected)) {
        this.report(
          'PS3539',
          `Argument ${index + 1} of ${label} is ${T.showType(argumentType)}; expected ${T.showType(resolvedExpected)}.`,
          argument,
        );
      }
    });
    return subst;
  }

  newType(node) {
    const call = node.callee.kind === 'Call' ? node.callee : null;
    const target = call ? call.callee : node.callee;
    const args = call ? call.args : [];

    let classType = null;
    if (target.kind === 'Name') {
      const entry = this.lookup(target.name);
      if (entry && entry.kind === 'class') classType = T.deref(entry.type);
    }
    if (!classType) {
      const targetType = T.deref(this.typeOf(target));
      if (targetType.k === 'class') classType = targetType;
    }
    if (!classType) {
      // A constructor that crosses the JavaScript boundary has no PlainScript
      // class type. Its value stays `any`, exactly as before 2.3, but a
      // declared class constructor is now fully checked.
      if (!call) this.typeOf(node.callee);
      return T.PRIM.any;
    }

    const subst = this.checkArgumentsDirect(classType.ctor, args, node, `the constructor of "${classType.name}"`);
    if (!classType.typeParams || !classType.typeParams.length) return classType.instance;
    const instance = T.substitute(classType.instance, subst);
    return T.deref(instance);
  }

  callType(node, expected) {
    if (node.callee.kind === 'Super') {
      const info = this.currentClassInfo();
      if (!info || !info.parentInfo) {
        this.report('PS3511', '"super(...)" is only valid in a class that extends another class.', node);
        for (const argument of node.args) this.typeOf(argument);
        return T.PRIM.any;
      }
      if (this.constructorDepth === 0) {
        this.report('PS3540', '"super(...)" is only valid inside a constructor.', node);
      }
      this.checkArgumentsDirect(info.parentInfo.ctor, node.args, node, `the constructor of "${info.parentInfo.name}"`);
      return T.PRIM.nothing;
    }
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
        const bigint = (value) => value.k === 'prim' && value.name === 'bigint';
        const leftBig = bigint(leftResolved);
        const rightBig = bigint(rightResolved);
        if (leftBig || rightBig) {
          if (leftBig && rightBig) {
            // Mixing a bigint and a number would throw at run time; the checker
            // refuses it at compile time instead of guessing a conversion.
            if (node.operator === '/' ) return T.PRIM.bigint;
            return T.PRIM.bigint;
          }
          this.report(
            'PS3536',
            `Arithmetic "${node.operator}" cannot mix bigint and number; convert one side explicitly.`,
            node,
          );
          return T.PRIM.error;
        }
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
        if (isBigIntOf(leftResolved) || isBigIntOf(rightResolved)) {
          const other = isBigIntOf(leftResolved) ? rightResolved : leftResolved;
          if (!isBigIntOf(other) && !(other.k === 'prim' && other.name === 'number')) {
            this.report('PS3537', `Cannot compare a bigint with ${T.showType(other)}.`, node);
          }
          return T.PRIM.boolean;
        }
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
          (T.assignable(left, T.PRIM.text) && T.assignable(right, T.PRIM.text)) ||
          ((isBigIntOf(leftResolved) || isBigIntOf(rightResolved))
            && (isBigIntOf(leftResolved) || leftResolved.k === 'prim')
            && (isBigIntOf(rightResolved) || rightResolved.k === 'prim'));
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

function inspectYields(statements) {
  const types = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      if (!node) continue;
      if (node.kind === 'Yield') {
        types.push(node.value && node.value.kind !== 'Nothing' ? (node.value.__type || T.PRIM.any) : T.PRIM.nothing);
      } else if (node.kind === 'Conditional') {
        for (const branch of node.branches) walk(branch.body);
        if (node.otherwise) walk(node.otherwise);
      } else if (node.kind === 'Try') {
        walk(node.body);
        if (node.handler) walk(node.handler);
        if (node.finalizer) walk(node.finalizer);
      } else if (node.kind === 'Match') {
        for (const branch of node.cases) walk(branch.body);
      } else if (node.kind === 'ForEach' || node.kind === 'ForRange' || node.kind === 'While') {
        walk(node.body);
      } else if (node.kind === 'FunctionDecl' || node.kind === 'FunctionExpression') {
        // Nested generators own their yields.
      } else if (node.kind === 'ExprStmt') {
        if (node.expression && node.expression.kind === 'Yield') {
          types.push(node.expression.value && node.expression.value.kind !== 'Nothing'
            ? (node.expression.value.__type || T.PRIM.any) : T.PRIM.nothing);
        }
      }
    }
  };
  walk(statements);
  return { types };
}

function isBigIntOf(type) {
  return Boolean(type) && type.k === 'prim' && type.name === 'bigint';
}

function alwaysReturns(statements) {
  if (!statements || statements.length === 0) return false;
  // Ordinary statements do not prevent a later return from being reached; a
  // terminator anywhere in the straight-line sequence guarantees the function
  // cannot finish normally. Statements after it are unreachable.
  for (const node of statements) {
    if (node.kind === 'Return' || node.kind === 'Throw' || node.kind === 'Render') return true;
    if (node.kind === 'Conditional') {
      if (!node.otherwise) continue;
      if (node.branches.every((branch) => alwaysReturns(branch.body)) && alwaysReturns(node.otherwise)) return true;
      continue;
    }
    if (node.kind === 'Match') {
      if (node.cases.every((branch) => alwaysReturns(branch.body))) return true;
      continue;
    }
    if (node.kind === 'Try') {
      const bodyReturns = alwaysReturns(node.body);
      const handlerReturns = node.handler ? alwaysReturns(node.handler) : false;
      if (bodyReturns && (!node.handler || handlerReturns)) return true;
      continue;
    }
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
  if (node.kind === 'BigInt') return { value: node.value, type: T.PRIM.bigint };
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
