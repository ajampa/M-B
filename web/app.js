import { computeLoadsheet } from '../engine/massbalance.mjs';
import { renderEnvelopeSVG } from './chart.js';
import DEFAULT_AIRCRAFT from './default-aircraft.js';

const LS_AC = 'mb.aircraft.v2';
const LS_LOAD = 'mb.load.v2';

let aircraft = load(LS_AC) || structuredClone(DEFAULT_AIRCRAFT);
let state = load(LS_LOAD) || freshLoad();
let brush = 'male';

function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function save() {
  localStorage.setItem(LS_AC, JSON.stringify(aircraft));
  localStorage.setItem(LS_LOAD, JSON.stringify(state));
}

// Pre-filled, realistic, in-envelope flight so the app opens populated.
function freshLoad() {
  return {
    flight: { no: 'TRM-204', route: 'ESSA→EGLL', alt: 'EGKK' },
    basicMass: aircraft.basic?.mass ?? 0,
    basicArm: aircraft.basic?.arm ?? aircraft.index.sta,
    crew: Object.fromEntries((aircraft.stations.crew || []).map((c) => [c.id, 200])),
    pantry: { pantryA: true },
    pax: { '3L': 'male', '3R': 'female', '4L': 'male', '4R': 'female' },
    cargo: { aftHold: 1000 },
    fuel: { taxi: 300, trip: 6000, contingency: 300, alternate: 1500, finalReserve: 1200, extra: 0 },
  };
}

// ---- engine input -----------------------------------------------------------
function buildLoad() {
  const sm = aircraft.standardMasses || {};
  const stdMass = { male: sm.adultMale ?? 200, female: sm.adultFemale ?? 165, child: sm.child ?? 75 };
  const crew = (aircraft.stations.crew || [])
    .map((c) => ({ mass: Number(state.crew[c.id]) || 0, arm: c.arm })).filter((x) => x.mass > 0);
  const pantry = (aircraft.stations.pantry || [])
    .filter((p) => state.pantry[p.id]).map((p) => ({ mass: p.mass, arm: p.arm }));
  const pax = Object.entries(state.pax).filter(([, t]) => t)
    .map(([id, t]) => ({ mass: stdMass[t], arm: seatArm(id) }));
  const cargo = (aircraft.stations.cargo || [])
    .map((h) => ({ mass: Number(state.cargo[h.id]) || 0, arm: h.arm })).filter((x) => x.mass > 0);
  return { basicMass: +state.basicMass, basicArm: +state.basicArm, crew, pantry, pax, cargo, fuel: state.fuel };
}
function seatArm(id) { return (aircraft.stations.pax.find((s) => s.id === id) || {}).arm; }
function stdMassFor(t) { const sm = aircraft.standardMasses || {}; return { male: sm.adultMale, female: sm.adultFemale, child: sm.child }[t]; }

