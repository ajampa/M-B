// Bundles the multi-file web app into one self-contained HTML file
// (web/standalone.html) with CSS and all JS inlined and de-modularised, so it
// runs from file://, a Files-app open, or any static host with no MIME/module
// caveats. Run: node build-standalone.mjs
import { readFile, writeFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');

const css = await read('./web/styles.css');
let engine = await read('./engine/massbalance.mjs');
let chart = await read('./web/chart.js');
let defAc = await read('./web/default-aircraft.js');
let app = await read('./web/app.js');
let html = await read('./web/index.html');

const stripImports = (s) => s.replace(/^\s*import\s.*$/gm, '');
const stripExports = (s) => s.replace(/^export\s+/gm, '');

engine = stripExports(stripImports(engine));
chart = stripExports(stripImports(chart));
defAc = stripImports(defAc).replace(/^\s*export default\s+/m, 'const DEFAULT_AIRCRAFT = ');
app = stripImports(app); // app has no exports

const bundleJs = [
  '/* ===== engine/massbalance.mjs ===== */', engine,
  '/* ===== web/default-aircraft.js ===== */', defAc,
  '/* ===== web/chart.js ===== */', chart,
  '/* ===== web/app.js ===== */', app,
].join('\n\n');

html = html
  .replace('<link rel="stylesheet" href="styles.css" />', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="app.js"></script>', `<script>\n${bundleJs}\n</script>`);

await writeFile(new URL('./web/standalone.html', import.meta.url), html);
console.log('Wrote web/standalone.html  (' + Math.round(html.length / 1024) + ' KB, self-contained)');
