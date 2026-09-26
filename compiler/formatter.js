// Formatter: normalises PlainScript source code style without changing its logic.
//
// Rules applied:
//   - Consistent 4-space indentation
//   - Remove trailing whitespace from every line
//   - One blank line between top-level block declarations (make, if, for each, etc.)
//   - Collapse multiple consecutive blank lines into one
//   - Indent multi-line array elements ([...]) relative to their enclosing block

const INDENT = '    '; // 4 spaces

// Keywords whose line CLOSES a block (printed at depth - 1).
const DEDENT_WORDS = new Set(['done', 'end', 'otherwise', 'else', 'recover', 'finally']);

// Patterns whose line OPENS a new block (next line indented).
const INDENT_STARTERS = [
  /^make\s+\S+\s*\(/,          // make name(...)
  /^to\s+\S+/,                 // to add a and b together ...
  /^if\s+/,                    // if ...
  /^otherwise\b/,              // otherwise
  /^else\b/,                   // else
  /^for\s+each\s+/,           // for each ...
  /^for\s+every\s+/,          // for every ... in ...
  /^for\s+index\s+/,          // for index i from ... to ...
  /^while\s+/,                 // while ...
  /^repeat\s+\d+\s+times\b/,  // repeat N times ...
  /^repeat\s+(with|while|until)\b/, // repeat with/while/until ...
  /^when\s+someone\s+visits/,  // when someone visits ...
  /^when\s+someone\s+(sends|clicks)\b/, // when someone sends / clicks (Telegram)
  /^when\s+socket\b/,          // when socket connects / sends message / disconnects (v2.1)
  /^when\s+nothing\s+matches\b/, // when nothing matches ... done (v2.1.1 404 handler)
  /^javascript\b/,             // javascript raw JS block (v1.2)
  /^reply\b.*\bwith\s+buttons\s*$/, // reply ... with buttons ... done (v1.2)
  /^listen\s+on\s+/,           // listen on ...
  /^reply\s+json\b/,           // reply json
  /^remember\s+\S+\s+as\s*$/,  // remember x as   (object literal, ends with "as")
  /^remember\s+\S+\s+as\s+javascript\s*$/, // remember x as javascript (raw JS block)
  /^route\s+"/,                // route "..."       (v0.6 Express DX)
  /^route\s+(get|post|put|patch|delete)\s+"/, // route <method> "..." (v2.1)
  /^group\s+"/,                // group "..."       (v2.1 route composition)
  /^transaction\s*$/,          // transaction       (v2.1 atomic DB block)
  /^try\s*$/,                  // try               (v2.1.1 error handling)
  /^recover\b/,                // recover [as name] (v2.1.1 error handling)
  /^finally\s*$/,              // finally           (v2.1.1 error handling)
  /^retry\s+\d+\s+times\b/,    // retry N times ... (v2.1.1 retries)
  /^every\s+\d+\s+(seconds?|minutes?|hours?|days?)\b/, // every 5 minutes (v2.1)
  /^every\s+N\s+(seconds?|minutes?|hours?|days?)\b/, // every N seconds (variable)
  /^every\s+frame\b/,          // every frame (v2.1.1 game loop)
  /^after\s+\d+\s+(milliseconds?|seconds?|minutes?|hours?|days?|frames?)\b/, // after 3 seconds
  /^run\s+in\s+parallel\b/,    // run in parallel ... done as results
/^switch\s+\S+\s+against\b/, // switch expr against ... done
  /^match\s+\S+\s+against\b/,  // match expr against ... done
  /^stream\s+/,                // stream "file" as line ...
  /^test\s+"/,                 // test "name"
  /^schedule\s+"/,             // schedule "..."    (v2.1 cron)
  /^websocket\s+server\b/,     // websocket server  (v2.1)
  /^whatsapp\s+bot\s*$/,       // whatsapp bot      (v2.1.1 WhatsApp runtime)
  /^on\s+message\s*$/,         // on message        (v2.1.1 WhatsApp handler)
  /^mail\s+transport\s*$/,     // mail transport    (v2.1)
  /^send\s+mail\s*$/,          // send mail         (v2.1)
  /^google\s+oauth\s*$/,       // google oauth      (v2.1.1 Google sign-in)
  /^query\b/,                  // query SQL block   (v0.6 SQLite DX)
  /^postgres\b/,               // postgres "conn" (connection, no body)
  /^mongo\b/,                  // mongo "conn" (connection, no body)
  /^enable\s+sessions\b/,      // enable sessions "secret"
  /^require\s+api\s+key\b/,    // require api key from ...
  /^limit\s+requests\b/,       // limit requests to N per minute
  /^accept\s+uploads\b/,       // accept uploads ...
  /^when\s+[^\s]+(\s+"[^"]*")?\s+happens\b/, // when target "<event>" happens (v2.1.1)
  /^insert\b/,                 // insert SQL block
  /^update\b/,                 // update SQL block
  /^delete\b(?!\s*["'])/,      // delete SQL block (v2.1.1: NOT `delete "<url>"`,
                               // which is an HTTP DELETE statement)
  /^execute\b/,                // execute SQL block
];

function opensBlock(line) {
  return INDENT_STARTERS.some(re => re.test(line));
}

// Count occurrences of ch in a line, ignoring characters inside double-quoted
// strings and after // comments.
function countUnquoted(line, ch) {
  let count = 0;
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    if (!inString && line[i] === '/' && line[i + 1] === '/') break; // rest is a comment
    if (line[i] === '"' && (i === 0 || line[i - 1] !== '\\')) inString = !inString;
    if (!inString && line[i] === ch) count++;
  }
  return count;
}

// Format a single PlainScript source string and return the formatted version.
function format(source) {
  const rawLines   = source.split('\n');
  const output     = [];
  let depth        = 0;  // keyword block depth (make/if/for each/done …)
  let bracketDepth = 0;  // bracket nesting depth for multi-line [ … ]
  let inJsBlock    = false; // inside `remember x as javascript … done`

  for (let i = 0; i < rawLines.length; i++) {
    const original = rawLines[i];
    const stripped = original.replace(/\s+$/, ''); // remove trailing whitespace
    const content  = stripped.trim();

    // ── Inside a raw JavaScript block ───────────────────────────────────────
    // JavaScript must be preserved verbatim: do not re-indent or trim its
    // lines, and do not apply PlainScript bracket/blank-line rules (RFC-0011 §31).
    if (inJsBlock) {
      if (content === 'done') {
        if (depth > 0) depth--;
        output.push(INDENT.repeat(depth) + 'done');
        inJsBlock = false;
      } else {
        output.push(original);
      }
      continue;
    }

    // Blank lines are preserved outside brackets; suppressed inside them.
    if (content === '') {
      if (bracketDepth === 0) output.push('');
      continue;
    }

    const opens  = countUnquoted(content, '[');
    const closes = countUnquoted(content, ']');

    // ── Inside a multi-line array [ … ] ──────────────────────────────────────
    if (bracketDepth > 0) {
      // Use the lower bracket depth so a closing ] de-indents before printing.
      const nextBracketDepth = bracketDepth + opens - closes;
      const indentLevel      = depth + Math.min(bracketDepth, nextBracketDepth);
      output.push(INDENT.repeat(Math.max(0, indentLevel)) + content);
      bracketDepth = Math.max(0, nextBracketDepth);
      continue;
    }

    // ── Normal line ───────────────────────────────────────────────────────────

    const firstWord = content.split(/\s+/)[0];

    // Dedenting keywords: reduce depth BEFORE printing this line.
    if (DEDENT_WORDS.has(firstWord) && depth > 0) {
      depth--;
    }

    // Insert exactly one blank line before a top-level block-opening statement
    // (e.g. make, if, for each) when prior content exists.
    // Simple statements like remember/show/becomes are NOT block openers and
    // do NOT get a blank line inserted before them.
    const isContinuation = ['else', 'finally', 'otherwise'].includes(firstWord);
    if (depth === 0 && opensBlock(content) && !isContinuation && output.length > 0) {
      let lastNonEmpty = output.length - 1;
      while (lastNonEmpty >= 0 && output[lastNonEmpty] === '') lastNonEmpty--;

      if (lastNonEmpty >= 0 && output[output.length - 1] !== '') {
        output.push('');
      }
    }

    output.push(INDENT.repeat(depth) + content);

    // Opening keywords: increase depth AFTER printing this line.
    if (opensBlock(content)) {
      if (/^remember\s+\S+\s+as\s+javascript\s*$/.test(content) ||
          /^javascript\s*$/.test(content)) inJsBlock = true;
      depth++;
    }

    // Update bracket depth for multi-line arrays starting on this line.
    bracketDepth = Math.max(0, bracketDepth + opens - closes);
  }

  // Collapse consecutive blank lines into one.
  const collapsed = [];
  let prevBlank = false;
  for (const line of output) {
    const blank = line === '';
    if (blank && prevBlank) continue;
    collapsed.push(line);
    prevBlank = blank;
  }

  // Strip leading and trailing blank lines, then add a single trailing newline.
  while (collapsed.length > 0 && collapsed[0]                    === '') collapsed.shift();
  while (collapsed.length > 0 && collapsed[collapsed.length - 1] === '') collapsed.pop();

  return collapsed.join('\n') + '\n';
}

module.exports = { format };
