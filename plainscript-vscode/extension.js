// PlainScript VS Code Extension - Language Features Provider
// Provides real-time syntax diagnostics, hover documentation, keyword autocompletion,
// and document formatting directly in VS Code.

const vscode = require('vscode');
const path   = require('path');
const fs     = require('fs');

// Attempt to locate compiler/lsp.js relative to extension or workspace
function findLspServerPath(context) {
  const localPath = path.join(__dirname, '..', 'compiler', 'lsp.js');
  if (fs.existsSync(localPath)) return localPath;
  return null;
}

function activate(context) {
  const lspPath = findLspServerPath(context);
  if (!lspPath) return;

  const { validateDocument, handleRequest } = require(lspPath);
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('plainscript');
  context.subscriptions.push(diagnosticCollection);

  function runDiagnostics(document) {
    if (document.languageId !== 'plainscript') return;
    const text = document.getText();
    const uri = document.uri.toString();

    // Hook into LSP's validateDocument
    let reportedDiagnostics = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      try {
        const parts = chunk.split('\r\n\r\n');
        if (parts[1]) {
          const msg = JSON.parse(parts[1]);
          if (msg.method === 'textDocument/publishDiagnostics') {
            reportedDiagnostics = msg.params.diagnostics || [];
          }
        }
      } catch (_) {}
      return true;
    };

    try {
      validateDocument(uri, text);
    } finally {
      process.stdout.write = origWrite;
    }

    const vsDiagnostics = reportedDiagnostics.map(d => {
      const range = new vscode.Range(
        d.range.start.line,
        d.range.start.character,
        d.range.end.line,
        d.range.end.character
      );
      return new vscode.Diagnostic(range, d.message, vscode.DiagnosticSeverity.Error);
    });

    diagnosticCollection.set(document.uri, vsDiagnostics);
  }

  // Live document change & open listeners
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(runDiagnostics),
    vscode.workspace.onDidChangeTextDocument(e => runDiagnostics(e.document)),
    vscode.workspace.onDidCloseTextDocument(doc => diagnosticCollection.delete(doc.uri))
  );

  // Validate already open documents
  vscode.workspace.textDocuments.forEach(runDiagnostics);

  // Hover Provider
  context.subscriptions.push(
    vscode.languages.registerHoverProvider('plainscript', {
      provideHover(document, position) {
        let hoverResult = null;
        const origWrite = process.stdout.write;
        process.stdout.write = (chunk) => {
          try {
            const parts = chunk.split('\r\n\r\n');
            if (parts[1]) {
              const res = JSON.parse(parts[1]);
              if (res.result && res.result.contents) {
                hoverResult = res.result.contents.value;
              }
            }
          } catch (_) {}
          return true;
        };

        try {
          handleRequest({
            jsonrpc: '2.0',
            id: 1,
            method: 'textDocument/hover',
            params: {
              textDocument: { uri: document.uri.toString() },
              position: { line: position.line, character: position.character },
            },
          });
        } finally {
          process.stdout.write = origWrite;
        }

        if (hoverResult) {
          return new vscode.Hover(new vscode.MarkdownString(hoverResult));
        }
        return null;
      }
    })
  );

  // Completion Item Provider
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('plainscript', {
      provideCompletionItems() {
        let items = [];
        const origWrite = process.stdout.write;
        process.stdout.write = (chunk) => {
          try {
            const parts = chunk.split('\r\n\r\n');
            if (parts[1]) {
              const res = JSON.parse(parts[1]);
              if (res.result && res.result.items) {
                items = res.result.items;
              }
            }
          } catch (_) {}
          return true;
        };

        try {
          handleRequest({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/completion',
            params: {},
          });
        } finally {
          process.stdout.write = origWrite;
        }

        return items.map(item => {
          const ci = new vscode.CompletionItem(item.label);
          ci.detail = item.detail;
          return ci;
        });
      }
    }, '.', ' ')
  );

  // Formatting Provider
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider('plainscript', {
      provideDocumentFormattingEdits(document) {
        let edits = [];
        const origWrite = process.stdout.write;
        process.stdout.write = (chunk) => {
          try {
            const parts = chunk.split('\r\n\r\n');
            if (parts[1]) {
              const res = JSON.parse(parts[1]);
              if (res.result) edits = res.result;
            }
          } catch (_) {}
          return true;
        };

        try {
          handleRequest({
            jsonrpc: '2.0',
            id: 3,
            method: 'textDocument/formatting',
            params: { textDocument: { uri: document.uri.toString() } },
          });
        } finally {
          process.stdout.write = origWrite;
        }

        return edits.map(e => {
          const range = new vscode.Range(
            e.range.start.line,
            e.range.start.character,
            e.range.end.line,
            e.range.end.character
          );
          return vscode.TextEdit.replace(range, e.newText);
        });
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
