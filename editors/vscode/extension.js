'use strict';

const path = require('node:path');
const vscode = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');

let client = null;

function serverModule(context) {
  try {
    return require.resolve('plainscript-lang/lsp');
  } catch {
    return context.asAbsolutePath(path.join('..', '..', 'src', 'lsp.js'));
  }
}

function start(context, modulePath) {
  const serverOptions = {
    command: process.execPath,
    args: [modulePath],
    transport: TransportKind.stdio,
  };
  const clientOptions = {
    documentSelector: [{ scheme: 'file', language: 'plainscript' }],
  };
  client = new LanguageClient('plainscript', 'PlainScript Language Server', serverOptions, clientOptions);
  return client.start();
}

function debugAdapterModule(context) {
  try {
    return require.resolve('plainscript-lang/cli');
  } catch {
    return context.asAbsolutePath(path.join('..', '..', 'src', 'cli.js'));
  }
}

async function activate(context) {
  const modulePath = serverModule(context);
  await start(context, modulePath);
  context.subscriptions.push(vscode.commands.registerCommand('plainscript.restartServer', async () => {
    if (client) await client.stop();
    await start(context, modulePath);
  }));

  const debugAdapter = debugAdapterModule(context);
  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('plainscript', {
    createDebugAdapterDescriptor() {
      return new vscode.DebugAdapterExecutable(process.execPath, [debugAdapter, 'dap'], {
        cwd: vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length
          ? vscode.workspace.workspaceFolders[0].uri.fsPath
          : undefined,
      });
    },
  }));
}

async function deactivate() {
  if (client) await client.stop();
  client = null;
}

module.exports = { activate, deactivate };
