// Build the web (site/) front-end from the SAME sources the desktop app uses (todo A1).
//
// The renderer/ and site/ trees used to be hand-copied forks: app.js had drifted ~20 KB apart
// and bug fixes landed on one side only. This script kills that fork:
//   site/app.js    <- renderer/app.js  (verbatim — the pv bridge is the only environment seam)
//   site/style.css <- renderer/style.css (verbatim)
//   site/index.html <- renderer/index.html with a handful of web-only adaptations applied
//                     (CSP allows OpenRouter, OG/meta/viewport, titlebar links, key wording)
// site/pv.js stays hand-maintained: it IS the environment-specific surface (todo A1: window.pv
// is the only place Electron-vs-web may diverge).
//
// Usage: node scripts/build-web.mjs   (wired as `npm run build:web`, and run by site:deploy)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, content) => fs.writeFileSync(path.join(ROOT, p), content);

let failures = 0;

// ---- site/app.js and site/style.css: straight copies ----
const appJs = read('renderer/app.js');
const styleCss = read('renderer/style.css');

// ---- site/index.html: renderer/index.html + web adaptations ----
let html = read('renderer/index.html');

// 1. CSP: the browser talks to OpenRouter directly (the desktop does that from Node).
// Insert right before the CSP meta's closing quote — the whole directive list is one string.
html = html.replace(/(Content-Security-Policy" content="[^"]*)(">)/, '$1 https://openrouter.ai$2');
if (!/Content-Security-Policy" content="[^"]*connect-src[^"]*openrouter\.ai/.test(html)) {
  console.error('build-web: CSP replacement did not apply');
  failures++;
}

// 2. Viewport + SEO block (OG/Twitter/canonical/favicon/description) after <title>.
const seoBlock = `
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Two AI models volley your prompt back and forth until it's actually good — runs entirely in your browser, bring your own OpenRouter key. Open source: github.com/Chimthuwu/Volley-Prompt">
<link rel="icon" href="icon.svg">
<link rel="canonical" href="https://volley-prompt.pages.dev/">
<meta property="og:type" content="website">
<meta property="og:url" content="https://volley-prompt.pages.dev/">
<meta property="og:title" content="VolleyPrompt — two AIs, one perfect prompt">
<meta property="og:description" content="Two AI models volley your prompt back and forth — Writer drafts, Reviewer rips it apart — until it's actually good. Runs free in your browser or as a Windows desktop app. Open source on GitHub: github.com/Chimthuwu/Volley-Prompt">
<meta property="og:image" content="https://volley-prompt.pages.dev/assets/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="VolleyPrompt — two AIs volley your prompt until it's perfect">
<meta property="og:site_name" content="VolleyPrompt">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="VolleyPrompt — two AIs, one perfect prompt">
<meta name="twitter:description" content="Two AI models volley your prompt back and forth until it's actually good. Free in your browser or as a Windows desktop app. Source: github.com/Chimthuwu/Volley-Prompt">
<meta name="twitter:image" content="https://volley-prompt.pages.dev/assets/og-image.png">`;
html = html.replace(
  /<title>VolleyPrompt<\/title>/,
  '<title>VolleyPrompt — two AIs, one perfect prompt</title>' + seoBlock,
);
if (!html.includes('og:image')) {
  console.error('build-web: SEO block replacement did not apply');
  failures++;
}

// 3. Titlebar: the web keeps the download + GitHub links and hides the window buttons
// (the browser owns minimize/maximize/close).
const webTitlebar = `    <a class="tb-btn" href="https://github.com/Chimthuwu/Volley-Prompt/releases/latest" title="Download the Windows desktop app" aria-label="Download the Windows desktop app" style="display:flex;align-items:center;justify-content:center;text-decoration:none;width:auto;padding:0 10px;font-size:11px;font-weight:700;white-space:nowrap">&#11015; Desktop app</a>
    <a class="tb-btn" href="https://github.com/Chimthuwu/Volley-Prompt" target="_blank" rel="noopener" title="View on GitHub" aria-label="View on GitHub" style="display:flex;align-items:center;justify-content:center;text-decoration:none">&#9733;</a>
    <button class="tb-btn" id="tbMin" title="Minimize" style="display:none">&#9473;</button>
    <button class="tb-btn" id="tbMax" title="Maximize" style="display:none">&#9633;</button>
    <button class="tb-btn tb-close" id="tbClose" title="Close" style="display:none">&#10005;</button>`;
html = html.replace(/    <button class="tb-btn" id="tbMin"[^]*?<button class="tb-btn tb-close" id="tbClose"[^>]*>[^<]*<\/button>/, webTitlebar);
if (!html.includes('Download the Windows desktop app')) {
  console.error('build-web: titlebar replacement did not apply');
  failures++;
}

// 4. Key-storage wording: the browser keeps the key in localStorage, not an encrypted keyfile.
html = html.replace(
  /Your key is stored encrypted on this computer only\./,
  "Your key stays in this browser's local storage and goes straight to OpenRouter — never through any server of ours. Clearing your browser data or using another browser/device means re-entering it.",
);
if (!html.includes("browser's local storage")) {
  console.error('build-web: key-hint replacement did not apply');
  failures++;
}

// 5. The sidebar folder button clears local history on the web (pv.openFolder is re-implemented
// in pv.js) — say so instead of promising a filesystem the browser does not have.
html = html.replace(
  /<button class="icon-btn" id="btnFolder" title="Open saved runs folder" aria-label="Open saved runs folder">📂<\/button>/,
  '<button class="icon-btn" id="btnFolder" title="Clear local history" aria-label="Clear local history">🗑</button>',
);
if (!html.includes('Clear local history')) {
  console.error('build-web: btnFolder replacement did not apply');
  failures++;
}

// 6. Load the web bridge first, then the shared helpers and compare modal (renderer/index.html
// already loads them; the copies land in site/ below). pairing.js must precede pv.js, which
// reads window.VPPairing; sync-engine.js must precede app.js, which reads window.VPSyncEngine.
html = html.replace(/(<script src="helpers\.js"><\/script>)/, '<script src="pv.js"></script>\n$1');
html = html.replace(/(<script src="pv\.js"><\/script>)/, '<script src="pairing.js"></script>\n$1');
html = html.replace('<script src="../lib/sync-engine.js"></script>', '<script src="sync-engine.js"></script>');
html = html.replace('<script src="../lib/scaffold.js"></script>', '<script src="scaffold.js"></script>');
if (!html.includes('<script src="pv.js"></script>') || !html.includes('<script src="pairing.js"></script>') || !html.includes('<script src="sync-engine.js"></script>') || !html.includes('<script src="scaffold.js"></script>')) {
  console.error('build-web: script injection did not apply');
  failures++;
}

// ---- Sanity check: every id app.js queries statically must exist in the generated HTML. ----
const ids = new Set();
for (const m of appJs.matchAll(/\$\('([A-Za-z][A-Za-z0-9_-]*)'\)/g)) ids.add(m[1]);
for (const m of appJs.matchAll(/getElementById\('([A-Za-z][A-Za-z0-9_-]*)'\)/g)) ids.add(m[1]);
const missing = [...ids].filter((id) => !new RegExp(`id="${id}"`).test(html));
if (missing.length) {
  console.error('build-web: app.js queries ids missing from the generated HTML:', missing.join(', '));
  failures++;
}

if (failures) {
  console.error(`build-web: ${failures} problem(s), site/ NOT updated`);
  process.exit(1);
}

write('site/app.js', appJs);
write('site/style.css', styleCss);
write('site/helpers.js', read('renderer/helpers.js'));
write('site/compare.js', read('renderer/compare.js'));
write('site/pairing.js', read('lib/pairing.js'));
write('site/sync-engine.js', read('lib/sync-engine.js'));
write('site/scaffold.js', read('lib/scaffold.js'));
write('site/index.html', html);
console.log(`build-web: site/app.js ${appJs.length} B, site/style.css ${styleCss.length} B, site/helpers.js + compare.js + pairing.js copied, site/index.html ${html.length} B written (${ids.size} app ids checked)`);