// ---- icons ------------------------------------------------------------------
const I = {
  flight: '<path d="M3 16l8-2 7-9 1.5.6L16 12l3 1 1.5-2 1 .5-2 4-15-1z" fill="currentColor"/>',
  crew: '<circle cx="12" cy="8" r="3.4" fill="currentColor"/><path d="M5 19a7 7 0 0114 0z" fill="currentColor"/>',
  pantry: '<rect x="5" y="4" width="14" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 8h6M9 12h6" stroke="currentColor" stroke-width="1.8"/>',
  pax: '<circle cx="8" cy="8" r="2.6" fill="currentColor"/><path d="M3 18a5 5 0 0110 0z" fill="currentColor"/><circle cx="17" cy="9" r="2.2" fill="currentColor" opacity=".55"/><path d="M13 18a4 4 0 018 0z" fill="currentColor" opacity=".55"/>',
  cargo: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 8l8 4 8-4M12 12v8" stroke="currentColor" stroke-width="1.6"/>',
  fuel: '<path d="M6 3h7v18H6z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M13 8h3a2 2 0 012 2v6a1.5 1.5 0 01-3 0v-4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6 12h7" stroke="currentColor" stroke-width="1.7"/>',
  aircraft: '<path d="M12 2.5c.6 0 1 .8 1 2.2V9l8 4.4v1.9L13 13v4.2l2.2 1.5v1.5L12 19.3 8.8 20.2v-1.5L11 17.2V13l-8 2.3v-1.9L11 9V4.7c0-1.4.4-2.2 1-2.2z" fill="currentColor"/>',
  envelope: '<path d="M4 4v16h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 16l4-7 3 3 3-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
};
const NAV = [
  { group: 'Flight Load' },
  { id: 'flight', label: 'Flight', icon: I.flight },
  { id: 'crew', label: 'Crew', icon: I.crew },
  { id: 'pantry', label: 'Pantry', icon: I.pantry },
  { id: 'pax', label: 'Passengers', icon: I.pax, count: () => Object.values(state.pax).filter(Boolean).length },
  { id: 'cargo', label: 'Cargo', icon: I.cargo },
  { id: 'fuel', label: 'Fuel', icon: I.fuel },
  { group: 'Dispatch' },
  { id: 'aircraft', label: 'Aircraft', icon: I.aircraft },
  { id: 'tanks', label: 'Fuel Tanks', icon: I.fuel },
  { id: 'envelope', label: 'Envelope & Index', icon: I.envelope },
];
let activePanel = 'flight';

function renderNav() {
  const nav = el('nav');
  nav.innerHTML = '';
  for (const item of NAV) {
    if (item.group) {
      const g = document.createElement('div'); g.className = 'group-label'; g.textContent = item.group;
      nav.appendChild(g); continue;
    }
    const b = document.createElement('button');
    b.className = 'navitem' + (item.id === activePanel ? ' active' : '');
    const cnt = item.count ? `<span class="count">${item.count()}</span>` : '';
    b.innerHTML = `<svg viewBox="0 0 24 24">${item.icon}</svg><span>${item.label}</span>${cnt}`;
    b.onclick = () => { activePanel = item.id; showPanel(); renderNav(); };
    nav.appendChild(b);
  }
}
function showPanel() {
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + activePanel));
  if (activePanel === 'aircraft') renderAircraft();
  else if (activePanel === 'tanks') renderTanks();
  else if (activePanel === 'envelope') renderEnvelope();
}

// ---- panels -----------------------------------------------------------------
function renderAll() {
  el('acReg').textContent = aircraft.name;
  el('flightNo').textContent = state.flight?.no || '';
  el('flightRoute').textContent = state.flight?.route || '';
  bindText('fl_no', () => state.flight.no, (v) => state.flight.no = v);
  bindText('fl_route', () => state.flight.route, (v) => state.flight.route = v);
  bindText('fl_alt', () => state.flight.alt, (v) => state.flight.alt = v);
  renderCrew(); renderPantry(); renderPaxBrush(); renderCabin(); renderCargo(); renderFuel();
  renderNav(); showPanel(); recompute();
}

function bindNum(id, key) { const e = el(id); e.value = state[key]; e.oninput = () => { state[key] = e.value; recompute(); save(); }; }
function bindText(id, get, set) { const e = el(id); e.value = get() || ''; e.oninput = () => { set(e.value); el('flightNo').textContent = state.flight.no; el('flightRoute').textContent = state.flight.route; save(); }; }

function renderCrew() {
  const host = el('crewList'); host.innerHTML = '';
  for (const c of aircraft.stations.crew || []) {
    host.appendChild(field(c.label, `arm ${c.arm} in`, stepper(state.crew[c.id], 10, (v) => { state.crew[c.id] = v; recompute(); save(); }), 'lb'));
  }
}

function renderPantry() {
  const host = el('pantryList'); host.innerHTML = '';
  for (const p of aircraft.stations.pantry || []) {
    const sw = toggle(!!state.pantry[p.id], (on) => { state.pantry[p.id] = on; recompute(); save(); });
    host.appendChild(field(p.label, `${p.mass} lb · arm ${p.arm} in`, sw));
  }
}

