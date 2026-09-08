// Tests for PlainScript v2.1.1 — WhatsApp bots and general string escapes.
//
//   language: multiline backtick strings, escape sequences (\n \t \\ \")
//   bots:     whatsapp bot … done with auth, login qr, login pairing,
//             on message, log message, message.text, reply
//   runtime:  Baileys socket startup, auth persistence, QR + pairing flows,
//             connection lifecycle/reconnect, self-message filtering — all
//             against a stubbed @whiskeysockets/baileys so the suite is
//             deterministic and network-free.
//
// Run with: node tests/whatsapp.test.js

const { execFileSync } = require('child_process');
const path = require('path');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate, createGenerationContext, wrapAsync } = require('../compiler/generator');
const { format } = require('../compiler/formatter');
const { detectDependencies } = require('../compiler/dependency-detector');
const { resolveDependencies } = require('../compiler/bundler');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

const pendingTests = [];
let lastTest = Promise.resolve();

function testAsync(name, fn) {
  const run = () => fn().then(
    () => { console.log(`  PASS  ${name}`); passed++; },
    (e) => { console.log(`  FAIL  ${name}`); console.log(`        ${e.message}`); failed++; },
  );
  lastTest = lastTest.then(run, run);
  pendingTests.push(lastTest);
}

function assert(actual, expected) {
  const a = String(actual).trim();
  const e = String(expected).trim();
  if (a !== e) throw new Error(`Expected:\n        ${e}\n        Got:\n        ${a}`);
}

function assertIncludes(actual, expected) {
  if (!String(actual).includes(expected)) {
    throw new Error(`Expected to include:\n        ${expected}\n        Got:\n        ${String(actual).trim()}`);
  }
}

function assertThrows(fn, fragment) {
  try {
    fn();
  } catch (e) {
    if (!String(e.message).includes(fragment)) {
      throw new Error(`Error message did not include "${fragment}":\n        ${e.message}`);
    }
    return;
  }
  throw new Error(`Expected an error containing "${fragment}", but nothing was thrown.`);
}

function compileProgram(source) {
  const context = createGenerationContext();
  let js = generate(parse(tokenize(source)), context);
  if (context.needsAsync) js = wrapAsync(js);
  return js;
}

function compileFile(file) {
  return compileProgram(require('fs').readFileSync(file, 'utf8'));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !predicate()) await sleep(20);
  if (!predicate()) throw new Error('Timed out waiting for a condition.');
}

// ── Stubbed Baileys runtime harness ─────────────────────────────────────────

