// Interactive Terminal REPL for PlainScript.
// Supports multiline input, block detection, persistent session context,
// AST/JS inspection, and instant expression evaluation.

const readline = require('readline');
const vm       = require('vm');
const util     = require('util');
const { tokenize, TOKEN } = require('./lexer');
const { parse }           = require('./parser');
const { generate, createGenerationContext, wrapAsync } = require('./generator');
const { formatDiagnostic } = require('./diagnostics');
const { VERSION }          = require('./version');

const HAS_COLOR = Boolean(process.stdout && process.stdout.isTTY);
const c = (code, str) => HAS_COLOR ? `\x1b[${code}m${str}\x1b[0m` : str;
const boldCyan  = (s) => c('1;36', s);
const boldGreen = (s) => c('1;32', s);
const boldYellow= (s) => c('1;33', s);
const dim       = (s) => c('2',    s);

// Keywords that open a block requiring a matching "done"
const BLOCK_OPENERS = [
  'if', 'make', 'define', 'function', 'for', 'while', 'when',
  'try', 'match', 'switch', 'web', 'route', 'database', 'retry',
  'bot', 'gather', 'filter', 'stream', 'schedule'
];

function needsMoreInput(code) {
  const trimmed = code.trim();
  if (!trimmed) return false;

  // Check brackets balance
  let parens = 0, brackets = 0, braces = 0;
  for (const ch of trimmed) {
    if (ch === '(') parens++;
    else if (ch === ')') parens--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
    else if (ch === '{') braces++;
    else if (ch === '}') braces--;
  }
  if (parens > 0 || brackets > 0 || braces > 0) return true;

  // Check block opener count vs "done" / "end"
  try {
    const tokens = tokenize(code);
    let openCount = 0;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === TOKEN.DONE || t.type === TOKEN.END) {
        openCount = Math.max(0, openCount - 1);
      } else if (BLOCK_OPENERS.includes(String(t.value).toLowerCase())) {
        // Special case: "route" keyword inside a "web app" block
        openCount++;
      } else if (t.type === TOKEN.IDENTIFIER && t.value === 'kind' && i > 0 && tokens[i - 1].value === 'a') {
        openCount++;
      }
    }
    return openCount > 0;
  } catch (_) {
    // If lexing failed because of an unclosed string or template, wait for more
    if (/unterminated string/i.test(_.message)) return true;
    return false;
  }
}

function startRepl() {
  console.log(`${boldCyan('PlainScript')} ${boldGreen(`v${VERSION}`)} ${dim('· Interactive Intent-Oriented REPL')}`);
  console.log(`Type ${boldYellow('.help')} for commands, ${boldYellow('.exit')} or Ctrl+D to exit.\n`);

  // Shared persistent sandbox context
  const sandbox = {
    console,
    process,
    require,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  const vmContext = vm.createContext(sandbox);

  let showAst = false;
  let showJs = false;
  let buffer = '';

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'pln> ',
  });

  rl.prompt();

  rl.on('line', (line) => {
    const trimmedLine = line.trim();

    // REPL commands (only when buffer is empty)
    if (!buffer && trimmedLine.startsWith('.')) {
      handleCommand(trimmedLine);
      rl.setPrompt('pln> ');
      rl.prompt();
      return;
    }

    buffer = buffer ? (buffer + '\n' + line) : line;

    if (needsMoreInput(buffer)) {
      rl.setPrompt('...  ');
      rl.prompt();
      return;
    }

    const codeToExecute = buffer;
    buffer = '';
    rl.setPrompt('pln> ');

    if (!codeToExecute.trim()) {
      rl.prompt();
      return;
    }

    try {
      evaluateSnippet(codeToExecute, vmContext, { showAst, showJs });
    } catch (err) {
      console.error(formatDiagnostic(err, { source: codeToExecute, filePath: '<repl>' }));
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nGoodbye!');
    process.exit(0);
  });

  function handleCommand(cmd) {
    switch (cmd.toLowerCase()) {
      case '.exit':
      case '.quit':
        rl.close();
        break;
      case '.clear':
        console.clear();
        break;
      case '.help':
        printReplHelp();
        break;
      case '.ast':
        showAst = !showAst;
        console.log(`AST printing: ${showAst ? boldGreen('ON') : boldYellow('OFF')}`);
        break;
      case '.js':
        showJs = !showJs;
        console.log(`Generated JS preview: ${showJs ? boldGreen('ON') : boldYellow('OFF')}`);
        break;
      case '.vars':
        printSessionVars(vmContext);
        break;
      default:
        console.log(`Unknown command: "${cmd}". Type .help for available commands.`);
    }
  }
}

