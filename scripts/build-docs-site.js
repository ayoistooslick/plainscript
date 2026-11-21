#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const OUT = DOCS;
const REPO = 'https://github.com/ayoistooslick/Plainscript';

const pages = [
  { slug: 'index', title: 'PlainScript', source: path.join(ROOT, 'README.md'), group: 'Start here', home: true },
  { slug: 'getting-started', title: 'Getting started', source: path.join(DOCS, 'GETTING_STARTED.md'), group: 'Start here' },
  { slug: 'language-reference', title: 'Language reference', source: path.join(DOCS, 'LANGUAGE_REFERENCE.md'), group: 'Language' },
  { slug: 'compiler', title: 'Compiler', source: path.join(DOCS, 'COMPILER.md'), group: 'Compiler' },
  { slug: 'integrations', title: 'Integrations', source: path.join(DOCS, 'INTEGRATIONS.md'), group: 'Guides' },
  { slug: 'migration-2-1', title: 'Migrating from 2.0', source: path.join(DOCS, 'MIGRATION_2_1.md'), group: 'Guides' },
  { slug: 'cli', title: 'CLI reference', source: path.join(DOCS, 'CLI.md'), group: 'Start here' },
  { slug: 'templates', title: 'Application templates', source: path.join(DOCS, 'TEMPLATES.md'), group: 'Start here' },
  { slug: 'spec', title: 'Language specification', source: path.join(DOCS, 'SPEC.md'), group: 'Language' },
  { slug: 'syntax-design', title: 'Syntax design', source: path.join(DOCS, 'SYNTAX_DESIGN.md'), group: 'Language' },
  { slug: 'architecture', title: 'Compiler architecture', source: path.join(DOCS, 'ARCHITECTURE.md'), group: 'Compiler' },
  { slug: 'interop', title: 'JavaScript interoperability', source: path.join(DOCS, 'INTEROP.md'), group: 'Compiler' },
  { slug: 'type-system', title: 'Type system', source: path.join(DOCS, 'TYPE_SYSTEM.md'), group: 'Language' },
  { slug: 'contracts', title: 'Unified contracts', source: path.join(DOCS, 'UNIFIED_CONTRACTS.md'), group: 'Guides' },
  { slug: 'concurrency', title: 'Concurrency', source: path.join(DOCS, 'CONCURRENCY.md'), group: 'Guides' },
  { slug: 'jobs', title: 'Background jobs', source: path.join(DOCS, 'JOBS.md'), group: 'Guides' },
  { slug: 'databases', title: 'Databases', source: path.join(DOCS, 'DATABASES.md'), group: 'Guides' },
  { slug: 'security', title: 'Security', source: path.join(DOCS, 'SECURITY.md'), group: 'Guides' },
  { slug: 'debugging', title: 'Debugging', source: path.join(DOCS, 'DEBUGGING.md'), group: 'Guides' },
  { slug: 'migration', title: 'Migration guide', source: path.join(DOCS, 'MIGRATION.md'), group: 'Guides' },
  { slug: 'comparison', title: 'Comparison with TypeScript', source: path.join(DOCS, 'COMPARISON.md'), group: 'Guides' },
  { slug: 'benchmarks', title: 'Benchmarks', source: path.join(DOCS, 'BENCHMARKS.md'), group: 'Compiler' },
  { slug: 'progress', title: 'Engineering progress', source: path.join(DOCS, 'PROGRESS.md'), group: 'Project' },
  { slug: 'roadmap', title: 'Roadmap', source: path.join(DOCS, 'ROADMAP.md'), group: 'Project' },
  { slug: 'audit', title: 'Audit', source: path.join(DOCS, 'AUDIT.md'), group: 'Project' },
  { slug: 'decisions', title: 'Decisions', source: path.join(DOCS, 'DECISIONS.md'), group: 'Project' },
];

