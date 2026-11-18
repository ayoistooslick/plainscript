#!/usr/bin/env node
'use strict';

// PlainScript language server.
//
// The server is dependency-free: it speaks Content-Length framed JSON-RPC over
// stdio and uses the same Compiler/checker as the CLI. It supports diagnostics,
// completion, hover, go-to-definition, references, rename (document-scoped),
// document symbols and whole-document formatting.

const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const { Compiler } = require('./modules');
const { tokenize } = require('./lexer');
const { format } = require('./formatter');
const T = require('./types');
const { VERSION } = require('./version');

const KEYWORDS = [
  'import', 'export', 'from', 'as', 'type', 'declare', 'function', 'async',
  'await', 'let', 'const', 'if', 'else', 'for', 'while', 'match', 'case',
  'try', 'catch', 'finally', 'throw', 'return', 'break', 'continue', 'render',
  'element', 'and', 'or', 'not', 'is', 'new', 'nothing', 'true', 'false',
];

class PlainScriptLanguageServer {
  constructor(input = process.stdin, output = process.stdout, root = process.cwd()) {
    this.input = input;
    this.output = output;
    this.root = path.resolve(root || process.cwd());
    this.documents = new Map();
    this.shutdown = false;
    this.buffer = Buffer.alloc(0);
    this.lastCompiler = null;
    this.lastRecord = null;
    this.diagnosticsByFile = new Map();
    this.input.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.readMessages();
    });
    this.input.on('end', () => process.exit(0));
  }

  start() {
    // Reading starts in the constructor; this method exists for embedders.
    return this;
  }

  readMessages() {
    while (true) {
      const separator = this.buffer.indexOf('\r\n\r\n');
      if (separator < 0) return;
      const header = this.buffer.slice(0, separator).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.slice(separator + 4);
        continue;
      }
      const length = Number(match[1]);
      if (this.buffer.length < separator + 4 + length) return;
      const body = this.buffer.slice(separator + 4, separator + 4 + length).toString('utf8');
      this.buffer = this.buffer.slice(separator + 4 + length);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      this.handleMessage(message);
    }
  }

  send(message) {
    const body = JSON.stringify(message);
    this.output.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
  }

  respond(id, result) {
    this.send({ jsonrpc: '2.0', id, result });
  }

  fail(id, code, message) {
    this.send({ jsonrpc: '2.0', id, error: { code, message } });
  }

  handleMessage(message) {
    if (message.method) {
      if (message.method === 'initialize') {
        if (message.params && message.params.rootUri) {
          try { this.root = path.resolve(fileURLToPath(message.params.rootUri)); } catch { /* keep cwd */ }
        }
        this.respond(message.id, {
          capabilities: {
            textDocumentSync: 1,
            completionProvider: { triggerCharacters: ['.'] },
            hoverProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            renameProvider: true,
            documentSymbolProvider: true,
            documentFormattingProvider: true,
          },
          serverInfo: { name: 'plainscript-lsp', version: VERSION },
        });
        return;
      }
      if (message.method === 'initialized' || message.method === 'workspace/didChangeConfiguration') return;
      if (message.method === 'shutdown') {
        this.shutdown = true;
        this.respond(message.id, null);
        return;
      }
      if (message.method === 'exit') {
        process.exit(this.shutdown ? 0 : 1);
      }
      if (message.method === 'textDocument/didOpen') {
        const document = message.params.textDocument;
        this.documents.set(document.uri, document.text);
        this.validate(document.uri);
        return;
      }
      if (message.method === 'textDocument/didChange') {
        const uri = message.params.textDocument.uri;
        const changes = message.params.contentChanges || [];
        if (changes.length) this.documents.set(uri, changes[changes.length - 1].text);
        this.validate(uri);
        return;
      }
      if (message.method === 'textDocument/didClose') {
        const uri = message.params.textDocument.uri;
        this.documents.delete(uri);
        this.publish(uri, []);
        return;
      }
      if (message.method === 'textDocument/completion') {
        this.respond(message.id, this.completions(this.uriOf(message)));
        return;
      }
      if (message.method === 'textDocument/hover') {
        this.respond(message.id, this.hover(message.params));
        return;
      }
      if (message.method === 'textDocument/definition') {
        this.respond(message.id, this.definition(message.params));
        return;
      }
      if (message.method === 'textDocument/references') {
        this.respond(message.id, this.references(message.params));
        return;
      }
      if (message.method === 'textDocument/rename') {
        this.respond(message.id, this.rename(message.params));
        return;
      }
      if (message.method === 'textDocument/documentSymbol') {
        this.respond(message.id, this.symbols(this.uriOf(message)));
        return;
      }
      if (message.method === 'textDocument/formatting') {
        this.respond(message.id, this.formatting(this.uriOf(message), message.params.options || {}));
        return;
      }
      if (message.id !== undefined) this.fail(message.id, -32601, `Unsupported method ${message.method}`);
      return;
    }
    if (message.id !== undefined) this.fail(message.id, -32600, 'Invalid request');
  }

  uriOf(message) {
    return message.params && message.params.textDocument ? message.params.textDocument.uri : null;
  }

  documentPath(uri) {
    try { return path.resolve(fileURLToPath(uri)); } catch { return null; }
  }

  documentText(uri) {
    return this.documents.get(uri) || '';
  }

  overrides() {
    const map = new Map();
    for (const [uri, text] of this.documents) {
      const file = this.documentPath(uri);
      if (file) map.set(file, text);
    }
    return map;
  }

  validate(uri) {
    const file = this.documentPath(uri);
    if (!file) return;
    const compiler = new Compiler({ root: this.root, overrides: this.overrides() });
    let record;
    try {
      record = compiler.load(file);
    } catch (failure) {
      this.publish(uri, [{
        range: rangeFrom({ line: 1, col: 1 }, 1),
        severity: 1,
        code: 'PS5000',
        source: 'plainscript',
        message: failure.message,
      }]);
      return;
    }
    this.lastCompiler = compiler;
    this.lastRecord = record;
    const groups = new Map();
    for (const diagnostic of compiler.diagnostics) {
      const diagnosticFile = this.absoluteDiagnosticFile(diagnostic);
      if (!groups.has(diagnosticFile)) groups.set(diagnosticFile, []);
      groups.get(diagnosticFile).push(protocolDiagnostic(diagnostic));
    }
    if (!groups.has(file)) groups.set(file, []);
    for (const [diagnosticFile, diagnostics] of groups) {
      this.publish(pathToFileURL(diagnosticFile).toString(), diagnostics);
    }
  }

  absoluteDiagnosticFile(diagnostic) {
    const file = diagnostic.span && diagnostic.span.file ? diagnostic.span.file : '<input>';
    return path.isAbsolute(file) ? file : path.resolve(this.root, file);
  }

  publish(uri, diagnostics) {
    this.diagnosticsByFile.set(uri, diagnostics);
    this.send({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri, diagnostics },
    });
  }

  compilerFor(uri) {
    if (!this.lastCompiler) this.validate(uri);
    return this.lastCompiler;
  }

  recordFor(uri) {
    const compiler = this.compilerFor(uri);
    const file = this.documentPath(uri);
    return compiler && file ? compiler.modules.get(file) || null : null;
  }

  sourceFor(uri, record) {
    return this.documents.get(uri) || (record && record.source) || '';
  }

  tokenAt(uri, position) {
    const record = this.recordFor(uri);
    const source = this.sourceFor(uri, record);
    const result = tokenize(source, this.documentPath(uri) || '<editor>');
    return (result.tokens || []).find((token) => {
      if (token.line !== position.line + 1 || token.t === 'eof') return false;
      const start = token.col - 1;
      const end = start + Math.max(1, String(token.v || '').length);
      return position.character >= start && position.character <= end;
    }) || null;
  }

  candidateAt(uri, position) {
    const record = this.recordFor(uri);
    if (!record || !record.ast) return null;
    const token = this.tokenAt(uri, position);
    if (!token || token.t !== 'ident') return null;
    const nodes = collectCandidates(record.ast);
    const line = token.line;
    const col = token.col;
    const exact = nodes.find((node) => node.line === line && node.col === col && node.name === token.v);
    if (exact) {
      if (exact.kind === 'ImportName' && record.check) {
        exact.symbol = record.check.checker.global.names.get(exact.name) || null;
        if (exact.symbol) exact.type = exact.symbol.type;
      }
      return exact;
    }
    // A declaration's `nameLine` is enough; exact token matching protects
    // against a same-named identifier elsewhere on the line.
    return nodes.find((node) => node.line === line && node.col === col) || null;
  }

  nodeInfo(uri, candidate) {
    const record = this.recordFor(uri);
    const checker = record && record.check ? record.check.checker : null;
    if (!candidate) return null;
    if (candidate.symbol) {
      return {
        name: candidate.name,
        type: candidate.symbol.type || candidate.type,
        symbol: candidate.symbol,
        kind: candidate.symbol.kind || 'value',
        typeDecl: null,
      };
    }
    if (candidate.typeDecl) {
      return {
        name: candidate.name,
        type: candidate.typeDecl.__type || candidate.type,
        symbol: null,
        kind: 'type',
        typeDecl: candidate.typeDecl,
        checker,
      };
    }
    if (candidate.type) {
      return { name: candidate.name, type: candidate.type, symbol: null, kind: 'type', typeDecl: null };
    }
    return null;
  }

  completions(uri) {
    if (!uri) return [];
    if (!this.lastCompiler || !this.lastRecord) this.validate(uri);
    const record = this.recordFor(uri);
    const source = this.sourceFor(uri, record);
    const items = new Map();
    for (const keyword of KEYWORDS) items.set(keyword, { label: keyword, kind: 14 });
    for (const [name, entry] of this.globalNames(record)) {
      const kind = entry.kind === 'function' ? 3 : (entry.kind === 'type' ? 7 : 6);
      items.set(name, { label: name, kind, detail: entry.type ? T.showType(entry.type) : undefined });
    }
    const result = tokenize(source, this.documentPath(uri) || '<editor>');
    const ast = record && record.ast;
    if (ast) {
      for (const candidate of collectCandidates(ast)) {
        if (!candidate.name) continue;
        if (!items.has(candidate.name)) {
          items.set(candidate.name, {
            label: candidate.name,
            kind: candidate.kind === 'FunctionDecl' ? 3 : candidate.kind === 'TypeDecl' ? 7 : 6,
            detail: candidate.type ? T.showType(candidate.type) : undefined,
          });
        }
      }
    }
    for (const standard of this.standardNames()) {
      if (!items.has(standard)) items.set(standard, { label: standard, kind: 6, detail: 'standard library export' });
    }
    void result;
    return [...items.values()];
  }

  globalNames(record) {
    const names = new Map();
    if (!record || !record.check) return names;
    const checker = record.check.checker;
    const aliases = new Map();
    for (const [exported, local] of checker.exports) aliases.set(local, exported);
    for (const [name, entry] of checker.global.names) {
      names.set(aliases.get(name) || name, entry);
    }
    for (const [name, declaration] of checker.typeDecls) {
      if (declaration.importedType) names.set(name, { kind: 'type', type: declaration.importedType });
    }
    return names;
  }

  standardNames() {
    if (!this.lastCompiler) return [];
    const names = [];
    for (const [, exports] of this.lastCompiler.stdModules) {
      for (const name of exports.values.keys()) names.push(name);
      for (const name of exports.types.keys()) names.push(name);
    }
    return [...new Set(names)];
  }

  hover(params) {
    const uri = params.textDocument.uri;
    const candidate = this.candidateAt(uri, params.position);
    if (!candidate) return null;
    const info = this.nodeInfo(uri, candidate);
    if (!info) return null;
    let value = `\`${info.name}\``;
    if (info.type) value += `: \`${T.showType(info.type)}\``;
    if (info.kind) value += `\n\n_${info.kind}_`;
    if (info.typeDecl && info.typeDecl.importedType) value += `\n\nImported from \`${info.typeDecl.importSpec}\``;
    return {
      contents: { kind: 'markdown', value },
      range: tokenRange(candidate.line, candidate.col, info.name.length),
    };
  }

  definition(params) {
    const uri = params.textDocument.uri;
    const candidate = this.candidateAt(uri, params.position);
    if (!candidate) return null;
    const record = this.recordFor(uri);
    const compiled = record && record.check ? record.check.checker : null;
    if (candidate.typeDecl) {
      if (candidate.typeDecl.importNode) return this.importDefinition(record, candidate.typeDecl.importSpec, candidate.typeDecl.importedName);
      return locationFor(candidate.typeDecl.nameLine, candidate.typeDecl.nameCol, candidate.typeDecl.name);
    }
    if (!candidate.symbol) return null;
    const symbol = candidate.symbol;
    if (symbol.importType) {
      return this.importDefinition(record, symbol.importSpec, symbol.importedName);
    }
    const line = symbol.nameLine || declarationLine(symbol);
    const col = symbol.nameCol || declarationCol(symbol);
    if (!line || !col) return null;
    const file = this.absoluteFile(symbol.declFile || (compiled && compiled.file));
    return fileLocation(file, line, col, symbol.name || candidate.name);
  }

  importDefinition(record, spec, importedName) {
    if (!record) return null;
    const resolved = record.resolutions.get(spec);
    if (!resolved) return null;
    let targetRecord = null;
    if (resolved.path) targetRecord = this.lastCompiler.modules.get(resolved.path);
    if (!targetRecord) return null;
    const declaration = findExportDeclaration(targetRecord, importedName);
    if (!declaration) return null;
    return fileLocation(declaration.file, declaration.line, declaration.col, importedName);
  }

  references(params) {
    const uri = params.textDocument.uri;
    const candidate = this.candidateAt(uri, params.position);
    if (!candidate) return [];
    const info = this.nodeInfo(uri, candidate);
    const locations = [];
    const seen = new Set();
    const add = (file, line, col, name) => {
      if (!file || !line || !col) return;
      const key = `${file}:${line}:${col}`;
      if (seen.has(key)) return;
      seen.add(key);
      locations.push(location(file, line, col, name));
    };
    if (info && info.symbol) {
      for (const reference of info.symbol.references || []) {
        add(this.absoluteFile(reference.file), reference.line, reference.col, reference.name);
      }
      add(this.absoluteFile(info.symbol.declFile), info.symbol.nameLine || declarationLine(info.symbol), info.symbol.nameCol || declarationCol(info.symbol), info.symbol.name);
    }
    // Imported symbols are referenced through a local import entry; follow the
    // binding to the defining file so references work across modules.
    let targetPath = null;
    let targetName = null;
    if (info && info.symbol && info.symbol.importType) {
      const target = this.importDefinition(this.recordFor(uri), info.symbol.importSpec, info.symbol.importedName);
      if (target) {
        targetPath = this.documentPath(target.uri);
        targetName = info.symbol.importedName;
      }
    } else if (info && info.symbol && info.symbol.declFile) {
      targetPath = this.absoluteFile(info.symbol.declFile);
      targetName = info.symbol.name;
    }
    if (targetPath && targetName) {
      for (const binding of this.workspaceBindings(targetPath, targetName)) {
        for (const reference of binding.entry.references || []) {
          add(this.absoluteFile(reference.file), reference.line, reference.col, reference.name);
        }
        add(this.absoluteFile(binding.entry.declFile), binding.entry.nameLine || declarationLine(binding.entry), binding.entry.nameCol || declarationCol(binding.entry), binding.entry.name);
        if (binding.imported && binding.entry.importedLine) {
          add(this.absoluteFile(binding.entry.declFile), binding.entry.importedLine, binding.entry.importedCol, binding.entry.importedName);
        }
      }
    }
    return locations;
  }

  resolveMatches(record, spec, targetFile) {
    const resolved = record.resolutions.get(spec);
    if (!resolved || !resolved.path) return false;
    return path.resolve(resolved.path) === path.resolve(targetFile);
  }

  workspaceBindings(targetFile, targetName) {
    const bindings = [];
    if (!this.lastCompiler) return bindings;
    for (const [file, record] of this.lastCompiler.modules) {
      if (!record.check) continue;
      const checker = record.check.checker;
      for (const [name, entry] of checker.global.names) {
        const targetBinding = file === targetFile && name === targetName;
        const importBinding = entry.importSpec
          && this.resolveMatches(record, entry.importSpec, targetFile)
          && entry.importedName === targetName;
        if (!targetBinding && !importBinding) continue;
        bindings.push({ file, entry, imported: Boolean(importBinding) });
      }
    }
    return bindings;
  }

  rename(params) {
    const uri = params.textDocument.uri;
    const newName = params.newName;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) return null;
    const candidate = this.candidateAt(uri, params.position);
    if (!candidate) return null;
    const info = this.nodeInfo(uri, candidate);
    const edits = new Map();
    const addEdit = (file, line, col, oldName) => {
      if (!file || !line || !col || !oldName) return;
      const key = pathToFileURL(file).toString();
      if (!edits.has(key)) edits.set(key, []);
      edits.get(key).push({
        range: tokenRange(line, col, oldName.length),
        newText: newName,
      });
    };
    if (info && info.symbol) {
      let targetPath = this.absoluteFile(info.symbol.declFile);
      let targetName = info.symbol.name;
      if (info.symbol.importType) {
        const target = this.importDefinition(this.recordFor(uri), info.symbol.importSpec, info.symbol.importedName);
        if (!target) return null;
        targetPath = this.documentPath(target.uri);
        targetName = info.symbol.importedName;
      }
      for (const binding of this.workspaceBindings(targetPath, targetName)) {
        if (binding.imported && binding.entry.importedLine) {
          const bindingFile = this.absoluteFile(binding.entry.declFile);
          addEdit(bindingFile, binding.entry.importedLine, binding.entry.importedCol, binding.entry.importedName);
          if (binding.entry.name === binding.entry.importedName) {
            addEdit(bindingFile, binding.entry.nameLine, binding.entry.nameCol, binding.entry.name);
            for (const reference of binding.entry.references || []) {
              addEdit(this.absoluteFile(reference.file), reference.line, reference.col, reference.name);
            }
          }
          continue;
        }
        addEdit(this.absoluteFile(binding.entry.declFile), binding.entry.nameLine || declarationLine(binding.entry), binding.entry.nameCol || declarationCol(binding.entry), binding.entry.name);
        for (const reference of binding.entry.references || []) {
          addEdit(this.absoluteFile(reference.file), reference.line, reference.col, reference.name);
        }
      }
    } else if (candidate.typeDecl && candidate.typeDecl.nameLine) {
      addEdit(this.absoluteFile(candidate.typeDecl.importNode ? this.documentPath(uri) : (candidate.typeDecl.declFile || this.documentPath(uri))), candidate.typeDecl.nameLine, candidate.typeDecl.nameCol, candidate.name);
    }
    if (!edits.size) return null;
    return {
      changes: Object.fromEntries(edits),
    };
  }

  symbols(uri) {
    const record = this.recordFor(uri);
    if (!record || !record.ast) return [];
    return record.ast.body
      .filter((statement) => statement.name)
      .map((statement) => ({
        name: statement.name,
        kind: statement.kind === 'FunctionDecl' ? 12 : statement.kind === 'TypeDecl' ? 5 : 13,
        range: rangeFrom({ line: statement.line, col: statement.col }, 1),
        selectionRange: rangeFrom({ line: statement.nameLine || statement.line, col: statement.nameCol || statement.col }, statement.name.length),
      }));
  }

  formatting(uri, options) {
    const source = this.documentText(uri);
    if (!source) return [];
    try {
      const formatted = format(source, this.documentPath(uri) || '<editor>');
      if (formatted === source) return [];
      const lines = source.split('\n');
      return [{
        range: { start: { line: 0, character: 0 }, end: { line: lines.length, character: 0 } },
        newText: formatted,
      }];
    } catch {
      return [];
    }
  }
}

