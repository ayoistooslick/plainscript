// PlainScript Language Server (LSP) implementation.
// Adheres to Language Server Protocol 3.17 over stdio JSON-RPC 2.0.
// Provides live diagnostics (as-you-type), hover docs, autocompletion, and formatting.

const { tokenize, TOKEN } = require('./lexer');
const { parse }           = require('./parser');
const { format }          = require('./formatter');
const { parseLocation }   = require('./diagnostics');
const { VERSION }         = require('./version');
const { inferTypes }      = require('./passes/inference');

// ── Hover Documentation Dictionary ──────────────────────────────────────────

const HOVER_DOCS = {
  remember: '**remember** `name as value`\n\nDeclares a mutable variable. Can also use `let name be value` or `let name as value`.\n\n```plainscript\nremember count as 0\nremember name as "Ada"\n```',
  let: '**let** `name is value`\n\nAlias for `remember`.\n\n```plainscript\nlet status is "active"\n```',
  show: '**show** `value`\n\nPrints a value to stdout (`console.log`). Aliases: `print`, `display`.\n\n```plainscript\nshow `Hello, ${name}!`\n```',
  print: '**print** `value`\n\nAlias for `show`.',
  display: '**display** `value`\n\nAlias for `show`.',
  make: '**make** `fn(args) ... done`\n\nDefines a function. Close with `done`.\n\n```plainscript\nmake add(a, b)\n    give a + b\ndone\n```',
  give: '**give** `value`\n\nReturns a value from a function. Aliases: `return`, `give back`.\n\n```plainscript\ngive a + b\n```',
  done: '**done**\n\nCloses an open block (`make`, `if`, `for`, `while`, `route`, `web app`, `database`, `try`, etc.).',
  if: '**if** `condition ... otherwise ... done`\n\nBranching condition block.\n\n```plainscript\nif score is at least 80\n    show "passed"\notherwise\n    show "review"\ndone\n```',
  otherwise: '**otherwise**\n\nElse branch of an `if` statement.',
  for: '**for each** `item in list ... done`\n\nLoops over each element in an iterable.\n\n```plainscript\nfor each user in users\n    show user.name\ndone\n```',
  while: '**while** `condition ... done`\n\nExecutes while condition evaluates to true.\n\n```plainscript\nwhile count is less than 5\n    count becomes count + 1\ndone\n```',
  becomes: '**becomes**\n\nAssigns a new value to an existing variable or property.\n\n```plainscript\ncount becomes count + 1\n```',
  route: '**route** `method "/path" ... done`\n\nRegisters an HTTP route inside a `web app` block.\n\n```plainscript\nweb app\n    route get "/users"\n        reply json users done\n    done\n    start 3000\ndone\n```',
  reply: '**reply** `[json] ... done`\n\nSends an HTTP response in a route handler.\n\n```plainscript\nreply json { ok: true } done\n```',
  database: '**database** `"file.db" ... done`\n\nConfigures SQLite database connection.\n\n```plainscript\ndatabase "app.db"\n    query "SELECT * FROM users" into users\ndone\n```',
  try: '**try ... recover as err ... done**\n\nError-handling block.\n\n```plainscript\ntry\n    riskyOperation()\nrecover as err\n    show text(err)\ndone\n```',
  retry: '**retry** `N times every T seconds ... done`\n\nRetries a block of code upon exception with backoff.',
  uppercase: '**uppercase**(str) → string\n\nConverts a string to uppercase.',
  lowercase: '**lowercase**(str) → string\n\nConverts a string to lowercase.',
  jsonEncode: '**jsonEncode**(value) → string\n\nSerializes a value to a JSON string.',
  jsonDecode: '**jsonDecode**(str) → any\n\nParses a JSON string into an object/array.',
};

const COMPLETION_ITEMS = [
  { label: 'remember', kind: 14, detail: 'remember name as value' },
  { label: 'show', kind: 14, detail: 'show expression' },
  { label: 'make', kind: 14, detail: 'make name(args) ... done' },
  { label: 'give', kind: 14, detail: 'give return_value' },
  { label: 'if', kind: 14, detail: 'if condition ... done' },
  { label: 'otherwise', kind: 14, detail: 'otherwise' },
  { label: 'done', kind: 14, detail: 'done' },
  { label: 'for each', kind: 14, detail: 'for each item in list ... done' },
  { label: 'while', kind: 14, detail: 'while condition ... done' },
  { label: 'becomes', kind: 14, detail: 'var becomes new_value' },
  { label: 'web app', kind: 14, detail: 'web app ... start port done' },
  { label: 'route get', kind: 14, detail: 'route get "/path" ... done' },
  { label: 'route post', kind: 14, detail: 'route post "/path" ... done' },
  { label: 'reply json', kind: 14, detail: 'reply json obj done' },
  { label: 'database', kind: 14, detail: 'database "path.db" ... done' },
  { label: 'query', kind: 14, detail: 'query "SQL" into result' },
  { label: 'try', kind: 14, detail: 'try ... recover as err ... done' },
  { label: 'retry', kind: 14, detail: 'retry 3 times every 1 second' },
  { label: 'uppercase', kind: 3, detail: 'uppercase(string)' },
  { label: 'lowercase', kind: 3, detail: 'lowercase(string)' },
  { label: 'jsonEncode', kind: 3, detail: 'jsonEncode(val)' },
  { label: 'jsonDecode', kind: 3, detail: 'jsonDecode(jsonStr)' },
];

