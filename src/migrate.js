'use strict';

const fs = require('fs');
const path = require('path');

// Migration is deliberately two-track:
//
//   1. Where a module can be converted safely, convert it.
//   2. Where it cannot, generate a typed interoperability boundary so the
//      original module stays authoritative and PlainScript can already use it.
//
// The analyser never claims that a file was converted because it looked simple.
// `convertJavaScript` refuses constructs it cannot preserve and reports why.

const IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', '.plainscript', 'dist', 'build', 'out', 'target',
  'vendor', '__pycache__', '.venv', 'venv', 'coverage', '.next', '.nuxt',
  'bin', 'obj', '.gradle', '.idea', '.vscode',
]);

const LANGUAGE_BY_EXTENSION = Object.freeze({
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.dart': 'dart',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
});

const FRAMEWORK_PACKAGES = Object.freeze({
  react: 'React',
  'react-dom': 'React',
  next: 'Next.js',
  vue: 'Vue',
  nuxt: 'Nuxt',
  svelte: 'Svelte',
  '@angular/core': 'Angular',
  express: 'Express',
  fastify: 'Fastify',
  koa: 'Koa',
  '@nestjs/core': 'NestJS',
  electron: 'Electron',
  'react-native': 'React Native',
  expo: 'Expo',
  vite: 'Vite',
  webpack: 'webpack',
  typescript: 'TypeScript',
  jest: 'Jest',
  vitest: 'Vitest',
  mocha: 'Mocha',
  prisma: 'Prisma',
  '@prisma/client': 'Prisma',
  mongoose: 'Mongoose',
  sequelize: 'Sequelize',
  typeorm: 'TypeORM',
  stripe: 'Stripe',
  tailwindcss: 'Tailwind CSS',
});

function walkFiles(root, options = {}) {
  const limit = options.limit || 20000;
  const files = [];
  const visit = (directory) => {
    if (files.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
      if (files.length >= limit) return;
    }
  };
  visit(root);
  return files;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function exists(root, name) {
  try {
    return fs.statSync(path.join(root, name)).isFile();
  } catch {
    return false;
  }
}

function detectFrameworks(packageJson) {
  if (!packageJson) return [];
  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
    ...(packageJson.peerDependencies || {}),
  };
  const found = [];
  for (const [name, label] of Object.entries(FRAMEWORK_PACKAGES)) {
    if (dependencies[name] && !found.includes(label)) found.push(label);
  }
  return found;
}

function detectStack(root, files) {
  const packageJson = readJson(path.join(root, 'package.json'));
  const languages = new Map();
  for (const file of files) {
    const language = LANGUAGE_BY_EXTENSION[path.extname(file).toLowerCase()];
    if (!language) continue;
    languages.set(language, (languages.get(language) || 0) + 1);
  }
  const markers = [];
  for (const [file, label] of [
    ['tsconfig.json', 'TypeScript configuration'],
    ['pyproject.toml', 'Python packaging (pyproject.toml)'],
    ['requirements.txt', 'Python requirements'],
    ['go.mod', 'Go module'],
    ['Cargo.toml', 'Cargo workspace'],
    ['pom.xml', 'Maven project'],
    ['build.gradle', 'Gradle project'],
    ['build.gradle.kts', 'Gradle project'],
    ['composer.json', 'Composer project'],
    ['Gemfile', 'Ruby Bundler project'],
    ['Package.swift', 'Swift package'],
    ['pubspec.yaml', 'Dart/Flutter package'],
  ]) {
    if (exists(root, file)) markers.push(label);
  }
  if (files.some((file) => file.endsWith('.csproj') || file.endsWith('.sln'))) markers.push('.NET project');

  return {
    name: packageJson ? packageJson.name || path.basename(root) : path.basename(root),
    moduleSystem: packageJson ? (packageJson.type === 'module' ? 'ESM' : 'CommonJS') : 'unknown',
    packageManager: exists(root, 'pnpm-lock.yaml') ? 'pnpm'
      : exists(root, 'yarn.lock') ? 'yarn'
        : exists(root, 'bun.lockb') || exists(root, 'bun.lock') ? 'bun'
          : exists(root, 'package-lock.json') ? 'npm'
            : exists(root, 'requirements.txt') || exists(root, 'pyproject.toml') ? 'pip'
              : 'unknown',
    frameworks: detectFrameworks(packageJson),
    markers,
    languages: Object.fromEntries([...languages.entries()].sort((a, b) => b[1] - a[1])),
    dependencies: packageJson ? Object.keys({ ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) }).length : 0,
    scripts: packageJson && packageJson.scripts ? Object.keys(packageJson.scripts) : [],
  };
}

