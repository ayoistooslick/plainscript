// Tests for PlainScript v1.2  -  Telegram statements, inline objects, and the
// statement-level JavaScript block.
//
// Run with: node tests/telegram.test.js
// (Standalone harness; the main suite is tests/compiler.test.js.)

const vm = require('vm');
const { tokenize, TOKEN } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate, createGenerationContext, wrapAsync } = require('../compiler/generator');
const { format } = require('../compiler/formatter');

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

// Async tests are queued and joined before the summary (see bottom).
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
  const a = actual.trim();
  const e = expected.trim();
  if (a !== e) {
    throw new Error(`Expected:\n        ${e}\n        Got:\n        ${a}`);
  }
}

function compile(source) {
  return generate(parse(tokenize(source)));
}

// Compile PlainScript source the way `plainscript build` does (async runtime wrapper).
function compileProgram(source) {
  const context = createGenerationContext();
  let js = generate(parse(tokenize(source)), context);
  if (context.needsAsync) js = wrapAsync(js);
  return js;
}

// Execute generated Telegram JavaScript against a stubbed Telegram API.
//
// The stub serves two queued getUpdates batches  -  a "/menu" command, then a
// callback query on "about"  -  and records every other API call. Once the
// queue is empty it parks the poll loop (a never-resolved promise does not
// hold the event loop open), so the program settles deterministically.
function runTelegramProgram(js) {
  const calls = [];
  const updatesQueue = [
    [{ update_id: 1, message: { chat: { id: 42 }, text: '/menu' } }],
    [{
      update_id: 2,
      callback_query: {
        data: 'about',
        message: { chat: { id: 42 }, message_id: 10 },
      },
    }],
  ];
  const sandbox = {
    console,
    process: { env: {} },
    setTimeout,
    clearTimeout,
    fetch: async (url, opts) => {
      const method = url.split('/').pop();
      if (method === 'getUpdates') {
        const batch = updatesQueue.shift();
        if (!batch) return new Promise(() => {});
        return { json: async () => ({ ok: true, result: batch }) };
      }
      calls.push({ method, body: JSON.parse(opts.body), url });
      return { json: async () => ({ ok: true, result: {} }) };
    },
  };
  vm.runInNewContext(js, sandbox, { filename: 'generated-telegram.js' });
  return calls;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits until predicate() sees the recorded API calls, or times out.
async function waitFor(calls, predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !predicate(calls)) await sleep(25);
}

function tokenTypes(source) {
  return tokenize(source).map(t => t.type);
}

// ── Lexer ──────────────────────────────────────────────────────────────────

test('lexer: { } : -> are new tokens', () => {
  assert(
    JSON.stringify(tokenTypes('{ text: "hi" }')),
    JSON.stringify(['LBRACE', 'IDENTIFIER', 'COLON', 'STRING', 'RBRACE', 'EOF'])
  );
  assert(
    JSON.stringify(tokenTypes('"About" -> "about"')),
    JSON.stringify(['STRING', 'ARROW', 'STRING', 'EOF'])
  );
});

test('lexer: { } : -> carry line/col metadata', () => {
  const brace = tokenize('{')[0];
  if (brace.type !== 'LBRACE') throw new Error('expected LBRACE');
  if (brace.line !== 1 || brace.col !== 1) throw new Error('bad position');
});

// ── Parser ─────────────────────────────────────────────────────────────────

test('parser: when someone sends command block', () => {
  const ast = parse(tokenize('when someone sends "/start"\n  reply "hi"\ndone'));
  const stmt = ast.body[0];
  if (stmt.type !== 'TelegramCommandStatement') throw new Error('not TelegramCommandStatement');
  if (stmt.command !== '/start') throw new Error('wrong command');
  if (stmt.isPattern) throw new Error('should not be a pattern');
  if (stmt.body.length !== 1 || stmt.body[0].type !== 'ReplyStatement') {
    throw new Error('wrong body');
  }
});

test('parser: when someone sends matching pattern block', () => {
  const ast = parse(tokenize('when someone sends matching "/echo (.+)"\n  reply "echo"\ndone'));
  const stmt = ast.body[0];
  if (stmt.type !== 'TelegramCommandStatement') throw new Error('not TelegramCommandStatement');
  if (!stmt.isPattern) throw new Error('should be a pattern');
});

test('parser: when someone clicks callback block', () => {
  const ast = parse(tokenize('when someone clicks "about"\n  reply "About PlainScript"\ndone'));
  const stmt = ast.body[0];
  if (stmt.type !== 'TelegramCallbackStatement') throw new Error('not TelegramCallbackStatement');
  if (stmt.data !== 'about') throw new Error('wrong data');
});