function collectCandidates(ast) {
  const candidates = [];
  const seen = new WeakSet();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value.kind === 'Name' && value.line && value.col) {
      candidates.push({ kind: 'Name', name: value.name, line: value.line, col: value.col, symbol: value.__symbol || null, type: value.__type || null });
    } else if (value.kind === 'NamePattern' && value.name && value.line && value.col) {
      candidates.push({ kind: 'NamePattern', name: value.name, line: value.line, col: value.col, symbol: value.__symbol || null, type: value.__type || null });
    } else if (value.kind === 'NamedType' && value.line && value.col) {
      candidates.push({ kind: 'NamedType', name: value.name, line: value.line, col: value.col, typeDecl: value.__typeDecl || null, type: value.__type || null });
    } else if (value.kind === 'FunctionDecl' && value.name && value.nameLine) {
      candidates.push({
        kind: 'FunctionDecl',
        name: value.name,
        line: value.nameLine,
        col: value.nameCol,
        symbol: value.__symbol || null,
        type: value.__signature ? T.fnType(value.__signature.params, value.__signature.ret, value.__signature.typeParams) : null,
      });
    }
    if ((value.kind === 'FunctionDecl' || value.kind === 'FunctionExpression') && value.params) {
      for (const parameter of value.params) {
        if (!parameter.nameLine) continue;
        candidates.push({
          kind: 'ParamName',
          name: parameter.name,
          line: parameter.nameLine,
          col: parameter.nameCol,
          symbol: parameter.__symbol || null,
          type: parameter.__type || null,
        });
      }
    } else if (value.kind === 'TypeDecl' && value.name && value.nameLine) {
      candidates.push({ kind: 'TypeDecl', name: value.name, line: value.nameLine, col: value.nameCol, typeDecl: value, type: value.__type || null });
    } else if (value.kind === 'DeclareFunction' && value.nameLine) {
      candidates.push({ kind: 'DeclareFunction', name: value.name, line: value.nameLine, col: value.nameCol, symbol: value.__symbol || null });
    } else if (value.kind === 'DeclareValue' && value.nameLine) {
      candidates.push({ kind: 'DeclareValue', name: value.name, line: value.nameLine, col: value.nameCol, symbol: value.__symbol || null });
    }
    if (value.kind === 'Import') {
      if (value.defaultName && value.defaultLine) {
        candidates.push({ kind: 'ImportName', name: value.defaultName, line: value.defaultLine, col: value.defaultCol, symbol: null });
      }
      if (value.namespace && value.namespaceLine) {
        candidates.push({ kind: 'ImportName', name: value.namespace, line: value.namespaceLine, col: value.namespaceCol, symbol: null });
      }
      for (const item of value.names || []) {
        if (item.line && item.col) candidates.push({ kind: 'ImportName', name: item.local, line: item.line, col: item.col, symbol: null, importedName: item.imported });
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('__') || key === 'comments') continue;
      if (child && typeof child === 'object') visit(child);
    }
  };
  visit(ast);
  const unique = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.line}:${candidate.col}:${candidate.name}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}

