// Tests for PlainScript Language Server Protocol (LSP).

const { test, assert } = require('./compat/_util');
const { handleRequest } = require('../compiler/lsp');

test('lsp: initialize returns server capabilities and info', () => {
  let response = null;
  // Mock sendResponse
  const origStdout = process.stdout.write;
  process.stdout.write = (chunk) => {
    const parts = chunk.split('\r\n\r\n');
    if (parts[1]) response = JSON.parse(parts[1]);
    return true;
  };

  try {
    handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    });

    assert(response !== null, 'expected response');
    assert(response.id === 1, 'id match');
    assert(response.result.capabilities.hoverProvider === true, 'hover capability');
    assert(response.result.capabilities.documentFormattingProvider === true, 'format capability');
    assert(response.result.serverInfo.name === 'plainscript-language-server', 'serverInfo name');
  } finally {
    process.stdout.write = origStdout;
  }
});

test('lsp: hover returns markdown docs for keywords', () => {
  let response = null;
  const origStdout = process.stdout.write;
  process.stdout.write = (chunk) => {
    const parts = chunk.split('\r\n\r\n');
    if (parts[1]) response = JSON.parse(parts[1]);
    return true;
  };

  try {
    // Open a document
    handleRequest({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: 'file:///app.pln',
          text: 'remember count as 5\n',
        },
      },
    });

    // Request hover over "remember"
    handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/hover',
      params: {
        textDocument: { uri: 'file:///app.pln' },
        position: { line: 0, character: 3 },
      },
    });

    assert(response !== null, 'expected hover response');
    assert(response.result.contents.kind === 'markdown', 'markdown content');
    assert(response.result.contents.value.includes('**remember**'), 'contains remember documentation');
  } finally {
    process.stdout.write = origStdout;
  }
});

test('lsp: didOpen publishes diagnostics on syntax errors and clears on fix', () => {
  const notifications = [];
  const origStdout = process.stdout.write;
  process.stdout.write = (chunk) => {
    const parts = chunk.split('\r\n\r\n');
    if (parts[1]) {
      const msg = JSON.parse(parts[1]);
      if (msg.method === 'textDocument/publishDiagnostics') {
        notifications.push(msg.params);
      }
    }
    return true;
  };

  try {
    // Invalid code
    handleRequest({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: 'file:///broken.pln',
          text: 'remembr x as 1\n',
        },
      },
    });

    assert(notifications.length === 1, 'expected 1 diagnostic notification');
    assert(notifications[0].diagnostics.length > 0, 'expected syntax error diagnostic');
    assert(notifications[0].diagnostics[0].message.includes('remembr'), 'message identifies typo');

    // Fix code
    handleRequest({
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri: 'file:///broken.pln' },
        contentChanges: [{ text: 'remember x as 1\n' }],
      },
    });

    assert(notifications.length === 2, 'expected 2nd diagnostic notification');
    assert(notifications[1].diagnostics.length === 0, 'diagnostics cleared after fix');
  } finally {
    process.stdout.write = origStdout;
  }
});

test('lsp: completion returns PlainScript keyword items', () => {
  let response = null;
  const origStdout = process.stdout.write;
  process.stdout.write = (chunk) => {
    const parts = chunk.split('\r\n\r\n');
    if (parts[1]) response = JSON.parse(parts[1]);
    return true;
  };

  try {
    handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'textDocument/completion',
      params: {
        textDocument: { uri: 'file:///app.pln' },
        position: { line: 0, character: 0 },
      },
    });

    assert(response !== null, 'expected completion response');
    const labels = response.result.items.map(i => i.label);
    assert(labels.includes('remember') && labels.includes('make') && labels.includes('route get'), 'contains keywords');
  } finally {
    process.stdout.write = origStdout;
  }
});

const { summary } = require('./compat/_util');
summary();