// Executes a compiled WhatsApp program against a fake @whiskeysockets/baileys
// module. Returns the recorder so tests can fire socket events and inspect
// what the bot did.
async function runWhatsAppProgram(js, initialState = {}) {
  const recorder = {
    events: {},            // sock.ev.on registrations: name → handler
    socketConfigs: [],     // every makeWASocket(...) argument
    authFolders: [],       // every useMultiFileAuthState(folder)
    keyStoreWraps: [],     // every makeCacheableSignalKeyStore(keys) call
    saveCredsCalls: 0,     // creds.update → saveCreds persistence calls
    pairingRequests: [],   // requestPairingCode(phone) numbers
    sentMessages: [],      // sendMessage(chat, { text })
    downloads: [],         // downloadMediaMessage invocations
    filesWritten: [],      // media files saved via the download statement
    qrRendered: [],        // qrcode-terminal.generate(qr, options)
    logs: [],
    errors: [],
    timers: [],            // [fn, delayMs] captured instead of scheduled
    askPrompts: [],        // every prompt passed to rl.question(...)
    answers: [],           // queued console answers, shifted per ask
    credsRegistered: false,
    ...initialState,
  };

  const sock = {
    authState: {
      get creds() { return { registered: recorder.credsRegistered }; },
    },
    ev: {
      on: (name, handler) => { recorder.events[name] = handler; },
    },
    sendMessage: async (chat, content) => {
      recorder.sentMessages.push({ chat, text: content.text });
      return { key: { id: 'SENT' } };
    },
    requestPairingCode: async (phone) => {
      recorder.pairingRequests.push(phone);
      return 'ABCD1234';
    },
    updateMediaMessage: async (msg) => ({ content: msg }),
  };

  const baileysStub = {
    default: (config) => { recorder.socketConfigs.push(config); return sock; },
    useMultiFileAuthState: async (folder) => {
      recorder.authFolders.push(folder);
      return {
        state: { creds: { get registered() { return recorder.credsRegistered; } }, keys: {} },
        saveCreds: () => { recorder.saveCredsCalls++; },
      };
    },
    fetchLatestBaileysVersion: async () => ({ version: [6, 7, 18] }),
    makeCacheableSignalKeyStore: (keys) => { recorder.keyStoreWraps.push({ keys }); return keys; },
    downloadMediaMessage: async (msg, type, mime, opts) => { recorder.downloads.push({ msg: msg.key.id, type }); return Buffer.from('FAKEMEDIA'); },
    DisconnectReason: {
      loggedOut: 401, connectionClosed: 428, connectionLost: 409,
      timedOut: 408, restartedRequired: 515,
    },
    Browsers: { windows: (browser) => ['Windows', browser, '10.0.0'] },
  };
  const qrcodeStub = {
    generate: (qr, options) => recorder.qrRendered.push({ qr, options }),
  };
  const readlineStub = {
    createInterface: () => ({
      question: (prompt, cb) => {
        recorder.askPrompts.push(prompt);
        cb(recorder.answers.length > 0 ? recorder.answers.shift() : '');
      },
      close: () => {},
    }),
  };
  const tmpRoot = (() => {
    const os = require('os');
    const pathmod = require('path');
    const dir = pathmod.join(os.tmpdir(), 'ps-wa-test-' + process.pid);
    require('fs').mkdirSync(dir, { recursive: true });
    return dir;
  })();
  const sandboxFs = {
    mkdirSync: (dir) => { require('fs').mkdirSync(dir, { recursive: true }); },
    writeFileSync: (dest, buffer) => {
      recorder.writeDest = dest;
      recorder.sandboxTmpRoot = tmpRoot;
      const resolved = dest.startsWith('/') ? dest : require('path').join(tmpRoot, dest);
      require('fs').mkdirSync(require('path').dirname(resolved), { recursive: true });
      require('fs').writeFileSync(resolved, buffer);
      recorder.filesWritten.push(resolved);
    },
  };

  const sandboxConsole = {
    log: (...args) => {
      const [first] = args;
      recorder.logs.push(
        args.length === 1 && first !== null && typeof first === 'object'
          ? JSON.stringify(first)
          : args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
      );
    },
    error: (...args) => recorder.errors.push(args.map(a => (a instanceof Error ? a.stack : String(a))).join('\n')),
  };
  const stubRequire = (name) => {
    if (name === '@qwerty-xcv/baileys' || name === '@whiskeysockets/baileys') return baileysStub;
    if (name === 'qrcode-terminal') return qrcodeStub;
    if (name === 'readline') return readlineStub;
    if (name === 'fs') return sandboxFs;
    if (name === 'path') return require('path');
    throw new Error('Unexpected require in test: ' + name);
  };

  const match = js.match(/^\(async \(\) => \{\n([\s\S]*)\n\}\)\(\);$/);
  const body = match ? `return (async () => {\n${match[1]}\n})();` : `${js}\n;return undefined;`;
  const program = new Function('require', 'console', 'setTimeout', body)(
    stubRequire,
    sandboxConsole,
    (fn, delay) => { recorder.timers.push([fn, delay]); return {}; },
  );
  await Promise.resolve(program); // let __whatsappStart finish registering handlers
  await sleep(10);

  recorder.sock = sock;
  return recorder;
}

// A mock Baileys message in the shape messages.upsert delivers.
function mockMessage(text, overrides = {}) {
  return {
    key: Object.assign({
      remoteJid: '2348012345678@s.whatsapp.net',
      fromMe: false,
      id: 'MSG' + Math.floor(Math.random() * 100000),
    }, overrides.key || {}),
    pushName: overrides.pushName !== undefined ? overrides.pushName : 'Ada',
    messageTimestamp: overrides.messageTimestamp !== undefined ? overrides.messageTimestamp : 1700000000,
    message: overrides.message !== undefined ? overrides.message : { conversation: text },
  };
}

const PAIRING_SOURCE = [
  'whatsapp bot',
  '    auth "session"',
  '    login pairing "2348012345678"',
  '',
  '    on message',
  '        log message',
  '',
  '        if message.text is "/start"',
  '            reply "Welcome!"',
  '        done',
  '',
  '        if message.text is "/help"',
  '            reply `Available commands:',
  '/start /help`',
  '        done',
  '    done',
  'done',
].join('\n');

const QR_SOURCE = [
  'whatsapp bot',
  '    auth "session"',
  '    login qr',
  '',
  '    on message',
  '        log message',
  '    done',
  'done',
].join('\n');

const RICH_SOURCE = [
  'whatsapp bot',
  '    auth "session"',
  '    login qr',
  '',
  '    on message',
  '        log message',
  '',
  '        if message.type is "image"',
  '            download "downloads/bot-media.jpg"',
  '            reply "saved image"',
  '        done',
  '',
  '        if message.type is "button"',
  '            reply "button pressed"',
  '        done',
  '',
  '        if message.type is "list"',
  '            reply "list chosen"',
  '        done',
  '    done',
  'done',
].join('\n');