function declarationLine(symbol) {
  if (!symbol || !symbol.declNode) return null;
  const node = symbol.declNode;
  if (node.nameLine) return node.nameLine;
  if (node.pattern && node.pattern.line) return node.pattern.line;
  if (node.line) return node.line;
  return null;
}

function declarationCol(symbol) {
  if (!symbol || !symbol.declNode) return null;
  const node = symbol.declNode;
  if (node.nameCol) return node.nameCol;
  if (node.pattern && node.pattern.col) return node.pattern.col;
  if (node.col) return node.col;
  return null;
}

function findExportDeclaration(record, exportedName) {
  if (!record || !record.ast) return null;
  for (const statement of record.ast.body) {
    if (statement.kind === 'FunctionDecl' && statement.name === exportedName) {
      return { file: record.file, line: statement.nameLine, col: statement.nameCol };
    }
    if (statement.kind === 'TypeDecl' && statement.name === exportedName) {
      return { file: record.file, line: statement.nameLine, col: statement.nameCol };
    }
    if (statement.kind === 'VarDecl' && statement.pattern && statement.pattern.name === exportedName) {
      return { file: record.file, line: statement.pattern.line, col: statement.pattern.col };
    }
    if (statement.kind === 'ExportNamed') {
      for (const name of statement.names) {
        if (name.exported !== exportedName) continue;
        if (statement.spec) {
          const resolved = record.resolutions.get(statement.spec);
          const target = resolved && resolved.path ? null : null;
          void target;
          return null;
        }
        const local = record.ast.body.find((candidate) => candidate.name === name.local);
        if (local) return { file: record.file, line: local.nameLine || local.line, col: local.nameCol || local.col };
      }
    }
  }
  return null;
}