const LANG_LABEL = {
  plainscript: 'pln',
  bash: 'sh',
  sh: 'sh',
  shell: 'sh',
  text: 'output',
  json: 'json',
  js: 'js',
  javascript: 'js',
  ts: 'ts',
  tsx: 'tsx',
  ebnf: 'ebnf',
  html: 'html',
  css: 'css',
};

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function slug(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function inline(value) {
  let text = esc(value);
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  text = text.replace(/href="(?:\.\.\/)?docs\/([A-Za-z0-9_-]+)\.md"/g, 'href="$1.html"');
  text = text.replace(/href="([A-Za-z0-9_-]+)\.md"/g, 'href="$1.html"');
  text = text.replace(/href="docs\/DEMOS\.md"/g, 'href="interop.html"');
  text = text.replace(/href="(CHANGELOG|CONTRIBUTION|LICENSE)(?:\.md)?"/g, 'href="' + REPO + '/blob/main/$1"');
  text = text.replace(/href="((?:demos|editors|templates|integrations)\/[^"]+)"/g, 'href="' + REPO + '/tree/main/$1"');
  const pageSlugs = ['MIGRATION', 'MIGRATION_2_1', 'GETTING_STARTED', 'LANGUAGE_REFERENCE', 'COMPILER', 'INTEGRATIONS', 'SPEC', 'SYNTAX_DESIGN', 'CLI', 'INTEROP', 'PROGRESS', 'DECISIONS', 'AUDIT', 'JOBS', 'DATABASES', 'SECURITY', 'DEBUGGING', 'CONCURRENCY', 'UNIFIED_CONTRACTS', 'TYPE_SYSTEM', 'TEMPLATES', 'BENCHMARKS', 'ROADMAP', 'ARCHITECTURE', 'COMPARISON'];
  text = text.replace(/href="UNIFIED_CONTRACTS\.html"/g, 'href="contracts.html"');
  for (const pageSlug of pageSlugs) text = text.replace(new RegExp(`href="${pageSlug}\\.html"`, 'g'), `href="${pageSlug.toLowerCase().replace(/_/g, '-')}.html"`);
  text = text.replace(/href="DEMOS\.html"/g, 'href="interop.html"');
  text = text.replace(/href="CHANGELOG\.html"/g, 'href="' + REPO + '/blob/main/CHANGELOG.md"');
  text = text.replace(/href="CONTRIBUTION\.html"/g, 'href="' + REPO + '/blob/main/CONTRIBUTION.md"');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return text;
}

function codeFigure(lang, source) {
  const clean = (lang || 'text').trim();
  const label = LANG_LABEL[clean] || clean || 'text';
  return `<figure class="specimen-code"><figcaption class="specimen-bar"><span class="specimen-lang">${esc(label)}</span><button class="copy-btn" type="button" data-copy aria-label="Copy code to clipboard">copy</button></figcaption><pre><code data-lang="${esc(clean)}">${esc(source)}</code></pre></figure>`;
}

function markdown(source) {
  const lines = source.replace(/\r/g, '').split('\n');
  const out = [];
  const headings = [];
  let paragraph = [];
  let list = null;
  let table = null;
  let code = null;
  let codeLang = 'text';
  let codeIndent = 0;
  let quote = [];

  const flushParagraph = () => { if (paragraph.length) { out.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; } };
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushTable = () => { if (table) { out.push('</tbody></table></div>'); table = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`); quote = []; } };
  const flushAll = () => { flushParagraph(); flushList(); flushTable(); flushQuote(); };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trimStart().startsWith('```')) {
      flushAll();
      if (code === null) {
        code = [];
        codeIndent = line.match(/^\s*/)[0].length;
        codeLang = line.trim().slice(3).trim().toLowerCase() || 'text';
      } else {
        out.push(codeFigure(codeLang, code.join('\n')));
        code = null;
        codeLang = 'text';
        codeIndent = 0;
      }
      continue;
    }
    if (code !== null) { code.push(raw.slice(codeIndent)); continue; }
    if (/^\s*<!--[\s\S]*?-->\s*$/.test(line)) { flushAll(); continue; }
    if (!line.trim()) { flushAll(); continue; }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const text = heading[2].replace(/\s+#+$/, '');
      const id = slug(text);
      headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushParagraph(); flushList(); flushTable();
      quote.push(line.replace(/^>\s?/, ''));
      continue;
    }
    flushQuote();
    const item = line.match(/^\s*[-*+]\s+(.+)$/) || line.match(/^\s*\d+\.\s+(.+)$/);
    if (item) {
      flushParagraph(); flushTable();
      const type = /^\s*\d+\./.test(line) ? 'ol' : 'ul';
      if (list !== type) { flushList(); list = type; out.push(`<${type}>`); }
      out.push(`<li>${inline(item[1])}</li>`);
      continue;
    }
    if (line.includes('|')) {
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      if (cells.length) {
        flushParagraph(); flushList();
        if (!table) { table = true; out.push(`<div class="table-wrap"><table><thead><tr>${cells.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>`); }
        else if (!cells.every((cell) => /^:?-+:?$/.test(cell))) out.push(`<tr>${cells.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`);
        continue;
      }
    }
    paragraph.push(line.trim());
  }
  if (code !== null) out.push(codeFigure(codeLang, code.join('\n')));
  flushAll();
  return { html: out.join('\n'), headings };
}