// ── 1. Compiler / check ─────────────────────────────────────────────────────

test('check: the finalized pairing example passes plainscript check', () => {
  const file = path.join(__dirname, '..', 'examples', 'whatsapp-bot', 'pairing.pln');
  resolveDependencies(path.resolve(file)); // same gate cmdCheck runs
});

test('check: the QR example passes plainscript check', () => {
  const file = path.join(__dirname, '..', 'examples', 'whatsapp-bot', 'qr.pln');
  resolveDependencies(path.resolve(file));
});

test('cli: node compiler/cli.js check exits cleanly for both examples', () => {
  const cli = path.join(__dirname, '..', 'compiler', 'cli.js');
  for (const name of ['pairing.pln', 'qr.pln']) {
    execFileSync(process.execPath, [cli, 'check', path.join(__dirname, '..', 'examples', 'whatsapp-bot', name)], { stdio: 'pipe' });
  }
});

test('dependencies: whatsapp bots map to Baileys and qrcode-terminal', () => {
  assertIncludes(JSON.stringify(detectDependencies(QR_SOURCE)), '@qwerty-xcv/baileys');
  assertIncludes(JSON.stringify(detectDependencies(QR_SOURCE)), 'qrcode-terminal');
});

// ── 2. Generated JavaScript (deterministic compiler only) ───────────────────

test('generate: whatsapp bot compiles to __whatsappStart with folder and pairing phone', () => {
  const js = compileProgram(PAIRING_SOURCE);
  assertIncludes(js, 'await __whatsappStart({');
  assertIncludes(js, 'folder: "session"');
  assertIncludes(js, `login: { mode: 'pairing', phone: "2348012345678" }`);
});

test('generate: login qr compiles to the qr mode', () => {
  const js = compileProgram(QR_SOURCE);
  assertIncludes(js, `login: { mode: 'qr' }`);
});

test('generate: compilation is deterministic (same source → byte-identical output)', () => {
  const first = compileProgram(PAIRING_SOURCE);
  const second = compileProgram(PAIRING_SOURCE);
  if (first !== second) throw new Error('Two compilations of the same source differ.');
});

test('generate: log message emits a console.log of the normalized record', () => {
  const js = compileProgram(PAIRING_SOURCE);
  assertIncludes(js, '__whatsappOnMessage(async (__waCtx) => {');
  assertIncludes(js, 'console.log(__waCtx.message);');
});

test('generate: message.text comparisons and replies target the current chat', () => {
  const js = compileProgram(PAIRING_SOURCE);
  assertIncludes(js, 'if (__waCtx.message.text === "/start") {');
  assertIncludes(js, 'await __whatsappReply(__waCtx.chat, "Welcome!");');
  assertIncludes(js, 'if (__waCtx.message.text === "/help") {');
  assertIncludes(js, 'await __whatsappReply(__waCtx.chat, `Available commands:\\n/start /help`)'.replace('\\n', '\n'));
});

test('compile errors: invalid pairing phones are rejected at compile time', () => {
  assertThrows(() => compileProgram('whatsapp bot\n    login pairing "abc"\ndone'), 'not a valid phone number');
  assertThrows(() => compileProgram('whatsapp bot\n    login pairing "1234567"\ndone'), '8 to 15 digits');
  assertThrows(() => compileProgram('whatsapp bot\n    login pairing "12345678901234567890"\ndone'), '8 to 15 digits');
  assertThrows(() => compileProgram('whatsapp bot\n    login pairing ""\ndone'), 'not a valid phone number');
});

test('parser: separators and a leading plus are normalized away', () => {
  const ast = parse(tokenize('whatsapp bot\n    login pairing "+234 801-234-5678"\ndone'));
  const bot = ast.body[0];
  if (bot.login.phone !== '2348012345678') {
    throw new Error(`expected normalized digits, got ${bot.login.phone}`);
  }
});

test('parser: no login means null login (handlers-only mode for hybrid bots)', () => {
  const ast = parse(tokenize('whatsapp bot\n    on message\n        log message\n    done\ndone'));
  const bot = ast.body[0];
  if (bot.authFolder !== 'plainscript-whatsapp-auth') throw new Error('bad default auth folder');
  if (bot.login !== null) throw new Error('expected null login when no login line present');
});

test('compile errors: unknown statements inside whatsapp bot are teaching errors', () => {
  assertThrows(
    () => compileProgram('whatsapp bot\n    show "hi"\ndone'),
    'may only contain'
  );
});

