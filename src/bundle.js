'use strict';

// A dependency-free bundler for PlainScript programs. It concatenates the
// module graph into one ES module using scoped module wrappers. Imports become
// property reads from the dependency's namespace, so the generated file has no
// runtime dependency on the PlainScript compiler. Package and standard-library
// imports stay external and are emitted as namespace imports (`import * as`).
//
// Exported `let` bindings are rejected: ESM imports are live bindings, and a
// namespace copy would silently freeze them. Exported consts, classes and
// functions bundle without changing observable behaviour.

const fs = require('fs');
const path = require('path');
const { Compiler, isFile } = require('./modules');
const { jsName } = require('./hir');
const { error, Span } = require('./diagnostics');

function bundleDiagnostic(message, file = '<bundle>') {
  return error('PS4010', message, new Span(file, 1, 1));
}

function posix(value) {
  return value.split(path.sep).join('/');
}

function patternNames(pattern, names = []) {
  if (!pattern) return names;
  if (pattern.kind === 'Name' || pattern.kind === 'NamePattern') names.push(pattern.name);
  else if (pattern.kind === 'ArrayPattern' || pattern.kind === 'TuplePattern') {
    for (const item of pattern.items) patternNames(item, names);
  } else if (pattern.kind === 'ObjectPattern' || pattern.kind === 'RecordPattern') {
    for (const field of pattern.fields) patternNames(field.target || field.value, names);
  }
  return names;
}

// Collect the exports a module's HIR declares without re-parsing the source.
function moduleExports(hir) {
  const exports = [];
  const mutable = new Set();
  for (const statement of hir.body) {
    if (statement.kind === 'VarDecl') {
      const names = patternNames(statement.pattern);
      if (statement.declKind !== 'const') for (const name of names) mutable.add(name);
      if (statement.exported) for (const name of names) exports.push({ exported: name, local: name });
    } else if (statement.kind === 'FunctionDecl') {
      if (statement.exported && statement.name) exports.push({ exported: statement.name, local: statement.name });
      if (statement.defaultExport) exports.push({ exported: 'default', local: '__bundle_default' });
    } else if (statement.kind === 'ClassDecl') {
      if (statement.exported) exports.push({ exported: statement.name, local: statement.name });
    } else if (statement.kind === 'ExportNamed' || statement.kind === 'ReExport') {
      for (const name of statement.names) exports.push({ exported: name.exported, local: name.local });
    } else if (statement.kind === 'ExportDefault') {
      exports.push({ exported: 'default', local: '__bundle_default' });
    }
  }
  return { exports, mutable };
}

function externalSpecifier(spec, resolved, record, outFile) {
  if (resolved.kind === 'std') return `plainscript-lang/std/${resolved.name}`;
  if (resolved.kind === 'declared' || resolved.kind === 'untyped') {
    if (!spec.startsWith('.')) return spec;
    const relative = path.relative(path.dirname(outFile), resolved.runtime || resolved.path);
    const normalized = posix(relative);
    return normalized.startsWith('.') ? normalized : `./${normalized}`;
  }
  return spec;
}

