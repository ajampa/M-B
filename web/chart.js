// SVG CG-envelope renderer. Framework-free string builder so it works both in
// the browser (innerHTML) and in Node (write to .svg file for visual proof).
// x-axis = %MAC, y-axis = mass.

import { envelopePolygon } from '../engine/massbalance.mjs';

const PHASE_STYLE = {
  zfm: { color: '#2563eb', label: 'ZFM' },
  tom: { color: '#16a34a', label: 'TOM' },
  ldm: { color: '#d97706', label: 'LDM' },
};

export function renderEnvelopeSVG(aircraft, result, opts = {}) {
  const W = opts.width || 640;
  const H = opts.height || 460;
  const m = { top: 24, right: 20, bottom: 48, left: 64 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;

  // Data bounds from both envelopes (+ a little padding).
  const allPts = ['TOL', 'FLT'].flatMap((k) => [...aircraft.envelopes[k].fwd, ...aircraft.envelopes[k].aft]);
  const xs = allPts.map((p) => p[1]);
  const ys = allPts.map((p) => p[0]);
  const xMin = Math.min(...xs) - 2;
  const xMax = Math.max(...xs) + 2;
  const yMin = Math.min(...ys) - 1500;
  const yMax = Math.max(...ys) + 1500;

  const sx = (pct) => m.left + ((pct - xMin) / (xMax - xMin)) * iw;
  const sy = (mass) => m.top + ih - ((mass - yMin) / (yMax - yMin)) * ih;

  const parts = [];
  parts.push(`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,Segoe UI,Roboto,sans-serif">`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);

  // Gridlines + axis labels.
  for (let pct = Math.ceil(xMin / 5) * 5; pct <= xMax; pct += 5) {
    const x = sx(pct);
    parts.push(`<line x1="${x}" y1="${m.top}" x2="${x}" y2="${m.top + ih}" stroke="#eef0f3"/>`);
    parts.push(`<text x="${x}" y="${m.top + ih + 18}" font-size="11" fill="#6b7280" text-anchor="middle">${pct}</text>`);
  }
  const massStep = 4000;
  for (let mass = Math.ceil(yMin / massStep) * massStep; mass <= yMax; mass += massStep) {
    const y = sy(mass);
    parts.push(`<line x1="${m.left}" y1="${y}" x2="${m.left + iw}" y2="${y}" stroke="#eef0f3"/>`);
    parts.push(`<text x="${m.left - 8}" y="${y + 4}" font-size="11" fill="#6b7280" text-anchor="end">${(mass / 1000)}k</text>`);
  }
  parts.push(`<text x="${m.left + iw / 2}" y="${H - 8}" font-size="12" fill="#374151" text-anchor="middle">CG (% MAC)</text>`);
  parts.push(`<text transform="translate(16 ${m.top + ih / 2}) rotate(-90)" font-size="12" fill="#374151" text-anchor="middle">Mass (lb)</text>`);

  // Envelope polygons: FLT (in-flight) and TOL (takeoff/landing).
  const polyPath = (env) => {
    const ring = envelopePolygon(env).map(([pct, mass]) => `${sx(pct).toFixed(1)},${sy(mass).toFixed(1)}`);
    return ring.join(' ');
  };
  parts.push(`<polygon points="${polyPath(aircraft.envelopes.FLT)}" fill="rgba(37,99,235,0.04)" stroke="#93c5fd" stroke-width="1.5" stroke-dasharray="5 4"/>`);
  parts.push(`<polygon points="${polyPath(aircraft.envelopes.TOL)}" fill="rgba(22,163,74,0.05)" stroke="#16a34a" stroke-width="1.75"/>`);

  // In-flight fuel-burn path (TOM -> LDM).
  if (result && result.burnPath && result.burnPath.length) {
    const d = result.burnPath.map((p, i) => `${i ? 'L' : 'M'}${sx(p.pctMac).toFixed(1)} ${sy(p.mass).toFixed(1)}`).join(' ');
    parts.push(`<path d="${d}" fill="none" stroke="#9ca3af" stroke-width="1.25" stroke-dasharray="2 3"/>`);
  }

  // Phase points.
  if (result && result.phases) {
    for (const key of ['zfm', 'tom', 'ldm']) {
      const p = result.phases[key];
      const st = result.envelope[key];
      const style = PHASE_STYLE[key];
      const cx = sx(p.pctMac);
      const cy = sy(p.mass);
      const stroke = st && st.inside ? style.color : '#dc2626';
      const fill = st && st.inside ? style.color : '#fee2e2';
      parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="6" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`);
      parts.push(`<text x="${(cx + 10).toFixed(1)}" y="${(cy + 4).toFixed(1)}" font-size="12" font-weight="600" fill="${stroke}">${style.label} ${p.pctMac.toFixed(1)}%</text>`);
    }
  }

  // Legend.
  parts.push(`<g transform="translate(${m.left + 8} ${m.top + 6})" font-size="11" fill="#374151">`);
  parts.push(`<rect x="0" y="0" width="14" height="3" fill="#16a34a"/><text x="20" y="5">Takeoff/Landing</text>`);
  parts.push(`<rect x="0" y="16" width="14" height="3" fill="#93c5fd"/><text x="20" y="21">In-flight</text>`);
  parts.push(`</g>`);

  parts.push(`</svg>`);
  return parts.join('\n');
}
