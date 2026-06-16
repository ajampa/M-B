// Renders the sample aircraft + the integration load to an SVG file so the
// envelope chart can be inspected without a browser.
// Usage: node test/render-svg.mjs [out.svg]

import { readFile, writeFile } from 'node:fs/promises';
import { computeLoadsheet } from '../engine/massbalance.mjs';
import { renderEnvelopeSVG } from '../web/chart.js';

const aircraft = JSON.parse(await readFile(new URL('../engine/sample-aircraft.json', import.meta.url)));
const V = JSON.parse(await readFile(new URL('./vectors.json', import.meta.url)));

const result = computeLoadsheet(aircraft, V.integration.load);
const svg = renderEnvelopeSVG(aircraft, result, { width: 680, height: 480 });

const out = process.argv[2] || new URL('../envelope-preview.svg', import.meta.url).pathname;
await writeFile(out, svg);
console.log(`Wrote ${out}`);
console.log(`ZFM ${result.phases.zfm.mass}lb ${result.phases.zfm.pctMac.toFixed(2)}%MAC inside=${result.envelope.zfm.inside}`);
console.log(`TOM ${result.phases.tom.mass}lb ${result.phases.tom.pctMac.toFixed(2)}%MAC inside=${result.envelope.tom.inside}`);
console.log(`LDM ${result.phases.ldm.mass}lb ${result.phases.ldm.pctMac.toFixed(2)}%MAC inside=${result.envelope.ldm.inside}`);