const PAX_CATS = [['male', 'Male'], ['female', 'Female'], ['child', 'Child']];
function renderPaxBrush() {
  const host = el('paxBrush'); host.innerHTML = '';
  for (const [k, label] of PAX_CATS) {
    const b = document.createElement('button');
    b.className = brush === k ? 'on' : '';
    b.textContent = `${label} · ${stdMassFor(k)}lb`;
    b.onclick = () => { brush = k; renderPaxBrush(); };
    host.appendChild(b);
  }
}
function renderCabin() {
  const host = el('cabin'); host.innerHTML = '';
  const rows = {};
  for (const s of aircraft.stations.pax) { const r = (s.id.match(/\d+/) || ['0'])[0]; (rows[r] = rows[r] || []).push(s); }
  for (const r of Object.keys(rows).sort((a, b) => a - b)) {
    const rowEl = div('seatrow');
    const seats = rows[r];
    const left = seats.filter((s) => /L/i.test(s.id));
    const right = seats.filter((s) => /R/i.test(s.id));
    rowEl.appendChild(spanCls('rownum', r));
    for (const s of left) rowEl.appendChild(seatEl(s));
    rowEl.appendChild(spanCls('aisle', '·'));
    for (const s of right) rowEl.appendChild(seatEl(s));
    host.appendChild(rowEl);
  }
  el('paxCount').textContent = `${Object.values(state.pax).filter(Boolean).length} pax`;
}
function seatEl(s) {
  const type = state.pax[s.id] || '';
  const d = div('seat ' + (type || 'empty'));
  const tag = { male: 'M', female: 'F', child: 'C' }[type] || '';
  d.innerHTML = `<span class="ic">${type ? tag : s.id}</span><span class="kg">${type ? stdMassFor(type) + 'lb' : ''}</span>`;
  d.onclick = () => {
    if (state.pax[s.id] === brush) delete state.pax[s.id];
    else state.pax[s.id] = brush;
    renderCabin(); renderNav(); recompute(); save();
  };
  return d;
}

function renderCargo() {
  const host = el('cargoList'); host.innerHTML = '';
  for (const h of aircraft.stations.cargo || []) {
    host.appendChild(field(h.label, `arm ${h.arm} in · max ${h.maxMass} lb`,
      stepper(state.cargo[h.id] || 0, 50, (v) => { state.cargo[h.id] = v; recompute(); save(); }), 'lb'));
  }
}

const FUEL_FIELDS = [['taxi', 'Taxi'], ['trip', 'Trip'], ['contingency', 'Contingency'], ['alternate', 'Alternate'], ['finalReserve', 'Final reserve'], ['extra', 'Extra']];
function renderFuel() {
  const host = el('fuelInputs'); host.innerHTML = '';
  for (const [k, label] of FUEL_FIELDS) {
    host.appendChild(field(label, '', stepper(state.fuel[k], 50, (v) => { state.fuel[k] = v; recompute(); save(); }), 'lb'));
  }
}

