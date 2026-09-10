// Lexer: converts PlainScript source text into a stream of tokens.
// Each token includes { type, value, line, col } for diagnostic reporting.

const TOKEN = {
  // Core keywords (v0.1–v0.4)
  REMEMBER:    'REMEMBER',
  LET:         'LET',         // alias for remember: "let x is 5"
  SHOW:        'SHOW',
  PRINT:       'PRINT',       // alias for show
  DISPLAY:     'DISPLAY',     // alias for show
  AS:          'AS',
  IS:          'IS',          // used for both "let x is 5" and comparisons
  IF:          'IF',
  OTHERWISE:   'OTHERWISE',
  ELSE:        'ELSE',        // alias for otherwise
  DONE:        'DONE',
  END:         'END',         // alias for done
  DO:          'DO',          // block-bodied lambda opener: (x) do ... done
  GREATER:     'GREATER',
  LESS:        'LESS',
  THAN:        'THAN',
  MAKE:        'MAKE',
  DEFINE:      'DEFINE',      // alias for make: "define add(a, b)"
  FUNCTION:    'FUNCTION',    // alias for make: "function add(a, b)"
  GIVE:        'GIVE',
  RETURN:      'RETURN',      // alias for give
  GIVE_BACK:   'GIVE_BACK',   // alias for give: "give back a + b"
  BECOMES:     'BECOMES',
  IS_NOW:      'IS_NOW',      // alias for becomes: "x is now 10"
  SET_TO:      'SET_TO',      // alias for becomes: "set x to 10"
  CHANGE_TO:   'CHANGE_TO',   // alias for becomes: "change x to 10"
  FOR:         'FOR',
  EACH:        'EACH',        // also used for "every" alias
  EVERY:       'EVERY',       // alias: "for every item in list"
  IN:          'IN',
  WHILE:       'WHILE',
  REPEAT:      'REPEAT',      // Natural intent repeat loop: repeat 5 times, repeat with x in list, repeat while, repeat until
  UNTIL:       'UNTIL',       // Natural intent repeat until <condition>
  LOG_KW:      'LOG_KW',      // alias for show: "log 'hello'"
  USE:         'USE',
  IMPORT:      'IMPORT',
  INCLUDE:     'INCLUDE',     // alias for import: "include "./file.pln""
  LOAD:        'LOAD',        // alias for import: "load "./file.pln""
  // v0.3 — Express runtime
  WHEN:        'WHEN',
  SOMEONE:     'SOMEONE',
  VISITS:      'VISITS',
  LISTEN:      'LISTEN',
  START_ON:    'START_ON',    // alias for listen: "start on port 3000"
  SERVE_ON:    'SERVE_ON',    // alias for listen: "serve on port 3000"
  ON:          'ON',
  REPLY:       'REPLY',
  RESPOND:     'RESPOND',     // alias for reply
  SEND_BACK:   'SEND_BACK',   // alias for reply
  JSON_KW:     'JSON_KW',
  FILE_KW:     'FILE_KW',      // for "reply file" and "serve file"
  SERVE:       'SERVE',
  SERVE_STATIC: 'SERVE_STATIC', // alias for serve folder
  SERVE_PUBLIC: 'SERVE_PUBLIC', // alias for serve folder
  FOLDER:      'FOLDER',
  // v0.6 — Extended comparisons
  ABOVE:       'ABOVE',
  BELOW:       'BELOW',
  AT:          'AT',
  LEAST:       'LEAST',
  MOST:        'MOST',
  NOT:         'NOT',
  EMPTY:       'EMPTY',
  CONTAINS:    'CONTAINS',
  NOW:         'NOW',         // for "is now" assignment
  BACK:        'BACK',        // for "give back" return
  STARTS:      'STARTS',
  ENDS:        'ENDS',
  WITH:        'WITH',
  BETWEEN:     'BETWEEN',
  AND:         'AND',
  OR:          'OR',          // v2.1.1 — logical or in conditions
  INSTANCEOF:  'INSTANCEOF',  // v1.0.2 — instanceof condition
  // v0.6 — Express DX
  WEB:         'WEB',
  ROUTE_KW:    'ROUTE_KW',
  START_KW:    'START_KW',
  RUN_ON:      'RUN_ON',      // alias for start: "run on port 3000"
  // v0.6 — SQLite DX
  DATABASE_KW: 'DATABASE_KW',
  CONNECT_DB:  'CONNECT_DB',  // alias for database: "connect database "app.db""
  USE_DATABASE: 'USE_DATABASE', // alias for database: "use database "app.db""
  QUERY_KW:    'QUERY_KW',
  INSERT_KW:   'INSERT_KW',
  UPDATE_KW:   'UPDATE_KW',
  DELETE_KW:   'DELETE_KW',
  EXECUTE_KW:  'EXECUTE_KW',
  SQL_BODY:    'SQL_BODY',    // raw SQL collected between a block keyword and "done"
  ASK:           'ASK',           // interactive input: ask name / ask "prompt" as name
  PROMPT:        'PROMPT',        // alias for ask: 'prompt "name?" as name'
  OCR_KW:        'OCR_KW',        // v2.0.1 — ocr "<image>" as <name> [using "<lang>"]
  PACKAGE:       'PACKAGE',       // bare npm package name after "use" (may contain -, _, ., /, @)
  GATHER:       'GATHER',       // gather each item in list giving expr (functional map)
  FILTER_KW:    'FILTER_KW',    // filter each item in list when condition (functional filter)
  TOTAL:        'TOTAL',        // total each item in list giving expr (functional reduce)
  MATCH:        'MATCH',        // match expr against ... done (pattern matching)
  AGAINST:      'AGAINST',      // match ... against keyword
  PATTERN_KW:   'PATTERN_KW',   // match pattern "regex" in text (regex matching)
  PARALLEL:     'PARALLEL',     // run in parallel ... done (worker threads)
  STREAM:       'STREAM',       // stream "file" as line ... done (line-by-line processing)
  EMIT:         'EMIT',         // emit "event.name" with data (event emitter)
  HAPPENS:      'HAPPENS',      // when "event.name" happens as data (event listener)
  CATCHES:      'CATCHES',      // recover when err catches "TypeError" (typed error recovery)
  // v1.0.1 — generators. "yield" is a JavaScript reserved word, so it becomes a
  // real keyword token (a variable named `yield` is illegal in JS anyway).
  YIELD:        'YIELD',
  // v2.3 — English-like syntax keywords
  TO:           'TO',           // "to add a and b together" function syntax
  TOGETHER:     'TOGETHER',     // function block terminator alternative
  BE:           'BE',           // "let x be 5" alternative to "let x is 5"
  THEN:         'THEN',         // "when ... then" alternative
  PLUS_WORD:    'PLUS_WORD',    // "a plus b" alternative to "a + b"
  MINUS_WORD:   'MINUS_WORD',   // "a minus b" alternative to "a - b"
  TIMES_WORD:   'TIMES_WORD',   // "a times b" alternative to "a * b"
  DIVIDED_BY_WORD: 'DIVIDED_BY_WORD', // "a divided by b" alternative to "a / b"
  LIST_WITH:    'LIST_WITH',    // "list with 1, 2, 3" alternative to "[1, 2, 3]"
  RECORD_WITH:  'RECORD_WITH',  // "record with name 'Alice'" alternative to object literal
  // Punctuation
  LBRACE:      'LBRACE',   // { — inline object literal (v1.2)
  RBRACE:      'RBRACE',   // }
  COLON:       'COLON',    // : — inline object property separator (v1.2)
  ARROW:       'ARROW',    // -> — Telegram inline keyboard button (v1.2)
  LPAREN:      'LPAREN',
  RPAREN:      'RPAREN',
  LBRACKET:    'LBRACKET',
  RBRACKET:    'RBRACKET',
  COMMA:       'COMMA',
  DOT:         'DOT',
  OPTIONAL_CHAIN: 'OPTIONAL_CHAIN', // ?. — optional chaining
  NULLISH_COALESCE: 'NULLISH_COALESCE', // ?? — nullish coalescing
  POWER:       'POWER',    // ** — exponentiation
  PLUS:        'PLUS',
  MINUS:       'MINUS',    // v2.1.1 — subtraction / unary minus
  STAR:        'STAR',     // v2.1.1 — multiplication
  SLASH:       'SLASH',    // v2.1.1 — division
  PERCENT:     'PERCENT',  // v2.1.1 — remainder (modulo)
  SPREAD:      'SPREAD',   // ... — spread operator
  REST:        'REST',     // ... — rest parameter
  LOGICAL_OR_ASSIGN: 'LOGICAL_OR_ASSIGN',     // ||=
  LOGICAL_AND_ASSIGN: 'LOGICAL_AND_ASSIGN',   // &&=
  NULLISH_ASSIGN: 'NULLISH_ASSIGN',           // ??=
  PLUS_ASSIGN: 'PLUS_ASSIGN',                 // ++=  (increment-assign, x += v)
  // Literals & identifiers
  IDENTIFIER:  'IDENTIFIER',
  STRING:      'STRING',
  NUMBER:      'NUMBER',
  TRUE_KW:     'TRUE_KW',   // v2.1.1 — boolean literal true
  FALSE_KW:    'FALSE_KW',  // v2.1.1 — boolean literal false
  NULL_KW:     'NULL_KW',   // v2.1.1 — null literal
  UNDEFINED_KW: 'UNDEFINED_KW', // v2.2.0 — undefined literal
  BIGINT:      'BIGINT',   // BigInt literal (e.g., 42n)
  TEMPLATE_STRING: 'TEMPLATE_STRING', // backtick-delimited string with interpolation
  SYMBOL_KW:   'SYMBOL_KW', // symbol keyword
  DEBUGGER_KW: 'DEBUGGER_KW', // debugger keyword
  IMPORT_META: 'IMPORT_META', // import.meta
  // v2.4 — Near-English intent-oriented syntax (single-word keywords)
  RAISES:        'RAISES',        // "raise expr" throw alternative
  CHOOSING:      'CHOOSING',      // "choosing cond then a otherwise b" ternary
  USES:          'USES',          // "x uses a, b together" function call
  FILLS:         'FILLS',         // "fill x with a, b together" function call
  // End of input
  EOF:         'EOF',
};

