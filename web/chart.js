// SVG CG-envelope renderer. Framework-free string builder so it works both in
// the browser (innerHTML) and in Node (write to .svg for a visual proof).
// x-axis = %MAC, y-axis = mass.

import { envelopePolygon } from '../engine/massbalance.mjs';

const PHASE_STYLE = {
  zfm: { color: '#0a84ff', label: 'ZFM' },
  tom: { color: '#1db954', label: 'TOM' },
  ldm: { color: '#ff9f0a', label: 'LDM' },
};

export function renderEnvelopeSVG(aircraft, result, opts = {}) {
  const W = opts.width || 460;
  const H = opts.height || 380;
  const m = { top: 22, right: 16, bottom: 42, left: 52 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;

  const allPts = ['TOL', 'FLT'].flatMap((k) => [...aircraft.envelopes[k].fwd, ...aircraft.envelopes[k].aft]);
  const xs = allPts.map((p) => p[1]);
  const ys = allPts.map((p) => p[0]);
  const xMin = Math.min(...xs) - 2.5;
  const xMax = Math.max(...xs) + 2.5;
  const yMin = Math.min(...ys) - 1500;
  const yMax = Math.max(...ys) + 1500;
  const sx = (pct) => m.left + ((pct - xMin) / (xMax - xMin)) * iw;
  const sy = (mass) => m.top + ih - ((mass - yMin) / (yMax - yMin)) * ih;

  const p = [];
  p.push(`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,SF Pro Text,Segoe UI,Roboto,sans-serif">`);
  p.push(`<defs>
    <linearGradient id="tolFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1db954" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#1db954" stop-opacity="0.04"/>
    </linearGradient>
    <filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation="1.4" flood-color="#0b1524" flood-opacity="0.25"/></filter>
  </defs>`);
  p.push(`<rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="#fbfcfe"/>`);
  p.push(`<rect x="${m.left}" y="${m.top}" width="${iw}" height="${ih}" fill="#ffffff" stroke="#eef1f6"/>`);

  // Gridlines + ticks.
  for (let pct = Math.ceil(xMin / 5) * 5; pct <= xMax; pct += 5) {
    const x = sx(pct);
    p.push(`<line x1="${x}" y1="${m.top}" x2="${x}" y2="${m.top + ih}" stroke="#f1f4f9"/>`);
    p.push(`<text x="${x}" y="${m.top + ih + 16}" font-size="10.5" fill="#8a94a6" text-anchor="middle">${pct}</text>`);
  }
  for (let mass = Math.ceil(yMin / 4000) * 4000; mass <= yMax; mass += 4000) {
    const y = sy(mass);
    p.push(`<line x1="${m.left}" y1="${y}" x2="${m.left + iw}" y2="${y}" stroke="#f1f4f9"/>`);
    p.push(`<text x="${m.left - 7}" y="${y + 3.5}" font-size="10.5" fill="#8a94a6" text-anchor="end">${mass / 1000}k</text>`);
  }
  p.push(`<text x="${m.left + iw / 2}" y="${H - 6}" font-size="11" fill="#5b6573" text-anchor="middle" font-weight="600">CG · % MAC</text>`);
  p.push(`<text transform="translate(13 ${m.top + ih / 2}) rotate(-90)" font-size="11" fill="#5b6573" text-anchor="middle" font-weight="600">Mass · lb</text>`);

  const ring = (env) => envelopePolygon(env).map(([pct, mass]) => `${sx(pct).toFixed(1)},${sy(mass).toFixed(1)}`).join(' ');
  // In-flight envelope (dashed, behind).
  p.push(`<polygon points="${ring(aircraft.envelopes.FLT)}" fill="none" stroke="#9cc6ff" stroke-width="1.4" stroke-dasharray="5 4"/>`);
  // Takeoff/landing envelope (filled, primary).
  p.push(`<polygon points="${ring(aircraft.envelopes.TOL)}" fill="url(#tolFill)" stroke="#1db954" stroke-width="2"/>`);

  // Fuel-burn path.
  if (result?.burnPath?.length) {
    const d = result.burnPath.map((q, i) => `${i ? 'L' : 'M'}${sx(q.pctMac).toFixed(1)} ${sy(q.mass).toFixed(1)}`).join(' ');
    p.push(`<path d="${d}" fill="none" stroke="#aab4c4" stroke-width="1.4" stroke-dasharray="2 3"/>`);
  }

  // Phase points + labels.
  if (result?.phases) {
    for (const key of ['zfm', 'tom', 'ldm']) {
      const pt = result.phases[key];
      const st = result.envelope[key];
      const style = PHASE_STYLE[key];
      const cx = sx(pt.pctMac), cy = sy(pt.mass);
      const ok = st && st.inside;
      const col = ok ? style.color : '#ff3b30';
      p.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="6.5" fill="#fff" filter="url(#sh)"/>`);
      p.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5" fill="${col}"/>`);
      const tx = cx + 9, label = `${style.label} ${pt.pctMac.toFixed(1)}%`;
      const wlab = label.length * 6.0 + 10;
      const lx = Math.min(tx, m.left + iw - wlab);
      p.push(`<g transform="translate(${lx.toFixed(1)} ${(cy - 9).toFixed(1)})">
        <rect x="0" y="0" width="${wlab.toFixed(0)}" height="17" rx="8.5" fill="${col}"/>
        <text x="${(wlab / 2).toFixed(0)}" y="12" font-size="10.5" font-weight="700" fill="#fff" text-anchor="middle">${label}</text></g>`);
    }
  }

  // Legend.
  p.push(`<g transform="translate(${m.left + 7} ${m.top + 6})" font-size="10">
    <rect x="0" y="0" width="13" height="3" rx="1.5" fill="#1db954"/><text x="18" y="4" fill="#5b6573">Takeoff/Landing</text>
    <rect x="0" y="13" width="13" height="3" rx="1.5" fill="#9cc6ff"/><text x="18" y="17" fill="#5b6573">In-flight</text></g>`);

  p.push('</svg>');
  return p.join('\n');
}
