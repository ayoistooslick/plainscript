#!/usr/bin/env node
// PlainScript Language Server Protocol service.
// Uses the parser -> IR -> static checker pipeline and keeps no editor state
// outside the in-memory document map.

const fs = require('fs');
const { tokenize } = require('./lexer');
const { parse } = require('./parser');
const { lowerToIR } = require('./ir');
const { checkTypes } = require('./type-checker');

function parsePosition(message) {
  const match = /Line (\d+), Column (\d+)/.exec(String(message));
  return match
    ? { line: Number(match[1]) - 1, character: Number(match[2]) - 1 }
    : { line: 0, character: 0 };
}

function wordAt(source, position) {
  const lines = source.split(/\r?\n/);
  const line = lines[position.line] || '';
  let index = Math.max(0, Math.min(position.character, line.length));
  if (index === line.length && index > 0) index--;
  if (!/[A-Za-z0-9_$]/.test(line[index] || '')) return null;
  let start = index;
  let end = index + 1;
  while (start > 0 && /[A-Za-z0-9_$]/.test(line[start - 1])) start--;
  while (end < line.length && /[A-Za-z0-9_$]/.test(line[end])) end++;
  return { word: line.slice(start, end), start, end, line: position.line };
}

function uriPath(uri) {
  if (!uri) return null;
  if (uri.startsWith('file://')) return decodeURIComponent(uri.slice('file://'.length));
  return uri;
}

class LspService {
  constructor() {
    this.documents = new Map();
    this.shutdownRequested = false;
  }

  setDocument(uri, text, version = null) {
    this.documents.set(uri, { uri, text, version });
  }

  document(uri) {
    const item = this.documents.get(uri);
    if (item) return item;
    const file = uriPath(uri);
    if (file && fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8');
      this.setDocument(uri, text, null);
      return this.documents.get(uri);
    }
    return null;
  }

  analyze(uri) {
    const document = this.document(uri);
    if (!document) return { diagnostics: [], ast: null, ir: null, check: null };
    try {
      const ast = parse(tokenize(document.text));
      const ir = lowerToIR(ast);
      const check = checkTypes(ast, { ir });
      return { diagnostics: check.diagnostics, ast, ir, check };
    } catch (error) {
      const position = parsePosition(error.message);
      return {
        diagnostics: [{
          severity: 1,
          source: 'plainscript',
          code: 'PLN-PARSE',
          message: error.message,
          range: { start: position, end: { line: position.line, character: position.character + 1 } },
        }],
        ast: null,
        ir: null,
        check: null,
      };
    }
  }

  publishDiagnostics(uri) {
    return { uri, diagnostics: this.analyze(uri).diagnostics };
  }

  symbols(uri) {
    const result = this.analyze(uri);
    if (!result.ast) return [];
    return result.ast.body.filter(node => ['TypeDeclaration', 'FunctionDeclaration', 'IntentDeclaration', 'RememberStatement'].includes(node.type)).map(node => ({
      name: node.name,
      kind: node.type === 'TypeDeclaration' ? 5 : node.type === 'RememberStatement' ? 13 : 12,
      range: {
        start: { line: (node.line || 1) - 1, character: (node.col || 1) - 1 },
        end: { line: (node.line || 1) - 1, character: (node.col || 1) - 1 + String(node.name || '').length },
      },
    }));
  }

  hover(uri, position) {
    const document = this.document(uri);
    const result = this.analyze(uri);
    if (!document || !result.ast) return null;
    const hit = wordAt(document.text, position);
    if (!hit) return null;
    const type = (result.ast.body || []).find(node => node.type === 'TypeDeclaration' && node.name === hit.word);
    const fn = (result.ast.body || []).find(node => (node.type === 'FunctionDeclaration' || node.type === 'IntentDeclaration') && node.name === hit.word);
    if (type) {
      const fields = (type.fields || []).map(field => `- ${field.key}: ${JSON.stringify(field.type)}`).join('\n');
      return { contents: { kind: 'markdown', value: `**type ${type.name}**\n\n${fields}` } };
    }
    if (fn) {
      const params = (fn.params || []).map(param => `${param.name}${param.typeAnnotation ? ` as ${JSON.stringify(param.typeAnnotation)}` : ''}`).join(', ');
      const prefix = fn.type === 'IntentDeclaration' ? 'intend' : 'make';
      return { contents: { kind: 'markdown', value: `[1m${prefix} ${fn.name}(${params})[0m` } };
    }
    return null;
  }