test('parser: route shorthand still works (when someone visits)', () => {
  const ast = parse(tokenize('when someone visits "/"\n  reply "hi"\ndone'));
  if (ast.body[0].type !== 'RouteStatement') throw new Error('not RouteStatement');
});

test('parser: reply with buttons block', () => {
  const ast = parse(tokenize([
    'reply "Choose" with buttons',
    '  "About" -> "about"',
    'done',
  ].join('\n')));
  const stmt = ast.body[0];
  if (stmt.type !== 'ReplyWithButtonsStatement') throw new Error('not ReplyWithButtonsStatement');
  if (stmt.value.value !== 'Choose') throw new Error('wrong value');
  if (stmt.buttons.length !== 1) throw new Error('wrong row count');
  if (stmt.buttons[0][0].text !== 'About' || stmt.buttons[0][0].data !== 'about') {
    throw new Error('wrong button');
  }
});

test('parser: buttons rows split across blank lines', () => {
  const ast = parse(tokenize([
    'reply "Menu" with buttons',
    '  "A" -> "a", "B" -> "b"',
    '',
    '  "C" -> "c"',
    'done',
  ].join('\n')));
  const stmt = ast.body[0];
  if (stmt.buttons.length !== 2) throw new Error('expected 2 rows');
  if (stmt.buttons[0].length !== 2) throw new Error('first row should have 2 buttons');
  if (stmt.buttons[1].length !== 1) throw new Error('second row should have 1 button');
});

test('parser: start telegram bot', () => {
  const ast = parse(tokenize('start telegram bot'));
  if (ast.body[0].type !== 'TelegramStartStatement') throw new Error('not TelegramStartStatement');
});

test('parser: start still parses a port', () => {
  const ast = parse(tokenize('start 3000'));
  if (ast.body[0].type !== 'StartStatement') throw new Error('not StartStatement');
});

test('parser: inline object literal', () => {
  const ast = parse(tokenize('remember data as { text: "hi", n: 2 }'));
  const stmt = ast.body[0];
  if (stmt.type !== 'RememberStatement') throw new Error('not RememberStatement');
  if (stmt.value.type !== 'InlineObjectLiteral') throw new Error('not InlineObjectLiteral');
  if (stmt.value.properties.length !== 2) throw new Error('wrong property count');
});

// ── Generator ──────────────────────────────────────────────────────────────

test('generate: telegram command emits BOT.onCommand', () => {
  const js = compile('when someone sends "/start"\n  reply "hi"\ndone');
  if (!js.includes('BOT.onCommand("/start", async (ctx) => {')) {
    throw new Error(`missing onCommand:\n${js}`);
  }
  if (!js.includes('await Telegram.sendMessage(ctx.chatId, "hi");')) {
    throw new Error('reply did not become Telegram.sendMessage');
  }
});

test('generate: telegram pattern emits BOT.onPattern', () => {
  const js = compile('when someone sends matching "/echo (.+)"\n  reply "echo"\ndone');
  if (!js.includes('BOT.onPattern(new RegExp("/echo (.+)", \'i\'), async (ctx) => {')) {
    throw new Error(`missing onPattern:\n${js}`);
  }
});

test('generate: telegram callback emits BOT.onCallback', () => {
  const js = compile('when someone clicks "about"\n  reply "About"\ndone');
  if (!js.includes('BOT.onCallback("about", async (ctx) => {')) {
    throw new Error(`missing onCallback:\n${js}`);
  }
});

test('generate: reply with buttons includes keyboard rows', () => {
  const js = compile([
    'when someone sends "/menu"',
    '  reply "Choose" with buttons',
    '    "About" -> "about", "Help" -> "help"',
    '  done',
    'done',
  ].join('\n'));
  if (!js.includes('await Telegram.sendMessage(ctx.chatId, "Choose", [["About","about"],["Help","help"]]);')) {
    throw new Error(`missing buttons send:\n${js}`);
  }
});

test('generate: bot token call binds BOT via the Telegram module factory', () => {
  const js = compile('bot "0123456789:TEST"\nstart telegram bot');
  if (!js.includes('BOT = await Telegram.createTelegramBot("0123456789:TEST");')) {
    throw new Error(`missing bot binding:\n${js}`);
  }
  if (!js.includes('await BOT.start();')) {
    throw new Error('missing BOT.start()');
  }
});