function protocolDiagnostic(diagnostic) {
  const span = diagnostic.span || { line: 1, column: 1, length: 1 };
  return {
    range: {
      start: { line: Math.max(0, span.line - 1), character: Math.max(0, span.column - 1) },
      end: { line: Math.max(0, span.line - 1), character: Math.max(0, span.column - 1) + Math.max(1, span.length || 1) },
    },
    severity: diagnostic.severity === 'warning' ? 2 : 1,
    code: diagnostic.code,
    source: 'plainscript',
    message: diagnostic.hint ? `${diagnostic.message} (${diagnostic.hint})` : diagnostic.message,
  };
}

function rangeFrom(position, length) {
  return {
    start: { line: Math.max(0, position.line - 1), character: Math.max(0, position.col - 1) },
    end: { line: Math.max(0, position.line - 1), character: Math.max(0, position.col - 1) + Math.max(1, length || 1) },
  };
}

function tokenRange(line, col, length) {
  return rangeFrom({ line, col }, length);
}

function location(file, line, col, name) {
  return { uri: pathToFileURL(file).toString(), range: tokenRange(line, col, name ? name.length : 1) };
}

function fileLocation(file, line, col, name) {
  if (!file || !line || !col) return null;
  return { uri: pathToFileURL(file).toString(), range: tokenRange(line, col, name ? name.length : 1) };
}

PlainScriptLanguageServer.prototype.absoluteFile = function absoluteFile(file) {
  if (!file) return null;
  if (path.isAbsolute(file)) return file;
  return path.resolve(this.root, file);
};

if (require.main === module) {
  const server = new PlainScriptLanguageServer(process.stdin, process.stdout, process.cwd());
  server.start();
}

module.exports = { PlainScriptLanguageServer };