function createBundler(options = {}) {
  const compiler = new Compiler(options);
  const diagnostics = [];

  function load(file) {
    const record = compiler.load(file);
    return record;
  }

  // Depth-first post-order keeps dependencies before their importers, which is
  // also the ESM evaluation order.
  function order(entry) {
    const visited = new Set();
    const visiting = new Set();
    const ordered = [];
    const visit = (file) => {
      if (visited.has(file)) return;
      if (visiting.has(file)) return; // cycles are rejected by the checker
      visiting.add(file);
      const record = load(file);
      for (const resolved of record.resolutions.values()) {
        if (resolved.kind !== 'local' || !isFile(resolved.path)) continue;
        visit(resolved.path);
      }
      visiting.delete(file);
      visited.add(file);
      if (!record.declarationOnly) ordered.push(file);
    };
    visit(path.resolve(entry));
    return ordered;
  }

  function bundle(entry, outFile) {
    entry = path.resolve(entry);
    if (!isFile(entry)) throw new Error(`No such file: ${entry}`);
    const files = order(entry);
    if (!files.includes(entry)) {
      diagnostics.push(bundleDiagnostic('The bundle entry is a declaration file and has no JavaScript output.', entry));
      return { ok: false, diagnostics };
    }

    const ids = new Map(files.map((file, index) => [file, `__m${index}`]));
    const external = new Map();
    const externalLines = [];
    const wrappers = [];

    for (const file of files) {
      const record = load(file);
      const result = compiler.compile(file, { outFile: file.replace(/\.pln$/, '.js'), bundle: true });
      if (!result.ok) {
        diagnostics.push(...compiler.diagnostics);
        return { ok: false, diagnostics };
      }
      const hir = record.hir;
      const bindings = [];
      const bound = new Set();

      const targetFor = (spec) => {
        const resolved = record.resolutions.get(spec);
        if (!resolved) return null;
        if (resolved.kind === 'local' && ids.has(resolved.path)) {
          return { expression: ids.get(resolved.path), resolved };
        }
        const specifier = externalSpecifier(spec, resolved, record, outFile);
        let alias = external.get(specifier);
        if (!alias) {
          alias = `__ext${external.size}`;
          external.set(specifier, alias);
          externalLines.push(`import * as ${alias} from ${JSON.stringify(specifier)};`);
        }
        return { expression: alias, resolved };
      };

      const addBinding = (text) => {
        if (bound.has(text)) return;
        bound.add(text);
        bindings.push(text);
      };

      for (const statement of hir.body) {
        if (statement.kind === 'Import') {
          const target = targetFor(statement.spec);
          if (!target) continue;
          if (statement.defaultName) {
            addBinding(`const ${jsName(statement.defaultName)} = ${target.expression}.default;`);
          }
          if (statement.namespace) {
            addBinding(`const ${jsName(statement.namespace)} = ${target.expression};`);
          }
          for (const name of statement.names) {
            addBinding(`const ${jsName(name.local)} = ${target.expression}[${JSON.stringify(name.imported)}];`);
          }
        } else if (statement.kind === 'ReExport') {
          const target = targetFor(statement.spec);
          if (!target) continue;
          for (const name of statement.names) {
            addBinding(`const ${jsName(name.local)} = ${target.expression}[${JSON.stringify(name.local)}];`);
          }
        }
      }

      const { exports: declared, mutable } = moduleExports(hir);
      for (const exported of declared) {
        if (mutable.has(exported.local) && exported.local !== 'default') {
          diagnostics.push(bundleDiagnostic(
            `"${exported.local}" is exported with let, but a bundle cannot preserve ESM live bindings. Export it with const or build with plainscript build.`,
            file,
          ));
          return { ok: false, diagnostics };
        }
      }

      const namespace = declared.map((item) => `${JSON.stringify(item.exported)}: ${jsName(item.local)}`).join(', ');
      const body = result.code.replace(/\n$/, '');
      const parts = [];
      parts.push(`const ${ids.get(file)} = (() => {`);
      if (bindings.length) parts.push(...bindings.map((line) => `    ${line}`));
      parts.push(...body.split('\n').map((line) => (line ? `    ${line}` : '')));
      parts.push(`    return { ${namespace} };`);
      parts.push('})();');
      wrappers.push(parts.join('\n'));
    }

    const entryId = ids.get(entry);
    const entryRecord = compiler.modules.get(entry);
    const entryExports = moduleExports(entryRecord.hir).exports;
    const footer = [];
    if (entryExports.length) {
      footer.push(`const __entry = ${entryId};`);
      entryExports.forEach((item, index) => {
        const local = `__bundle_export_${index}`;
        footer.push(`const ${local} = __entry[${JSON.stringify(item.exported)}];`);
        footer.push(`export { ${local} as ${item.exported === 'default' ? 'default' : jsName(item.exported)} };`);
      });
    }

    const header = [
      `// Bundled by PlainScript ${require('./version').VERSION} from ${posix(path.relative(process.cwd(), entry))}.`,
      '// External package and standard-library imports are preserved as ES imports.',
    ];
    const code = [...header, ...externalLines, ...(externalLines.length ? [''] : []), ...wrappers, ...(footer.length ? ['', ...footer] : []), ''].join('\n');
    return { ok: true, code, diagnostics, files, external: [...external.keys()] };
  }

  return { compiler, bundle, diagnostics };
}

module.exports = { createBundler };