const KEYWORDS = {
  // Core
  remember:  TOKEN.REMEMBER,
  let:       TOKEN.LET,
  show:      TOKEN.SHOW,
  print:     TOKEN.PRINT,
  display:   TOKEN.DISPLAY,
  as:        TOKEN.AS,
  is:        TOKEN.IS,
  if:        TOKEN.IF,
  otherwise: TOKEN.OTHERWISE,
  else:      TOKEN.ELSE,
  done:      TOKEN.DONE,
  end:       TOKEN.END,
  do:        TOKEN.DO,        // block-bodied lambda opener: (x) do ... done
  greater:   TOKEN.GREATER,
  less:      TOKEN.LESS,
  than:      TOKEN.THAN,
  make:      TOKEN.MAKE,
  define:    TOKEN.DEFINE,
  function:  TOKEN.FUNCTION,
  give:      TOKEN.GIVE,
  return:    TOKEN.RETURN,
  give_back: TOKEN.GIVE_BACK,
  becomes:   TOKEN.BECOMES,
  is_now:    TOKEN.IS_NOW,
  set_to:    TOKEN.SET_TO,
  change_to: TOKEN.CHANGE_TO,
  for:       TOKEN.FOR,
  each:      TOKEN.EACH,
  every:     TOKEN.EACH,    // alias: "for every" = "for each"
  in:        TOKEN.IN,
  while:     TOKEN.WHILE,
  use:       TOKEN.USE,
  import:    TOKEN.IMPORT,
  include:   TOKEN.INCLUDE,
  load:      TOKEN.LOAD,
  // v0.3
  when:      TOKEN.WHEN,
  someone:   TOKEN.SOMEONE,
  visits:    TOKEN.VISITS,
  listen:    TOKEN.LISTEN,
  start_on:  TOKEN.START_ON,
  serve_on:  TOKEN.SERVE_ON,
  on:        TOKEN.ON,
  reply:     TOKEN.REPLY,
  respond:   TOKEN.RESPOND,
  send_back: TOKEN.SEND_BACK,
  json:      TOKEN.JSON_KW,
  file:      TOKEN.FILE_KW,
  serve:     TOKEN.SERVE,
  serve_static: TOKEN.SERVE_STATIC,
  serve_public: TOKEN.SERVE_PUBLIC,
  folder:    TOKEN.FOLDER,
  // v0.6 — comparisons
  above:     TOKEN.ABOVE,
  below:     TOKEN.BELOW,
  at:        TOKEN.AT,
  least:     TOKEN.LEAST,
  most:      TOKEN.MOST,
  not:       TOKEN.NOT,
  empty:     TOKEN.EMPTY,
  contains:  TOKEN.CONTAINS,
  starts:    TOKEN.STARTS,
  ends:      TOKEN.ENDS,
  with:      TOKEN.WITH,
  between:   TOKEN.BETWEEN,
  and:       TOKEN.AND,
  or:        TOKEN.OR,
  instanceof: TOKEN.INSTANCEOF,
  now:       TOKEN.NOW,
  back:      TOKEN.BACK,
  // v2.1.1 — literal keywords. These were previously plain identifiers that
  // passed through to generated JavaScript; making them explicit tokens gives
  // them first-class AST nodes and deterministic diagnostics.
  true:      TOKEN.TRUE_KW,
  false:     TOKEN.FALSE_KW,
  null:      TOKEN.NULL_KW,
  undefined: TOKEN.UNDEFINED_KW,
  // v0.6 — Express DX
  web:       TOKEN.WEB,
  route:     TOKEN.ROUTE_KW,
  start:     TOKEN.START_KW,
  run_on:    TOKEN.RUN_ON,
  // v0.6 — SQLite DX
  database:  TOKEN.DATABASE_KW,
  connect_db: TOKEN.CONNECT_DB,
  use_database: TOKEN.USE_DATABASE,
  ask:        TOKEN.ASK,
  prompt:     TOKEN.PROMPT,
  // v2.0.1 — OCR capability
  ocr:        TOKEN.OCR_KW,
  // IOPL-native features
  gather:     TOKEN.GATHER,
  filter:     TOKEN.FILTER_KW,
  total:      TOKEN.TOTAL,
  match:      TOKEN.MATCH,
  against:    TOKEN.AGAINST,
  pattern:    TOKEN.PATTERN_KW,
  parallel:   TOKEN.PARALLEL,
  stream:     TOKEN.STREAM,
  emit:       TOKEN.EMIT,
  happens:    TOKEN.HAPPENS,
  catches:    TOKEN.CATCHES,
  yield:      TOKEN.YIELD,
  symbol:     TOKEN.SYMBOL_KW,
  debugger:   TOKEN.DEBUGGER_KW,
  // v2.3 — English-like syntax keywords
  to:         TOKEN.TO,
  together:   TOKEN.TOGETHER,
  be:         TOKEN.BE,
  then:       TOKEN.THEN,
  plus:       TOKEN.PLUS_WORD,
  minus:      TOKEN.MINUS_WORD,
  times:      TOKEN.TIMES_WORD,
  divided_by: TOKEN.DIVIDED_BY_WORD,
  list_with:  TOKEN.LIST_WITH,
  record_with: TOKEN.RECORD_WITH,
  // v2.4 — Near-English intent-oriented syntax (single-word keywords)
  raise:        TOKEN.RAISES,
  raises:       TOKEN.RAISES,
  choosing:     TOKEN.CHOOSING,
  uses:         TOKEN.USES,
  fills:        TOKEN.FILLS,
  // Natural language intent keywords
  repeat:       TOKEN.REPEAT,
  until:        TOKEN.UNTIL,
  log:          TOKEN.LOG_KW,
};

