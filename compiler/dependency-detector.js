
// Runtime dependency detection for PlainScript source files.
//
// This module only inspects source/AST data. It never installs packages or
// checks the filesystem, so it can be reused by the CLI, editors, and tools.

const { builtinModules } = require('module');
const { tokenize } = require('./lexer');
const { parse } = require('./parser');

// PlainScript's friendly module names mapped to the npm packages they require.
const PACKAGE_MAP = Object.freeze({
  express: 'express',
  sqlite: 'better-sqlite3',
  fs: 'fs',
  path: 'path',
  // v2.0.1 — OCR statements are backed by tesseract.js. The mapping keeps the
  // implementation dependency out of PlainScript's language surface: source says
  // `ocr ... as text`, tooling installs tesseract.js.
  ocr: 'tesseract.js',
  // v2.1.0 — PostgreSQL behind the friendly "postgres" name.
  postgres: 'pg',
  // v2.1.0 — backend integrations keep implementation packages out of source.
  mailer: 'nodemailer',
  scheduler: 'croner',
  websocket: 'ws',
  cache: 'redis',
  // v2.1.1 — "accept uploads" is backed by multer; the WebAssembly SQLite
  // engine used by the `database` statement's fallback chain is sql.js.
  uploads: 'multer',
  'wasm-sqlite': 'sql.js',
  // v2.1.1 — WhatsApp bots run on Baileys; QR codes render in the terminal
  // through qrcode-terminal. Neither package ever appears in PlainScript source.
  // The default Baileys is the maintained @qwerty-xcv fork (reliable pairing);
  // users can override it per-block with `use baileys "<pkg>"`.
  whatsapp: '@qwerty-xcv/baileys',
  'wa-qrcode': 'qrcode-terminal',
  // v2.2.0 — MongoDB driver.
  mongodb: 'mongodb',
});

const BUILTIN_MODULES = new Set(builtinModules);

function isBuiltinModule(name) {
  return BUILTIN_MODULES.has(name) || BUILTIN_MODULES.has(`node:${name}`);
}

// v2.0.1 — split an npm specifier into its package name and version range.
//
//   "express"        → { name: "express", spec: null }
//   "left-pad@^1.3"  → { name: "left-pad", spec: "^1.3" }
//   "@scope/pkg"     → { name: "@scope/pkg", spec: null }   (scope, not version)
//   "@scope/pkg@2"   → { name: "@scope/pkg", spec: "2" }
//
// The "@" that starts an npm scope sits at index 0 and never marks a version,
// so the search for the version separator starts at index 1.
function splitPackageSpec(specifier) {
  const at = specifier.indexOf('@', 1);
  if (at === -1) return { name: specifier, spec: null };
  return { name: specifier.slice(0, at), spec: specifier.slice(at + 1) };
}