  completion(uri) {
    const result = this.analyze(uri);
    const labels = ['remember', 'show', 'make', 'intend', 'type', 'if', 'otherwise', 'for', 'while', 'done', 'give', 'match', 'test'];
    if (result.ast) {
      for (const node of result.ast.body) {
        if (node.name) labels.push(node.name);
        if (node.type === 'TypeDeclaration') for (const field of node.fields || []) labels.push(field.key);
      }
    }
    return { isIncomplete: false, items: [...new Set(labels)].map(label => ({ label, kind: 14 })) };
  }

  definition(uri, position) {
    const document = this.document(uri);
    const result = this.analyze(uri);
    if (!document || !result.ast) return null;
    const hit = wordAt(document.text, position);
    if (!hit) return null;
    const node = result.ast.body.find(item => item.name === hit.word);
    if (!node) return null;
    return [{
      uri,
      range: {
        start: { line: (node.line || 1) - 1, character: (node.col || 1) - 1 },
        end: { line: (node.line || 1) - 1, character: (node.col || 1) - 1 + hit.word.length },
      },
    }];
  }

  request(method, params = {}) {
    switch (method) {
      case 'initialize':
        return { capabilities: {
          textDocumentSync: { openClose: true, change: 1 },
          hoverProvider: true,
          completionProvider: { triggerCharacters: ['.', ' '] },
          definitionProvider: true,
        }, serverInfo: { name: 'plainscript-lsp', version: '1.0.0' } };
      case 'shutdown': this.shutdownRequested = true; return null;
      case 'textDocument/hover': return this.hover(params.textDocument.uri, params.position);
      case 'textDocument/completion': return this.completion(params.textDocument.uri);
      case 'textDocument/definition': return this.definition(params.textDocument.uri, params.position);
      case 'textDocument/documentSymbol': return this.symbols(params.textDocument.uri);
      case 'workspace/symbol': {
        const all = [];
        for (const uri of this.documents.keys()) all.push(...this.symbols(uri));
        return all;
      }
      default: return null;
    }
  }

  notification(method, params = {}) {
    if (method === 'textDocument/didOpen') {
      this.setDocument(params.textDocument.uri, params.textDocument.text, params.textDocument.version);
      return this.publishDiagnostics(params.textDocument.uri);
    }
    if (method === 'textDocument/didChange') {
      const changes = params.contentChanges || [];
      const current = this.document(params.textDocument.uri);
      const text = changes.length === 1 && !changes[0].range
        ? changes[0].text
        : (current ? current.text : '');
      this.setDocument(params.textDocument.uri, text, params.textDocument.version);
      return this.publishDiagnostics(params.textDocument.uri);
    }
    if (method === 'textDocument/didClose') {
      this.documents.delete(params.textDocument.uri);
      return { uri: params.textDocument.uri, diagnostics: [] };
    }
    return null;
  }
}

function startStdio(input = process.stdin, output = process.stdout) {
  const service = new LspService();
  let buffer = Buffer.alloc(0);
  function send(message) {
    const body = Buffer.from(JSON.stringify(message));
    output.write(`Content-Length: ${body.length}\r\n\r\n`);
    output.write(body);
  }
  function handle(message) {
    const params = message.params || {};
    if (message.method && message.id !== undefined) {
      send({ jsonrpc: '2.0', id: message.id, result: service.request(message.method, params) });
    } else if (message.method) {
      const diagnostics = service.notification(message.method, params);
      if (diagnostics && message.method !== 'exit') send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: diagnostics });
      if (message.method === 'exit') process.exit(service.shutdownRequested ? 0 : 1);
    }
  }
  input.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const separator = buffer.indexOf(Buffer.from('\r\n\r\n'));
      if (separator < 0) break;
      const header = buffer.slice(0, separator).toString('ascii');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) { buffer = buffer.slice(separator + 4); continue; }
      const length = Number(match[1]);
      const start = separator + 4;
      if (buffer.length < start + length) break;
      const body = buffer.slice(start, start + length).toString('utf8');
      buffer = buffer.slice(start + length);
      try { handle(JSON.parse(body)); } catch (error) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: error.message } }); }
    }
  });
  return service;
}

if (require.main === module) startStdio();
module.exports = { LspService, startStdio };