// ---- recompute / summary / chart -------------------------------------------
function recompute() {
  const r = computeLoadsheet(aircraft, buildLoad());
  renderSummary(r); renderFuelDerived(r);
  el('chart').innerHTML = renderEnvelopeSVG(aircraft, r, { width: 372, height: 320 });
  renderVerdict(r);
  el('overallBadge').innerHTML = pill(r.ok ? 'good' : 'bad', r.ok ? 'Within limits' : 'Check limits');
  el('loadsheetTime').innerHTML = `<span class="pill blue flat">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
}
function renderSummary(r) {
  const rowsDef = [
    ['DOM', r.phases.dom, null, null], ['ZFM', r.phases.zfm, r.limits.mzfm, r.envelope.zfm],
    ['TOM', r.phases.tom, r.limits.mtom, r.envelope.tom], ['LDM', r.phases.ldm, r.limits.mlm, r.envelope.ldm],
    ['RAMP', r.phases.ramp, r.limits.mrw, null],
  ];
  el('summaryBody').innerHTML = rowsDef.map(([name, p, lim, env]) => {
    const bad = (lim && lim.ok === false) || (env && !env.inside);
    let status = '—';
    if (env) status = pill(env.inside ? 'good' : 'bad', env.inside ? 'IN' : 'OUT');
    else if (lim && lim.ok != null) status = pill(lim.ok ? 'good' : 'bad', lim.ok ? 'OK' : 'OVER');
    return `<tr class="${bad ? 'is-bad' : ''}"><td class="phase">${name}</td><td>${fmt(p.mass)}</td><td>${p.pctMac.toFixed(1)}</td><td>${p.index.toFixed(1)}</td><td>${status}</td></tr>`;
  }).join('');
}
function renderFuelDerived(r) {
  const f = r.fuel;
  const cell = (v, k, accent) => `<div class="readout ${accent ? 'accent' : ''}"><div class="v">${fmt(v)} <small>lb</small></div><div class="k">${k}</div></div>`;
  el('fuelDerived').innerHTML = cell(f.ramp, 'Ramp', 1) + cell(f.takeoff, 'Takeoff', 1) + cell(f.trip, 'Trip') + cell(f.landing, 'Landing');
  el('fuelMsg').innerHTML = f.sufficient
    ? pill('good', `Ramp ≥ minimum required (${fmt(f.requiredRamp)} lb)`)
    : pill('bad', `Ramp below minimum (${fmt(f.requiredRamp)} lb)`);
}
function renderVerdict(r) {
  const v = el('verdict');
  if (r.ok) { v.className = 'verdict-bar good'; v.innerHTML = '✓ All phases within envelope &amp; limits'; return; }
  const issues = [];
  for (const [k, e] of Object.entries(r.envelope)) if (!e.inside) issues.push(`${k.toUpperCase()} CG`);
  for (const [k, c] of Object.entries(r.limits)) if (c.ok === false) issues.push(`${k.toUpperCase()}`);
  if (!r.fuel.sufficient) issues.push('Fuel');
  v.className = 'verdict-bar bad'; v.innerHTML = '⚠ Out of limits: ' + issues.join(' · ');
}

// ---- dispatch: aircraft -----------------------------------------------------
function renderAircraft() {
  el('ac_name').value = aircraft.name;
  el('ac_name').oninput = (e) => { aircraft.name = e.target.value; el('acReg').textContent = aircraft.name; save(); };
  bindNum('basicMass', 'basicMass');
  bindNum('basicArm', 'basicArm');
  for (const k of ['mrw', 'mtom', 'mzfm', 'mlm']) { el('cfg_' + k).value = aircraft.limits[k]; bindCfg('cfg_' + k, () => aircraft.limits, k); }
}

// ---- dispatch: fuel tanks ---------------------------------------------------
function renderTanks() {
  const host = el('tankEditors'); host.innerHTML = '';
  (aircraft.tanks || []).forEach((tk, ti) => {
    const det = document.createElement('details'); det.className = 'env-acc';
    const rows = (tk.table || []).map((pt, i) =>
      `<tr><td><input type="number" data-i="${i}" data-f="0" value="${pt[0]}"></td><td><input type="number" step="0.01" data-i="${i}" data-f="1" value="${pt[1]}"></td><td><button class="btn small ghost" data-del="${i}">✕</button></td></tr>`).join('');
    det.innerHTML = `<summary>${tk.name} <span style="color:var(--muted)">· max ${fmt(tk.maxMass)} lb · fill ${tk.fillOrder ?? '-'} / burn ${tk.burnOrder ?? '-'}</span></summary>
      <div class="grid2">
        <div class="field"><div class="label"><div class="t">Name</div></div><input type="text" class="wide" data-k="name" value="${tk.name}"></div>
        <div class="field"><div class="label"><div class="t">Max mass</div></div><input type="number" data-k="maxMass" value="${tk.maxMass}"><span class="unit">lb</span></div>
        <div class="field"><div class="label"><div class="t">Fill order</div></div><input type="number" data-k="fillOrder" value="${tk.fillOrder ?? 1}"></div>
        <div class="field"><div class="label"><div class="t">Burn order</div></div><input type="number" data-k="burnOrder" value="${tk.burnOrder ?? 1}"></div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin:10px 0 4px">Fuel-arm table (quantity → CG arm)</div>
      <table class="vtable"><thead><tr><th>Qty (lb)</th><th>Arm (in)</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <div style="margin-top:8px"><button class="btn small" data-add="1">+ Add point</button>
        <button class="btn small ghost" data-deltank="1" style="margin-left:8px;color:var(--red)">Delete tank</button></div>`;
    det.querySelectorAll('input[data-k]').forEach((inp) => inp.oninput = () => { const k = inp.dataset.k; tk[k] = k === 'name' ? inp.value : Number(inp.value); save(); recompute(); });
    det.querySelectorAll('input[data-i]').forEach((inp) => inp.oninput = () => { tk.table[+inp.dataset.i][+inp.dataset.f] = Number(inp.value); save(); recompute(); });
    det.querySelector('[data-add]').onclick = () => { const last = tk.table[tk.table.length - 1] || [0, aircraft.index.sta]; tk.table.push([last[0] + 1000, last[1]]); renderTanks(); recompute(); save(); };
    det.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { tk.table.splice(+b.dataset.del, 1); renderTanks(); recompute(); save(); });
    det.querySelector('[data-deltank]').onclick = () => { aircraft.tanks.splice(ti, 1); renderTanks(); recompute(); save(); };
    host.appendChild(det);
  });
}
el('addTank').onclick = () => {
  aircraft.tanks = aircraft.tanks || [];
  const n = aircraft.tanks.length + 1;
  aircraft.tanks.push({ name: 'New tank', maxMass: 1000, fillOrder: n, burnOrder: n, table: [[0, aircraft.index.sta], [1000, aircraft.index.sta]] });
  renderTanks(); recompute(); save();
};

// ---- dispatch: envelope & index ---------------------------------------------
function renderEnvelope() {
  const set = (id, v) => el(id).value = v;
  set('cfg_sta', aircraft.index.sta); set('cfg_scale', aircraft.index.scale); set('cfg_offset', aircraft.index.offset);
  set('cfg_lemac', aircraft.mac.lemac); set('cfg_maclen', aircraft.mac.maclen);
  bindCfg('cfg_sta', () => aircraft.index, 'sta'); bindCfg('cfg_scale', () => aircraft.index, 'scale'); bindCfg('cfg_offset', () => aircraft.index, 'offset');
  bindCfg('cfg_lemac', () => aircraft.mac, 'lemac'); bindCfg('cfg_maclen', () => aircraft.mac, 'maclen');
  renderEnvEditors();
}
function bindCfg(id, target, key) { el(id).oninput = (e) => { target()[key] = Number(e.target.value); save(); recompute(); }; }

const ENV_CURVES = [['TOL', 'fwd', 'Takeoff/Landing — Forward'], ['TOL', 'aft', 'Takeoff/Landing — Aft'], ['FLT', 'fwd', 'In-flight — Forward'], ['FLT', 'aft', 'In-flight — Aft']];
function renderEnvEditors() {
  const host = el('envEditors'); host.innerHTML = '';
  for (const [phase, side, label] of ENV_CURVES) {
    const curve = aircraft.envelopes[phase][side];
    const det = document.createElement('details'); det.className = 'env-acc';
    const rows = curve.map((pt, i) =>
      `<tr><td><input type="number" data-i="${i}" data-f="0" value="${pt[0]}"></td><td><input type="number" step="0.1" data-i="${i}" data-f="1" value="${pt[1]}"></td><td><button class="btn small ghost" data-del="${i}">✕</button></td></tr>`).join('');
    det.innerHTML = `<summary>${label} <span style="color:var(--muted)">(${curve.length})</span></summary>
      <table class="vtable"><thead><tr><th>Mass (lb)</th><th>%MAC</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <button class="btn small" data-add="1">+ Add vertex</button>`;
    det.querySelectorAll('input').forEach((inp) => inp.oninput = () => { curve[+inp.dataset.i][+inp.dataset.f] = Number(inp.value); save(); recompute(); });
    det.querySelector('[data-add]').onclick = () => { const last = curve[curve.length - 1] || [26000, 25]; curve.push([last[0] + 1000, last[1]]); renderEnvEditors(); recompute(); save(); };
    det.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { curve.splice(+b.dataset.del, 1); renderEnvEditors(); recompute(); save(); });
    host.appendChild(det);
  }
}
function renderDispatch() { renderAircraft(); renderTanks(); renderEnvelope(); }
el('xmlImport').onclick = () => {
  try { parseLegacyXml(el('xmlIn').value); save(); renderDispatch(); recompute(); el('xmlIn').value = ''; alert('Imported. Review the values.'); }
  catch (e) { alert('Could not parse: ' + e.message); }
};
el('resetDefault').onclick = () => { if (confirm('Reset aircraft to the bundled sample?')) { aircraft = structuredClone(DEFAULT_AIRCRAFT); state = freshLoad(); save(); renderAll(); } };
function parseLegacyXml(xml) {
  const attr = (tag, name) => { const m = xml.match(new RegExp(`<${tag}[^>]*\\b${name}="([\\d.\\-]+)"`, 'i')); return m ? Number(m[1]) : null; };
  const pairs = (tag) => { const m = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 'is')); return m ? [...m[1].matchAll(/\(([\d.\-]+)\s*,\s*([\d.\-]+)\)/g)].map((g) => [Number(g[1]), Number(g[2])]) : null; };
  const sta = attr('INDEX', 'STA'); if (sta != null) aircraft.index = { sta, scale: attr('INDEX', 'SCALE'), offset: attr('INDEX', 'OFFSET') };
  const lemac = attr('MAC', 'LEMAC'); if (lemac != null) aircraft.mac = { lemac, maclen: attr('MAC', 'MACLEN') };
  for (const [tag, [phase, side]] of Object.entries({ FWDCGFLT: ['FLT', 'fwd'], AFTCGFLT: ['FLT', 'aft'], FWDCGTOL: ['TOL', 'fwd'], AFTCGTOL: ['TOL', 'aft'] })) {
    const p = pairs(tag); if (p) aircraft.envelopes[phase][side] = p;
  }
}

// ---- UI component helpers ---------------------------------------------------
function field(title, hint, control, unit) {
  const f = div('field');
  const l = div('label');
  l.innerHTML = `<div class="t">${title}</div>` + (hint ? `<div class="h">${hint}</div>` : '');
  f.appendChild(l); f.appendChild(control);
  if (unit) { const u = spanCls('unit', unit); f.appendChild(u); }
  return f;
}
function stepper(value, step, onChange) {
  const wrap = div('stepper');
  const minus = btn('−'), plus = btn('+');
  const inp = document.createElement('input'); inp.type = 'number'; inp.value = value;
  const fire = (v) => { v = Math.max(0, Math.round(v)); inp.value = v; onChange(v); };
  minus.onclick = () => fire((+inp.value || 0) - step);
  plus.onclick = () => fire((+inp.value || 0) + step);
  inp.oninput = () => onChange(+inp.value || 0);
  wrap.append(minus, sep(), inp, sep(), plus);
  return wrap;
}
function toggle(on, onChange) {
  const lab = document.createElement('label'); lab.className = 'switch';
  const input = document.createElement('input'); input.type = 'checkbox'; input.checked = on;
  input.onchange = () => onChange(input.checked);
  const track = div('track'), knob = div('knob');
  lab.append(input, track, knob);
  return lab;
}
function btn(t) { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; return b; }
function sep() { return div('sep'); }
function el(id) { return document.getElementById(id); }
function div(cls) { const d = document.createElement('div'); if (cls) d.className = cls; return d; }
function spanCls(cls, t) { const s = document.createElement('span'); s.className = cls; s.textContent = t; return s; }
function fmt(n) { return Math.round(n).toLocaleString(); }
function pill(kind, txt) { return `<span class="pill ${kind}">${txt}</span>`; }

renderAll();