test('compile errors: log message outside on message is rejected', () => {
  assertThrows(() => compileProgram('log message'), 'can only be used inside an "on message" block');
});

test('formatter: whatsapp blocks indent their bodies', () => {
  const out = format([
    'whatsapp bot',
    'auth "session"',
    'login qr',
    'on message',
    'log message',
    'done',
    'done',
  ].join('\n'));
  const lines = out.trim().split('\n');
  if (lines[1] !== '    auth "session"') throw new Error(`auth not indented: ${lines[1]}`);
  if (lines[3] !== '    on message') throw new Error(`on message not indented: ${lines[3]}`);
  if (lines[4] !== '        log message') throw new Error(`log not indented: ${lines[4]}`);
  if (lines[5] !== '    done') throw new Error(`handler done not dedented: ${lines[5]}`);
  if (lines[6] !== 'done') throw new Error(`bot done not dedented: ${lines[6]}`);
});

// ── 11. Multiline backtick strings (general lexer feature) ──────────────────

test('lexer: multiline backtick strings preserve the newline as characters', () => {
  const tokens = tokenize('reply `heyy\nhow you dey?`');
  const template = tokens.find(t => t.type === 'TEMPLATE_STRING');
  if (!template) throw new Error('no TEMPLATE_STRING token');
  if (template.value !== 'heyy\nhow you dey?') {
    throw new Error(`newline not preserved: ${JSON.stringify(template.value)}`);
  }
});

test('lexer: an escaped backtick does not terminate a backtick string', () => {
  const tokens = tokenize('show `a\\`b`');
  const template = tokens.find(t => t.type === 'TEMPLATE_STRING');
  if (!template) throw new Error('escaped backtick closed the string early');
  assertIncludes(template.value, '\\`');
});

test('lexer: double-quoted strings decode normal escapes', () => {
  const value = tokenize('show "line\\nnext\\tend\\\\end\\"quoted\\""' )[0 + 1].value;
  if (value !== 'line\nnext\tend\\end"quoted"') {
    throw new Error(`escapes wrong: ${JSON.stringify(value)}`);
  }
});

test('lexer: quoted-string behaviour without escapes is unchanged', () => {
  const value = tokenize('show "plain text"')[1].value;
  if (value !== 'plain text') throw new Error(`changed: ${JSON.stringify(value)}`);
});

test('runtime: multiline backtick reply keeps its newline end to end', () => {
  const logs = [];
  const js = compileProgram('show `heyy\nhow you dey?`');
  new Function('console', js)({ log: (...args) => logs.push(args.join(' ')) });
  assert(logs.join('\n'), 'heyy\nhow you dey?');
});

test('runtime: interpolation inside backticks still works', () => {
  const logs = [];
  const js = compileProgram('remember name as "Ada"\nshow `Hi ${name}!`');
  new Function('console', js)({ log: (...args) => logs.push(args.join(' ')) });
  assert(logs.join('\n'), 'Hi Ada!');
});

test('runtime: escaped quotes and tabs evaluate to the intended characters', () => {
  const logs = [];
  const js = compileProgram('show "say \\"hi\\" now"');
  new Function('console', js)({ log: (...args) => logs.push(args.join(' ')) });
  assert(logs.join('\n'), 'say "hi" now');
});

// ── 3–10. Runtime integration against a stubbed Baileys ─────────────────────

testAsync('runtime: startup creates the Baileys socket and registers lifecycle handlers', async () => {
  const rec = await runWhatsAppProgram(compileProgram(QR_SOURCE));
  if (rec.socketConfigs.length !== 1) throw new Error('makeWASocket was not called exactly once');
  for (const event of ['connection.update', 'creds.update', 'messages.upsert']) {
    if (typeof rec.events[event] !== 'function') throw new Error(`handler missing for ${event}`);
  }
});

testAsync('runtime: the socket uses the proven pairing-safe settings', async () => {
  const rec = await runWhatsAppProgram(compileProgram(PAIRING_SOURCE));
  const config = rec.socketConfigs[0];
  if (!config) throw new Error('makeWASocket was never called');
  if (JSON.stringify(config.browser) !== JSON.stringify(['Mac Os', 'chrome', '121.0.6167.159'])) {
    throw new Error(`browser mismatch: ${JSON.stringify(config.browser)}`);
  }
  if (JSON.stringify(config.version) !== JSON.stringify([2, 2413, 1])) {
    throw new Error(`fixed Baileys version not applied: ${JSON.stringify(config.version)}`);
  }
  for (const [key, expected] of [
    ['syncFullHistory', false],
    ['markOnlineOnConnect', false],
    ['defaultQueryTimeoutMs', 60000],
    ['keepAliveIntervalMs', 50000],
    ['printQRInTerminal', false],
    ['generateHighQualityLinkPreview', true],
  ]) {
    if (config[key] !== expected) throw new Error(`${key} should be ${expected}, got ${config[key]}`);
  }
  if (rec.keyStoreWraps.length !== 1 || !config.auth || !config.auth.creds || !config.auth.keys) {
    throw new Error('auth must carry creds with keys wrapped by makeCacheableSignalKeyStore');
  }
});

