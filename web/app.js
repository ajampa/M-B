import { computeLoadsheet } from '../engine/massbalance.mjs';
import { renderEnvelopeSVG } from './chart.js';
import DEFAULT_AIRCRAFT from './default-aircraft.js';

// ---------------------------------------------------------------------------
// State (persisted to localStorage so a pilot's work survives a reload)
// ---------------------------------------------------------------------------
const LS_AC = 'mb.aircraft.v1';
const LS_LOAD = 'mb.load.v1';
const PAX_TYPES = ['', 'male', 'female', 'child'];

let aircraft = load(LS_AC) || structuredClone(DEFAULT_AIRCRAFT);
let state = load(LS_LOAD) || freshLoad();

function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function save() {
  localStorage.setItem(LS_AC, JSON.stringify(aircraft));
  localStorage.setItem(LS_LOAD, JSON.stringify(state));
}

function freshLoad() {
  return {
    basicMass: aircraft.basic?.mass ?? 0,
    basicArm: aircraft.basic?.arm ?? aircraft.index.sta,
    crew: Object.fromEntries((aircraft.stations.crew || []).map((c) => [c.id, 200])),
    pantry: { [aircraft.stations.pantry?.[0]?.id]: true },
    pax: {},
    cargo: {},
    fuel: { taxi: 300, trip: 6000, contingency: 300, alternate: 1500, finalReserve: 1200, extra: 0 },
  };
}

// Build the engine input from UI state.
function buildLoad() {
  const sm = aircraft.standardMasses || {};
  const stdMass = { male: sm.adultMale ?? 200, female: sm.adultFemale ?? 165, child: sm.child ?? 75 };
  const crew = (aircraft.stations.crew || [])
    .map((c) => ({ mass: Number(state.crew[c.id]) || 0, arm: c.arm }))
    .filter((x) => x.mass > 0);
  const pantry = (aircraft.stations.pantry || [])
    .filter((p) => state.pantry[p.id])
    .map((p) => ({ mass: p.mass, arm: p.arm }));
  const pax = Object.entries(state.pax)
    .filter(([, t]) => t)
    .map(([id, t]) => ({ mass: stdMass[t], arm: seatArm(id) }));
  const cargo = (aircraft.stations.cargo || [])
    .map((h) => ({ mass: Number(state.cargo[h.id]) || 0, arm: h.arm }))
    .filter((x) => x.mass > 0);
  return { basicMass: Number(state.basicMass), basicArm: Number(state.basicArm), crew, pantry, pax, cargo, fuel: state.fuel };
}

function seatArm(id) { return (aircraft.stations.pax.find((s) => s.id === id) || {}).arm; }

// ---------------------------------------------------------------------------
// Views / tabs
// ---------------------------------------------------------------------------
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    const v = t.dataset.view;
    document.getElementById('view-pilot').classList.toggle('hidden', v !== 'pilot');
    document.getElementById('view-config').classList.toggle('hidden', v !== 'config');
    if (v === 'config') renderConfig();
  })
);

// ---------------------------------------------------------------------------
// Pilot view rendering
// ---------------------------------------------------------------------------
function renderPilot() {
  document.getElementById('acName').textContent = aircraft.name;
  bindInput('basicMass', 'basicMass');
  bindInput('basicArm', 'basicArm');
  renderCrew();
  renderPantry();
  renderSeatmap();
  renderCargo();
  renderFuel();
  recompute();
}

function bindInput(elId, key) {
  const el = document.getElementById(elId);
  el.value = state[key];
  el.oninput = () => { state[key] = el.value; recompute(); save(); };
}

function renderCrew() {
  const host = el('crewList');
  host.innerHTML = '';
  for (const c of aircraft.stations.crew || []) {
    const row = div('row');
    row.innerHTML = `<label>${c.label} (arm ${c.arm})</label>`;
    const inp = numInput(state.crew[c.id], (v) => { state.crew[c.id] = v; recompute(); save(); });
    row.appendChild(inp);
    host.appendChild(row);
  }
}

