window.searchIndex = [{"title":"PlainScript","url":"index.html","text":""},{"title":"Getting started","url":"getting-started.html","text":"Getting started with PlainScript 2.1 PlainScript is a statically typed language that compiles to JavaScript. You write a .pln file, the compiler checks it, and you run the emitted ES module with Node, Vite, Next.js or any other JavaScript t"},{"title":"Language reference","url":"language-reference.html","text":"PlainScript 2.1 language reference This is the practical reference for the 2.1 dialect. The normative semantics are in the specification SPEC.md ; this page shows the surface, names the 2.0 equivalent, and states the rules the compiler enfo"},{"title":"Compiler","url":"compiler.html","text":"The PlainScript compiler The compiler turns a .pln module graph into JavaScript ES modules. It has six stages, each with its own diagnostics and tests: 1. Dialect resolution Dialect detection happens before lexing. src/dialect.js reads the "},{"title":"Integrations","url":"integrations.html","text":"Integrations PlainScript emits ordinary ES modules. Any JavaScript framework that accepts a module works without a plugin, a runtime shim or a custom bundler. This page covers the eight integrations in integrations/ ../integrations . Each e"},{"title":"Migrating from 2.0","url":"migration-2-1.html","text":"Migrating from PlainScript 2.0 to 2.1 2.1 is additive. Every 2.0 file compiles unchanged, and a project can move one file at a time. Nothing in this guide is required to keep shipping on 2.0. The migration has two steps: add the pragma, the"},{"title":"CLI reference","url":"cli.html","text":"Command line Exit codes: 0 success, 1 compile or test failure, 2 usage error. Diagnostics go to stderr; program output and ir / version output go to stdout. Syntax dialects A .pln file selects its surface dialect on the first line: syntax 2"},{"title":"Application templates","url":"templates.html","text":"Application templates PlainScript ships eight starters. They are real program slices, not static landing pages: each has PlainScript source, package metadata and documentation. The three application templates include persistent storage; the"},{"title":"Language specification","url":"spec.html","text":"The PlainScript 2.1 Language Specification This document defines the language implemented by the compiler in src/ . When this document and the compiler disagree, the compiler is authoritative and the document is a bug. PlainScript is static"},{"title":"Syntax design","url":"syntax-design.html","text":"PlainScript syntax design Design goal PlainScript should be recognizable to developers who already write JavaScript or TypeScript, without becoming a TypeScript clone. Familiar syntax should be chosen where it clarifies common code; distinc"},{"title":"Compiler architecture","url":"architecture.html","text":"Compiler architecture PlainScript 2.0 is a single-pass-per-stage compiler with an explicit typed IR between checking and emission. There are no runtime dependencies, and the emitted code has no PlainScript runtime. src/modules.js owns the m"},{"title":"JavaScript interoperability","url":"interop.html","text":"JavaScript interoperability PlainScript emits ES modules. There is no runtime library, no wrapper around React, and no custom module format, so interoperability is a question of what the emitted JavaScript can import — which is everything N"},{"title":"Type system","url":"type-system.html","text":"Type system PlainScript uses structural types. Types are erased from emitted JavaScript; the checker is the enforcer, and untyped JavaScript boundaries remain any deliberately. Implemented and tested - Primitives, records, optional and read"},{"title":"Unified contracts","url":"contracts.html","text":"Unified full-stack contracts Status: implemented through schemas, typed operations, typed errors, dispatch, SQLite models/migrations, PostgreSQL/MySQL adapter surfaces and a real authentication flow. The verified application is demos/contra"},{"title":"Concurrency","url":"concurrency.html","text":"Concurrency and asynchronous programming PlainScript keeps JavaScript's event loop and promise semantics. std/task adds a structured layer on top of that runtime; it does not introduce a second scheduler. Semantics - Task group ownership. g"},{"title":"Background jobs","url":"jobs.html","text":"Background jobs std/jobs is a scheduler for server work that should not block a request: sending email, resizing an upload, warming a cache, or retrying a flaky integration. Its scheduler is in-process; an optional store adapter persists jo"},{"title":"Databases","url":"databases.html","text":"Databases PlainScript has no database runtime of its own. Application code imports an ordinary npm driver, passes values as bound parameters, and keeps contract validation at the boundary. The bundled SQLite, PostgreSQL and MySQL adapters p"},{"title":"Security","url":"security.html","text":"Security and production readiness PlainScript's security-sensitive standard library is intentionally small. This page states what is verified, what defaults are safe, and what remains application responsibility. Passwords std/auth.hashPassw"},{"title":"Debugging","url":"debugging.html","text":"Debugging PlainScript emits ordinary JavaScript with source maps. Debugging therefore uses the JavaScript ecosystem's tools rather than a custom runtime. Compile, then inspect Open chrome://inspect or your editor's Node debugger , attach to"},{"title":"Migration guide","url":"migration.html","text":"Migration from PlainScript v1 to v2 PlainScript 2.0 is a ground-up rebuild. This guide documents the changes from v1 to v2 and what you need to update in your v1 code to make it work with v2. Conditional syntax update after the 2.0.0 snapsh"},{"title":"Comparison with TypeScript","url":"comparison.html","text":"Comparison with TypeScript stacks This is an engineering comparison, not a marketing claim. PlainScript is younger and has a much smaller ecosystem. The useful question is narrower: for a schema-first full-stack application, how much duplic"},{"title":"Benchmarks","url":"benchmarks.html","text":"Compiler benchmarks The benchmark is synthetic and PlainScript-only. It exists to detect regressions and to make the build path measurable without a network install. It does not support a claim that PlainScript is faster than TypeScript. Re"},{"title":"Engineering progress","url":"progress.html","text":"PlainScript engineering status This file records the current verified state. Earlier per-defect logs are preserved in git history and in docs/AUDIT.md ; stale status claims are not kept here. Verified baseline Run npm test from the reposito"},{"title":"Roadmap","url":"roadmap.html","text":"Roadmap This roadmap reports status; it is not a promise of dates. Available and verified now - Compiler pipeline: lexer, parser, type checker, typed HIR, JavaScript emitter and source maps; deterministic ESM output and .d.pln declaration g"},{"title":"Audit","url":"audit.html","text":"Audit of PlainScript 1.x This audit was performed on the source archived at legacy/v1/ , not on README claims. Every number and quotation below comes from that tree. Method - Read the lexer, parser, generator, type checker, module loader, C"},{"title":"Decisions","url":"decisions.html","text":"Architectural Decisions — PlainScript 2.0 This document captures the key design decisions behind the PlainScript 2.0 rebuild. It is intended to explain the \"why\" behind the language changes, not just the \"what\". 1. Breaking release, not inc"}];
/* PlainScript manual — client interactions. No dependencies. */
(function () {
  'use strict';

  /* ---------------- search ---------------- */
  var input = document.querySelector('#doc-search');
  var results = document.querySelector('#search-results');

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function showResults(value) {
    if (!input || !results) return;
    var query = value.trim().toLowerCase();
    if (!query) {
      results.classList.remove('visible');
      results.innerHTML = '';
      return;
    }
    var matches = (window.searchIndex || []).filter(function (item) {
      return (item.title + ' ' + item.text).toLowerCase().indexOf(query) !== -1;
    }).slice(0, 8);
    results.innerHTML = matches.length
      ? matches.map(function (item) {
          return '<a class="search-result" href="' + item.url + '"><strong>' +
            escapeHtml(item.title) + '</strong><span>' + escapeHtml(item.text) + '</span></a>';
        }).join('')
      : '<div class="search-empty">No page matches \u201c' + escapeHtml(value.trim()) + '\u201d.</div>';
    results.classList.add('visible');
  }

  if (input) {
    input.addEventListener('input', function () { showResults(input.value); });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { input.value = ''; showResults(''); input.blur(); }
      if (event.key === 'Enter') {
        var first = results && results.querySelector('.search-result');
        if (first) window.location.href = first.getAttribute('href');
      }
    });
  }
  document.addEventListener('keydown', function (event) {
    if (!input) return;
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if ((event.key === '/' && !typing) || (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      input.focus();
      input.select();
    }
  });
  document.addEventListener('click', function (event) {
    if (results && !event.target.closest('.search-wrap')) results.classList.remove('visible');
  });

  /* ---------------- syntax highlighting ---------------- */
  var KEYWORDS = new Set(('define returns end when otherwise if else while for in is value type record ' +
    'function import from export return match with try catch throw async await class const let var new ' +
    'this true false null and or not of to as field method private public readonly interface enum ' +
    'namespace declare module extends implements static void text number boolean list map any').split(' '));

  function highlight(code, lang) {
    if (!lang || lang === 'text' || lang === 'output' || lang === 'ebnf' || lang === 'grammar') {
      return escapeHtml(code);
    }
    var pattern = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b|([A-Za-z_$][A-Za-z0-9_$]*)/g;
    var out = '';
    var last = 0;
    var match;
    while ((match = pattern.exec(code)) !== null) {
      out += escapeHtml(code.slice(last, match.index));
      var full = match[0];
      var isComment = match[1] !== undefined;
      var isString = match[2] !== undefined;
      var isNumber = match[3] !== undefined;
      var isIdent = match[4] !== undefined;
      if (isComment) {
        out += '<span class="tok-com">' + escapeHtml(full) + '</span>';
      } else if (isString) {
        out += '<span class="tok-str">' + escapeHtml(full) + '</span>';
      } else if (isNumber) {
        out += '<span class="tok-num">' + escapeHtml(full) + '</span>';
      } else if (isIdent) {
        var next = code[match.index + full.length];
        if (KEYWORDS.has(full)) out += '<span class="tok-kw">' + escapeHtml(full) + '</span>';
        else if (next === '(') out += '<span class="tok-fn">' + escapeHtml(full) + '</span>';
        else out += escapeHtml(full);
      }
      last = match.index + full.length;
    }
    out += escapeHtml(code.slice(last));
    return out;
  }

  document.querySelectorAll('pre code').forEach(function (code) {
    var lang = code.getAttribute('data-lang') || '';
    code.innerHTML = highlight(code.textContent, lang);
  });

  /* ---------------- copy buttons ---------------- */
  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      var figure = button.closest('figure');
      var code = figure ? figure.querySelector('code') : null;
      if (!code) return;
      var text = code.textContent;
      var done = function () {
        var original = button.textContent;
        button.textContent = 'copied';
        button.classList.add('copied');
        window.setTimeout(function () {
          button.textContent = original;
          button.classList.remove('copied');
        }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try { document.execCommand('copy'); } catch (error) { /* ignore */ }
        document.body.removeChild(area);
        done();
      }
    });
  });

  /* ---------------- homepage tabs ---------------- */
  document.querySelectorAll('[data-tabs]').forEach(function (root) {
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
    var panels = Array.prototype.slice.call(root.querySelectorAll('[data-panel]'));
    function select(name) {
      tabs.forEach(function (tab) {
        var on = tab.getAttribute('data-tab') === name;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.setAttribute('tabindex', on ? '0' : '-1');
      });
      panels.forEach(function (panel) {
        panel.hidden = panel.getAttribute('data-panel') !== name;
      });
    }
    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () { select(tab.getAttribute('data-tab')); });
      tab.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        var delta = event.key === 'ArrowRight' ? 1 : -1;
        var next = tabs[(index + delta + tabs.length) % tabs.length];
        next.focus();
        select(next.getAttribute('data-tab'));
      });
    });
  });

  /* ---------------- mobile drawer ---------------- */
  var toggle = document.querySelector('[data-nav-toggle]');
  var rail = document.querySelector('#rail');
  var scrim = document.querySelector('[data-scrim]');
  function setNav(open) {
    if (!rail || !toggle) return;
    rail.classList.toggle('is-open', open);
    document.body.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (toggle) toggle.addEventListener('click', function () { setNav(!rail.classList.contains('is-open')); });
  if (scrim) scrim.addEventListener('click', function () { setNav(false); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') setNav(false); });
  if (rail) rail.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () { setNav(false); });
  });

  /* ---------------- reading progress ---------------- */
  var progress = document.querySelector('.progress span');
  function paintProgress() {
    if (!progress) return;
    var doc = document.documentElement;
    var max = doc.scrollHeight - doc.clientHeight;
    var ratio = max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0;
    progress.style.width = (ratio * 100).toFixed(2) + '%';
  }
  window.addEventListener('scroll', paintProgress, { passive: true });
  window.addEventListener('resize', paintProgress);
  paintProgress();

  /* ---------------- active toc ---------------- */
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var byId = {};
    tocLinks.forEach(function (link) { byId[link.getAttribute('href').slice(1)] = link; });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        tocLinks.forEach(function (link) { link.classList.remove('is-active'); });
        var active = byId[entry.target.id];
        if (active) active.classList.add('is-active');
      });
    }, { rootMargin: '-84px 0px -72% 0px', threshold: 0 });
    document.querySelectorAll('.prose h2[id], .prose h3[id]').forEach(function (heading) {
      observer.observe(heading);
    });
  }
})();