test('generate: Telegram handlers expose update context values', () => {
  const js = compileProgram([
    'bot "0123456789:TEST"',
    'when someone sends matching "/echo (.+)"',
    '  remember answer as chatWith("groq", "model", message)',
    '  telegramCall("sendChatAction", {chat_id: chatId, action: "typing"})',
    '  reply answer',
    'done',
  ].join('\n'));
  if (!js.includes('ctx.message')) throw new Error('message context was not exposed');
  if (!js.includes('ctx.chatId')) throw new Error('chatId context was not exposed');
  if (!js.includes('Telegram.call("sendChatAction"')) throw new Error('raw Telegram API call missing');
});

test('generate: inline object literal renders { key: value }', () => {
  const js = compile('remember data as { text: "hi", n: 2 }\nshow data');
  if (!js.includes('let data = { "text": "hi", "n": 2 };')) {
    throw new Error(`bad inline object output:\n${js}`);
  }
});

// ── Formatter ──────────────────────────────────────────────────────────────

test('format: telegram blocks indent', () => {
  const out = format([
    'when someone sends "/start"',
    'reply "hi"',
    'done',
    'when someone clicks "about"',
    'reply "About"',
    'done',
  ].join('\n'));
  const lines = out.trim().split('\n');
  if (lines[0] !== 'when someone sends "/start"') throw new Error('bad first line');
  if (lines[1] !== '    reply "hi"') throw new Error('reply not indented');
  if (lines[2] !== 'done') throw new Error('done not dedented');
});

test('format: reply with buttons block indents button rows', () => {
  const out = format([
    'reply "Choose" with buttons',
    '"About" -> "about"',
    'done',
  ].join('\n'));
  const lines = out.trim().split('\n');
  if (lines[1] !== '    "About" -> "about"') throw new Error(`button row not indented: ${lines[1]}`);
  if (lines[2] !== 'done') throw new Error('done not dedented');
});

// ── End-to-end: rendered inline button executes its PlainScript callback ─────────

const BUTTONS_SOURCE = [
  'bot "0123456789:TEST"',
  'when someone sends "/menu"',
  '  reply "Choose" with buttons',
  '    "About" -> "about", "Help" -> "help"',
  '  done',
  'done',
  'when someone clicks "about"',
  '  reply "You clicked about!"',
  'done',
  'start telegram bot',
].join('\n');

testAsync('runtime: rendered inline button carries callback_data and executes its PlainScript callback', async () => {
  const calls = runTelegramProgram(compileProgram(BUTTONS_SOURCE));

  // 1. The /menu reply must render the inline keyboard with callback_data.
  await waitFor(calls, (c) => c.some(m => m.method === 'sendMessage' && m.body.reply_markup));
  const menu = calls.find(m => m.method === 'sendMessage' && m.body.reply_markup);
  if (!menu) throw new Error('no sendMessage with an inline keyboard was made');
  if (menu.body.chat_id !== 42) throw new Error('keyboard sent to the wrong chat');
  const flatButtons = menu.body.reply_markup.inline_keyboard.flat();
  const about = flatButtons.find(b => b.text === 'About');
  if (!about || about.callback_data !== 'about') {
    throw new Error(`"About" button missing callback_data "about": ${JSON.stringify(flatButtons)}`);
  }

  // 2. Pressing the button (callback_query update) must execute the PlainScript
  //    "when someone clicks" handler  -  proven by its reply reaching Telegram.
  await waitFor(calls, (c) => c.some(m => m.method === 'sendMessage' && m.body.text === 'You clicked about!'));
  const click = calls.find(m => m.method === 'sendMessage' && m.body.text === 'You clicked about!');
  if (!click) throw new Error('clicking the rendered button did not execute the PlainScript callback');
  if (click.body.chat_id !== 42) throw new Error('callback reply went to the wrong chat');
});

testAsync('runtime: bot token literal is used for API calls without TELEGRAM_BOT_TOKEN', async () => {
  const js = compileProgram(BUTTONS_SOURCE);
  if (!js.includes("createTelegramBot")) throw new Error('runtime factory missing');
  const calls = runTelegramProgram(js);
  await waitFor(calls, (c) => c.length > 0);
  for (const call of calls) {
    if (!call.url.includes('/bot0123456789:TEST/')) {
      throw new Error(`API call did not use the bot token from bot "...": ${call.url}`);
    }
  }
});

// ── Summary ────────────────────────────────────────────────────────────────

Promise.all(pendingTests).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