function renderPantry() {
  const host = el('pantryChips');
  host.innerHTML = '';
  for (const p of aircraft.stations.pantry || []) {
    const chip = document.createElement('button');
    chip.className = 'chip' + (state.pantry[p.id] ? ' on' : '');
    chip.textContent = `${p.label} · ${p.mass}lb`;
    chip.onclick = () => { state.pantry[p.id] = !state.pantry[p.id]; renderPantry(); recompute(); save(); };
    host.appendChild(chip);
  }
}

function renderSeatmap() {
  const host = el('seatmap');
  host.innerHTML = '';
  // Group pax stations into rows by leading digits; split sides by L/R.
  const rows = {};
  for (const s of aircraft.stations.pax) {
    const r = (s.id.match(/\d+/) || ['0'])[0];
    (rows[r] = rows[r] || []).push(s);
  }
  let occupied = 0;
  for (const r of Object.keys(rows).sort((a, b) => a - b)) {
    const rowEl = div('seatrow');
    const seats = rows[r];
    const left = seats.filter((s) => /L/i.test(s.id));
    const right = seats.filter((s) => /R/i.test(s.id));
    for (const s of left) rowEl.appendChild(seatEl(s));
    rowEl.appendChild(div('aisle'));
    for (const s of right) rowEl.appendChild(seatEl(s));
    host.appendChild(rowEl);
  }
  for (const t of Object.values(state.pax)) if (t) occupied++;
  el('paxCount').innerHTML = `<span class="pill good">${occupied} pax</span>`;
}

function seatEl(s) {
  const type = state.pax[s.id] || '';
  const d = div('seat' + (type ? ' ' + type : ''));
  const sm = aircraft.standardMasses || {};
  const mass = { male: sm.adultMale, female: sm.adultFemale, child: sm.child }[type];
  d.innerHTML = `<span class="who">${s.id}</span><span class="kg">${type ? mass + 'lb' : '—'}</span>`;
  d.onclick = () => {
    const next = PAX_TYPES[(PAX_TYPES.indexOf(type) + 1) % PAX_TYPES.length];
    if (next) state.pax[s.id] = next; else delete state.pax[s.id];
    renderSeatmap(); recompute(); save();
  };
  return d;
}

function renderCargo() {
  const host = el('cargoList');
  host.innerHTML = '';
  for (const h of aircraft.stations.cargo || []) {
    const row = div('row');
    row.innerHTML = `<label>${h.label} (arm ${h.arm}, max ${h.maxMass}lb)</label>`;
    const inp = numInput(state.cargo[h.id] || 0, (v) => { state.cargo[h.id] = v; recompute(); save(); });
    row.appendChild(inp);
    host.appendChild(row);
  }
}