testAsync('runtime: auth/session persists through the declared folder and saveCreds', async () => {
  const rec = await runWhatsAppProgram(compileProgram(QR_SOURCE));
  if (JSON.stringify(rec.authFolders) !== JSON.stringify(['session'])) {
    throw new Error(`useMultiFileAuthState got folders ${JSON.stringify(rec.authFolders)}`);
  }
  rec.events['creds.update']({});
  if (rec.saveCredsCalls !== 1) throw new Error('creds.update did not persist credentials via saveCreds');
});

testAsync('pairing flow: a fresh session requests a code 2s after socket creation', async () => {
  const rec = await runWhatsAppProgram(compileProgram(PAIRING_SOURCE));
  // The code is requested by a timer scheduled at socket-creation time — no
  // QR event or any other trigger may be involved.
  const pairTimer = rec.timers.find(([fn, delay]) => delay === 2000);
  if (!pairTimer) throw new Error(`expected a 2000ms pairing timer, got ${JSON.stringify(rec.timers.map(t => t[1]))}`);
  if (rec.pairingRequests.length !== 0) throw new Error('pairing code was requested before the 2 second delay');
  pairTimer[0]();
  await waitFor(() => rec.pairingRequests.length > 0);
  if (rec.pairingRequests[0] !== '2348012345678') {
    throw new Error(`requestPairingCode received ${rec.pairingRequests[0]}`);
  }
  assertIncludes(rec.logs.join('\n'), 'WhatsApp pairing code: ABCD-1234');
});

testAsync('pairing flow: an already-registered session never re-pairs', async () => {
  const rec = await runWhatsAppProgram(compileProgram(PAIRING_SOURCE), { credsRegistered: true });
  await sleep(50);
  for (const [fn] of rec.timers) fn(); // flush every pending timer
  if (rec.pairingRequests.length !== 0) throw new Error('paired device requested another code');
});

testAsync('qr flow: a fresh session renders the QR in the terminal', async () => {
  const rec = await runWhatsAppProgram(compileProgram(QR_SOURCE));
  rec.events['connection.update']({ qr: 'QRDATA', connection: 'connecting' });
  await waitFor(() => rec.qrRendered.length > 0);
  if (rec.qrRendered[0].qr !== 'QRDATA') throw new Error('wrong QR payload rendered');
  if (rec.qrRendered[0].options.small !== true) throw new Error('QR not rendered small');
  if (rec.pairingRequests.length !== 0) throw new Error('qr mode must not request a pairing code');
});

testAsync('lifecycle: transient close schedules a reconnect after 3 seconds', async () => {
  const rec = await runWhatsAppProgram(compileProgram(QR_SOURCE));
  rec.events['connection.update']({
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 428 }, message: 'Connection Closed' } },
  });
  await sleep(20);
  if (rec.timers.length !== 1) throw new Error(`expected one reconnect timer, got ${rec.timers.length}`);
  if (rec.timers[0][1] !== 3000) throw new Error(`reconnect delay should be 3000ms, got ${rec.timers[0][1]}`);
  if (typeof rec.timers[0][0] !== 'function') throw new Error('reconnect timer carries no function');
});

testAsync('lifecycle: loggedOut closes never reconnect and teach the fix', async () => {
  const rec = await runWhatsAppProgram(compileProgram(QR_SOURCE));
  rec.events['connection.update']({
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 401 }, message: 'Logged Out' } },
  });
  await sleep(20);
  if (rec.timers.length !== 0) throw new Error('must not reconnect after being logged out');
  assertIncludes(rec.errors.join('\n'), 'signed out');
  assertIncludes(rec.errors.join('\n'), '"session"');
});

testAsync('mock message: notify upserts reach the handler as a normalized record', async () => {
  const rec = await runWhatsAppProgram(compileProgram(PAIRING_SOURCE));
  rec.events['messages.upsert']({
    type: 'notify',
    messages: [mockMessage('/start')],
  });
  await waitFor(() => rec.sentMessages.length > 0);
  const sent = rec.sentMessages[0];
  if (sent.chat !== '2348012345678@s.whatsapp.net') throw new Error(`reply went to ${sent.chat}`);
  if (sent.text !== 'Welcome!') throw new Error(`/start replied "${sent.text}"`);
});

