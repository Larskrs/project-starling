/**
 * The docs site's stylesheet and client behaviour.
 *
 * Split out of docs.ts so the rendering logic stays readable — that file is
 * about turning files into pages, this one is about how a page looks.
 *
 * Tokens are inlined rather than imported from @starling/ui: the API serves
 * these pages and has no build step that could resolve a CSS package, and
 * documentation that broke because the design system moved a file would be a
 * silly way to lose it. The values mirror packages/ui/src/theme.css.
 */

export const DOCS_CSS = String.raw`
/* ── Tokens ──────────────────────────────────────────────────────────────── */
:root {
  --bg:        oklch(0.99 0.002 245);
  --surface:   oklch(0.97 0.004 245);
  --raised:    oklch(1    0     0);
  --fg:        oklch(0.22 0.020 245);
  --fg-strong: oklch(0.13 0.025 245);
  --muted:     oklch(0.52 0.018 245);
  --faint:     oklch(0.66 0.014 245);
  --border:    oklch(0.90 0.010 245);
  --hairline:  oklch(0.93 0.008 245);
  --accent:    oklch(0.52 0.19  255);
  --accent-bg: oklch(0.95 0.03  255);
  --shadow:    0 1px 2px oklch(0.2 0.02 245 / .05), 0 2px 8px oklch(0.2 0.02 245 / .04);

  --mono: ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;

  /* Reading measure. Prose is capped; tables and code opt out — see .wide. */
  --measure: 74ch;
  --sidebar: 288px;
}

:root[data-theme="dark"], :root:not([data-theme="light"]) {
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { color-scheme: dark; }
}

/* One dark palette, reachable by system preference or the toggle. */
:root[data-theme="dark"],
:root:not([data-theme="light"]) {
  --dark-bg:        oklch(0.17 0.022 250);
  --dark-surface:   oklch(0.21 0.021 250);
  --dark-raised:    oklch(0.24 0.022 250);
  --dark-fg:        oklch(0.90 0.012 245);
  --dark-fg-strong: oklch(0.97 0.008 245);
  --dark-muted:     oklch(0.66 0.016 245);
  --dark-faint:     oklch(0.52 0.016 245);
  --dark-border:    oklch(0.30 0.020 250);
  --dark-hairline:  oklch(0.26 0.018 250);
  --dark-accent:    oklch(0.72 0.15  255);
  --dark-accent-bg: oklch(0.28 0.05  255);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: var(--dark-bg); --surface: var(--dark-surface); --raised: var(--dark-raised);
    --fg: var(--dark-fg); --fg-strong: var(--dark-fg-strong);
    --muted: var(--dark-muted); --faint: var(--dark-faint);
    --border: var(--dark-border); --hairline: var(--dark-hairline);
    --accent: var(--dark-accent); --accent-bg: var(--dark-accent-bg);
    --shadow: 0 1px 2px oklch(0 0 0 / .3), 0 2px 8px oklch(0 0 0 / .2);
  }
}
:root[data-theme="dark"] {
  --bg: var(--dark-bg); --surface: var(--dark-surface); --raised: var(--dark-raised);
  --fg: var(--dark-fg); --fg-strong: var(--dark-fg-strong);
  --muted: var(--dark-muted); --faint: var(--dark-faint);
  --border: var(--dark-border); --hairline: var(--dark-hairline);
  --accent: var(--dark-accent); --accent-bg: var(--dark-accent-bg);
  --shadow: 0 1px 2px oklch(0 0 0 / .3), 0 2px 8px oklch(0 0 0 / .2);
}

* { box-sizing: border-box; min-width: 0; }

html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--sans);
  font-size: 15.5px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* ── Layout ──────────────────────────────────────────────────────────────── */
.layout { display: grid; grid-template-columns: var(--sidebar) minmax(0, 1fr); }

.side {
  position: sticky; top: 0; height: 100dvh;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--hairline);
  background: var(--surface);
}
.side__head {
  display: flex; align-items: center; gap: 10px;
  padding: 18px 20px 14px;
}
.side__mark {
  width: 26px; height: 26px; border-radius: 7px; flex: none;
  background: linear-gradient(140deg, var(--accent), oklch(0.6 0.19 290));
}
.side__title { font-weight: 640; color: var(--fg-strong); letter-spacing: -.01em; font-size: 14.5px; }
.side__theme {
  margin-left: auto; width: 28px; height: 28px; flex: none;
  display: grid; place-items: center;
  border: 1px solid var(--border); border-radius: 8px;
  background: var(--raised); color: var(--muted); cursor: pointer; font-size: 13px;
}
.side__theme:hover { color: var(--fg-strong); }
.side__theme:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.side__search { padding: 0 16px 12px; }
.side__search input {
  width: 100%; height: 32px; padding: 0 10px;
  font: inherit; font-size: 13.5px;
  color: var(--fg); background: var(--raised);
  border: 1px solid var(--border); border-radius: 8px;
}
.side__search input::placeholder { color: var(--faint); }
.side__search input:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }

.side__nav { flex: 1; overflow-y: auto; padding: 0 12px 24px; scrollbar-width: thin; }
.side__group {
  font-size: 10.5px; font-weight: 650; letter-spacing: .09em; text-transform: uppercase;
  color: var(--faint); padding: 16px 8px 6px;
}
.side a {
  display: block; padding: 6px 10px; border-radius: 7px;
  color: var(--muted); text-decoration: none; font-size: 14px;
}
.side a:hover { background: var(--raised); color: var(--fg-strong); }
.side a[aria-current="page"] { background: var(--accent-bg); color: var(--accent); font-weight: 600; }
.side a:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

/* A page's own sections, nested under the active page. */
.side__toc { margin: 2px 0 6px; padding-left: 10px; border-left: 1px solid var(--border); }
.side__toc a { font-size: 13px; padding: 4px 10px; color: var(--faint); }
.side__toc a.is-active { color: var(--accent); background: none; font-weight: 600; }

/* ── Content ─────────────────────────────────────────────────────────────── */
main { padding: 56px 56px 160px; }
.prose { max-width: var(--measure); }

/*
 * Tables and code break the measure.
 *
 * API.md has 129 table rows, some 750 characters wide — forcing them into a
 * 74ch column would make the site unusable for the thing it is most used for.
 * Prose stays narrow for reading; dense reference material gets the room.
 */
.prose > .wide { max-width: min(1180px, calc(100vw - var(--sidebar) - 112px)); }

.prose > * { margin: 0 0 18px; }
.prose > :last-child { margin-bottom: 0; }

h1 {
  font-size: 34px; line-height: 1.15; letter-spacing: -.022em;
  font-weight: 680; color: var(--fg-strong); margin: 0 0 10px;
}
.lede { color: var(--muted); font-size: 17px; margin-bottom: 40px !important; }

h2 {
  font-size: 22px; line-height: 1.25; letter-spacing: -.016em;
  font-weight: 650; color: var(--fg-strong);
  margin: 56px 0 14px; scroll-margin-top: 24px;
}
h3 {
  font-size: 16.5px; letter-spacing: -.008em; font-weight: 650;
  color: var(--fg-strong); margin: 32px 0 8px; scroll-margin-top: 24px;
}
h4 { font-size: 14px; font-weight: 650; color: var(--muted); margin: 24px 0 6px;
     text-transform: uppercase; letter-spacing: .05em; }

/* The anchor sits outside the text rather than shifting it — a float with a
   negative margin collapses the moment the heading wraps. */
.hanchor {
  position: absolute; left: -1.1em; width: 1.1em;
  color: var(--faint); text-decoration: none; opacity: 0;
  font-weight: 400;
}
h2, h3 { position: relative; }
h2:hover .hanchor, h3:hover .hanchor, .hanchor:focus-visible { opacity: 1; }

p { margin: 0 0 18px; }
strong { font-weight: 640; color: var(--fg-strong); }

a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }
a:hover { text-decoration-thickness: 2px; }

ul, ol { margin: 0 0 18px; padding-left: 22px; }
li { margin: 5px 0; }
li::marker { color: var(--faint); }

hr { border: 0; border-top: 1px solid var(--hairline); margin: 44px 0; }

blockquote {
  margin: 22px 0; padding: 14px 18px;
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-left: 3px solid var(--accent);
  border-radius: 0 10px 10px 0;
  color: var(--fg);
}
blockquote > :last-child { margin-bottom: 0; }

/* ── Inline code ─────────────────────────────────────────────────────────── */
code {
  font-family: var(--mono); font-size: .875em;
  background: var(--surface); border: 1px solid var(--hairline);
  padding: .1em .38em; border-radius: 5px;
  color: var(--fg-strong); word-break: break-word;
}
a code { color: inherit; border-color: transparent; background: var(--accent-bg); }
h1 code, h2 code, h3 code { font-size: .9em; }

/* ── Code blocks ─────────────────────────────────────────────────────────── */
.codeblock {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: 12px;
  overflow: hidden;
}
.codeblock__bar {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px 7px 14px;
  border-bottom: 1px solid var(--hairline);
  background: var(--raised);
}
.codeblock__lang {
  font: 600 10.5px/1 var(--mono); letter-spacing: .07em; text-transform: uppercase;
  color: var(--faint);
}
.codeblock__copy {
  margin-left: auto; border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface); color: var(--muted);
  font: 500 11.5px/1 var(--sans); padding: 4px 9px; cursor: pointer;
}
.codeblock__copy:hover { color: var(--fg-strong); }
.codeblock__copy:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.codeblock__copy[data-done="1"] { color: var(--accent); border-color: var(--accent); }

.codeblock pre { margin: 0; padding: 14px 16px; overflow-x: auto; }
pre code {
  background: none; border: 0; padding: 0; font-size: 13px; line-height: 1.65;
  color: var(--fg); white-space: pre;
}

/* Highlighting — one hue family, weights doing the work, so code reads as code
   rather than as a fruit salad. */
.hljs-keyword, .hljs-literal, .hljs-type   { color: oklch(0.52 0.17 300); }
.hljs-string, .hljs-regexp                 { color: oklch(0.50 0.14 150); }
.hljs-number                               { color: oklch(0.55 0.15 60);  }
.hljs-comment, .hljs-quote                 { color: var(--faint); font-style: italic; }
.hljs-title, .hljs-title.function_        { color: oklch(0.50 0.16 255); }
.hljs-title.class_, .hljs-title.inherited__ { color: oklch(0.52 0.17 300); }
.hljs-attr, .hljs-property, .hljs-attribute{ color: oklch(0.50 0.10 220); }
.hljs-built_in, .hljs-variable.language_  { color: oklch(0.55 0.13 200); }
.hljs-meta, .hljs-symbol                   { color: var(--muted); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .hljs-keyword,
  :root:not([data-theme="light"]) .hljs-literal,
  :root:not([data-theme="light"]) .hljs-type    { color: oklch(0.78 0.13 300); }
  :root:not([data-theme="light"]) .hljs-string,
  :root:not([data-theme="light"]) .hljs-regexp  { color: oklch(0.80 0.13 150); }
  :root:not([data-theme="light"]) .hljs-number  { color: oklch(0.82 0.12 70);  }
  :root:not([data-theme="light"]) .hljs-title,
  :root:not([data-theme="light"]) .hljs-title.function_ { color: oklch(0.78 0.12 255); }
  :root:not([data-theme="light"]) .hljs-attr,
  :root:not([data-theme="light"]) .hljs-property,
  :root:not([data-theme="light"]) .hljs-attribute { color: oklch(0.80 0.08 220); }
  :root:not([data-theme="light"]) .hljs-built_in,
  :root:not([data-theme="light"]) .hljs-variable.language_ { color: oklch(0.80 0.10 200); }
}
:root[data-theme="dark"] .hljs-keyword,
:root[data-theme="dark"] .hljs-literal,
:root[data-theme="dark"] .hljs-type    { color: oklch(0.78 0.13 300); }
:root[data-theme="dark"] .hljs-string,
:root[data-theme="dark"] .hljs-regexp  { color: oklch(0.80 0.13 150); }
:root[data-theme="dark"] .hljs-number  { color: oklch(0.82 0.12 70);  }
:root[data-theme="dark"] .hljs-title,
:root[data-theme="dark"] .hljs-title.function_ { color: oklch(0.78 0.12 255); }
:root[data-theme="dark"] .hljs-attr,
:root[data-theme="dark"] .hljs-property,
:root[data-theme="dark"] .hljs-attribute { color: oklch(0.80 0.08 220); }
:root[data-theme="dark"] .hljs-built_in,
:root[data-theme="dark"] .hljs-variable.language_ { color: oklch(0.80 0.10 200); }

/* ── Tables ──────────────────────────────────────────────────────────────── */
/*
 * The dominant element in this documentation, so it gets the most care.
 *
 * Row separators only — no vertical rules. A grid of boxes ("prison bars")
 * fights the eye on a 129-row reference table; horizontal hairlines let it scan
 * downward, which is how these are actually read. The wrapper scrolls, not the
 * table, so the table keeps normal table layout instead of 'display: block'.
 */
.tablewrap {
  overflow-x: auto;
  border: 1px solid var(--hairline);
  border-radius: 12px;
  background: var(--raised);
  scrollbar-width: thin;
}
table { border-collapse: collapse; width: 100%; font-size: 13.5px; line-height: 1.55; }
thead th {
  position: sticky; top: 0; z-index: 1;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  text-align: left; font-weight: 640; color: var(--fg-strong);
  padding: 9px 14px; white-space: nowrap;
}
tbody td { border-top: 1px solid var(--hairline); padding: 9px 14px; vertical-align: top; }
tbody tr:first-child td { border-top: 0; }
tbody tr:hover { background: var(--surface); }
td code { font-size: 12.5px; white-space: nowrap; }
/* Long prose cells are the norm here — let them breathe rather than forcing a
   single line that pushes the table three screens wide. */
td:last-child { min-width: 22ch; }

/* ── Index page ──────────────────────────────────────────────────────────── */
.cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); list-style: none; padding: 0; }
.card {
  display: block; padding: 16px 18px; text-decoration: none;
  background: var(--raised); border: 1px solid var(--hairline);
  border-radius: 12px; box-shadow: var(--shadow);
}
.card:hover { border-color: var(--accent); }
.card__title { font-weight: 640; color: var(--fg-strong); margin-bottom: 3px; }
.card__slug { font: 12px var(--mono); color: var(--faint); }

/* ── Small screens ───────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .side { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--hairline); }
  .side__nav { max-height: 40vh; }
  main { padding: 28px 20px 80px; }
  .prose > .wide { max-width: 100%; }
  h1 { font-size: 27px; }
  h2 { font-size: 20px; margin-top: 40px; }
}
`;