function readSource(file, limit = 2 * 1024 * 1024) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > limit) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

const PATTERN_NOTES = [
  { code: 'JSX', pattern: /<[A-Za-z][A-Za-z0-9.]*(?:\s[^>]*)?>|<>/, note: 'JSX markup' },
  { code: 'HOOKS', pattern: /\buse(?:State|Effect|Memo|Callback|Ref|Context|Reducer)\s*\(/, note: 'React hooks' },
  { code: 'CLASS', pattern: /\bclass\s+[A-Za-z_$]/, note: 'class syntax' },
  { code: 'TS_TYPE', pattern: /:\s*(?:string|number|boolean|any|unknown|void|never|[A-Z][A-Za-z0-9_<>, |]*)\s*[=;),]/, note: 'TypeScript annotations' },
  { code: 'INTERFACE', pattern: /\binterface\s+[A-Za-z_$]/, note: 'interface declaration' },
  { code: 'ENUM', pattern: /\benum\s+[A-Za-z_$]/, note: 'enum declaration' },
  { code: 'NAMESPACE', pattern: /\bnamespace\s+[A-Za-z_$]/, note: 'namespace declaration' },
  { code: 'DECORATOR', pattern: /^\s*@[A-Za-z_$]/, note: 'decorator' },
  { code: 'COMMONJS', pattern: /\brequire\s*\(|\bmodule\.exports\b|\bexports\.[A-Za-z_$]/, note: 'CommonJS module syntax' },
  { code: 'DYNAMIC_IMPORT', pattern: /\bimport\s*\(/, note: 'dynamic import' },
  { code: 'EVAL', pattern: /\beval\s*\(/, note: 'eval' },
  { code: 'PROXY', pattern: /\bnew\s+Proxy\s*\(/, note: 'Proxy' },
  { code: 'REGEX_LITERAL', pattern: /(?:^|[=(,:;[\]!&|?+\-*%<>~^])\s*\/(?![/*])(?:\\.|[^/\n])+\/[gimsuyvd]*/, note: 'regular expressions' },
  { code: 'GENERATOR', pattern: /\bfunction\s*\*/, note: 'generator function' },
  { code: 'THIS', pattern: /\bthis\b/, note: 'this binding' },
  { code: 'PROCESS', pattern: /\bprocess\.(?:env|exit|argv)\b/, note: 'Node process API' },
];

function analyseFile(file) {
  const source = readSource(file);
  if (source === null) {
    return { path: file, language: LANGUAGE_BY_EXTENSION[path.extname(file).toLowerCase()] || 'unknown', skipped: 'too large to analyse' };
  }
  const lines = source.split('\n');
  const notes = [];
  for (const check of PATTERN_NOTES) {
    if (check.pattern.test(source)) notes.push({ code: check.code, note: check.note });
  }
  const language = LANGUAGE_BY_EXTENSION[path.extname(file).toLowerCase()] || 'unknown';
  const exports = detectExports(source, language);
  const imports = [];
  for (const line of lines) {
    const match = /^\s*import\s+(?:[^'"]+from\s+)?["']([^"']+)["']/.exec(line);
    if (match) imports.push(match[1]);
    const required = /^\s*(?:const|let|var)\s+[^=]+=\s*require\s*\(\s*["']([^"']+)["']\s*\)/.exec(line);
    if (required) imports.push(required[1]);
  }
  const jsx = notes.some((note) => note.code === 'JSX');
  return {
    path: file,
    relative: null,
    language,
    lines: lines.length,
    bytes: Buffer.byteLength(source),
    jsx,
    exports,
    imports: [...new Set(imports)],
    notes,
    convertible: language === 'javascript' && !jsx && !notes.some((note) => ['CLASS', 'COMMONJS', 'THIS', 'GENERATOR', 'EVAL', 'DECORATOR', 'DYNAMIC_IMPORT'].includes(note.code)),
  };
}

const OTHER_LANGUAGE_EXPORTS = Object.freeze({
  python: [/^\s*def\s+([A-Za-z_]\w*)/gm, /^\s*class\s+([A-Za-z_]\w*)/gm],
  rust: [
    /^\s*pub\s+(?:async\s+)?fn\s+([A-Za-z_]\w*)/gm,
    /^\s*pub\s+(?:struct|enum|trait|type|const|static|mod)\s+([A-Za-z_]\w*)/gm,
  ],
  go: [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm, /^\s*type\s+([A-Z]\w*)/gm],
  java: [
    /^\s*public\s+(?:static\s+)?(?:final\s+)?(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/gm,
    /^\s*public\s+(?:static\s+)?[\w<>\[\], ?]+\s+([A-Za-z_]\w*)\s*\(/gm,
  ],
  kotlin: [
    /^\s*(?:public\s+)?fun\s+([A-Za-z_]\w*)/gm,
    /^\s*(?:public\s+)?(?:data\s+|sealed\s+)?(?:class|interface|object|enum\s+class)\s+([A-Za-z_]\w*)/gm,
  ],
  ruby: [/^\s*def\s+(?:self\.)?([A-Za-z_]\w*[!?=]?)/gm, /^\s*(?:class|module)\s+([A-Z]\w*)/gm],
  php: [/^\s*(?:public\s+|protected\s+|private\s+)?function\s+([A-Za-z_]\w*)/gm, /^\s*(?:final\s+|abstract\s+)?class\s+([A-Za-z_]\w*)/gm],
  csharp: [
    /^\s*public\s+(?:static\s+)?(?:sealed\s+|abstract\s+)?(?:class|interface|enum|record|struct)\s+([A-Za-z_]\w*)/gm,
    /^\s*public\s+(?:static\s+)?[\w<>\[\], ?]+\s+([A-Za-z_]\w*)\s*\(/gm,
  ],
  swift: [
    /^\s*(?:public\s+)?func\s+([A-Za-z_]\w*)/gm,
    /^\s*(?:public\s+)?(?:class|struct|enum|protocol|actor)\s+([A-Za-z_]\w*)/gm,
  ],
  dart: [
    /^\s*(?:abstract\s+)?class\s+([A-Za-z_]\w*)/gm,
    /^\s*(?:mixin|enum|typedef)\s+([A-Za-z_]\w*)/gm,
  ],
});

function detectExports(source, language = 'javascript') {
  const names = new Set();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+(?:type|interface|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s*\{([^}]+)\}/g,
    ...(OTHER_LANGUAGE_EXPORTS[language] || []),
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      if (pattern.source.includes('\\{')) {
        for (const part of match[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/)[0].trim();
          if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) names.add(name);
        }
      } else {
        names.add(match[1]);
      }
    }
  }
  const commonjs = /module\.exports\s*=\s*\{([^}]+)\}/.exec(source);
  if (commonjs) {
    for (const part of commonjs[1].split(',')) {
      const name = part.trim().split(':')[0].trim();
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) names.add(name);
    }
  }
  return [...names].sort();
}

function classifyFile(file, projectRoot) {
  const relative = path.relative(projectRoot, file).split(path.sep).join('/');
  const name = path.basename(file).toLowerCase();
  const analysis = analyseFile(file);
  const language = analysis.language || 'unknown';

  const notes = [...analysis.notes];
  let strategy = 'manual';
  if (['javascript', 'jsx', 'typescript', 'tsx'].includes(language)) {
    strategy = analysis.convertible ? 'auto-convert' : 'interop-boundary';
  } else if (language !== 'unknown') {
    strategy = 'manual';
    notes.push({
      code: 'CROSS_LANGUAGE',
      note: `${language} modules keep their native implementation; expose them through a JSON-RPC bridge (plainscript bridge / std/bridge) or the generated bindings instead of source conversion.`,
    });
  }

  const entrypoint = /^(?:src\/)?(?:index|main|server|app|cli)\.[a-z]+$/i.test(relative)
    || /(?:^|\/)(?:index|main|server|app|cli)\.[a-z]+$/i.test(relative);
  const ui = analysis.jsx || /\.(?:jsx|tsx)$/.test(name) || (analysis.imports || []).some((specifier) => specifier === 'react' || specifier.startsWith('react/'));
  const phase = ui ? 'ui-components' : entrypoint ? 'entrypoints' : analysis.exports.length ? 'modules-with-public-api' : 'leaf-utilities';

  return { ...analysis, relative, strategy, phase, entrypoint, ui, notes };
}

function analyseProject(root) {
  const files = walkFiles(root);
  const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.go', '.rs', '.java', '.kt', '.kts', '.rb', '.php', '.cs', '.swift', '.dart', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp']);
  const relevant = files.filter((file) => sourceExtensions.has(path.extname(file).toLowerCase()) && !file.endsWith('.d.ts'));
  const stack = detectStack(root, files);
  const analysed = relevant.map((file) => classifyFile(file, root));
  const phases = ['leaf-utilities', 'modules-with-public-api', 'ui-components', 'entrypoints'];
  const plan = phases.map((phase) => {
    const items = analysed.filter((item) => item.phase === phase);
    return {
      phase,
      description: PHASE_DESCRIPTIONS[phase],
      files: items.map((item) => ({ path: item.relative, strategy: item.strategy, language: item.language })),
    };
  }).filter((phase) => phase.files.length);

  return {
    root,
    generatedAt: new Date().toISOString(),
    stack,
    files: analysed.map((item) => ({
      path: item.relative,
      language: item.language,
      lines: item.lines,
      bytes: item.bytes,
      strategy: item.strategy,
      phase: item.phase,
      jsx: item.ui,
      exports: item.exports,
      imports: item.imports,
      notes: item.notes,
    })),
    summary: {
      files: analysed.length,
      convertible: analysed.filter((item) => item.strategy === 'auto-convert').length,
      boundaries: analysed.filter((item) => item.strategy === 'interop-boundary').length,
      manual: analysed.filter((item) => item.strategy === 'manual').length,
      jsx: analysed.filter((item) => item.ui).length,
      languages: stack.languages,
      frameworks: stack.frameworks,
    },
    phases: plan,
  };
}

const PHASE_DESCRIPTIONS = Object.freeze({
  'leaf-utilities': 'Leaf modules have no dependants yet. Convert these first and keep the tests green.',
  'modules-with-public-api': 'Modules with a public API: convert or wrap, then point dependants at the PlainScript module.',
  'ui-components': 'UI modules use JSX. Keep them in JavaScript/TypeScript and consume them through generated declarations, or rewrite them in PlainScript JSX.',
  entrypoints: 'Entrypoints move last. Before switching, run the existing build and test scripts against the mixed project.',
});

// ------------------------------------------------------------------ converter

function splitCodeAndStrings(line) {
  const segments = [];
  let buffer = '';
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char === '"' || char === "'" || char === '`') {
      if (buffer) { segments.push({ kind: 'code', value: buffer }); buffer = ''; }
      const quote = char;
      let value = quote;
      index += 1;
      while (index < line.length) {
        const current = line[index];
        value += current;
        if (current === '\\') { index += 1; if (index < line.length) value += line[index]; index += 1; continue; }
        index += 1;
        if (current === quote) break;
      }
      segments.push({ kind: 'string', value });
      continue;
    }
    if (char === '/' && line[index + 1] === '/') {
      if (buffer) { segments.push({ kind: 'code', value: buffer }); buffer = ''; }
      segments.push({ kind: 'comment', value: line.slice(index) });
      index = line.length;
      break;
    }
    buffer += char;
    index += 1;
  }
  if (buffer) segments.push({ kind: 'code', value: buffer });
  return segments;
}

function convertCodeSegment(code) {
  let value = code;
  value = value.replace(/===/g, '==').replace(/!==/g, '!=');
  value = value.replace(/&&/g, ' and ').replace(/\|\|/g, ' or ');
  value = value.replace(/(^|[=(,:;!&|?+\-*%<>~^]\s*)!(?!=)/g, '$1not ');
  value = value.replace(/\bnull\b/g, 'nothing').replace(/\bundefined\b/g, 'nothing');
  value = value.replace(/\bconsole\.log\s*\(/g, 'print(');
  value = value.replace(/;\s*$/g, '');
  return value;
}

function convertLine(line, state) {
  const indent = '    '.repeat(state.depth);
  const trimmed = line.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('//')) return [`${indent}# ${trimmed.slice(2).trim()}`];

  const pieces = splitCodeAndStrings(line);
  let converted = pieces.map((piece) => {
    if (piece.kind === 'comment') return `# ${piece.value.slice(2).trim()}`;
    if (piece.kind === 'string') return piece.value;
    return convertCodeSegment(piece.value);
  }).join('');
  converted = converted.trim();

  // Closing forms come first: they reduce depth.
  if (/^\}\s*else\s+if\s*\(.*\)\s*\{\s*$/.test(converted)) {
    // One branch closes and the next opens, so the depth is unchanged.
    const condition = /else\s+if\s*\((.*)\)\s*\{\s*$/.exec(converted)[1].trim();
    return [`${'    '.repeat(Math.max(0, state.depth - 1))}otherwise when ${condition}`];
  }
  if (/^\}\s*else\s*\{\s*$/.test(converted)) {
    return [`${'    '.repeat(Math.max(0, state.depth - 1))}otherwise`];
  }
  if (/^\}\s*(?:catch\s*\(([^)]*)\)|finally)\s*\{\s*$/.test(converted)) {
    const handler = /catch\s*\(([^)]*)\)/.exec(converted);
    return [`${'    '.repeat(Math.max(0, state.depth - 1))}${handler ? `catch ${handler[1].trim()}` : 'finally'}`];
  }
  if (/^\}\s*;?\s*$/.test(converted)) {
    state.depth -= 1;
    return [`${'    '.repeat(state.depth)}end`];
  }

  // Function declarations.
  let match = /^(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*\{\s*$/.exec(converted);
  if (match) {
    state.depth += 1;
    const prefix = match[1] ? 'export ' : '';
    const params = match[3].split(',').map((part, index) => {
      const trimmed = part.trim();
      if (!trimmed) return '';
      if (/^[{[\]]/.test(trimmed)) return `props${index === 0 ? '' : index}: any`;
      if (trimmed.includes(':')) return trimmed;
      const rest = trimmed.startsWith('...');
      const name = trimmed.replace(/^\.\.\./, '').replace(/=.*$/, '').trim();
      return `${rest ? '...' : ''}${name}: any`;
    }).filter(Boolean).join(', ');
    return [`${indent}${prefix}define ${match[2]}(${params}) returns any`];
  }
  match = /^(export\s+)?(?:async\s+)?function\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\(([^)]*)\)\s*\{\s*$/.exec(converted);
  if (match) throw new MigrationError('An anonymous function declaration needs a name.');

  // Control flow.
  match = /^if\s*\((.*)\)\s*\{\s*$/.exec(converted);
  if (match) { state.depth += 1; return [`${indent}when ${match[1].trim()}`]; }
  match = /^while\s*\((.*)\)\s*\{\s*$/.exec(converted);
  if (match) { state.depth += 1; return [`${indent}while ${match[1].trim()}`]; }
  match = /^for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+of\s+(.+)\)\s*\{\s*$/.exec(converted);
  if (match) { state.depth += 1; return [`${indent}for each ${match[1]} in ${match[2].trim()}`]; }
  match = /^for\s*\(\s*(?:let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(.+?);\s*\1\s*<\s*(.+?);\s*\1(?:\+\+|\s*\+=\s*1)\s*\)\s*\{\s*$/.exec(converted);
  if (match) { state.depth += 1; return [`${indent}for ${match[1]} from ${match[2].trim()} to (${match[3].trim()}) - 1`]; }
  if (/^try\s*\{\s*$/.test(converted)) { state.depth += 1; return [`${indent}try`]; }
  match = /^catch\s*\(([^)]*)\)\s*\{\s*$/.exec(converted);
  if (match) { state.depth += 1; return [`${indent}catch ${match[1].trim()}`]; }
  if (/^finally\s*\{\s*$/.test(converted)) { state.depth += 1; return [`${indent}finally`]; }

  // Declarations and assignments.
  match = /^(export\s+)?(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(.+)$/.exec(converted);
  if (match) {
    const keyword = match[1] ? 'export ' : '';
    const immutable = match[2] === 'const';
    return [`${indent}${keyword}${immutable ? 'value' : 'set'} ${match[3]} ${immutable ? 'is' : 'to'} ${match[4].trim()}`];
  }
  match = /^return(?:\s+(.*))?$/.exec(converted);
  if (match) return [`${indent}return ${match[1] !== undefined ? match[1].trim() : 'nothing'}`];
  match = /^throw\s+new\s+Error\s*\((.*)\)$/.exec(converted);
  if (match) return [`${indent}throw ${match[1].trim()}`];

  // Object literals and any other brace lines are not safely convertible.
  if (/\{\s*$/.test(converted) && !/\{\s*\}/.test(converted)) {
    throw new MigrationError(`Unsupported block: ${converted}`);
  }

  return [`${indent}${converted}`];
}

class MigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationError';
  }
}

// Converts a deliberately small, well-understood JavaScript subset. The gate
// is strict: anything that could change behaviour returns ok:false with the
// reason instead of emitting a plausible-looking translation.
function convertJavaScript(source, file) {
  const diagnostics = [];
  const gate = [
    { pattern: /\bclass\s+[A-Za-z_$]/, message: 'classes are not converted; keep the class in JavaScript or rewrite it as records and functions.' },
    { pattern: /<[A-Za-z][A-Za-z0-9.]*(?:\s[^>]*)?>|<>/, message: 'JSX is not converted by this pass; write the component in PlainScript JSX or keep it behind a boundary.' },
    { pattern: /\brequire\s*\(|\bmodule\.exports\b|\bexports\.[A-Za-z_$]/, message: 'CommonJS modules are handled by an interop boundary.' },
    { pattern: /\bthis\b/, message: '`this` binding is not converted.' },
    { pattern: /\bfunction\s*\*/, message: 'generator functions are not converted.' },
    { pattern: /\beval\s*\(/, message: 'eval is not convertible.' },
    { pattern: /^\s*@[A-Za-z_$]/m, message: 'decorators are not converted.' },
    { pattern: /\bimport\s*\(/, message: 'dynamic import is not converted.' },
    { pattern: /\bexport\s+default\b/, message: 'default exports are not converted; export a named binding instead.' },
    { pattern: /\bexport\s+\*\s+from\b/, message: 'wildcard re-exports are not converted.' },
  ];
  for (const check of gate) {
    if (check.pattern.test(source)) diagnostics.push({ code: 'UNSUPPORTED', message: check.message });
  }
  if (diagnostics.length) return { ok: false, diagnostics, code: null };

  const state = { depth: 0 };
  const output = ['#syntax 2.1', '', `# Converted from ${path.basename(file || 'module.js')} by plainscript migrate.`, '# Review the result and run the project tests before deleting the source.', ''];
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    try {
      const converted = convertLine(line, state);
      output.push(...converted);
    } catch (failure) {
      diagnostics.push({ code: 'UNSUPPORTED', message: `${path.basename(file || 'module.js')}:${index + 1}: ${failure.message}` });
      return { ok: false, diagnostics, code: null };
    }
  }
  if (state.depth !== 0) {
    diagnostics.push({ code: 'UNSUPPORTED', message: `Unbalanced blocks (${state.depth} unclosed).` });
    return { ok: false, diagnostics, code: null };
  }
  return { ok: true, diagnostics, code: `${output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n` };
}

// ------------------------------------------------------------------ boundaries

function declarationFor(file) {
  const source = readSource(file);
  if (source === null) return null;
  const language = LANGUAGE_BY_EXTENSION[path.extname(file).toLowerCase()] || 'javascript';
  if (!['javascript', 'jsx', 'typescript', 'tsx'].includes(language)) return null;

  const names = detectExports(source);
  if (!names.length) return null;
  const lines = [
    '#syntax 2.1',
    '',
    `# Interop boundary for ${path.basename(file)}.`,
    '# Signatures are deliberately any at the JavaScript boundary: the original',
    '# module remains authoritative until it is ported to PlainScript.',
    '',
  ];
  for (const name of names) {
    const functionPattern = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${escapeRegExp(name)}\\s*\\(([^)]*)\\)`);
    const arrowPattern = new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=\\s*(?:async\\s*)?\\(([^)]*)\\)\\s*=>`);
    const functionMatch = functionPattern.exec(source) || arrowPattern.exec(source);
    if (functionMatch) {
      const params = functionMatch[1].split(',').map((part) => part.trim()).filter(Boolean)
        .map((part, index) => {
          if (/^[{[\]]/.test(part)) return `props${index === 0 ? '' : index}: any`;
          const cleaned = part.replace(/[:=].*$/, '').replace(/^\.\.\./, '').trim();
          return `${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(cleaned) ? cleaned : `arg${index}`}: any`;
        });
      lines.push(`export declare function ${name}(${params.join(', ')}) -> any`);
      continue;
    }
    if (new RegExp(`export\\s+class\\s+${escapeRegExp(name)}`).test(source)) {
      lines.push(`export declare const ${name}: any`);
      continue;
    }
    if (new RegExp(`export\\s+(?:type|interface|enum)\\s+${escapeRegExp(name)}`).test(source)) {
      lines.push(`export declare const ${name}: any`);
      continue;
    }
    lines.push(`export declare const ${name}: any`);
  }
  return { code: `${lines.join('\n')}\n`, names };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function boundaryPlan(project, item) {
  if (item.strategy !== 'interop-boundary') return null;
  if (!['javascript', 'jsx', 'typescript', 'tsx'].includes(item.language)) return null;
  const absolute = path.join(project.root, item.path);
  const declaration = declarationFor(absolute);
  if (!declaration) return null;
  const source = readSource(absolute) || '';
  const commonjs = /\bmodule\.exports\b|\bexports\.[A-Za-z_$]|\brequire\s*\(/.test(source);
  const base = path.basename(item.path, path.extname(item.path));
  const directory = path.join(project.root, 'bridges');
  const declarationPath = path.join(directory, `${base}.runtime.d.pln`);
  const runtimePath = path.join(directory, `${base}.runtime.js`);
  const wrapperPath = path.join(directory, `${base}.pln`);
  const relativeRuntime = path.relative(directory, absolute).split(path.sep).join('/');
  const specifier = relativeRuntime.startsWith('.') ? relativeRuntime : `./${relativeRuntime}`;

  const runtime = commonjs
    ? [
      `// Boundary for ${item.path}. The original CommonJS module stays authoritative.`,
      `import namespace from ${JSON.stringify(specifier)};`,
      ...declaration.names.map((name) => `export const ${name} = namespace[${JSON.stringify(name)}];`),
      '',
    ].join('\n')
    : [
      `// Boundary for ${item.path}. The original module stays authoritative.`,
      `export { ${declaration.names.join(', ')} } from ${JSON.stringify(specifier)};`,
      '',
    ].join('\n');

  const wrapper = [
    '#syntax 2.1',
    '',
    `# Boundary for ${item.path}. Import this module from PlainScript.`,
    `# Runtime: ./${base}.runtime.js (re-exports the original). Types: ./${base}.runtime.d.pln.`,
    '',
    `export { ${declaration.names.join(', ')} } from "./${base}.js"`,
    '',
  ].join('\n');

  return {
    path: item.path,
    declarationPath,
    runtimePath,
    wrapperPath,
    declaration: declaration.code,
    runtime,
    wrapper,
    names: declaration.names,
  };
}

function writeBoundaries(project, boundaries) {
  const written = [];
  for (const boundary of boundaries) {
    fs.mkdirSync(path.dirname(boundary.declarationPath), { recursive: true });
    fs.writeFileSync(boundary.declarationPath, boundary.declaration);
    fs.writeFileSync(boundary.runtimePath, boundary.runtime);
    fs.mkdirSync(path.dirname(boundary.wrapperPath), { recursive: true });
    fs.writeFileSync(boundary.wrapperPath, boundary.wrapper);
    written.push({
      source: boundary.path,
      declaration: boundary.declarationPath,
      runtime: boundary.runtimePath,
      wrapper: boundary.wrapperPath,
    });
  }
  return written;
}

function writeConverted(project, converted) {
  const written = [];
  for (const item of converted) {
    const absolute = path.join(project.root, item.path);
    const target = absolute.replace(/\.(?:jsx?|mjs|cjs)$/, '.pln');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, item.code);
    written.push({ source: item.path, target });
  }
  return written;
}

function reportMarkdown(project, options = {}) {
  const { stack, summary, phases, files } = project;
  const lines = [
    `# PlainScript migration plan — ${stack.name}`,
    '',
    `Generated ${project.generatedAt}.`,
    '',
    '## Project',
    '',
    `- Languages: ${Object.entries(stack.languages).map(([language, count]) => `${language} (${count})`).join(', ') || 'none detected'}`,
    `- Module system: ${stack.moduleSystem}`,
    `- Package manager: ${stack.packageManager}`,
    `- Frameworks: ${stack.frameworks.join(', ') || 'none detected'}`,
    `- Other markers: ${stack.markers.join(', ') || 'none'}`,
    `- Files analysed: ${summary.files} (${summary.convertible} convertible, ${summary.boundaries} boundaries, ${summary.manual} manual)`,
    '',
    '## Phases',
    '',
  ];
  for (const phase of phases) {
    lines.push(`### ${phase.phase}`);
    lines.push('');
    lines.push(phase.description);
    lines.push('');
    for (const file of phase.files) lines.push(`- \`${file.path}\` — ${file.strategy} (${file.language})`);
    lines.push('');
  }
  lines.push('## Next steps');
  lines.push('');
  lines.push('1. `plainscript migrate --write` generates interop boundaries and safe conversions.');
  lines.push('2. Convert leaf modules first, keeping the existing test suite green.');
  lines.push('3. `plainscript bindings <entry> --lang=python,go,...` exposes PlainScript modules to the rest of the stack.');
  lines.push('4. Run the existing build and test scripts after each phase; a mixed project is a valid end state.');
  lines.push('');
  if (options.explain) {
    lines.push('## Unresolved transformations');
    lines.push('');
    for (const file of files.filter((entry) => entry.notes.length)) {
      lines.push(`- \`${file.path}\`: ${file.notes.map((note) => note.note).join('; ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = {
  LANGUAGE_BY_EXTENSION,
  IGNORED_DIRECTORIES,
  walkFiles,
  analyseFile,
  analyseProject,
  convertJavaScript,
  declarationFor,
  boundaryPlan,
  writeBoundaries,
  writeConverted,
  reportMarkdown,
  MigrationError,
};
