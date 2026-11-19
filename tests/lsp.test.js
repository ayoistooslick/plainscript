'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

class LspClient {
  constructor() {
    this.process = spawn(process.execPath, [path.join(ROOT, 'src', 'lsp.js')], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.process.stdout.on('data', (chunk) => this.onData(chunk));
    this.process.stderr.on('data', () => {});
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
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
      const message = JSON.parse(body);
      if (message.id !== undefined && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        entry.resolve(message);
      } else if (message.method) {
        this.notifications.push(message);
      }
    }
  }

  send(message) {
    const body = JSON.stringify(message);
    this.process.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timed out: ${method}`));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  async open(file, text = fs.readFileSync(file, 'utf8')) {
    const uri = pathToFileURL(file).toString();
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'plainscript', version: 1, text },
    });
    return uri;
  }

  async diagnosticsFor(uri) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const found = [...this.notifications].reverse().find((message) =>
        message.method === 'textDocument/publishDiagnostics' && message.params.uri === uri);
      if (found) return found.params.diagnostics;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`No diagnostics were published for ${uri}`);
  }

  async stop() {
    try {
      await this.request('shutdown', {});
      this.notify('exit', {});
    } catch {
      this.process.kill();
    }
  }
}

function positionOf(source, needle, occurrence = 1) {
  let index = -1;
  for (let count = 0; count < occurrence; count += 1) index = source.indexOf(needle, index + 1);
  if (index < 0) throw new Error(`Could not find ${needle}`);
  const before = source.slice(0, index);
  const lines = before.split('\n');
  return { line: lines.length - 1, character: lines[lines.length - 1].length };
}

test('language server publishes diagnostics, hover, definitions, references, rename, symbols and formatting', async () => {
  const client = new LspClient();
  try {
    const initialize = await client.request('initialize', { rootUri: pathToFileURL(ROOT).toString() });
    assert.equal(initialize.result.capabilities.hoverProvider, true);
    assert.equal(initialize.result.capabilities.definitionProvider, true);
    assert.equal(initialize.result.capabilities.renameProvider, true);
    assert.equal(initialize.result.capabilities.documentFormattingProvider, true);
    assert.equal(initialize.result.capabilities.codeActionProvider.codeActionKinds[0], 'quickfix');
    assert.equal(initialize.result.capabilities.semanticTokensProvider.full, true);
    client.notify('initialized', {});

    const brokenFile = path.join(ROOT, 'tests', 'fixtures', 'lsp', 'broken.pln');
    const brokenUri = await client.open(brokenFile);
    const brokenDiagnostics = await client.diagnosticsFor(brokenUri);
    assert.ok(brokenDiagnostics.some((diagnostic) => diagnostic.code === 'PS3311'), JSON.stringify(brokenDiagnostics));

    const cleanFile = path.join(ROOT, 'tests', 'fixtures', 'lsp', 'clean.pln');
    const cleanSource = fs.readFileSync(cleanFile, 'utf8');
    const cleanUri = await client.open(cleanFile, cleanSource);
    const cleanDiagnostics = await client.diagnosticsFor(cleanUri);
    assert.deepEqual(cleanDiagnostics, []);

    const callPosition = positionOf(cleanSource, 'greet("Ada")');
    const hover = await client.request('textDocument/hover', {
      textDocument: { uri: cleanUri },
      position: { line: callPosition.line, character: callPosition.character + 2 },
    });
    assert.match(hover.result.contents.value, /greet/);
    assert.match(hover.result.contents.value, /text/);

    const definition = await client.request('textDocument/definition', {
      textDocument: { uri: cleanUri },
      position: { line: callPosition.line, character: callPosition.character + 2 },
    });
    assert.equal(definition.result.uri, pathToFileURL(cleanFile).toString());
    assert.equal(definition.result.range.start.line, 6);

    const references = await client.request('textDocument/references', {
      textDocument: { uri: cleanUri },
      position: { line: callPosition.line, character: callPosition.character + 2 },
      context: { includeDeclaration: true },
    });
    assert.ok(references.result.length >= 2, JSON.stringify(references.result));

    const rename = await client.request('textDocument/rename', {
      textDocument: { uri: cleanUri },
      position: { line: callPosition.line, character: callPosition.character + 2 },
      newName: 'welcome',
    });
    const edits = rename.result.changes[pathToFileURL(cleanFile).toString()];
    assert.equal(edits.length, 2);
    assert.ok(edits.every((edit) => edit.newText === 'welcome'));

    const completion = await client.request('textDocument/completion', {
      textDocument: { uri: cleanUri },
      position: { line: callPosition.line, character: 1 },
    });
    assert.ok(completion.result.some((item) => item.label === 'greet'));

    const symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri: cleanUri } });
    assert.equal(symbols.result[0].name, 'Greeting');
    assert.ok(symbols.result.some((symbol) => symbol.name === 'greet'));

    const formatting = await client.request('textDocument/formatting', {
      textDocument: { uri: cleanUri },
      options: { tabSize: 4 },
    });
    assert.ok(Array.isArray(formatting.result));

    const semantic = await client.request('textDocument/semanticTokens/full', { textDocument: { uri: cleanUri } });
    assert.ok(Array.isArray(semantic.result.data));
    assert.ok(semantic.result.data.length > 0);
    assert.equal(semantic.result.data.length % 5, 0);

    const typoFile = path.join(ROOT, 'tests', 'fixtures', 'lsp', 'typo.pln');
    const typoUri = await client.open(typoFile);
    const typoDiagnostics = await client.diagnosticsFor(typoUri);
    const withHint = typoDiagnostics.find((diagnostic) => diagnostic.data && diagnostic.data.hint);
    assert.ok(withHint, JSON.stringify(typoDiagnostics));
    const actions = await client.request('textDocument/codeAction', {
      textDocument: { uri: typoUri },
      range: withHint.range,
      context: { diagnostics: [withHint] },
    });
    assert.ok(actions.result.some((action) => action.kind === 'quickfix' && /greet/.test(action.title)));

    const libFile = path.join(ROOT, 'tests', 'fixtures', 'lsp', 'lib.pln');
    const consumerFile = path.join(ROOT, 'tests', 'fixtures', 'lsp', 'consumer.pln');
    await client.open(libFile);
    const consumerSource = fs.readFileSync(consumerFile, 'utf8');
    const consumerUri = await client.open(consumerFile, consumerSource);
    await client.diagnosticsFor(consumerUri);
    const consumerCall = positionOf(consumerSource, 'greet("Ada")');
    const crossFileDefinition = await client.request('textDocument/definition', {
      textDocument: { uri: consumerUri },
      position: { line: consumerCall.line, character: consumerCall.character + 2 },
    });
    assert.equal(crossFileDefinition.result.uri, pathToFileURL(libFile).toString());
    const crossFileReferences = await client.request('textDocument/references', {
      textDocument: { uri: consumerUri },
      position: { line: consumerCall.line, character: consumerCall.character + 2 },
      context: { includeDeclaration: true },
    });
    const referenceUris = new Set(crossFileReferences.result.map((reference) => reference.uri));
    assert.equal(referenceUris.has(pathToFileURL(libFile).toString()), true);
    assert.equal(referenceUris.has(consumerUri), true);
    const crossFileRename = await client.request('textDocument/rename', {
      textDocument: { uri: consumerUri },
      position: { line: consumerCall.line, character: consumerCall.character + 2 },
      newName: 'welcome',
    });
    assert.ok(crossFileRename.result.changes[pathToFileURL(libFile).toString()].length >= 1);
    assert.ok(crossFileRename.result.changes[consumerUri].length >= 2);
  } finally {
    await client.stop();
  }
});