/**
 * Client behaviour. Small and dependency-free on purpose — a docs page should
 * not ship a framework to do three things.
 *
 * Everything degrades: with JS off you still get a fully rendered, navigable,
 * readable page. These only add convenience.
 */
export const DOCS_JS = String.raw`
(function () {
  // ── Theme toggle ──────────────────────────────────────────────────────────
  // Defaults to the OS preference and only pins an explicit choice once made,
  // so someone who never touches it keeps following their system.
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem('docs-theme');
    if (saved) root.setAttribute('data-theme', saved);
  } catch (e) { /* private mode: fall back to the system preference */ }

  var toggle = document.querySelector('.side__theme');
  if (toggle) toggle.addEventListener('click', function () {
    var dark = root.getAttribute('data-theme') === 'dark'
      || (!root.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    var next = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('docs-theme', next); } catch (e) {}
  });

  // ── Copy buttons ──────────────────────────────────────────────────────────
  document.querySelectorAll('.codeblock__copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var code = btn.closest('.codeblock').querySelector('code');
      navigator.clipboard.writeText(code.innerText).then(function () {
        btn.textContent = 'Copied';
        btn.dataset.done = '1';
        setTimeout(function () { btn.textContent = 'Copy'; delete btn.dataset.done; }, 1400);
      });
    });
  });

  // ── Sidebar filter ────────────────────────────────────────────────────────
  var search = document.querySelector('.side__search input');
  if (search) search.addEventListener('input', function () {
    var q = search.value.trim().toLowerCase();
    document.querySelectorAll('.side__nav a').forEach(function (a) {
      a.hidden = q !== '' && a.textContent.toLowerCase().indexOf(q) === -1;
    });
    document.querySelectorAll('.side__group').forEach(function (g) { g.hidden = q !== ''; });
  });

  // ── Scroll spy ────────────────────────────────────────────────────────────
  // Marks the section you are actually reading. rootMargin pins the trigger
  // near the top of the viewport, so the highlight changes as a heading reaches
  // the top rather than when it first peeks into view at the bottom.
  var links = {};
  document.querySelectorAll('.side__toc a').forEach(function (a) {
    links[a.getAttribute('href').slice(1)] = a;
  });
  var headings = document.querySelectorAll('main h2[id]');
  if (headings.length && 'IntersectionObserver' in window) {
    var visible = new Set();
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) visible.add(e.target.id); else visible.delete(e.target.id);
      });
      var first = null;
      headings.forEach(function (h) { if (!first && visible.has(h.id)) first = h.id; });
      Object.keys(links).forEach(function (id) {
        links[id].classList.toggle('is-active', id === first);
      });
    }, { rootMargin: '-8% 0px -80% 0px' });
    headings.forEach(function (h) { spy.observe(h); });
  }
})();
`;
