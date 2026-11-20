#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const OUT = DOCS;

const pages = [
  { slug: 'index', title: 'PlainScript', source: path.join(ROOT, 'README.md'), group: 'Start here', home: true },
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

const css = `
:root { --ink:#17212b; --muted:#637081; --line:#dfe6ec; --paper:#fff; --wash:#f5f7f9; --navy:#102431; --blue:#1167a8; --mint:#d9f2e5; --lime:#c7ef8d; --coral:#ff846b; --shadow:0 18px 50px rgba(16,36,49,.08); }
* { box-sizing:border-box; }
html { scroll-behavior:smooth; }
body { margin:0; color:var(--ink); background:var(--paper); font:16px/1.7 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
a { color:var(--blue); text-decoration-thickness:1px; text-underline-offset:3px; }
a:hover { color:#0b4d7e; }
.site-shell { min-height:100vh; display:grid; grid-template-columns:280px minmax(0,1fr); }
.sidebar { position:sticky; top:0; height:100vh; overflow:auto; background:var(--navy); color:#d8e5eb; padding:28px 20px 24px; }
.brand { display:flex; align-items:center; gap:12px; color:#fff; text-decoration:none; margin:0 8px 34px; }
.brand-mark { display:grid; place-items:center; width:38px; height:38px; border-radius:12px 12px 12px 4px; background:var(--lime); color:var(--navy); font-weight:900; letter-spacing:-.08em; }
.brand-name { font-weight:800; letter-spacing:-.03em; font-size:1.05rem; }
.brand-meta { display:block; color:#91a9b5; font-size:.72rem; font-weight:600; letter-spacing:.08em; text-transform:uppercase; margin-top:1px; }
.nav-group { margin:0 8px 25px; }
.nav-label { color:#7f9aa7; text-transform:uppercase; font-size:.67rem; font-weight:800; letter-spacing:.14em; margin:0 0 8px; }
.nav-link { display:block; padding:7px 10px; border-radius:8px; color:#c2d4dc; text-decoration:none; font-size:.92rem; }
.nav-link:hover, .nav-link.active { background:rgba(255,255,255,.09); color:#fff; }
.nav-link.active { box-shadow:inset 3px 0 var(--coral); }
.sidebar-footer { border-top:1px solid rgba(255,255,255,.1); padding:18px 8px 0; color:#89a2ae; font-size:.8rem; }
.sidebar-footer a { color:#b7e7ff; }
.main { min-width:0; }
.topbar { position:sticky; top:0; z-index:5; display:flex; justify-content:space-between; align-items:center; gap:18px; min-height:70px; padding:14px clamp(22px,5vw,72px); background:rgba(255,255,255,.92); border-bottom:1px solid var(--line); backdrop-filter:blur(12px); }
.search { display:flex; align-items:center; gap:9px; max-width:480px; flex:1; background:var(--wash); border:1px solid transparent; border-radius:10px; padding:8px 12px; color:var(--muted); }
.search:focus-within { border-color:#9ecbe7; background:#fff; box-shadow:0 0 0 3px rgba(17,103,168,.08); }
.search input { width:100%; border:0; outline:0; background:transparent; color:var(--ink); font:inherit; }
.search kbd { border:1px solid #cdd8df; border-bottom-width:2px; border-radius:5px; padding:1px 5px; font-size:.68rem; color:var(--muted); white-space:nowrap; }
.top-links { display:flex; align-items:center; gap:16px; font-size:.86rem; white-space:nowrap; }
.top-links a { color:var(--muted); text-decoration:none; }
.content { max-width:1120px; margin:0 auto; padding:66px clamp(22px,5vw,72px) 100px; }
.eyebrow { color:var(--blue); font-size:.75rem; font-weight:850; letter-spacing:.14em; text-transform:uppercase; }
.hero { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(240px,.65fr); gap:42px; align-items:end; padding:22px 0 52px; }
.hero h1 { max-width:760px; margin:12px 0 16px; font-size:clamp(2.6rem,6vw,5.8rem); line-height:.98; letter-spacing:-.075em; color:var(--navy); }
.hero p { max-width:690px; margin:0; font-size:1.18rem; color:var(--muted); }
.hero-aside { padding:22px; background:var(--mint); border-radius:20px 20px 20px 5px; box-shadow:var(--shadow); }
.hero-aside strong { display:block; color:var(--navy); font-size:1.05rem; margin-bottom:8px; }
.hero-aside p { font-size:.92rem; line-height:1.55; color:#35534e; }
.hero-aside code { color:#184a42; }
.quick-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin:0 0 58px; }
.quick-card { display:block; padding:20px; min-height:150px; border:1px solid var(--line); border-radius:15px; color:var(--ink); text-decoration:none; transition:.18s ease; }
.quick-card:hover { transform:translateY(-3px); border-color:#9ecbe7; box-shadow:var(--shadow); }
.quick-card .number { color:var(--coral); font-weight:900; font-size:.82rem; }
.quick-card h2 { margin:10px 0 5px; font-size:1.1rem; letter-spacing:-.025em; }
.quick-card p { margin:0; color:var(--muted); font-size:.9rem; line-height:1.5; }
.page-layout { display:grid; grid-template-columns:minmax(0,1fr) 210px; gap:52px; align-items:start; }
.prose { min-width:0; }
.prose h1 { color:var(--navy); font-size:clamp(2rem,4vw,3.4rem); line-height:1.05; letter-spacing:-.06em; margin:0 0 18px; }
.prose h2 { color:var(--navy); font-size:1.7rem; line-height:1.15; letter-spacing:-.045em; margin:48px 0 14px; padding-top:15px; border-top:1px solid var(--line); }
.prose h3 { color:var(--navy); font-size:1.18rem; margin:30px 0 8px; }
.prose p { margin:0 0 18px; }
.prose ul, .prose ol { padding-left:1.4rem; margin:0 0 20px; }
.prose li { margin:4px 0; }
.prose blockquote { margin:24px 0; padding:14px 18px; border-left:4px solid var(--coral); background:#fff6f2; color:#62463e; }
.prose code { padding:2px 5px; border-radius:5px; background:#eef2f5; color:#8c3e2f; font: .9em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.prose pre { overflow:auto; padding:18px 20px; margin:22px 0; border-radius:12px; background:#12232d; color:#deedf2; box-shadow:var(--shadow); }
.prose pre code { padding:0; background:none; color:inherit; font-size:.87rem; line-height:1.65; }
.prose table { width:100%; border-collapse:collapse; margin:22px 0 28px; font-size:.92rem; }
.prose th, .prose td { padding:9px 11px; border:1px solid var(--line); text-align:left; vertical-align:top; }
.prose th { background:var(--wash); color:var(--navy); }
.toc { position:sticky; top:94px; border-left:1px solid var(--line); padding-left:18px; font-size:.82rem; }
.toc-title { color:var(--muted); font-size:.68rem; font-weight:850; letter-spacing:.13em; text-transform:uppercase; margin-bottom:10px; }
.toc a { display:block; color:var(--muted); text-decoration:none; padding:3px 0; line-height:1.35; }
.toc a:hover { color:var(--blue); }
.toc a.toc-h3 { padding-left:10px; font-size:.78rem; }
.page-footer { display:flex; justify-content:space-between; gap:16px; padding-top:30px; margin-top:55px; border-top:1px solid var(--line); color:var(--muted); font-size:.84rem; }
.empty { padding:28px; border:1px dashed #b9c9d2; border-radius:12px; color:var(--muted); }
.search-results { position:absolute; top:58px; left:0; right:0; max-height:390px; overflow:auto; padding:8px; background:#fff; border:1px solid var(--line); border-radius:12px; box-shadow:var(--shadow); display:none; }
.search-wrap { position:relative; flex:1; max-width:480px; }
.search-results.visible { display:block; }
.search-result { display:block; padding:10px 12px; border-radius:8px; text-decoration:none; color:var(--ink); }
.search-result:hover { background:var(--wash); }
.search-result strong { display:block; font-size:.9rem; }
.search-result span { display:block; color:var(--muted); font-size:.78rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
@media (max-width:900px) { .site-shell { grid-template-columns:1fr; } .sidebar { position:relative; height:auto; padding:18px 18px 12px; } .brand { margin-bottom:18px; } .nav-group { display:inline-block; vertical-align:top; width:46%; margin-bottom:12px; } .sidebar-footer { display:none; } .hero { grid-template-columns:1fr; } .page-layout { grid-template-columns:1fr; } .toc { position:static; order:-1; border-left:0; border-bottom:1px solid var(--line); padding:0 0 15px; } }
@media (max-width:620px) { .topbar { padding:12px 16px; } .top-links a:not(:last-child) { display:none; } .content { padding:38px 18px 70px; } .quick-grid { grid-template-columns:1fr; } .nav-group { width:100%; } .hero h1 { font-size:3.3rem; } .page-footer { flex-direction:column; } }
`;

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
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
  text = text.replace(/href="(CHANGELOG|CONTRIBUTION|LICENSE)(?:\.md)?"/g, 'href="https://github.com/ayoistooslick/Plainscript/blob/main/$1"');
  text = text.replace(/href="((?:demos|editors|templates)\/[^\"]+)"/g, 'href="https://github.com/ayoistooslick/Plainscript/tree/main/$1"');
  const pageSlugs = ['MIGRATION', 'SPEC', 'SYNTAX_DESIGN', 'CLI', 'INTEROP', 'PROGRESS', 'DECISIONS', 'AUDIT', 'JOBS', 'DATABASES', 'SECURITY', 'DEBUGGING', 'CONCURRENCY', 'UNIFIED_CONTRACTS', 'TYPE_SYSTEM', 'TEMPLATES', 'BENCHMARKS', 'ROADMAP'];
  text = text.replace(/href="UNIFIED_CONTRACTS\.html"/g, 'href="contracts.html"');
  for (const pageSlug of pageSlugs) text = text.replace(new RegExp(`href="${pageSlug}\\.html"`, 'g'), `href="${pageSlug.toLowerCase().replace('_', '-')}.html"`);
  text = text.replace(/href="DEMOS\.html"/g, 'href="interop.html"');
  text = text.replace(/href="CHANGELOG\.html"/g, 'href="https://github.com/ayoistooslick/Plainscript/blob/main/CHANGELOG.md"');
  text = text.replace(/href="CONTRIBUTION\.html"/g, 'href="https://github.com/ayoistooslick/Plainscript/blob/main/CONTRIBUTION.md"');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return text;
}
function markdown(source) {
  const lines = source.replace(/\r/g, '').split('\n');
  const out = [];
  const headings = [];
  let paragraph = [];
  let list = null;
  let table = null;
  let code = null;
  let codeIndent = 0;
  const flushParagraph = () => { if (paragraph.length) { out.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; } };
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushTable = () => { if (table) { out.push('</tbody></table>'); table = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trimStart().startsWith('```')) {
      flushParagraph(); flushList(); flushTable();
      if (code === null) {
        code = [];
        codeIndent = line.match(/^\s*/)[0].length;
        out.push('<pre><code>');
      } else {
        out[out.length - 1] += `${esc(code.join('\n'))}</code></pre>`;
        code = null;
        codeIndent = 0;
      }
      continue;
    }
    if (code !== null) { code.push(raw.slice(codeIndent)); continue; }
    if (!line.trim()) { flushParagraph(); flushList(); flushTable(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { flushParagraph(); flushList(); flushTable(); const level = heading[1].length; const text = heading[2].replace(/\s+#+$/, ''); const id = slug(text); headings.push({ level, text, id }); out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`); continue; }
    if (/^>\s?/.test(line)) { flushParagraph(); flushList(); flushTable(); out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    const item = line.match(/^\s*[-*+]\s+(.+)$/) || line.match(/^\s*\d+\.\s+(.+)$/);
    if (item) { flushParagraph(); flushTable(); const type = /^\s*\d+\./.test(line) ? 'ol' : 'ul'; if (list !== type) { flushList(); list = type; out.push(`<${type}>`); } out.push(`<li>${inline(item[1])}</li>`); continue; }
    if (line.includes('|')) {
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      if (cells.length) {
        flushParagraph(); flushList();
        if (!table) { table = true; out.push(`<table><thead><tr>${cells.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>`); }
        else if (!cells.every((cell) => /^:?-+:?$/.test(cell))) out.push(`<tr>${cells.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`);
        continue;
      }
    }
    paragraph.push(line.trim());
  }
  if (code !== null) out[out.length - 1] += `${esc(code.join('\n'))}</code></pre>`;
  flushParagraph(); flushList(); flushTable();
  return { html: out.join('\n'), headings };
}

function nav(active) {
  const groups = [...new Set(pages.map((page) => page.group))];
  return groups.map((group) => `<div class="nav-group"><div class="nav-label">${group}</div>${pages.filter((page) => page.group === group).map((page) => `<a class="nav-link ${page.slug === active ? 'active' : ''}" href="${page.slug === 'index' ? 'index.html' : `${page.slug}.html`}">${page.title}</a>`).join('')}</div>`).join('');
}
function toc(headings) {
  const visible = headings.filter((heading) => heading.level >= 2 && heading.level <= 3);
  if (!visible.length) return '';
  return `<aside class="toc"><div class="toc-title">On this page</div>${visible.map((heading) => `<a class="toc-h${heading.level}" href="#${heading.id}">${esc(heading.text)}</a>`).join('')}</aside>`;
}
function shell(page, body, headings) {
  const description = page.home ? 'A typed language that compiles to JavaScript.' : `${page.title} — PlainScript documentation.`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${esc(description)}"><title>${esc(page.title)} · PlainScript</title><link rel="stylesheet" href="style.css"></head><body><div class="site-shell"><aside class="sidebar"><a class="brand" href="index.html"><span class="brand-mark">PS</span><span><span class="brand-name">PlainScript</span><span class="brand-meta">Language docs · 2.0</span></span></a>${nav(page.slug)}<div class="sidebar-footer">Open source under MIT.<br><a href="https://github.com/ayoistooslick/Plainscript">View on GitHub ↗</a></div></aside><main class="main"><header class="topbar"><div class="search-wrap"><label class="search" aria-label="Search documentation"><span>⌕</span><input id="doc-search" type="search" placeholder="Search the docs…" autocomplete="off"><kbd>/</kbd></label><div id="search-results" class="search-results" role="listbox"></div></div><nav class="top-links"><a href="index.html">Docs</a><a href="https://github.com/ayoistooslick/Plainscript">GitHub ↗</a></nav></header><div class="content">${body}<footer class="page-footer"><span>PlainScript 2.0 documentation</span><a href="https://github.com/ayoistooslick/Plainscript/issues">Report a documentation issue ↗</a></footer></div></main></div><script src="app.js"></script></body></html>`;
}

function homeBody(rendered) {
  return `<section class="hero"><div><div class="eyebrow">A language for serious JavaScript software</div><h1>Make the machine readable.</h1><p>PlainScript is a statically typed language that compiles to ordinary JavaScript modules. Learn the syntax, understand the compiler, and build full-stack applications without leaving the ecosystem.</p></div><aside class="hero-aside"><strong>Start with the shape of the language.</strong><p>Read the quick tour, then move into the specification when you need exact semantics. The docs are organized for both paths.</p><code>plainscript new my-app</code></aside></section><section class="quick-grid"><a class="quick-card" href="cli.html"><span class="number">01 / BUILD</span><h2>Install and run</h2><p>Use the CLI to check, build, format, test, and scaffold a project.</p></a><a class="quick-card" href="spec.html"><span class="number">02 / LEARN</span><h2>Learn the language</h2><p>Follow the language model from modules and types to async code and rendering.</p></a><a class="quick-card" href="architecture.html"><span class="number">03 / UNDERSTAND</span><h2>Explore the compiler</h2><p>Trace source through lexer, parser, checker, HIR, and JavaScript emission.</p></a></section><article class="page-layout"><div class="prose">${rendered.html}</div>${toc(rendered.headings)}</article>`;
}

for (const generated of ['index.html', 'cli.html', 'templates.html', 'spec.html', 'syntax-design.html', 'architecture.html', 'interop.html', 'migration.html', 'progress.html', 'audit.html', 'decisions.html', 'style.css', 'app.js', '.nojekyll']) {
  fs.rmSync(path.join(OUT, generated), { force: true });
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'style.css'), css.trimStart());
const search = [];
for (const page of pages) {
  const source = fs.readFileSync(page.source, 'utf8');
  const rendered = markdown(source);
  search.push({ title: page.title, url: page.slug === 'index' ? 'index.html' : `${page.slug}.html`, text: source.replace(/\s+/g, ' ').slice(0, 260) });
  const body = page.home ? homeBody(rendered) : `<article class="page-layout"><div class="prose">${rendered.html}</div>${toc(rendered.headings)}</article>`;
  fs.writeFileSync(path.join(OUT, `${page.slug}.html`), shell(page, body, rendered.headings));
}
fs.writeFileSync(path.join(OUT, 'app.js'), `const searchIndex = ${JSON.stringify(search)};\nconst input = document.querySelector('#doc-search');\nconst results = document.querySelector('#search-results');\nfunction showResults(value) { const query = value.trim().toLowerCase(); if (!query) { results.classList.remove('visible'); results.innerHTML = ''; return; } const matches = searchIndex.filter((item) => (item.title + ' ' + item.text).toLowerCase().includes(query)).slice(0, 8); results.innerHTML = matches.length ? matches.map((item) => '<a class="search-result" href="' + item.url + '"><strong>' + item.title + '</strong><span>' + item.text.replace(/[<>]/g, '') + '</span></a>').join('') : '<div class="empty">No matching page.</div>'; results.classList.add('visible'); }\ninput.addEventListener('input', () => showResults(input.value));\ninput.addEventListener('keydown', (event) => { if (event.key === 'Escape') { input.value = ''; showResults(''); input.blur(); } });\ndocument.addEventListener('keydown', (event) => { if ((event.key === '/' || (event.key === 'k' && (event.metaKey || event.ctrlKey))) && document.activeElement !== input) { event.preventDefault(); input.focus(); } });\ndocument.addEventListener('click', (event) => { if (!event.target.closest('.search-wrap')) results.classList.remove('visible'); });\n`);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`Built ${pages.length} documentation pages in ${path.relative(ROOT, OUT)}/`);