testAsync('self-protection: the bot never reacts to its own messages', async () => {
  const rec = await runWhatsAppProgram(compileProgram(PAIRING_SOURCE));
  rec.events['messages.upsert']({
    type: 'notify',
    messages: [mockMessage('/start', { key: { fromMe: true } })],
  });
  await sleep(50);
  if (rec.sentMessages.length !== 0) throw new Error('the bot answered itself');
  if (rec.logs.length !== 0) throw new Error('self-messages still reached handlers');
});

testAsync('filtering: non-notify upserts and status broadcasts are ignored', async () => {
  const rec = await runWhatsAppProgram(compileProgram(PAIRING_SOURCE));
  rec.events['messages.upsert']({ type: 'append', messages: [mockMessage('/start')] });
  rec.events['messages.upsert']({
    type: 'notify',
    messages: [mockMessage('hello status', { key: { remoteJid: 'status@broadcast' } })],
  });
  await sleep(50);
  if (rec.sentMessages.length !== 0) throw new Error('filtered deliveries still reached handlers');
});

testAsync('log message: prints the full normalized message record', async () => {
  const rec = await runWhatsAppProgram(compileProgram(PAIRING_SOURCE));
  rec.events['messages.upsert']({
    type: 'notify',
    messages: [mockMessage('just logging', { pushName: 'Grace', messageTimestamp: 1700000001 })],
  });
  await waitFor(() => rec.logs.length > 0 && rec.logs[0].includes('just logging'));
  const printed = JSON.parse(rec.logs[0]);
  if (printed.text !== 'just logging') throw new Error(`record text wrong: ${printed.text}`);
  if (printed.chat !== '2348012345678@s.whatsapp.net') throw new Error(`record chat wrong: ${printed.chat}`);
  if (printed.name !== 'Grace') throw new Error(`record name wrong: ${printed.name}`);
  if (printed.time !== 1700000001000) throw new Error(`record time wrong: ${printed.time}`);
  if (printed.isGroup !== false) throw new Error('group flag wrong');
});

testAsync('message.text: /help replies with the multiline command list', async () => {
  const rec = await runWhatsAppProgram(compileProgram(PAIRING_SOURCE));
  rec.events['messages.upsert']({
    type: 'notify',
    messages: [mockMessage('/help')],
  });
  await waitFor(() => rec.sentMessages.length > 0);
  const sent = rec.sentMessages[0];
  if (sent.text !== 'Available commands:\n/start /help') {
    throw new Error(`multiline help lost its newline: ${JSON.stringify(sent.text)}`);
  }
});

testAsync('message normalization: groups keep the participant as sender', async () => {
  const rec = await runWhatsAppProgram(compileProgram(PAIRING_SOURCE));
  rec.events['messages.upsert']({
    type: 'notify',
    messages: [mockMessage('/start', {
      key: { remoteJid: '12035@g.us', fromMe: false, participant: '2348012345678@s.whatsapp.net' },
      pushName: null,
    })],
  });
  await waitFor(() => rec.sentMessages.length > 0);
  const printed = JSON.parse(rec.logs[0]);
  if (printed.sender !== '2348012345678@s.whatsapp.net') throw new Error(`sender wrong: ${printed.sender}`);
  if (printed.isGroup !== true) throw new Error('group flag wrong');
  if (rec.sentMessages[0].chat !== '12035@g.us') throw new Error('group reply went to the wrong chat');
});

testAsync('normalization: wrapped and captioned messages expose their text', async () => {
  const rec = await runWhatsAppProgram(compileProgram(PAIRING_SOURCE));
  rec.events['messages.upsert']({
    type: 'notify',
    messages: [
      mockMessage('', { message: { ephemeralMessage: { message: { conversation: 'wrapped hello' } } } }),
      mockMessage('', { message: { imageMessage: { caption: 'photo caption' } } }),
    ],
  });
  await waitFor(() => rec.logs.filter(l => l.includes('hello') || l.includes('caption')).length >= 2);
  const texts = rec.logs.map(l => { try { return JSON.parse(l).text; } catch (_) { return ''; } });
  if (!texts.includes('wrapped hello')) throw new Error('ephemeral wrapper not unwrapped');
  if (!texts.includes('photo caption')) throw new Error('image caption not extracted');
});