// ── In-Memory Document Store ─────────────────────────────────────────────────

const documents = new Map();

function validateDocument(uri, text) {
  const diagnostics = [];
  try {
    const tokens = tokenize(text);
    parse(tokens);
  } catch (err) {
    const loc = parseLocation(err);
    const line = loc.line ? loc.line - 1 : 0;
    const col = loc.col ? loc.col - 1 : 0;

    diagnostics.push({
      range: {
        start: { line, character: col },
        end: { line, character: col + 5 },
      },
      severity: 1, // Error
      source: 'plainscript',
      message: loc.message,
    });
  }

  sendNotification('textDocument/publishDiagnostics', {
    uri,
    diagnostics,
  });
}

// ── JSON-RPC Framing & Dispatch ───────────────────────────────────────────────

function sendResponse(id, result, error = null) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id,
    ...(error ? { error } : { result }),
  });
  const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`;
  process.stdout.write(header + payload);
}

function sendNotification(method, params) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    method,
    params,
  });
  const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`;
  process.stdout.write(header + payload);
}

function handleRequest(req) {
  const { id, method, params } = req;

  switch (method) {
    case 'initialize':
      return sendResponse(id, {
        capabilities: {
          textDocumentSync: 1, // Full document sync
          hoverProvider: true,
          completionProvider: {
            resolveProvider: false,
            triggerCharacters: ['.', ' '],
          },
          documentFormattingProvider: true,
        },
        serverInfo: {
          name: 'plainscript-language-server',
          version: VERSION,
        },
      });

    case 'initialized':
      // Client notification after handshake
      return;

    case 'shutdown':
      return sendResponse(id, null);

    case 'exit':
      process.exit(0);

    case 'textDocument/didOpen':
      documents.set(params.textDocument.uri, params.textDocument.text);
      validateDocument(params.textDocument.uri, params.textDocument.text);
      return;

    case 'textDocument/didChange':
      if (params.contentChanges && params.contentChanges[0]) {
        const text = params.contentChanges[0].text;
        documents.set(params.textDocument.uri, text);
        validateDocument(params.textDocument.uri, text);
      }
      return;

    case 'textDocument/didClose':
      documents.delete(params.textDocument.uri);
      sendNotification('textDocument/publishDiagnostics', {
        uri: params.textDocument.uri,
        diagnostics: [],
      });
      return;

    case 'textDocument/hover': {
      const doc = documents.get(params.textDocument.uri);
      if (!doc) return sendResponse(id, null);

      const lines = doc.split(/\r?\n/);
      const line = lines[params.position.line] || '';
      const col = params.position.character;

      // Extract word under cursor
      const left = line.slice(0, col).match(/[A-Za-z0-9_]+$/);
      const right = line.slice(col).match(/^[A-Za-z0-9_]+/);
      const word = (left ? left[0] : '') + (right ? right[0] : '');

      if (word && HOVER_DOCS[word]) {
        return sendResponse(id, {
          contents: {
            kind: 'markdown',
            value: HOVER_DOCS[word],
          },
        });
      }

      // Check inferred types for variables, functions, and kinds
      if (word) {
        try {
          const tokens = tokenize(doc);
          const ast = parse(tokens);
          const inference = inferTypes(ast);
          const info = inference.getTypeInfo(word, params.position.line + 1, col + 1);
          if (info) {
            const kindPrefix = info.kind ? `(${info.kind}) ` : '';
            return sendResponse(id, {
              contents: {
                kind: 'markdown',
                value: `\`\`\`plainscript\n${kindPrefix}${info.name}: ${info.type}\n\`\`\``,
              },
            });
          }
        } catch (_) {
          // Graceful fallback on syntax errors
        }
      }
      return sendResponse(id, null);
    }

    case 'textDocument/completion':
      return sendResponse(id, {
        isIncomplete: false,
        items: COMPLETION_ITEMS,
      });

    case 'textDocument/formatting': {
      const doc = documents.get(params.textDocument.uri);
      if (!doc) return sendResponse(id, []);

      try {
        const formatted = format(doc);
        if (formatted === doc) return sendResponse(id, []);

        const lineCount = doc.split(/\r?\n/).length;
        return sendResponse(id, [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: lineCount, character: 0 },
            },
            newText: formatted,
          },
        ]);
      } catch (_) {
        return sendResponse(id, []);
      }
    }

    default:
      if (id !== undefined) {
        return sendResponse(id, null, {
          code: -32601,
          message: `Method not found: ${method}`,
        });
      }
  }
}

// ── Stream Reader ─────────────────────────────────────────────────────────────

function startServer() {
  let buffer = Buffer.alloc(0);

  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const headerText = buffer.slice(0, headerEnd).toString('ascii');
      const match = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const totalLength = headerEnd + 4 + contentLength;
      if (buffer.length < totalLength) break; // Wait for full body

      const bodyText = buffer.slice(headerEnd + 4, totalLength).toString('utf8');
      buffer = buffer.slice(totalLength);

      try {
        const req = JSON.parse(bodyText);
        handleRequest(req);
      } catch (e) {
        // malformed json
      }
    }
  });

  process.stdin.resume();
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer, handleRequest, validateDocument };
