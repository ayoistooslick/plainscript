'use strict';

// PlainScript has two surface dialects over one abstract syntax tree:
//
//   2.0  the original, terse spelling: let/const/function/if/else, `->`.
//   2.1  the English-oriented spelling: value/set/change/define/when/otherwise,
//        `returns`, `for each`, `for … from … to`, and comparison phrases.
//
// A file opts in with a pragma on its first line:
//
//   #syntax 2.1
//
// Files without a pragma are 2.0, so every existing program keeps its meaning.
// The dialect never changes the AST, the type checker, or the emitted
// JavaScript. Because the dialect is a surface, a 2.1 module and a 2.0 module
// can import one another freely.
//
// The 2.1 vocabulary is deliberately small. It replaces the declaration and
// control-flow keywords that read poorly aloud, and it adds phrase operators
// for comparisons. It does not rename operators, types, `match`, `try`,
// `import`, `export`, `async`, `await` or `render`, because those words are
// already English and a second spelling would add vocabulary without adding
// clarity.
//
// `value`, `set`, `change`, `define`, `returns` and `each` are *contextual*:
// they introduce a construct only in the position where that construct can
// appear. They remain valid identifiers everywhere else, so `value` can still
// be a parameter name. Only `when` and `otherwise` are reserved, because those
// words were already reserved (and unused) in 2.0.

const { Span, error } = require('./diagnostics');

const DIALECTS = Object.freeze(['2.0', '2.1']);
const CURRENT_DIALECT = '2.1';
const LEGACY_DIALECT = '2.0';

// The pragma must be the first line. It is an ordinary `#` comment to every
// other tool, so a 2.1 file still looks like a PlainScript file to editors.
const PRAGMA = /^\uFEFF?[ \t]*#[ \t]*syntax[ \t]+([0-9]+\.[0-9]+)[ \t]*$/;

const KEYWORD_RENAMES = Object.freeze({
  when: 'if',
  otherwise: 'else',
});

// Multi-word comparisons. The lexer merges these into one operator token, so
// precedence and code generation are exactly the symbolic operators' rules.
const COMPARISON_PHRASES = Object.freeze([
  { words: ['is', 'not', 'equal', 'to'], operator: '!=' },
  { words: ['is', 'equal', 'to'], operator: '==' },
  { words: ['is', 'greater', 'than'], operator: '>' },
  { words: ['is', 'less', 'than'], operator: '<' },
  { words: ['is', 'at', 'least'], operator: '>=' },
  { words: ['is', 'at', 'most'], operator: '<=' },
]);

const CONTEXTUAL_WORDS = Object.freeze(['value', 'set', 'change', 'define', 'returns', 'each']);

function isDialect(value) {
  return DIALECTS.includes(String(value));
}

// `fallback` is the project-level default from plainscript.config.json. A
// per-file pragma always wins, so a project can standardise on 2.1 while a
// single legacy module keeps its `#syntax 2.0` line.
function detectDialect(source, file = '<input>', fallback = null) {
  const firstLine = String(source).split('\n', 1)[0];
  const match = PRAGMA.exec(firstLine);
  if (!match) {
    if (fallback === null || fallback === undefined) {
      return { version: LEGACY_DIALECT, explicit: false, errors: [] };
    }
    if (!isDialect(fallback)) {
      return {
        version: LEGACY_DIALECT,
        explicit: false,
        errors: [error(
          'PS1005',
          `Unsupported syntax dialect "${fallback}" in the project configuration. Supported dialects are ${DIALECTS.join(' and ')}.`,
          new Span(file, 1, 1),
        )],
      };
    }
    return { version: String(fallback), explicit: false, errors: [] };
  }

  const version = match[1];
  if (!DIALECTS.includes(version)) {
    return {
      version: LEGACY_DIALECT,
      explicit: true,
      errors: [error(
        'PS1005',
        `Unsupported syntax dialect "${version}". Supported dialects are ${DIALECTS.join(' and ')}.`,
        new Span(file, 1, 1, firstLine.length),
      )],
    };
  }
  return { version, explicit: true, errors: [] };
}

function mergeComparisons(tokens) {
  const merged = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.t !== 'kw' || token.v !== 'is') {
      merged.push(token);
      continue;
    }

    let matched = null;
    for (const phrase of COMPARISON_PHRASES) {
      let cursor = index;
      let ok = true;
      for (const word of phrase.words) {
        const candidate = tokens[cursor];
        if (!candidate || candidate.t === 'eof' || candidate.v !== word) { ok = false; break; }
        cursor += 1;
      }
      if (ok) { matched = { phrase, end: cursor }; break; }
    }

    if (!matched) {
      merged.push(token);
      continue;
    }

    merged.push({
      t: 'punct',
      v: matched.phrase.operator,
      line: token.line,
      col: token.col,
      dialectPhrase: matched.phrase.words.join(' '),
    });
    index = matched.end - 1;
  }
  return merged;
}

// Rewrites the 2.1 token stream into the canonical vocabulary. `when` and
// `otherwise` become `if` and `else` carrying `alias: true`, which lets the
// parser accept the 2.1 word and still reject the 2.0 one. The contextual
// words are left untouched for the parser to interpret in statement position.
function normalise(tokens) {
  const merged = mergeComparisons(tokens);
  return merged.map((token) => {
    if (token.t !== 'kw') return token;
    if (Object.prototype.hasOwnProperty.call(KEYWORD_RENAMES, token.v)) {
      return { ...token, v: KEYWORD_RENAMES[token.v], alias: true };
    }
    return token;
  });
}

function applyDialect(tokens, version) {
  return version === '2.1' ? normalise(tokens) : tokens;
}

module.exports = {
  DIALECTS,
  CURRENT_DIALECT,
  LEGACY_DIALECT,
  CONTEXTUAL_WORDS,
  KEYWORD_RENAMES,
  COMPARISON_PHRASES,
  PRAGMA,
  detectDialect,
  isDialect,
  applyDialect,
  normalise,
};
