// Post-process the generated JSDoc site:
//  1. copy custom.css into docs/
//  2. strip the legacy IE-only html5shiv <script> (keeps the site offline)
//  3. drop the ESM "exports." longname prefix (ids, hrefs, display text)
//  4. build docs/readme.html — a themed, navigable render of README.md, so the
//     "README" nav link opens a real HTML page over file:// (a raw .md would
//     just download). Idempotent: regenerated from index.html every run.
import { readFileSync, writeFileSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { marked } from 'marked';

copyFileSync('custom.css', 'docs/custom.css');

for (const f of readdirSync('docs')) {
  if (!f.endsWith('.html')) continue;
  const p = `docs/${f}`;
  let html = readFileSync(p, 'utf8');
  html = html.replace(/^.*html5shiv\.googlecode\.com.*$/gm, '');
  html = html.replace(/\.exports\./g, '.');
  html = html.replace(/>exports\./g, '>');
  // Remove docdash's mobile hamburger machinery (checkbox + two <label>s). The
  // full-screen `.overlay` is a <label> that toggles the checkbox on click; the
  // navicon button is another. Stripping them removes every possible click-stealer
  // / overlay over the nav links, leaving a plain always-clickable sidebar.
  html = html.replace(/<input[^>]*id="nav-trigger"[^>]*>\s*/g, '');
  html = html.replace(/<label[^>]*for="nav-trigger"[^>]*class="navicon-button[^"]*"[^>]*>[\s\S]*?<\/label>\s*/g, '');
  html = html.replace(/<label[^>]*for="nav-trigger"[^>]*class="overlay"[^>]*>\s*<\/label>\s*/g, '');
  // normalise the three top nav links to explicit ./ relative form (file:// safe)
  html = html.replace('<a href="index.html">Home</a>', '<a href="./index.html">Home</a>');
  html = html.replace('href="readme.html" class="menu-item"', 'href="./readme.html" class="menu-item"');
  // (Play the game already uses ../web-app/index.html — a correct relative path)
  writeFileSync(p, html);
}

// --- build docs/readme.html from README.md, reusing index.html's shell ---
if (existsSync('docs/index.html') && existsSync('README.md')) {
  const tpl = readFileSync('docs/index.html', 'utf8');
  const body = marked.parse(readFileSync('README.md', 'utf8'));
  const open = '<div id="main">';
  const i = tpl.indexOf(open);
  const j = tpl.indexOf('<footer', i);
  if (i !== -1 && j !== -1) {
    const out = (
      tpl.slice(0, i + open.length) +
      `\n<h1 class="page-title">README</h1>\n<section><article class="readme">${body}</article></section>\n</div>\n` +
      tpl.slice(j)
    ).replace(/<title>[\s\S]*?<\/title>/, '<title>README &#8212; Chaos Gomoku 3D</title>');
    writeFileSync('docs/readme.html', out);
    console.log('postdocs: readme.html built (' + body.length + ' chars rendered)');
  } else {
    console.warn('postdocs: could not locate #main/footer; readme.html not built');
  }
}
console.log('postdocs: css copied · html5shiv removed · exports. cleaned · readme.html ready');
