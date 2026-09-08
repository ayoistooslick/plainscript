// compiler/fixer.js
// Automated compiler-driven self-healing engine for PlainScript.
// Detects syntax mistakes, missing block closers, and JS/Python muscle-memory habits,
// repairing the source file cleanly.

const fs = require('fs');
const path = require('path');
const { tokenize } = require('./lexer');
const { parse } = require('./parser');
const { format } = require('./formatter');

/**
 * Attempts to repair common PlainScript syntax mistakes:
 * 1. `=` assignment replaced with `is` or `becomes`
 * 2. `def` or `function` replaced with `make`
 * 3. `print` or `console.log` replaced with `show`
 * 4. `return` replaced with `give`
 * 5. `else if` / `elif` replaced with `otherwise if`
 * 6. `else` replaced with `otherwise`
 * 7. Unclosed blocks automatically closed with `done`
 * 
 * @param {string} sourceText - Original source code
 * @returns {{ healedText: string, fixes: string[], changed: boolean }}
 */
function healSource(sourceText) {
  const fixes = [];
  const lines = sourceText.split(/\r?\n/);
  const healedLines = [];

  const BLOCK_OPENERS = [
    /^\s*make\s+[a-zA-Z_$]/,
    /^\s*if\s+/,
    /^\s*while\s+/,
    /^\s*for\s+(each|every|index)\s+/,
    /^\s*route\s+(get|post|put|delete|patch)\s+/,
    /^\s*group\s+/,
    /^\s*test\s+/,
    /^\s*try\s*$/,
    /^\s*schedule\s+/,
    /^\s*web\s+app\s*$/,
    /^\s*telegram\s+bot\s+/,
    /^\s*whatsapp\s+bot\s+/,
    /^\s*query\s+/,
    /^\s*stream\s+/,
    /^\s*match\s+/,
  ];

  let openBlocks = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    let line = lines[idx];
    const trimmed = line.trim();

    // Skip empty lines or pure comments
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('--')) {
      healedLines.push(line);
      continue;
    }

    // Track block closers
    if (trimmed === 'done' || trimmed === 'end') {
      if (trimmed === 'end') {
        line = line.replace(/\bend\b/, 'done');
        fixes.push(`Line ${idx + 1}: Replaced "end" with canonical "done"`);
      }
      openBlocks = Math.max(0, openBlocks - 1);
      healedLines.push(line);
      continue;
    }

    // Track block openers
    for (const pattern of BLOCK_OPENERS) {
      if (pattern.test(line)) {
        openBlocks++;
        break;
      }
    }

    // Fix 1: let/remember with "=" assignment -> "is" / "as"
    // e.g. "let x = 10" -> "let x is 10"
    const letAssign = line.match(/^(\s*let\s+[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(.+)$/);
    if (letAssign) {
      line = `${letAssign[1]} is ${letAssign[2]}`;
      fixes.push(`Line ${idx + 1}: Replaced "=" with "is" in let declaration`);
    }

    const remAssign = line.match(/^(\s*remember\s+[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(.+)$/);
    if (remAssign) {
      line = `${remAssign[1]} as ${remAssign[2]}`;
      fixes.push(`Line ${idx + 1}: Replaced "=" with "as" in remember declaration`);
    }

    // Fix 2: Bare re-assignment "x = 10" -> "x becomes 10"
    const bareAssign = line.match(/^(\s*[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*([^=].*)$/);
    if (bareAssign && !line.trim().startsWith('let ') && !line.trim().startsWith('remember ')) {
      line = `${bareAssign[1]} becomes ${bareAssign[2]}`;
      fixes.push(`Line ${idx + 1}: Replaced "=" with "becomes" for variable update`);
    }

    // Fix 3: Python / JS function declaration habits
    // "def foo(a, b)" or "function foo(a, b)" -> "make foo(a, b)"
    const funcMatch = line.match(/^(\s*)(def|function|mke|funtion)\s+([a-zA-Z_$][a-zA-Z0-9_$]*\s*\(.*)/);
    if (funcMatch) {
      line = `${funcMatch[1]}make ${funcMatch[3]}`;
      fixes.push(`Line ${idx + 1}: Replaced "${funcMatch[2]}" with "make"`);
      openBlocks++;
    }

    // Fix 4: Print habits
    // "print ..." or "console.log(...)" -> "show ..."
    const printMatch = line.match(/^(\s*)(print|console\.log)\s*\((.*)\)\s*;?$/);
    if (printMatch) {
      line = `${printMatch[1]}show ${printMatch[3]}`;
      fixes.push(`Line ${idx + 1}: Replaced "${printMatch[2]}" with "show"`);
    } else {
      const barePrint = line.match(/^(\s*)print\s+(.+)$/);
      if (barePrint) {
        line = `${barePrint[1]}show ${barePrint[2]}`;
        fixes.push(`Line ${idx + 1}: Replaced "print" with "show"`);
      }
    }

    // Fix 5: Return habit -> "give"
    const returnMatch = line.match(/^(\s*)return\s+(.+)$/);
    if (returnMatch) {
      line = `${returnMatch[1]}give ${returnMatch[2]}`;
      fixes.push(`Line ${idx + 1}: Replaced "return" with "give"`);
    }

    // Fix 6: Else habits
    // "else if" / "elif" -> "otherwise if"
    const elifMatch = line.match(/^(\s*)(else\s+if|elif)\s+(.+)$/);
    if (elifMatch) {
      line = `${elifMatch[1]}otherwise if ${elifMatch[3]}`;
      fixes.push(`Line ${idx + 1}: Replaced "${elifMatch[2]}" with "otherwise if"`);
    } else {
      const elseMatch = line.match(/^(\s*)else\s*$/);
      if (elseMatch) {
        line = `${elseMatch[1]}otherwise`;
        fixes.push(`Line ${idx + 1}: Replaced "else" with "otherwise"`);
      }
    }

    // Fix 7: Spelling corrections for keywords
    line = line.replace(/\bwihle\b/g, () => {
      fixes.push(`Line ${idx + 1}: Corrected typo "wihle" -> "while"`);
      return 'while';
    });

    healedLines.push(line);
  }

  // If there are unclosed blocks remaining at EOF, append matching "done"
  while (openBlocks > 0) {
    healedLines.push('done');
    fixes.push(`EOF: Appended missing "done" delimiter (unclosed block)`);
    openBlocks--;
  }

  let finalCode = healedLines.join('\n');

  // Format code cleanly if parseable
  try {
    const formatted = format(finalCode);
    finalCode = formatted;
  } catch (_) {}

  return {
    healedText: finalCode,
    fixes,
    changed: fixes.length > 0,
  };
}

/**
 * Self-heals a PlainScript file in place or displays fixes.
 * 
 * @param {string} filePath - Target file path
 * @param {Object} options - { dryRun, verbose }
 * @returns {Object} Healing outcome
 */
function fixFile(filePath, options = {}) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const raw = fs.readFileSync(absPath, 'utf8');
  const result = healSource(raw);

  if (result.changed && !options.dryRun) {
    fs.writeFileSync(absPath, result.healedText, 'utf8');
  }

  return {
    filePath: absPath,
    ...result,
  };
}

module.exports = {
  healSource,
  fixFile,
};