testAsync('rich record: image messages expose type, mtype, caption and download media', async () => {
  const rec = await runWhatsAppProgram(compileProgram(RICH_SOURCE));
  rec.events['messages.upsert']({
    type: 'notify',
    messages: [mockMessage('', { message: { imageMessage: { caption: 'holiday snap', url: 'http://x/y.jpg' } } })],
  });
  try {
    await waitFor(() => rec.logs.some(l => l.includes('holiday snap')));
    await waitFor(() => rec.downloads.length > 0 && rec.filesWritten.length > 0);
    await waitFor(() => rec.sentMessages.some(m => m.text === 'saved image'));
  } catch (e) {
    throw new Error(e.message + ' | errors=' + JSON.stringify(rec.errors) + ' | logs=' + JSON.stringify(rec.logs) + ' | downloads=' + JSON.stringify(rec.downloads) + ' | files=' + JSON.stringify(rec.filesWritten) + ' | writeDest=' + JSON.stringify(rec.writeDest) + ' | tmpRoot=' + JSON.stringify(rec.sandboxTmpRoot) + ' | sent=' + JSON.stringify(rec.sentMessages));
  }
  const printed = JSON.parse(rec.logs.find(l => l.includes('holiday snap')));
  if (printed.type !== 'image') throw new Error(`type should be image, got ${printed.type}`);
  if (printed.mtype !== 'imageMessage') throw new Error(`mtype should be imageMessage, got ${printed.mtype}`);
  if (printed.caption !== 'holiday snap') throw new Error(`caption wrong: ${printed.caption}`);
  if (printed.buttonId !== null) throw new Error(`buttonId should be null for images, got ${printed.buttonId}`);
  if (rec.downloads[0].type !== 'buffer') throw new Error('downloadMediaMessage not called as buffer');
  if (rec.filesWritten.length !== 1) throw new Error('media was not saved to a file; files=' + JSON.stringify(rec.filesWritten));
  if (!rec.sentMessages.some(m => m.text === 'saved image')) throw new Error('image branch did not reply');
});

testAsync('rich record: button replies carry the selected id', async () => {
  const rec = await runWhatsAppProgram(compileProgram(RICH_SOURCE));
  rec.events['messages.upsert']({
    type: 'notify',
    messages: [mockMessage('', { message: { buttonsResponseMessage: { selectedButtonId: 'yes', selectedDisplayText: 'Yes' } } })],
  });
  await waitFor(() => rec.sentMessages.length > 0);
  const printed = JSON.parse(rec.logs.find(l => l.includes('yes')));
  if (printed.type !== 'button') throw new Error(`type should be button, got ${printed.type}`);
  if (printed.buttonId !== 'yes') throw new Error(`buttonId wrong: ${printed.buttonId}`);
  if (!rec.sentMessages.some(m => m.text === 'button pressed')) throw new Error('button branch did not reply');
});

testAsync('rich record: list replies carry the selected row id', async () => {
  const rec = await runWhatsAppProgram(compileProgram(RICH_SOURCE));
  rec.events['messages.upsert']({
    type: 'notify',
    messages: [mockMessage('', { message: { listResponseMessage: { singleSelectReply: { selectedRowId: 'opt2', selectedRowTitle: 'Option 2' } } } })],
  });
  await waitFor(() => rec.sentMessages.length > 0);
  const printed = JSON.parse(rec.logs.find(l => l.includes('opt2')));
  if (printed.type !== 'list') throw new Error(`type should be list, got ${printed.type}`);
  if (printed.buttonId !== 'opt2') throw new Error(`row id wrong: ${printed.buttonId}`);
  if (!rec.sentMessages.some(m => m.text === 'list chosen')) throw new Error('list branch did not reply');
});

testAsync('reply failure teaches instead of crashing the process', async () => {
  const rec = await runWhatsAppProgram(compileProgram(PAIRING_SOURCE));
  rec.sock.sendMessage = async () => { throw new Error('socket gone'); };
  rec.events['messages.upsert']({
    type: 'notify',
    messages: [mockMessage('/start')],
  });
  await sleep(50);  // The process survives: no exception escaped the runtime's error boundary.
});

testAsync('acceptance: the compiled example files boot against real-shaped events', async () => {
  const pairingJs = compileFile(path.join(__dirname, '..', 'examples', 'whatsapp-bot', 'pairing.pln'));
  const qrJs = compileFile(path.join(__dirname, '..', 'examples', 'whatsapp-bot', 'qr.pln'));

  const recPairing = await runWhatsAppProgram(pairingJs);
  recPairing.events['messages.upsert']({ type: 'notify', messages: [mockMessage('/start')] });
  await waitFor(() => recPairing.sentMessages.length > 0);
  if (recPairing.sentMessages[0].text !== 'Welcome!') throw new Error('example /start broken');

  const recQr = await runWhatsAppProgram(qrJs);
  recQr.events['messages.upsert']({ type: 'notify', messages: [mockMessage('/anything')] });
  await waitFor(() => recQr.logs.length > 0);
  if (!JSON.parse(recQr.logs[0]).text) throw new Error('qr example logging broken');
});

