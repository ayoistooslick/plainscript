const vscode = require('vscode');
const path = require('path');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');

let client;

function activate(context) {
  const sourceServer = context.asAbsolutePath(path.join('..', 'compiler', 'lsp.js'));
  const serverOptions = require('fs').existsSync(sourceServer)
    ? {
      run: { command: process.execPath, args: [sourceServer], transport: TransportKind.stdio },
      debug: { command: process.execPath, args: [sourceServer], transport: TransportKind.stdio },
    }
    : {
      run: { command: 'plainscript-lsp', args: [], transport: TransportKind.stdio },
      debug: { command: 'plainscript-lsp', args: [], transport: TransportKind.stdio },
    };
  const clientOptions = {
    documentSelector: [{ scheme: 'file', language: 'plainscript' }],
    synchronize: { configurationSection: 'plainscript' },
    outputChannelName: 'PlainScript Language Server',
  };
  client = new LanguageClient('plainscript', 'PlainScript Language Server', serverOptions, clientOptions);
  context.subscriptions.push(client);
  client.start();
}

async function deactivate() {
  if (client) await client.stop();
  client = undefined;
}

module.exports = { activate, deactivate };