// Keywords that introduce raw SQL blocks (content up to "done" is collected verbatim).
const SQL_BLOCK_WORDS = {
  query:   TOKEN.QUERY_KW,
  insert:  TOKEN.INSERT_KW,
  update:  TOKEN.UPDATE_KW,
  delete:  TOKEN.DELETE_KW,
  execute: TOKEN.EXECUTE_KW,
};

// Decode one escape sequence inside a double-quoted string, starting at
// source[index] (the backslash). Returns [decodedText, charsConsumed].
// Supported: \n \t \r \0 \\ \" \' — any other escaped character is kept as
// itself (JavaScript-style leniency), so "\q" means "q".
function decodeEscape(source, index) {
  const next = source[index + 1];
  if (next === undefined) return ['', 1]; // trailing backslash at EOF: drop it
  const simple = { n: '\n', t: '\t', r: '\r', 0: '\0', '\\': '\\', '"': '"', "'": "'" };
  if (next in simple) return [simple[next], 2];
  return [next, 2];
}

function tokenize(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let pendingUse = false; // true between a "use" keyword and its package name

  function col() { return i - lineStart + 1; }

  while (i < source.length) {
    // Skip whitespace (track newlines for line counting)
    if (/\s/.test(source[i])) {
      if (source[i] === '\n') { line++; lineStart = i + 1; }
      i++;
      continue;
    }

    // Single-line comment: skip to end of line
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }

    const tokenLine = line;
    const tokenCol  = col();

    // Package name after "use": a bare npm specifier may contain hyphens,
    // underscores, dots, slashes, a scope ("@scope/package-name"), and a
    // version range ("pkg@^1.2.0", "pkg@~2", "pkg@>=3 <4", "pkg@*").
    if (pendingUse) {
      if (/[A-Za-z0-9@]/.test(source[i])) {
        let pkg = '';
        while (i < source.length && /[A-Za-z0-9_.@/^~><=*-]/.test(source[i])) pkg += source[i++];
        tokens.push({ type: TOKEN.PACKAGE, value: pkg, line: tokenLine, col: tokenCol });
        pendingUse = false;
        continue;
      }
      pendingUse = false; // not a package start — tokenize normally
    }

    // String literal. Normal escapes are decoded here (\n, \t, \r, \\, \",
    // \', \0) so generated JavaScript receives the intended characters.
    // An unknown escape keeps the escaped character itself, matching the
    // lenient behaviour of JavaScript string literals.
    if (source[i] === '"') {
      let str = '';
      i++; // skip opening quote
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\n') { line++; lineStart = i + 1; }
        if (source[i] === '\\') {
          const [decoded, consumed] = decodeEscape(source, i, tokenLine, tokenCol);
          str += decoded;
          // Track newlines inside multi-character escapes like "\n".
          for (let k = 0; k < consumed; k++) {
            if (source[i + k] === '\n') { line++; lineStart = i + k + 1; }
          }
          i += consumed;
          continue;
        }
        str += source[i++];
      }
      if (i >= source.length) {
        throw new Error(
          `Line ${tokenLine}, Column ${tokenCol}: Unterminated string: the closing " is missing.`
        );
      }
      i++; // skip closing quote
      tokens.push({ type: TOKEN.STRING, value: str, line: tokenLine, col: tokenCol });
      continue;
    }

    // Backtick string (template literal): preserves whitespace and supports
    // interpolation. Scanning is escape-aware — a backslash escapes the next
    // character verbatim (\` does not close the string, \\ stays a backslash,
    // \$ guards ${ from interpolating) while ordinary characters, real
    // newlines and ${expr} pass through untouched for the generator to emit.
    if (source[i] === '`') {
      let content = '';
      i++; // skip opening backtick
      while (i < source.length && source[i] !== '`') {
        if (source[i] === '\n') { line++; lineStart = i + 1; }
        if (source[i] === '\\' && i + 1 >= source.length) {
          throw new Error(
            `Line ${tokenLine}, Column ${tokenCol}: Unterminated backtick string: the closing \` is missing.`
          );
        }
        if (source[i] === '\\') {
          content += source[i] + source[i + 1]; // keep escape pair verbatim
          i += 2;
          continue;
        }
        content += source[i++];
      }
      if (i >= source.length) {
        throw new Error(
          `Line ${tokenLine}, Column ${tokenCol}: Unterminated backtick string: the closing \` is missing.`
        );
      }
      i++; // skip closing backtick
      tokens.push({ type: TOKEN.TEMPLATE_STRING, value: content, line: tokenLine, col: tokenCol });
      continue;
    }

    // Hex number literal (0x... → decimal; supports colors like 0xRRGGBB)
    if (source[i] === '0' && (source[i + 1] === 'x' || source[i + 1] === 'X')) {
      let hex = '';
      let j = i + 2;
      while (j < source.length && /[0-9a-fA-F]/.test(source[j])) hex += source[j++];
      if (hex) {
        tokens.push({ type: TOKEN.NUMBER, value: Number.parseInt(hex, 16), line: tokenLine, col: tokenCol });
        i = j;
        continue;
      }
    }

    // Number literal (may include decimal point or BigInt suffix 'n')
    if (/[0-9]/.test(source[i])) {
      let num = '';
      while (i < source.length && /[0-9.]/.test(source[i])) num += source[i++];
      // Check for BigInt suffix
      if (i < source.length && source[i] === 'n') {
        i++; // consume 'n'
        tokens.push({ type: TOKEN.BIGINT, value: BigInt(num), line: tokenLine, col: tokenCol });
      } else {
        tokens.push({ type: TOKEN.NUMBER, value: Number(num), line: tokenLine, col: tokenCol });
      }
      continue;
    }

    // Word: keyword, SQL-block keyword, or identifier
    if (/[a-zA-Z_]/.test(source[i])) {
      let word = '';
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) word += source[i++];

      // SQL block keywords: collect raw content up to "done"
      if (Object.prototype.hasOwnProperty.call(SQL_BLOCK_WORDS, word)) {
        const kwType = SQL_BLOCK_WORDS[word];
        tokens.push({ type: kwType, value: word, line: tokenLine, col: tokenCol });

        // Check if the rest of this line is blank (raw block mode)
        let j = i;
        while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;

        if (j >= source.length || source[j] === '\n' || source[j] === '\r') {
          // Advance past the newline
          i = j;
          if (i < source.length && source[i] === '\n') { i++; line++; lineStart = i; }

          // Collect raw lines until a line whose trimmed content is exactly "done"
          let sql = '';
          while (i < source.length) {
            const lineEnd  = source.indexOf('\n', i);
            const realEnd  = lineEnd === -1 ? source.length : lineEnd;
            const lineText = source.slice(i, realEnd);
            const trimmed  = lineText.trim();

            if (trimmed === 'done') {
              i = realEnd < source.length ? realEnd + 1 : realEnd;
              if (realEnd < source.length) { line++; lineStart = i; }
              break;
            }

            sql += lineText + '\n';
            i = realEnd < source.length ? realEnd + 1 : realEnd;
            if (realEnd < source.length) { line++; lineStart = i; }
          }

          tokens.push({ type: TOKEN.SQL_BODY,  value: sql.trimEnd(), line: tokenLine, col: tokenCol });
          tokens.push({ type: TOKEN.DONE,       value: 'done',         line, col: col() });
        }
        // else: stays on same line — parsed normally by the parser as kwType + next tokens
        continue;
      }

      const type = Object.prototype.hasOwnProperty.call(KEYWORDS, word)
        ? KEYWORDS[word]
        : TOKEN.IDENTIFIER;
      if (type === TOKEN.USE) pendingUse = true;
      tokens.push({ type, value: word, line: tokenLine, col: tokenCol });
      continue;
    }

    // Single-character punctuation
    if (source[i] === '{') { tokens.push({ type: TOKEN.LBRACE, value: '{', line: tokenLine, col: tokenCol }); i++; continue; }
    if (source[i] === '}') { tokens.push({ type: TOKEN.RBRACE, value: '}', line: tokenLine, col: tokenCol }); i++; continue; }
    if (source[i] === ':') { tokens.push({ type: TOKEN.COLON, value: ':', line: tokenLine, col: tokenCol }); i++; continue; }
    if (source[i] === '(') { tokens.push({ type: TOKEN.LPAREN,   value: '(', line: tokenLine, col: tokenCol }); i++; continue; }
    if (source[i] === ')') { tokens.push({ type: TOKEN.RPAREN,   value: ')', line: tokenLine, col: tokenCol }); i++; continue; }
    if (source[i] === '[') { tokens.push({ type: TOKEN.LBRACKET, value: '[', line: tokenLine, col: tokenCol }); i++; continue; }
    if (source[i] === ']') { tokens.push({ type: TOKEN.RBRACKET, value: ']', line: tokenLine, col: tokenCol }); i++; continue; }
    if (source[i] === ',') { tokens.push({ type: TOKEN.COMMA,    value: ',', line: tokenLine, col: tokenCol }); i++; continue; }
    if (source[i] === '?' && source[i + 1] === '.') { tokens.push({ type: TOKEN.OPTIONAL_CHAIN, value: '?.', line: tokenLine, col: tokenCol }); i += 2; continue; }
    if (source[i] === '?' && source[i + 1] === '?' && source[i + 2] === '=') { tokens.push({ type: TOKEN.NULLISH_ASSIGN, value: '??=', line: tokenLine, col: tokenCol }); i += 3; continue; }
    if (source[i] === '?' && source[i + 1] === '?') { tokens.push({ type: TOKEN.NULLISH_COALESCE, value: '??', line: tokenLine, col: tokenCol }); i += 2; continue; }
    if (source[i] === '.' && source[i + 1] === '.' && source[i + 2] === '.') { tokens.push({ type: TOKEN.SPREAD, value: '...', line: tokenLine, col: tokenCol }); i += 3; continue; }
    if (source[i] === '.') { tokens.push({ type: TOKEN.DOT,      value: '.', line: tokenLine, col: tokenCol }); i++; continue; }
    if (source[i] === '+' && source[i + 1] === '+' && source[i + 2] === '=') { tokens.push({ type: TOKEN.PLUS_ASSIGN, value: '++=', line: tokenLine, col: tokenCol }); i += 3; continue; }
    if (source[i] === '+') { tokens.push({ type: TOKEN.PLUS,     value: '+', line: tokenLine, col: tokenCol }); i++; continue; }
    // v2.1.1 — arithmetic. "->" is matched first so it never becomes MINUS.
    if (source[i] === '-' && source[i + 1] === '>') { tokens.push({ type: TOKEN.ARROW,  value: '->', line: tokenLine, col: tokenCol }); i += 2; continue; }
    if (source[i] === '-') { tokens.push({ type: TOKEN.MINUS,    value: '-', line: tokenLine, col: tokenCol }); i++; continue; }
    if (source[i] === '*' && source[i + 1] === '*') { tokens.push({ type: TOKEN.POWER, value: '**', line: tokenLine, col: tokenCol }); i += 2; continue; }
    if (source[i] === '*') { tokens.push({ type: TOKEN.STAR,     value: '*', line: tokenLine, col: tokenCol }); i++; continue; }
    if (source[i] === '/') { tokens.push({ type: TOKEN.SLASH,    value: '/', line: tokenLine, col: tokenCol }); i++; continue; }
    if (source[i] === '%') { tokens.push({ type: TOKEN.PERCENT,  value: '%', line: tokenLine, col: tokenCol }); i++; continue; }
    if (source[i] === '|' && source[i + 1] === '|' && source[i + 2] === '=') { tokens.push({ type: TOKEN.LOGICAL_OR_ASSIGN, value: '||=', line: tokenLine, col: tokenCol }); i += 3; continue; }
    if (source[i] === '&' && source[i + 1] === '&' && source[i + 2] === '=') { tokens.push({ type: TOKEN.LOGICAL_AND_ASSIGN, value: '&&=', line: tokenLine, col: tokenCol }); i += 3; continue; }
    if (source[i] === '|') { i++; continue; } // lone | not supported
    if (source[i] === '&') { i++; continue; } // lone & not supported

    throw new Error(
      `Line ${line}, Column ${col()}: Unexpected character "${source[i]}". PlainScript only uses letters, numbers, strings, and known symbols.`
    );
  }

  tokens.push({ type: TOKEN.EOF, line, col: col() });
  return tokens;
}

module.exports = { tokenize, TOKEN };
