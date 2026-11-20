#!/usr/bin/env node
'use strict';

// Checks the generated documentation site: every relative href/src must point
// at a file in docs/, and every in-page anchor must exist. External links are
// not fetched (they would make CI depend on the network).

const fs = require('fs');
const path = require('path');

const DOCS = path.resolve(__dirname, '..', 'docs');
const failures = [];
let checked = 0;

function idsIn(html) {
  const ids = new Set();
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) ids.add(match[1]);
  return ids;
}

const pages = fs.readdirSync(DOCS).filter((name) => name.endsWith('.html'));
const idCache = new Map();
function idsOf(file) {
  if (!idCache.has(file)) idCache.set(file, idsIn(fs.readFileSync(path.join(DOCS, file), 'utf8')));
  return idCache.get(file);
}

for (const page of pages) {
  const html = fs.readFileSync(path.join(DOCS, page), 'utf8');
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|data:)/.test(target)) continue;
    checked += 1;

    if (target.startsWith('#')) {
      const id = target.slice(1);
      if (id && !idsOf(page).has(id)) failures.push(`${page}: missing anchor ${target}`);
      continue;
    }

    const [filePart, anchor] = target.split('#');
    const resolved = path.join(DOCS, filePart);
    if (!fs.existsSync(resolved)) {
      failures.push(`${page}: missing file ${filePart}`);
      continue;
    }
    if (anchor && resolved.endsWith('.html') && !idsOf(path.basename(resolved)).has(anchor)) {
      failures.push(`${page}: missing anchor ${target}`);
    }
  }
}

if (failures.length) {
  process.stdout.write(`Documentation links: ${failures.length} problem(s) across ${pages.length} pages.\n`);
  for (const failure of failures) process.stdout.write(`  ${failure}\n`);
  process.exit(1);
}
process.stdout.write(`Documentation links: ${checked} internal links across ${pages.length} pages resolve.\n`);