const FUEL_FIELDS = [
  ['taxi', 'Taxi'], ['trip', 'Trip'], ['contingency', 'Contingency'],
  ['alternate', 'Alternate'], ['finalReserve', 'Final reserve'], ['extra', 'Extra'],
];
function renderFuel() {
  const host = el('fuelInputs');
  host.innerHTML = '';
  for (const [key, label] of FUEL_FIELDS) {
    const row = div('row');
    row.innerHTML = `<label>${label} (lb)</label>`;
    row.appendChild(numInput(state.fuel[key], (v) => { state.fuel[key] = v; recompute(); save(); }));
    host.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Recompute + summary + chart
// ---------------------------------------------------------------------------
function recompute() {
  const result = computeLoadsheet(aircraft, buildLoad());
  renderSummary(result);
  renderFuelDerived(result);
  el('chart').innerHTML = renderEnvelopeSVG(aircraft, result, { width: 460, height: 360 });
  renderVerdict(result);
}

function renderSummary(r) {
  const body = el('summaryBody');
  const rowsDef = [
    ['DOM', r.phases.dom, null, null],
    ['ZFM', r.phases.zfm, r.limits.mzfm, r.envelope.zfm],
    ['TOM', r.phases.tom, r.limits.mtom, r.envelope.tom],
    ['LDM', r.phases.ldm, r.limits.mlm, r.envelope.ldm],
    ['RAMP', r.phases.ramp, r.limits.mrw, null],
  ];
  body.innerHTML = rowsDef.map(([name, p, lim, env]) => {
    const limCell = lim && lim.ok != null ? pill(lim.ok ? 'good' : 'bad', lim.ok ? `≤ ${fmt(lim.max)}` : `> ${fmt(lim.max)}`) : '—';
    const envCell = env ? pill(env.inside ? 'good' : 'bad', env.inside ? 'IN' : 'OUT') : '—';
    return `<tr><td><b>${name}</b></td><td>${fmt(p.mass)}</td><td>${p.pctMac.toFixed(1)}</td><td>${p.index.toFixed(1)}</td><td>${limCell}</td><td>${envCell}</td></tr>`;
  }).join('');
  el('overallBadge').innerHTML = pill(r.ok ? 'good' : 'bad', r.ok ? 'WITHIN LIMITS' : 'CHECK LIMITS');
}

function renderFuelDerived(r) {
  const f = r.fuel;
  el('fuelDerived').innerHTML = `
    <div><div class="n">${fmt(f.ramp)}</div><div class="l">Ramp</div></div>
    <div><div class="n">${fmt(f.takeoff)}</div><div class="l">Takeoff</div></div>
    <div><div class="n">${fmt(f.trip)}</div><div class="l">Trip</div></div>
    <div><div class="n">${fmt(f.landing)}</div><div class="l">Landing</div></div>`;
  el('fuelMsg').innerHTML = f.sufficient
    ? `<span class="pill good">Ramp ≥ minimum required (${fmt(f.requiredRamp)} lb)</span>`
    : `<span class="pill bad">Ramp below minimum required (${fmt(f.requiredRamp)} lb)</span>`;
}

function renderVerdict(r) {
  const v = el('verdict');
  if (r.ok) { v.innerHTML = pill('good', '● All phases within envelope & limits'); return; }
  const issues = [];
  for (const [k, e] of Object.entries(r.envelope)) if (!e.inside) issues.push(`${k.toUpperCase()} CG out`);
  for (const [k, c] of Object.entries(r.limits)) if (c.ok === false) issues.push(`${k.toUpperCase()} exceeded`);
  if (!r.fuel.sufficient) issues.push('Fuel below minimum');
  v.innerHTML = pill('bad', '● ' + issues.join(' · '));
}

// ---------------------------------------------------------------------------
// Config view
// ---------------------------------------------------------------------------
function renderConfig() {
  setVal('cfg_sta', aircraft.index.sta); setVal('cfg_scale', aircraft.index.scale); setVal('cfg_offset', aircraft.index.offset);
  setVal('cfg_lemac', aircraft.mac.lemac); setVal('cfg_maclen', aircraft.mac.maclen);
  setVal('cfg_mrw', aircraft.limits.mrw); setVal('cfg_mtom', aircraft.limits.mtom);
  setVal('cfg_mzfm', aircraft.limits.mzfm); setVal('cfg_mlm', aircraft.limits.mlm);
  bindCfg('cfg_sta', () => aircraft.index, 'sta'); bindCfg('cfg_scale', () => aircraft.index, 'scale'); bindCfg('cfg_offset', () => aircraft.index, 'offset');
  bindCfg('cfg_lemac', () => aircraft.mac, 'lemac'); bindCfg('cfg_maclen', () => aircraft.mac, 'maclen');
  bindCfg('cfg_mrw', () => aircraft.limits, 'mrw'); bindCfg('cfg_mtom', () => aircraft.limits, 'mtom');
  bindCfg('cfg_mzfm', () => aircraft.limits, 'mzfm'); bindCfg('cfg_mlm', () => aircraft.limits, 'mlm');
  renderEnvEditors();
  refreshConfigChart();
}

function bindCfg(id, target, key) {
  el(id).oninput = (e) => { target()[key] = Number(e.target.value); save(); refreshConfigChart(); };
}

const ENV_CURVES = [
  ['TOL', 'fwd', 'Takeoff/Landing — Forward'],
  ['TOL', 'aft', 'Takeoff/Landing — Aft'],
  ['FLT', 'fwd', 'In-flight — Forward'],
  ['FLT', 'aft', 'In-flight — Aft'],
];
function renderEnvEditors() {
  const host = el('envEditors');
  host.innerHTML = '';
  for (const [phase, side, label] of ENV_CURVES) {
    const wrap = div('');
    wrap.style.marginBottom = '14px';
    const curve = aircraft.envelopes[phase][side];
    const rows = curve.map((pt, i) =>
      `<tr><td><input type="number" data-i="${i}" data-f="0" value="${pt[0]}"></td>
           <td><input type="number" step="0.1" data-i="${i}" data-f="1" value="${pt[1]}"></td>
           <td><button class="btn small" data-del="${i}">✕</button></td></tr>`).join('');
    wrap.innerHTML = `<h2 style="font-size:13px;margin:0 0 6px">${label}</h2>
      <table class="vtable"><thead><tr><th>Mass (lb)</th><th>%MAC</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <button class="btn small" data-add="1">+ Add vertex</button>`;
    wrap.querySelectorAll('input').forEach((inp) => {
      inp.oninput = () => {
        const i = +inp.dataset.i, f = +inp.dataset.f;
        curve[i][f] = Number(inp.value);
        save(); refreshConfigChart();
      };
    });
    wrap.querySelector('[data-add]').onclick = () => {
      const last = curve[curve.length - 1] || [26000, 25];
      curve.push([last[0] + 1000, last[1]]);
      renderEnvEditors(); refreshConfigChart(); save();
    };
    wrap.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
      curve.splice(+b.dataset.del, 1); renderEnvEditors(); refreshConfigChart(); save();
    });
    host.appendChild(wrap);
  }
}