function nav(active) {
  const groups = [...new Set(pages.map((page) => page.group))];
  return groups.map((group) => `<div class="nav-group"><div class="nav-label">${esc(group)}</div>${pages.filter((page) => page.group === group).map((page) => `<a class="nav-link ${page.slug === active ? 'active' : ''}" href="${page.slug === 'index' ? 'index.html' : `${page.slug}.html`}"${page.slug === active ? ' aria-current="page"' : ''}>${esc(page.title)}</a>`).join('')}</div>`).join('');
}

function toc(headings) {
  const visible = headings.filter((heading) => heading.level >= 2 && heading.level <= 3);
  if (!visible.length) return '';
  return `<aside class="toc-rail" aria-label="On this page"><div class="toc-title">On this page</div><nav class="toc">${visible.map((heading) => `<a class="toc-h${heading.level}" href="#${heading.id}">${esc(heading.text.replace(/`/g, ''))}</a>`).join('')}</nav></aside>`;
}

function pageNav(page) {
  const order = pages.filter((item) => !item.home);
  const index = order.findIndex((item) => item.slug === page.slug);
  if (index === -1) return '';
  const prev = order[index - 1];
  const next = order[index + 1];
  const link = (item, kind) => item
    ? `<a class="pn-${kind}" href="${item.slug}.html"><span class="pn-label">${kind === 'prev' ? '← Previous' : 'Next →'}</span><span class="pn-title">${esc(item.title)}</span></a>`
    : `<span></span>`;
  return `<nav class="page-nav" aria-label="Chapter navigation">${link(prev, 'prev')}${link(next, 'next')}</nav>`;
}

function colophon() {
  return `<footer class="colophon"><div><div class="colophon-mark">PlainScript<span>.</span></div><p>An independent, statically typed language for the JavaScript platform. This manual is set in Fraunces, Newsreader, Space Grotesk and IBM Plex Mono, with halftone plates drawn in-house. One stylesheet, no frameworks, no trackers.</p></div><nav class="colophon-links" aria-label="Project links"><a href="index.html">Manual</a><a href="${REPO}">Source</a><a href="${REPO}/issues">Issues</a><a href="${REPO}/blob/main/CHANGELOG.md">Changelog</a><a href="${REPO}/blob/main/LICENSE">MIT</a></nav></footer>`;
}

const CHAPTER_ART = {
  'Start here': { file: 'plate-portrait.jpg' },
  Language: { file: 'plate-eye.jpg' },
  Compiler: { file: 'plate-chrome.jpg' },
  Guides: { file: 'plate-figure.jpg' },
  Project: { file: 'plate-hands.jpg' }
}

function chapterNumber(page) {
  const order = pages.filter((item) => !item.home);
  const index = order.findIndex((item) => item.slug === page.slug);
  return String(Math.max(0, index) + 1).padStart(2, '0');
}

function kicker(page, minutes) {
  return `<div class="page-kicker"><span class="kicker-no">${chapterNumber(page)}</span><span class="kicker-section">${esc(page.group)}</span><span class="kicker-meta">${minutes} min read</span></div>`;
}

function chapterHead(page, minutes, html) {
  const art = CHAPTER_ART[page.group] || CHAPTER_ART.Guides;
  const found = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/);
  const heading = found ? found[0] : '';
  const rest = found ? html.replace(found[0], '') : html;
  return `<div class="chapter-head"><figure class="chapter-band" data-tilt><img src="assets/${art.file}" alt="" width="1024" height="1024" loading="lazy" decoding="async"></figure>${kicker(page, minutes)}${heading}</div>${rest}`;
}

function shell(page, body, meta) {
  const description = meta.description;
  const crumb = page.home
    ? '<span class="crumb"><b>PlainScript</b><span class="slash">/</span>Manual</span>'
    : `<span class="crumb"><b>PlainScript</b><span class="slash">/</span>${esc(page.group)}<span class="slash">/</span>${esc(page.title)}</span>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${esc(description)}"><meta name="color-scheme" content="dark"><meta name="theme-color" content="#08070b"><title>${esc(page.title)} · PlainScript</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23a679ff'/%3E%3Ctext x='16' y='23' font-family='Georgia,serif' font-size='20' fill='%2308070b' text-anchor='middle'%3EP%3C/text%3E%3C/svg%3E"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=IBM+Plex+Mono:ital,wght@0,400;0,500;1,400&family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..600&family=Space+Grotesk:wght@400..700&display=swap" rel="stylesheet"><link rel="stylesheet" href="style.css"></head><body><a class="skip" href="#main">Skip to content</a><div class="scrim" data-scrim></div><div class="shell"><aside class="rail" id="rail"><div class="rail-head"><a class="wordmark" href="index.html">PlainScript<span class="dot">.</span></a><div class="rail-meta">Language manual<br>Vol. 2.1 · MMXXVI</div></div><nav class="rail-nav" aria-label="Documentation">${nav(page.slug)}</nav><div class="rail-foot"><a href="${REPO}">Source ↗</a><span class="sep">/</span><a href="${REPO}/issues">Issues ↗</a><br>MIT · built by hand</div></aside><div class="main"><header class="top"><button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="rail"><span aria-hidden="true">≡</span> <span class="nav-toggle-label">Contents</span></button><a class="top-brand" href="index.html">PlainScript<span>.</span></a>${crumb}<div class="search-wrap"><label class="search" aria-label="Search the manual"><span class="glyph" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg></span><input id="doc-search" type="search" placeholder="Search the manual" autocomplete="off" aria-controls="search-results" aria-expanded="false"><kbd>/</kbd></label><div id="search-results" class="search-results" role="listbox" aria-label="Search results"></div></div><a class="top-github" href="${REPO}">GitHub ↗</a><div class="progress" aria-hidden="true"><span></span></div></header><main id="main" class="page">${body}</main></div></div><script src="app.js"></script></body></html>`;
}

/* ---------------- homepage ---------------- */
const sampleSource = [
  '#syntax 2.1',
  '',
  'import { print } from "std/io"',
  '',
  'define greet(name: text) returns text',
  '    return "Hello, {name}."',
  'end',
  '',
  'print(greet("world"))',
].join('\n');
const sampleOutput = [
  'import { print } from "./std/io.js";',
  '',
  'function greet(name) {',
  '  return `Hello, ${name}.`;',
  '}',
  '',
  'print(greet("world"));',
].join('\n');
const sampleTerminal = [
  '$ plainscript run hello.pln',
  'Hello, world.',
].join('\n');

function manualIndex() {
  const order = pages.filter((page) => !page.home);
  return order.map((page, index) => `<li><a href="${page.slug}.html"><span class="ix">${String(index + 1).padStart(2, '0')}</span><span class="mt">${esc(page.title)}</span><span class="mg">${esc(page.group)}</span></a></li>`).join('');
}

function artFigure(file, width, height, className) {
  return `<figure class="art-plate ${className || ''}" data-tilt><div class="art-plate__frame"><img src="assets/${file}" alt="Halftone artwork" width="${width}" height="${height}" loading="lazy" decoding="async"></div></figure>`;
}

function homeBody() {
  const tabs = `<div class="code-tabs" data-tabs><div class="tablist" role="tablist" aria-label="Language specimen"><button type="button" role="tab" id="tab-src" aria-controls="panel-src" aria-selected="true" data-tab="src">hello.pln</button><button type="button" role="tab" id="tab-out" aria-controls="panel-out" aria-selected="false" tabindex="-1" data-tab="out">hello.js</button><button type="button" role="tab" id="tab-cli" aria-controls="panel-cli" aria-selected="false" tabindex="-1" data-tab="cli">terminal</button></div><div class="tabpanel" role="tabpanel" id="panel-src" aria-labelledby="tab-src" data-panel="src"><pre><code data-lang="plainscript">${esc(sampleSource)}</code></pre></div><div class="tabpanel" role="tabpanel" id="panel-out" aria-labelledby="tab-out" data-panel="out" hidden><pre><code data-lang="js">${esc(sampleOutput)}</code></pre></div><div class="tabpanel" role="tabpanel" id="panel-cli" aria-labelledby="tab-cli" data-panel="cli" hidden><pre><code data-lang="text">${esc(sampleTerminal)}</code></pre></div></div>`;
  const heroPlate = `<figure class="art-plate" data-tilt><div class="art-plate__frame"><img src="assets/plate-portrait.jpg" alt="Halftone portrait with a violet and orange riso window printed across the eyes" width="1024" height="1024" fetchpriority="high" decoding="async"></div></figure>`;
  return `<div class="home"><div class="folio"><span>PlainScript</span><span>Vol. 2.1</span><span>An independent language</span><span>MMXXVI</span></div><section class="masthead"><div class="hero-grid"><div class="hero-copy"><h1 class="display">A language that reads like <em>plain writing</em>.</h1><div class="hero-lede-row"><p class="lede">PlainScript is a statically typed, full-stack language for the JavaScript platform. Write modules that read like structured English; compile them to ordinary ES modules that run anywhere JavaScript already runs. This is the manual — the whole thing, in the open.</p><div class="masthead-actions"><a class="btn-primary" href="getting-started.html">Start the manual <span aria-hidden="true">→</span></a><a class="btn-ghost" href="spec.html">Read the specification</a></div></div></div><div class="hero-art">${heroPlate}</div></div><dl class="factbar"><div><dt>Version</dt><dd>2.1.0</dd></div><div><dt>Licence</dt><dd>MIT</dd></div><div><dt>Compiles to</dt><dd>ES modules</dd></div><div><dt>Author</dt><dd>Ayodele A. David</dd></div></dl></section><section class="plate"><div class="plate-copy"><div class="section-mark">The language</div><h2>Readable at the source. Ordinary at the output.</h2><p>No new runtime, no virtual machine, no ecosystem to migrate to. PlainScript is a typed surface over the JavaScript platform: the compiler checks your program, then emits modules your existing tools already understand.</p><ul class="checklist"><li>Statically checked before anything runs.</li><li>Functions, records, unions and async without ceremony.</li><li>Ships with a CLI, language server, formatter and debugger.</li><li>One file at a time — 2.0 code keeps compiling.</li></ul></div><div>${tabs}</div></section><section class="art-break reveal"><div class="art-break__copy"><div class="section-mark"><span>Interlude</span>On reading code</div><p class="quoteline">“A program is a sentence you will read a hundred times. <b>Write it for the hundredth.</b>”</p><p class="attrib">PlainScript design note · Decisions</p></div><div class="art-break__plate">${artFigure('plate-eye.jpg', 1024, 1024)}</div></section><section class="manual"><div class="section-mark"><span>Contents</span>Everything, in order</div><ol class="manual-list">${manualIndex()}</ol></section><section class="principles"><div class="section-mark"><span>Position</span>What this is, and is not</div><div class="principle-grid"><article class="principle" data-tilt-soft><span class="num">01</span><h3>Independent by design</h3><p>PlainScript is not a framework or a wrapper. It is a language with its own grammar, checker and compiler, built in the open by one author and published under MIT.</p></article><article class="principle" data-tilt-soft><span class="num">02</span><h3>Typed without ceremony</h3><p>Types are inferred where they are obvious and written where they matter. The checker is strict about the things that break software, and quiet about the rest.</p></article><article class="principle" data-tilt-soft><span class="num">03</span><h3>Ordinary at the output</h3><p>The compiler emits readable ES modules and source maps. There is no runtime to adopt and no ecosystem to leave behind.</p></article></div><p class="closing-line"><a href="decisions.html">Read the design decisions →</a></p></section>${colophon()}</div>`;
}

/* ---------------- build ---------------- */
const css = fs.readFileSync(path.join(__dirname, 'docs', 'style.css'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, 'docs', 'app.js'), 'utf8');

for (const generated of ['index.html', 'cli.html', 'templates.html', 'spec.html', 'syntax-design.html', 'architecture.html', 'interop.html', 'migration.html', 'getting-started.html', 'language-reference.html', 'compiler.html', 'integrations.html', 'migration-2-1.html', 'progress.html', 'audit.html', 'decisions.html', 'type-system.html', 'contracts.html', 'concurrency.html', 'jobs.html', 'databases.html', 'security.html', 'debugging.html', 'comparison.html', 'benchmarks.html', 'roadmap.html', 'style.css', 'app.js', '.nojekyll']) {
  fs.rmSync(path.join(OUT, generated), { force: true });
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'style.css'), css.trimStart());

const search = [];
for (const page of pages) {
  const source = fs.readFileSync(page.source, 'utf8');
  const rendered = markdown(source);
  const plain = source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`|\[\]()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = plain.split(' ').filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 220));
  search.push({
    title: page.title,
    url: page.slug === 'index' ? 'index.html' : `${page.slug}.html`,
    text: plain.slice(0, 240),
  });
  const body = page.home
    ? homeBody()
    : `<div class="article-grid"><article class="prose">${chapterHead(page, minutes, rendered.html)}</article>${toc(rendered.headings)}</div>${pageNav(page)}${colophon()}`;
  const description = page.home
    ? 'PlainScript is an independent, statically typed language that compiles to ordinary JavaScript. Read the manual.'
    : `${page.title} — PlainScript 2.1 documentation.`;
  fs.writeFileSync(path.join(OUT, `${page.slug}.html`), shell(page, body, { description }));
}
fs.writeFileSync(path.join(OUT, 'app.js'), `window.searchIndex = ${JSON.stringify(search)};\n${appSource}`);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`Built ${pages.length} documentation pages in ${path.relative(ROOT, OUT)}/`);