function evaluateSnippet(source, vmContext, options = {}) {
  // If it's a bare expression like "2 + 3" or "name", compile it to evaluate and display
  let isExpression = false;
  let tokens;
  let ast;

  try {
    tokens = tokenize(source);
    ast = parse(tokens);
  } catch (err) {
    // Attempt parsing as an expression wrapped in show(...) if single statement
    try {
      const exprSource = `show (${source})`;
      const exprTokens = tokenize(exprSource);
      ast = parse(exprTokens);
      isExpression = true;
    } catch (_) {
      throw err; // throw original syntax error
    }
  }

  if (options.showAst) {
    console.log(boldCyan('// AST:'));
    console.log(util.inspect(ast, { depth: 4, colors: HAS_COLOR }));
  }

  const genCtx = createGenerationContext();
  let js = generate(ast, genCtx);
  if (genCtx.needsAsync) js = wrapAsync(js);

  // In Node VM, top-level `let` is script-scoped and disappears between lines.
  // Converting top-level `let` to `var` attaches variables to the global sandbox context,
  // allowing session state to persist across multiple lines in the REPL.
  js = js.replace(/^let\s+([A-Za-z0-9_]+)\s*=/gm, 'var $1 =');

  if (options.showJs) {
    console.log(boldCyan('// Generated JavaScript:'));
    console.log(dim(js));
  }

  // Execute in persistent VM context
  const script = new vm.Script(js, { filename: '<repl>' });
  const result = script.runInContext(vmContext);

  if (!isExpression && result !== undefined) {
    console.log(util.inspect(result, { colors: HAS_COLOR }));
  }
}

function printReplHelp() {
  console.log(`
${boldCyan('PlainScript REPL Commands:')}
  ${boldYellow('.help')}          Show this help message
  ${boldYellow('.exit')}          Exit the REPL (or Ctrl+D)
  ${boldYellow('.clear')}         Clear terminal screen
  ${boldYellow('.vars')}          List defined variables in this session
  ${boldYellow('.ast')}           Toggle showing the parsed AST
  ${boldYellow('.js')}            Toggle showing emitted JavaScript

${boldCyan('REPL Syntax Quick Notes:')}
  • Type statements directly: ${boldGreen('remember count as 5')}
  • Update values:           ${boldGreen('count becomes count + 1')}
  • Write functions & loops across multiple lines with ${boldGreen('done')}:
      make square(x)
          give x * x
      done
`);
}

function printSessionVars(vmContext) {
  const builtins = new Set([
    'console', 'process', 'require', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval'
  ]);
  const keys = Object.keys(vmContext).filter(k => !builtins.has(k));
  if (keys.length === 0) {
    console.log(dim('No session variables defined yet.'));
    return;
  }
  console.log(boldCyan('Session Variables:'));
  for (const k of keys) {
    console.log(`  ${boldGreen(k)}: ${util.inspect(vmContext[k], { colors: HAS_COLOR, depth: 1 })}`);
  }
}

function evalSnippetStructured(code, vmContext) {
  try {
    let tokens = tokenize(code);
    let ast;
    let isBareExpression = false;
    try {
      ast = parse(tokens);
    } catch (err) {
      // Fallback for bare expressions: wrap in "show <expr>"
      const exprTokens = tokenize(`show ${code}`);
      ast = parse(exprTokens);
      isBareExpression = true;
    }

    const { inferTypes } = require('./passes/inference');
    const inference = inferTypes(ast);

    const genCtx = createGenerationContext();
    let js = generate(ast, genCtx);
    if (genCtx.needsAsync) js = wrapAsync(js);
    js = js.replace(/^let\s+([A-Za-z0-9_]+)\s*=/gm, 'var $1 =');

    const logs = [];
    const origLog = vmContext.console.log;
    vmContext.console.log = (...args) => logs.push(args.map(a => typeof a === 'object' ? util.inspect(a) : String(a)).join(' '));

    const script = new vm.Script(js, { filename: '<repl>' });
    const result = script.runInContext(vmContext);
    vmContext.console.log = origLog;

    const typesObj = {};
    for (const [k, v] of inference.types.entries()) {
      typesObj[k] = v;
    }

    let output = '';
    if (logs.length > 0) {
      output = logs.join('\n');
    } else if (result !== undefined && !isBareExpression) {
      output = util.inspect(result);
    }

    return {
      ok: true,
      result: output,
      js,
      ast: JSON.parse(JSON.stringify(ast)),
      types: typesObj,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
    };
  }
}

function startJsonIpcRepl() {
  const sandbox = {
    console: { ...console },
    process,
    require,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  const vmContext = vm.createContext(sandbox);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const req = JSON.parse(line);
      const res = evalSnippetStructured(req.code || '', vmContext);
      console.log(JSON.stringify(res));
    } catch (e) {
      console.log(JSON.stringify({ ok: false, error: e.message }));
    }
  });
}

module.exports = { startRepl, startJsonIpcRepl, evaluateSnippet, evalSnippetStructured, needsMoreInput };
