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
    <marker id="arrow" viewBox="0 0 12 12" refX="9" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
      <path d="M1 1L11 6L1 11L3.4 6z" fill="#b06a00"/></marker>
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

  // Allowable fuel-CG corridor: where total CG could sit if the fuel were at
  // its forward / aft tank-CG limit across the burn. The fuel line must stay
  // inside this band. Converges to ZFM (no fuel) and widens toward TOM.
  const band = (result?.fuelLine || []).filter((s) => s.fwd && s.aft);
  if (band.length > 1) {
    const fwd = band.map((s) => `${sx(s.fwd.pctMac).toFixed(1)},${sy(s.fwd.mass).toFixed(1)}`);
    const aft = band.map((s) => `${sx(s.aft.pctMac).toFixed(1)},${sy(s.aft.mass).toFixed(1)}`);
    p.push(`<polygon points="${fwd.concat([...aft].reverse()).join(' ')}" fill="rgba(192,57,43,0.06)" stroke="none"/>`);
    p.push(`<polyline points="${fwd.join(' ')}" fill="none" stroke="#d98a8a" stroke-width="1.2" stroke-dasharray="4 3"/>`);
    p.push(`<polyline points="${aft.join(' ')}" fill="none" stroke="#d98a8a" stroke-width="1.2" stroke-dasharray="4 3"/>`);
  }

  // Fuel line: solid line of the CG locus as fuel burns from takeoff down to
  // zero fuel (connects TOM through LDM all the way to ZFM). It bends as tanks
  // empty in burn order. Arrow points in the burn direction (toward ZFM).
  const line = result?.fuelLine?.length > 1 ? result.fuelLine : result?.burnPath;
  if (line?.length > 1) {
    const d = line.map((q, i) => `${i ? 'L' : 'M'}${sx(q.pctMac).toFixed(1)} ${sy(q.mass).toFixed(1)}`).join(' ');
    p.push(`<path d="${d}" fill="none" stroke="#d98a14" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrow)"/>`);
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
    <rect x="0" y="13" width="13" height="3" rx="1.5" fill="#9cc6ff"/><text x="18" y="17" fill="#5b6573">In-flight</text>
    <rect x="0" y="26" width="13" height="3" rx="1.5" fill="#d98a14"/><text x="18" y="30" fill="#5b6573">Fuel burn</text>
    <rect x="0" y="39" width="13" height="3" rx="1.5" fill="#d98a8a"/><text x="18" y="43" fill="#5b6573">Fuel CG limits</text></g>`);

  p.push('</svg>');
  return p.join('\n');
}
