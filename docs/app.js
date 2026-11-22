window.searchIndex = [{"title":"PlainScript","url":"index.html","text":"PlainScript 2.3 PlainScript is an independent, statically typed programming language for the JavaScript platform. It reads like structured English, checks every program before it runs, and compiles to ordinary ES modules that use the JavaSc"},{"title":"Getting started","url":"getting-started.html","text":"Getting started with PlainScript 2.1 PlainScript is a statically typed language that compiles to JavaScript. You write a .pln file, the compiler checks it, and you run the emitted ES module with Node, Vite, Next.js or any other JavaScript t"},{"title":"Language reference","url":"language-reference.html","text":"PlainScript 2.2 language reference This is the practical reference for the 2.1 dialect. The normative semantics are in the specification SPEC.md ; this page shows the surface, names the 2.0 equivalent, and states the rules the compiler enfo"},{"title":"Regular expressions","url":"regex.html","text":"Regular expressions Regular expressions are values in PlainScript. A literal is parsed by the lexer, assigned the primitive type regex , and compiled to a native JavaScript RegExp . The pattern engine is therefore the host's engine: V8 in N"},{"title":"JSX and React","url":"jsx.html","text":"JSX and React PlainScript parses JSX as native syntax. A .pln file can contain React components directly: there is no separate .jsx layer, no Babel step and no runtime wrapper. The compiler parses elements and fragments, type-checks props w"},{"title":"Compiler","url":"compiler.html","text":"The PlainScript compiler The compiler turns a .pln module graph into JavaScript ES modules. It has six stages, each with its own diagnostics and tests: 1. Dialect resolution Dialect detection happens before lexing. src/dialect.js reads the "},{"title":"Integrations","url":"integrations.html","text":"Integrations PlainScript emits ordinary ES modules. Any JavaScript framework that accepts a module works without a plugin, a runtime shim or a custom bundler. This page covers the eight integrations in integrations/ ../integrations . Each e"},{"title":"Migrating from 2.0","url":"migration-2-1.html","text":"Migrating from PlainScript 2.0 to 2.1 2.1 is additive. Every 2.0 file compiles unchanged, and a project can move one file at a time. Nothing in this guide is required to keep shipping on 2.0. The migration has two steps: add the pragma, the"},{"title":"Migrating to 2.2","url":"migration-2-2.html","text":"Migrating to PlainScript 2.2 PlainScript 2.2 adds a migration tool that analyses an existing project and produces a phased plan, safe conversions, interoperability boundaries and a machine-readable report. It is designed for incremental ado"},{"title":"Migrating to 2.3","url":"migration-2-3.html","text":"Migrating to PlainScript 2.3 2.3 is additive. Programs that compiled under 2.0, 2.1 or 2.2 compile under 2.3 without source changes. The one exception is a deliberate tightening: a throws clause now checks the thrown class nominally, so a f"},{"title":"CLI reference","url":"cli.html","text":"Command line Exit codes: 0 success, 1 compile or test failure, 2 usage error. Diagnostics go to stderr; program output and ir / version output go to stdout. Syntax dialects A .pln file selects its surface dialect on the first line: syntax 2"},{"title":"Application templates","url":"templates.html","text":"Application templates PlainScript ships eight starters. They are real program slices, not static landing pages: each has PlainScript source, package metadata and documentation. The three application templates include persistent storage; the"},{"title":"Language specification","url":"spec.html","text":"The PlainScript 2.3 Language Specification This document defines the language implemented by the compiler in src/ . When this document and the compiler disagree, the compiler is authoritative and the document is a bug. PlainScript is static"},{"title":"Syntax design","url":"syntax-design.html","text":"PlainScript syntax design Design goal PlainScript should be recognizable to developers who already write JavaScript or TypeScript, without becoming a TypeScript clone. Familiar syntax should be chosen where it clarifies common code; distinc"},{"title":"Compiler architecture","url":"architecture.html","text":"Compiler architecture PlainScript 2.3 is a single-pass-per-stage compiler with an explicit typed IR between checking and emission. There are no runtime dependencies, and the emitted code has no PlainScript runtime. src/modules.js owns the m"},{"title":"JavaScript interop","url":"interop.html","text":"JavaScript interoperability PlainScript emits ES modules. There is no runtime library, no wrapper around React, and no custom module format, so interoperability is a question of what the emitted JavaScript can import — which is everything N"},{"title":"Cross-language bridges","url":"cross-language.html","text":"Cross-language interoperability PlainScript runs on JavaScript, so JavaScript and TypeScript are the native interoperability story: import an npm package, a Node builtin, a browser API or a local .js module and the emitted ESM uses it direc"},{"title":"Type system","url":"type-system.html","text":"Type system PlainScript uses structural types. Types are erased from emitted JavaScript; the checker is the enforcer, and untyped JavaScript boundaries remain any deliberately. Implemented and tested - Primitives, records, optional and read"},{"title":"Standard library","url":"stdlib.html","text":"Standard library Every module is imported by name and resolved by the compiler: The .d.pln declaration next to each module is the source of truth for types; the .js file is the runtime. Browser builds can rewrite std/ imports with --std-bas"},{"title":"Unified contracts","url":"contracts.html","text":"Unified full-stack contracts Status: implemented through schemas, typed operations, typed errors, dispatch, SQLite models/migrations, PostgreSQL/MySQL adapter surfaces and a real authentication flow. The verified application is demos/contra"},{"title":"Concurrency","url":"concurrency.html","text":"Concurrency and asynchronous programming PlainScript keeps JavaScript's event loop and promise semantics. std/task adds a structured layer on top of that runtime; it does not introduce a second scheduler. Semantics - Task group ownership. g"},{"title":"Background jobs","url":"jobs.html","text":"Background jobs std/jobs is a scheduler for server work that should not block a request: sending email, resizing an upload, warming a cache, or retrying a flaky integration. Its scheduler is in-process; an optional store adapter persists jo"},{"title":"Databases","url":"databases.html","text":"Databases PlainScript has no database runtime of its own. Application code imports an ordinary npm driver, passes values as bound parameters, and keeps contract validation at the boundary. The bundled SQLite, PostgreSQL and MySQL adapters p"},{"title":"Security","url":"security.html","text":"Security and production readiness PlainScript's security-sensitive standard library is intentionally small. This page states what is verified, what defaults are safe, and what remains application responsibility. Passwords std/auth.hashPassw"},{"title":"Debugging","url":"debugging.html","text":"Debugging PlainScript emits ordinary JavaScript with source maps. Debugging therefore uses the JavaScript ecosystem's tools rather than a custom runtime. Compile, then inspect Open chrome://inspect or your editor's Node debugger , attach to"},{"title":"Migration guide","url":"migration.html","text":"Migration from PlainScript v1 to v2 PlainScript 2.0 is a ground-up rebuild. This guide documents the changes from v1 to v2 and what you need to update in your v1 code to make it work with v2. Conditional syntax update after the 2.0.0 snapsh"},{"title":"Comparison with TypeScript","url":"comparison.html","text":"Comparison with TypeScript stacks This is an engineering comparison, not a marketing claim. PlainScript is younger and has a much smaller ecosystem. The useful question is narrower: for a schema-first full-stack application, how much duplic"},{"title":"Benchmarks","url":"benchmarks.html","text":"Compiler benchmarks The benchmark is synthetic and PlainScript-only. It exists to detect regressions and to make the build path measurable without a network install. It does not support a claim that PlainScript is faster than TypeScript. Re"},{"title":"Engineering progress","url":"progress.html","text":"PlainScript engineering status This file records the current verified state. Earlier per-defect logs are preserved in git history and in docs/AUDIT.md ; stale status claims are not kept here. Verified baseline Run npm test from the reposito"},{"title":"Roadmap","url":"roadmap.html","text":"Roadmap This roadmap reports status; it is not a promise of dates. Available in 2.3 - Classes, inheritance, super , this , generics, static and readonly members, decorators and nominal is checks. - Generators, Iterator of T and the lazy hel"},{"title":"Audit","url":"audit.html","text":"Audit of PlainScript 1.x For the 2.2 capability audit, including JSX, regex, interoperability, migration and the remaining gaps, see Capability audit 2.2 CAPABILITY AUDIT 2 2.md . This audit was performed on the source archived at legacy/v1"},{"title":"Capability audit 2.2","url":"capability-audit-2-2.html","text":"PlainScript 2.2 capability audit This audit records what was inspected for 2.2, what changed, and what remains absent. It covers the language surface, compiler, runtime, standard library, tooling, interoperability, migration and production "},{"title":"Capability audit 2.3","url":"capability-audit-2-3.html","text":"Capability audit 2.3 This audit answers the 2.2 adoption review item by item. Every \"verified\" row names the check that exercises it in this repository; a row that cannot be verified here says so instead of claiming success. Language surfac"},{"title":"Decisions","url":"decisions.html","text":"Architectural Decisions — PlainScript 2.0 This document captures the key design decisions behind the PlainScript 2.0 rebuild. It is intended to explain the \"why\" behind the language changes, not just the \"what\". 1. Breaking release, not inc"}];
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

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- real 3D stage ---------------- */
  (function stages() {
    var canvases = document.querySelectorAll('canvas[data-stage]');
    if (!canvases.length) return;
    var phi = (1 + Math.sqrt(5)) / 2;
    var raw = [[-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0], [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi], [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1]];
    var verts = raw.map(function (v) {
      var len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      return [v[0] / len, v[1] / len, v[2] / len];
    });
    var faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];

    Array.prototype.forEach.call(canvases, function (canvas) {
      var ctx = canvas.getContext('2d');
      if (!ctx) return;
      var width = 0;
      var height = 0;
      var running = false;
      var frame = 0;
      var spin = { x: 0, y: 0, tx: 0, ty: 0, drag: false, px: 0, py: 0 };
      var start = performance.now();

      function project(v, yaw, pitch, scale, cx, cy) {
        var cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
        var cpit = Math.cos(pitch), spit = Math.sin(pitch);
        var x1 = v[0] * cyaw - v[2] * syaw;
        var z1 = v[0] * syaw + v[2] * cyaw;
        var y1 = v[1] * cpit - z1 * spit;
        var z2 = v[1] * spit + z1 * cpit;
        var persp = 2.9 / (2.9 - z2);
        return { x: cx + x1 * scale * persp, y: cy + y1 * scale * persp, rx: x1, ry: y1, rz: z2, s: persp };
      }

      function draw(time) {
        var size = Math.min(width, height);
        var cx = width / 2;
        var cy = height / 2;
        var scale = size * 0.31;
        var scrollTilt = (window.scrollY || 0) * 0.0004;
        var yaw = time * 0.34 + spin.x * 1.4 + 0.4;
        var pitch = -0.32 + Math.sin(time * 0.28) * 0.1 + spin.y * 0.9 + scrollTilt;
        ctx.clearRect(0, 0, width, height);

        ctx.beginPath();
        for (var i = 0; i <= 96; i++) {
          var a = (i / 96) * Math.PI * 2;
          var ringPoint = project([Math.cos(a) * 1.62, Math.sin(a * 2) * 0.06, Math.sin(a) * 1.62], yaw, pitch + 0.42, scale, cx, cy);
          if (i === 0) ctx.moveTo(ringPoint.x, ringPoint.y);
          else ctx.lineTo(ringPoint.x, ringPoint.y);
        }
        ctx.strokeStyle = 'rgba(166,121,255,.28)';
        ctx.lineWidth = 1;
        ctx.stroke();

        var rotated = verts.map(function (v) { return project(v, yaw, pitch, scale, cx, cy); });
        var lx = -0.42, ly = -0.5, lz = -0.76;
        var ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
        lx /= ll; ly /= ll; lz /= ll;

        faces.map(function (face, index) {
          var a = rotated[face[0]], b = rotated[face[1]], c = rotated[face[2]];
          return { face: face, z: (a.rz + b.rz + c.rz) / 3, index: index };
        }).sort(function (m, n) { return m.z - n.z; }).forEach(function (item) {
          var a = rotated[item.face[0]], b = rotated[item.face[1]], c = rotated[item.face[2]];
          var nx = (b.ry - a.ry) * (c.rz - a.rz) - (b.rz - a.rz) * (c.ry - a.ry);
          var ny = (b.rz - a.rz) * (c.rx - a.rx) - (b.rx - a.rx) * (c.rz - a.rz);
          var nz = (b.rx - a.rx) * (c.ry - a.ry) - (b.ry - a.ry) * (c.rx - a.rx);
          var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
          var glow = Math.pow(Math.abs(nx * lx + ny * ly + nz * lz), 1.6);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(c.x, c.y);
          ctx.closePath();
          ctx.fillStyle = 'rgba(' + Math.round(109 + 57 * glow) + ',' + Math.round(60 + 46 * glow) + ',' + Math.round(224 - 26 * glow) + ',' + (0.10 + glow * 0.34).toFixed(3) + ')';
          ctx.fill();
          ctx.strokeStyle = 'rgba(242,238,231,' + (0.10 + glow * 0.4).toFixed(3) + ')';
          ctx.lineWidth = 0.9;
          ctx.stroke();
        });

        for (var k = 0; k < 3; k++) {
          var ang = time * (0.5 + k * 0.17) + k * 2.1;
          var sat = project([Math.cos(ang) * 1.62, Math.sin(ang * 1.7 + k) * 0.55, Math.sin(ang) * 1.62], yaw, pitch + 0.42, scale, cx, cy);
          ctx.beginPath();
          ctx.arc(sat.x, sat.y, Math.max(0.8, 2.2 * sat.s), 0, Math.PI * 2);
          ctx.fillStyle = k === 1 ? 'rgba(255,106,61,.95)' : 'rgba(201,170,255,.95)';
          ctx.shadowColor = k === 1 ? 'rgba(255,106,61,.9)' : 'rgba(166,121,255,.9)';
          ctx.shadowBlur = 14;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      function resize() {
        var rect = canvas.getBoundingClientRect();
        var dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), 2.5);
        width = Math.max(1, rect.width);
        height = Math.max(1, rect.height);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw((performance.now() - start) / 1000);
      }

      function loop(now) {
        if (!running) return;
        var time = (now - start) / 1000;
        spin.x += (spin.tx - spin.x) * 0.07;
        spin.y += (spin.ty - spin.y) * 0.07;
        draw(time);
        frame = window.requestAnimationFrame(loop);
      }

      function play() {
        if (reduceMotion) { draw((performance.now() - start) / 1000); return; }
        if (running) return;
        running = true;
        frame = window.requestAnimationFrame(loop);
      }
      function pause() { running = false; window.cancelAnimationFrame(frame); }

      canvas.style.cursor = 'grab';
      canvas.addEventListener('pointerdown', function (event) {
        spin.drag = true;
        spin.px = event.clientX;
        spin.py = event.clientY;
        canvas.style.cursor = 'grabbing';
        if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
      });
      canvas.addEventListener('pointermove', function (event) {
        if (spin.drag) {
          spin.tx += (event.clientX - spin.px) * 0.006;
          spin.ty += (event.clientY - spin.py) * 0.004;
          spin.px = event.clientX;
          spin.py = event.clientY;
        } else {
          var box = canvas.getBoundingClientRect();
          spin.tx = ((event.clientX - box.left) / box.width - 0.5) * 0.5;
          spin.ty = ((event.clientY - box.top) / box.height - 0.5) * 0.35;
        }
      });
      function release() {
        spin.drag = false;
        spin.tx = 0;
        spin.ty = 0;
        canvas.style.cursor = 'grab';
      }
      canvas.addEventListener('pointerup', release);
      canvas.addEventListener('pointercancel', release);
      canvas.addEventListener('pointerleave', function () {
        if (!spin.drag) { spin.tx = 0; spin.ty = 0; }
      });

      if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
      else window.addEventListener('resize', resize);
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) play();
            else pause();
          });
        }, { threshold: 0.05 }).observe(canvas);
      }
      resize();
      play();
    });
  })();

  /* ---------------- pointer tilt, with real perspective ---------------- */
  (function tilts() {
    if (reduceMotion || !window.matchMedia('(hover: hover)').matches) return;
    var els = document.querySelectorAll('[data-tilt], [data-tilt-soft], .code-tabs');
    Array.prototype.forEach.call(els, function (el) {
      var soft = el.hasAttribute('data-tilt-soft') || el.classList.contains('code-tabs');
      var code = el.classList.contains('code-tabs');
      var pending = false;
      var nx = 0;
      var ny = 0;
      function apply() {
        pending = false;
        if (code) {
          el.style.setProperty('--tx', ny.toFixed(2));
          el.style.setProperty('--ty', nx.toFixed(2));
        } else {
          el.style.setProperty('--rx', (soft ? -ny * 4 : -ny * 7).toFixed(2) + 'deg');
          el.style.setProperty('--ry', (soft ? nx * 5 : nx * 9).toFixed(2) + 'deg');
        }
      }
      el.addEventListener('pointermove', function (event) {
        var box = el.getBoundingClientRect();
        nx = (event.clientX - box.left) / box.width - 0.5;
        ny = (event.clientY - box.top) / box.height - 0.5;
        if (!pending) { pending = true; window.requestAnimationFrame(apply); }
      });
      el.addEventListener('pointerleave', function () {
        el.style.removeProperty('--rx');
        el.style.removeProperty('--ry');
        el.style.removeProperty('--tx');
        el.style.removeProperty('--ty');
      });
    });
  })();

  /* ---------------- scroll reveal (additive only) ---------------- */
  (function reveals() {
    var items = document.querySelectorAll('.reveal');
    if (!items.length || reduceMotion || !('IntersectionObserver' in window)) return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
    Array.prototype.forEach.call(items, function (el) { observer.observe(el); });
  })();
})();