function refreshConfigChart() {
  let result = null;
  try { result = computeLoadsheet(aircraft, buildLoad()); } catch {}
  el('chartCfg').innerHTML = renderEnvelopeSVG(aircraft, result, { width: 460, height: 380 });
}

// XML import (bootstrap from legacy format).
el('xmlImport').onclick = () => {
  const xml = el('xmlIn').value;
  try {
    parseLegacyXml(xml);
    save(); renderConfig();
    el('xmlIn').value = '';
    alert('Imported. Review the values, then switch to Pilot/Load.');
  } catch (e) { alert('Could not parse: ' + e.message); }
};
el('resetDefault').onclick = () => {
  if (!confirm('Reset aircraft to the bundled sample?')) return;
  aircraft = structuredClone(DEFAULT_AIRCRAFT);
  save(); renderConfig(); renderPilot();
};

function parseLegacyXml(xml) {
  const attr = (tag, name) => {
    const m = xml.match(new RegExp(`<${tag}[^>]*\\b${name}="([\\d.\\-]+)"`, 'i'));
    return m ? Number(m[1]) : null;
  };
  const pairs = (tag) => {
    const m = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 'is'));
    if (!m) return null;
    return [...m[1].matchAll(/\(([\d.\-]+)\s*,\s*([\d.\-]+)\)/g)].map((g) => [Number(g[1]), Number(g[2])]);
  };
  const sta = attr('INDEX', 'STA'), scale = attr('INDEX', 'SCALE'), offset = attr('INDEX', 'OFFSET');
  if (sta != null) aircraft.index = { sta, scale, offset };
  const lemac = attr('MAC', 'LEMAC'), maclen = attr('MAC', 'MACLEN');
  if (lemac != null) aircraft.mac = { lemac, maclen };
  const map = { FWDCGFLT: ['FLT', 'fwd'], AFTCGFLT: ['FLT', 'aft'], FWDCGTOL: ['TOL', 'fwd'], AFTCGTOL: ['TOL', 'aft'] };
  for (const [tag, [phase, side]] of Object.entries(map)) {
    const p = pairs(tag);
    if (p) aircraft.envelopes[phase][side] = p;
  }
}

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------
function el(id) { return document.getElementById(id); }
function div(cls) { const d = document.createElement('div'); if (cls) d.className = cls; return d; }
function setVal(id, v) { el(id).value = v; }
function fmt(n) { return Math.round(n).toLocaleString(); }
function pill(kind, txt) { return `<span class="pill ${kind}">${txt}</span>`; }
function numInput(value, onChange) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.value = value;
  inp.oninput = () => onChange(Number(inp.value));
  return inp;
}

renderPilot();
