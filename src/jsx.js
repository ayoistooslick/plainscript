'use strict';

// JSX configuration is resolved once per file. Project settings in
// plainscript.config.json supply the default; a leading `#` comment pragma
// overrides them for a single file, which is how a React app and a Preact
// island can live in the same repository.
//
//   # @jsx h
//   # @jsxFrag Fragment
//   # @jsxImportSource preact
//   # @jsxRuntime automatic
//
// Two runtimes are supported:
//
//   classic    JSX lowers to factory(type, props, ...children)
//   automatic  JSX lowers to the JSX runtime's jsx/jsxs functions, imported
//              from `${importSource}/jsx-runtime`

const DEFAULT_JSX = Object.freeze({
  runtime: 'classic',
  factory: 'createElement',
  fragment: 'Fragment',
  importSource: 'react',
});

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const DOTTED = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
const PACKAGE = /^[A-Za-z0-9@._/-]+$/;

function readPragma(source, name) {
  const pattern = new RegExp(`^[ \\t]*#[ \\t]*@${name}[ \\t]+(\\S+)[ \\t]*$`, 'm');
  const head = String(source).split('\n').slice(0, 20).join('\n');
  const match = pattern.exec(head);
  return match ? match[1] : null;
}

function resolveJsxOptions(source, config = {}) {
  const options = { ...DEFAULT_JSX };
  const settings = config || {};

  if (settings.jsxRuntime === 'automatic' || settings.jsxRuntime === 'classic') {
    options.runtime = settings.jsxRuntime;
  }
  if (typeof settings.jsxFactory === 'string' && DOTTED.test(settings.jsxFactory)) {
    options.factory = settings.jsxFactory;
  }
  if (typeof settings.jsxFragment === 'string' && DOTTED.test(settings.jsxFragment)) {
    options.fragment = settings.jsxFragment;
  }
  if (typeof settings.jsxImportSource === 'string' && PACKAGE.test(settings.jsxImportSource)) {
    options.importSource = settings.jsxImportSource;
    options.runtime = 'automatic';
  }

  const pragmaFactory = readPragma(source, 'jsx');
  if (pragmaFactory && DOTTED.test(pragmaFactory)) options.factory = pragmaFactory;

  const pragmaFragment = readPragma(source, 'jsxFrag');
  if (pragmaFragment && DOTTED.test(pragmaFragment)) {
    options.fragment = pragmaFragment;
    options.runtime = 'classic';
  }

  const pragmaRuntime = readPragma(source, 'jsxRuntime');
  if (pragmaRuntime === 'automatic' || pragmaRuntime === 'classic') options.runtime = pragmaRuntime;

  const pragmaSource = readPragma(source, 'jsxImportSource');
  if (pragmaSource && PACKAGE.test(pragmaSource)) {
    options.importSource = pragmaSource;
    options.runtime = 'automatic';
  }

  return options;
}

function jsxFactorySpec() {
  return DEFAULT_JSX;
}

module.exports = { DEFAULT_JSX, resolveJsxOptions, jsxFactorySpec, IDENTIFIER };

// Project defaults are read from plainscript.config.json. Both a top-level
// `jsx` object and `compilerOptions.jsx` are accepted, so a project can keep
// compiler options together or separate.
function jsxConfigFor(root) {
  const fs = require('fs');
  const path = require('path');
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, 'plainscript.config.json'), 'utf8'));
    const compilerOptions = parsed.compilerOptions || {};
    return { ...(parsed.jsx || {}), ...(compilerOptions.jsx || {}) };
  } catch {
    return {};
  }
}

module.exports = { DEFAULT_JSX, resolveJsxOptions, jsxConfigFor, jsxFactorySpec, IDENTIFIER };