// ── v2.1.2 — ask (general console input) + login pairing with a value ───────

const ASK_PAIRING_SOURCE = [
  'ask "WhatsApp number: " as phone',
  '',
  'whatsapp bot',
  '    auth "session"',
  '    login pairing phone',
  '',
  '    on message',
  '        log message',
  '    done',
  'done',
].join('\n');

test('compiler: login pairing accepts a value, not only a string literal', () => {
  const bot = parse(tokenize(ASK_PAIRING_SOURCE)).body.find((n) => n.type === 'WhatsAppBotStatement');
  if (!bot) throw new Error('whatsapp bot statement missing');
  if (bot.login.mode !== 'pairing') throw new Error('login mode wrong');
  if (!bot.login.phoneExpr || bot.login.phoneExpr.name !== 'phone') {
    throw new Error(`expected the phone expression, got ${JSON.stringify(bot.login)}`);
  }
});

test('compiler: login pairing still parses the literal form with compile-time validation', () => {
  const bot = parse(tokenize(PAIRING_SOURCE)).body.find((n) => n.type === 'WhatsAppBotStatement');
  if (bot.login.mode !== 'pairing' || bot.login.phone !== '2348012345678' || bot.login.phoneExpr) {
    throw new Error(`literal form broken: ${JSON.stringify(bot.login)}`);
  }
  assertThrows(
    () => parse(tokenize('whatsapp bot\nlogin pairing "abc"\ndone')),
    'is not a valid phone number for "login pairing"',
  );
});

test('generate: the pairing phone flows from the variable into the runtime options', () => {
  const js = compileProgram(ASK_PAIRING_SOURCE);
  if (!js.includes("login: { mode: 'pairing', phone: (phone) },") && !js.includes("login: { mode: 'pairing', phone:(phone) },")) {
    throw new Error('expected the variable to be passed through:\n' +
      js.split('\n').filter((l) => l.includes('login:')).join('\n'));
  }
});

test('compiler: ask + expression pairing compiles deterministically and formats cleanly', () => {
  const first = compileProgram(ASK_PAIRING_SOURCE);
  const second = compileProgram(ASK_PAIRING_SOURCE);
  if (first !== second) throw new Error('compilation is not deterministic');
  const formatted = format(ASK_PAIRING_SOURCE);
  if (!formatted.includes('login pairing phone')) throw new Error('formatter lost the value form');
});

testAsync('runtime: ask reads console input asynchronously into the variable', async () => {
  const rec = await runWhatsAppProgram(compileProgram('ask "Name: " as name\nshow name'), {
    answers: ['Ada Lovelace'],
  });
  if (rec.askPrompts[0] !== 'Name: ') {
    throw new Error(`wrong prompt: ${JSON.stringify(rec.askPrompts[0])}`);
  }
  await sleep(10);
  const printed = rec.logs.join('|');
  if (!printed.includes('Ada Lovelace')) throw new Error(`answer not bound to the variable: ${printed}`);
});

testAsync('runtime: ask feeds login pairing end to end', async () => {
  const rec = await runWhatsAppProgram(compileProgram(ASK_PAIRING_SOURCE), {
    answers: ['2348012345678'],
  });
  if (rec.askPrompts[0] !== 'WhatsApp number: ') throw new Error('prompt never reached readline');
  if (rec.socketConfigs.length !== 1) throw new Error('socket not started after the answer');
  const pairTimer = rec.timers.find(([fn, delay]) => delay === 2000);
  if (!pairTimer) throw new Error('the 2s pairing timer was not scheduled');
  if (rec.pairingRequests.length !== 0) throw new Error('paired before the 2s wait');
  pairTimer[0]();
  await waitFor(() => rec.pairingRequests.length > 0);
  if (rec.pairingRequests[0] !== '2348012345678') {
    throw new Error(`pairing used ${rec.pairingRequests[0]} instead of the typed number`);
  }
  if (rec.qrRendered.length !== 0) throw new Error('value-based pairing fell back to QR');
});

testAsync('runtime: a bad runtime phone value teaches instead of crashing silently', async () => {
  let message = null;
  try {
    await runWhatsAppProgram(compileProgram(ASK_PAIRING_SOURCE), { answers: ['hello'] });
  } catch (e) {
    message = e.message;
  }
  if (!message || !message.includes('is not a valid pairing phone number')) {
    throw new Error(`expected the teaching error, got: ${message}`);
  }
});

// ── Summary ─────────────────────────────────────────────────────────────────

Promise.all(pendingTests).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
