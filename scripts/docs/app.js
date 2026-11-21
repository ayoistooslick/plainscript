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