function visit(node, onUse) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) visit(item, onUse);
    return;
  }

  if (node.type === 'UseStatement') {
    onUse(node.module);
  } else if (node.type === 'ImportStatement' && node.path) {
    // Detect npm package dependencies imported via `bring ... from "pkg"` or `import ... from "pkg"`
    const isLocalFile = node.path.startsWith('.') || node.path.startsWith('/') || node.path.startsWith('\\') || node.path.startsWith('@/') || node.path.endsWith('.pln');
    if (!isLocalFile) {
      onUse(node.path);
    }
  } else if (node.type === 'WebAppStatement') {
    // The `web app` shorthand creates an Express application.
    onUse('express');
  } else if (node.type === 'DatabaseStatement') {
    // v2.1.1 — `database` runs SQLite through a portable engine chain:
    // better-sqlite3 (native) first, sql.js (WebAssembly) as the fallback.
    // "using" picks one engine explicitly.
    if (node.driver === 'wasm') {
      onUse('wasm-sqlite');
    } else if (node.driver === 'native') {
      onUse('sqlite');
    } else {
      onUse('sqlite');
      onUse('wasm-sqlite');
    }
  } else if (node.type === 'AcceptUploadsStatement') {
    // v2.1.1 — `accept uploads` is backed by multer under the hood.
    onUse('uploads');
  } else if (node.type === 'PostgresStatement') {
    // v2.1.0 — `postgres "<url>"` uses node-postgres under the hood.
    onUse('postgres');
  } else if (node.type === 'MongoStatement') {
    // v2.2.0 — `mongo "<uri>"` uses mongodb driver under the hood.
    onUse('mongodb');
  } else if (node.type === 'OcrStatement') {
    // v2.0.1 — `ocr "<image>" as <variable>` uses tesseract.js under the hood.
    onUse('ocr');
  } else if (node.type === 'MailTransportStatement' || node.type === 'SendMailStatement') {
    // v2.1.0 — email statements use nodemailer under the hood.
    onUse('mailer');
  } else if (node.type === 'ScheduleStatement') {
    // v2.1.0 — cron schedules use croner under the hood.
    onUse('scheduler');
  } else if (node.type === 'WebSocketServerStatement') {
    // v2.1.0 — websocket servers use ws under the hood.
    onUse('websocket');
  } else if (node.type === 'CacheStatement') {
    // v2.1.0 — cache statements use the redis client under the hood.
    onUse('cache');
  } else if (node.type === 'WhatsAppBotStatement') {
    // v2.1.1 — WhatsApp bots run on Baileys and render QR codes with
    // qrcode-terminal; both are implementation packages, never source.
    // The user may override the Baileys package per-block with
    // `use baileys "<pkg>"`; otherwise the default is used.
    onUse(node.baileysModule || 'whatsapp');
    onUse('wa-qrcode');
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') visit(value, onUse);
  }
}

/**
 * Return the unique npm packages required by PlainScript `use` statements
 * `web app` and `database` shorthand blocks.
 *
 * @param {string|object} source PlainScript source text or a parsed PlainScript AST
 * @returns {string[]} package names in first-seen order
 */
function detectDependencies(source) {
  const ast = typeof source === 'string'
    ? parse(tokenize(source))
    : source;
  const dependencies = new Set();

  // Only the resolved npm package decides whether a dependency is real.
  // PlainScript's friendly module names (e.g. sqlite) must not be mistaken for Node
  // built-ins just because Node ships a module with the same name.
  const addPackage = (moduleName) => {
    // A specifier may carry a version range ("left-pad@^1.3.0"); friendly
    // module names resolve through PACKAGE_MAP before the spec is re-attached,
    // so `use sqlite@7` still maps to better-sqlite3@7.
    const { name, spec } = splitPackageSpec(moduleName);
    const packageName = PACKAGE_MAP[name] || name;
    if (!isBuiltinModule(packageName)) {
      dependencies.add(spec ? `${packageName}@${spec}` : packageName);
    }
  };

  visit(ast, addPackage);

  // Additional check for the `database "..."` shorthand when the source is a string.
  // This ensures detection even if the parser does not produce a DatabaseStatement node.
  if (typeof source === 'string') {
    // Look for patterns like: database "file.db" or database 'file.db'
    // We use a simple regex to catch the shorthand, honouring an explicit
    // engine choice so the result always matches the AST path above.
    const dbMatch = /database\s+["'][^"']*["'](\s+using\s+["'](\w+)["'])?/.exec(source);
    if (dbMatch) {
      if (dbMatch[2] === 'wasm') {
        addPackage('wasm-sqlite');
      } else if (dbMatch[2] === 'native') {
        addPackage('sqlite');
      } else {
        addPackage('sqlite');
        addPackage('wasm-sqlite');
      }
    }
  }

  return [...dependencies];
}

module.exports = {
  detectDependencies,
  isBuiltinModule,
  splitPackageSpec,
  PACKAGE_MAP,
};