import { computeLoadsheet } from '../engine/massbalance.mjs';
import { renderEnvelopeSVG } from './chart.js';
import DEFAULT_AIRCRAFT from './default-aircraft.js';
import ATR_AIRCRAFT from './atr-aircraft.js';

const CATALOG = [DEFAULT_AIRCRAFT, ATR_AIRCRAFT]; // built-in aircraft the fleet seeds from
const LS_FLEET = 'mb.fleet.v7';
const LS_DRAFTS = 'mb.drafts.v7';
const LS_HIST = 'mb.hist.v7';
const LS_LOADS = 'mb.loads.v7';
const LS_SEL = 'mb.selected.v7';
const clone = (o) => JSON.parse(JSON.stringify(o));

// fleet  = committed aircraft configs (the "final save")
// drafts = per-aircraft working copies Dispatch edits (tested live, not yet saved)
// histories = per-aircraft log of staged change-batches (revertable)
let fleet = load(LS_FLEET) || CATALOG.map(clone);
let drafts = load(LS_DRAFTS) || {};
let histories = load(LS_HIST) || {};
let loads = load(LS_LOADS) || {};
let selected = load(LS_SEL) || fleet[0].id;
ensureDraft(selected);
let aircraft = drafts[selected];           // everything renders/calculates from the DRAFT
let lastSnapshot = clone(aircraft);        // state at the last history checkpoint
let state = loads[selected] || (loads[selected] = freshLoad(aircraft));
let brush = 'male';
let histTimer = null;

function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function committed() { return fleet.find((a) => a.id === selected); }
function ensureDraft(id) {
  const c = fleet.find((a) => a.id === id);
  if (!drafts[id]) drafts[id] = clone(c);
  if (!histories[id]) histories[id] = [];
}
function persist() {
  loads[selected] = state;
  localStorage.setItem(LS_FLEET, JSON.stringify(fleet));
  localStorage.setItem(LS_DRAFTS, JSON.stringify(drafts));
  localStorage.setItem(LS_HIST, JSON.stringify(histories));
  localStorage.setItem(LS_LOADS, JSON.stringify(loads));
  localStorage.setItem(LS_SEL, JSON.stringify(selected));
}
// Every save persists immediately and schedules a history capture. Dispatch
// edits change the draft (logged); pilot/load edits don't (ignored by the diff).
function save() { persist(); scheduleHistory(); renderHistory(); }
function switchAircraft(id) {
  flushHistory();
  loads[selected] = state;
  selected = id; ensureDraft(id);
  aircraft = drafts[id]; lastSnapshot = clone(aircraft);
  state = loads[id] || (loads[id] = freshLoad(aircraft));
  save(); renderAll();
}

// ---- dispatch staging / history --------------------------------------------
function isDirty() { return JSON.stringify(aircraft) !== JSON.stringify(committed()); }
// Called by every Dispatch (config) edit. Persists the draft and the live
// preview immediately, but only logs a revertable history batch after a pause.
function dispatchChanged() { recompute(); save(); }
function scheduleHistory() { clearTimeout(histTimer); histTimer = setTimeout(flushHistory, 650); }
function flushHistory() {
  if (histTimer) { clearTimeout(histTimer); histTimer = null; }
  const changes = diffAircraft(lastSnapshot, aircraft);
  if (changes.length) {
    histories[selected].push({ ts: Date.now(), changes, before: lastSnapshot, after: clone(aircraft) });
    const h = histories[selected];
    if (h.length > 40) h.splice(0, h.length - 40);
    lastSnapshot = clone(aircraft);
    persist();
  }
  renderHistory();
}
function revertTo(i) {
  flushHistory();
  const h = histories[selected];
  const before = clone(h[i].before);
  drafts[selected] = before; aircraft = before; lastSnapshot = clone(before);
  histories[selected] = h.slice(0, i);
  save(); renderAll();
}
function commitDraft() {
  flushHistory();
  const idx = fleet.findIndex((a) => a.id === selected);
  fleet[idx] = clone(aircraft); histories[selected] = []; lastSnapshot = clone(aircraft);
  save(); renderHistory();
}
function discardDraft() {
  const c = clone(committed());
  drafts[selected] = c; aircraft = c; lastSnapshot = clone(c); histories[selected] = [];
  save(); renderAll();
}
// Recursive diff of two aircraft snapshots -> list of {path, from, to, kind}.
function diffAircraft(a, b, path = '', out = []) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    if (k.startsWith('_')) continue;
    const pa = a ? a[k] : undefined, pb = b ? b[k] : undefined;
    const p = path ? path + '.' + k : k;
    if (pa === pb) continue;
    const oa = pa && typeof pa === 'object', ob = pb && typeof pb === 'object';
    if (pa === undefined) out.push({ path: p, kind: 'add' });
    else if (pb === undefined) out.push({ path: p, kind: 'remove' });
    else if (Array.isArray(pa) || Array.isArray(pb)) { if (JSON.stringify(pa) !== JSON.stringify(pb)) out.push({ path: p, kind: 'arr' }); }
    else if (oa || ob) diffAircraft(pa, pb, p, out);
    else if (pa !== pb) out.push({ path: p, kind: 'val', from: pa, to: pb });
  }
  return out;
}

// Unit labels come from the selected aircraft.
function massU() { return aircraft.units?.mass || 'lb'; }
function armU() { return aircraft.units?.arm || 'in'; }
function setUnits() {
  document.querySelectorAll('[data-u="mass"]').forEach((e) => e.textContent = massU());
  document.querySelectorAll('[data-u="arm"]').forEach((e) => e.textContent = armU());
}

// Per-aircraft demo flight, seeded from the aircraft's seedLoad.
function freshLoad(ac) {
  const seed = ac.seedLoad || {};
  return {
    flight: { no: seed.flightNo || '', route: seed.route || '', alt: seed.alt || '' },
    basicMass: ac.basic?.mass ?? 0,
    basicArm: ac.basic?.arm ?? (ac.index?.sta ?? 0),
    crew: Object.fromEntries((ac.stations?.crew || []).map((c) => [c.id, c.mass ?? (ac.units?.mass === 'kg' ? 85 : 200)])),
    pantry: seed.pantry || (ac.stations?.pantry?.[0] ? { [ac.stations.pantry[0].id]: true } : {}),
    pax: seed.pax || {},
    sections: seed.sections || {},
    cargo: seed.cargo || {},
    fuel: seed.fuel || { ramp: 0, taxi: 0, trip: 0 },
  };
}

// ---- engine input -----------------------------------------------------------
function buildLoad() {
  const sm = aircraft.standardMasses || {};
  const stdMass = stdMassMap();
  const crew = (aircraft.stations?.crew || [])
    .map((c) => ({ mass: Number(state.crew[c.id]) || 0, arm: c.arm })).filter((x) => x.mass > 0);
  const pantry = (aircraft.stations?.pantry || [])
    .map((p) => { let v = state.pantry?.[p.id]; if (v === true) v = p.mass; if (v == null) v = p.mass; return { mass: Number(v) || 0, arm: p.arm }; })
    .filter((x) => x.mass > 0);
  // Normal seating: each occupied seat holds a category (string) or a custom mass (number).
  const pax = Object.entries(state.pax || {}).filter(([, t]) => t)
    .map(([id, t]) => ({ mass: typeof t === 'number' ? t : stdMass[t], arm: seatArm(id) }));
  // Section seating: per-category passenger counts at the section arm.
  if (aircraft.cabinRows) {
    for (const sec of cabinSections()) {
      const c = sectionCounts(sec.label);
      for (const [cat] of SECTION_CATS) {
        const n = Number(c[cat]) || 0;
        if (n > 0) pax.push({ mass: n * (stdMass[cat] ?? 0), arm: sec.arm });
      }
      const cn = Number(c.customCount) || 0, cm = Number(c.customMass) || 0;
      if (cn > 0 && cm > 0) pax.push({ mass: cn * cm, arm: sec.arm });
    }
  }
  const cargo = (aircraft.stations?.cargo || [])
    .map((h) => ({ mass: Number(state.cargo[h.id]) || 0, arm: h.arm })).filter((x) => x.mass > 0);
  return { basicMass: +state.basicMass, basicArm: +state.basicArm, crew, pantry, pax, cargo, fuel: state.fuel };
}
function stdMassMap() {
  const sm = aircraft.standardMasses || {};
  return {
    male: sm.adultMale ?? 200, female: sm.adultFemale ?? 165, child: sm.child ?? 75,
    infant: sm.infant ?? 0, stretcher: sm.stretcher ?? 250, adult: sm.adult ?? sm.adultMale ?? 200,
  };
}
const SECTION_CATS = [['adult', 'Adult'], ['male', 'Male'], ['female', 'Female'], ['child', 'Child'], ['infant', 'Infant']];
// Normalise a section's stored value into a counts object (legacy number = adults).
function sectionCounts(label) {
  let c = state.sections?.[label];
  if (c == null) c = {};
  if (typeof c === 'number') c = { adult: c };
  return c;
}
function sectionTotal(c) {
  let t = 0;
  for (const [cat] of SECTION_CATS) t += Number(c[cat]) || 0;
  return t + (Number(c.customCount) || 0);
}
function seatArm(id) { return (aircraft.stations?.pax?.find((s) => s.id === id) || {}).arm; }
// Group cabinRows into sections. Section arm is either the mean of all row arms,
// or the average of the first and last row arms (aircraft.sectionArmMode).
function cabinSections() {
  const map = {};
  for (const r of aircraft.cabinRows || []) { const s = r.section ?? '—'; (map[s] = map[s] || []).push(r); }
  const mode = aircraft.sectionArmMode || 'mean';
  return Object.keys(map).map((label) => {
    const rs = map[label].slice().sort((a, b) => a.arm - b.arm);
    const arm = mode === 'endpoints' ? (rs[0].arm + rs[rs.length - 1].arm) / 2 : rs.reduce((a, r) => a + r.arm, 0) / rs.length;
    return {
      label, rows: rs,
      capacity: rs.reduce((a, r) => a + (r.capacity ?? 4), 0),
      arm,
      firstRow: rs[0].label, lastRow: rs[rs.length - 1].label,
    };
  }).sort((a, b) => a.arm - b.arm);
}
function stdMassFor(t) { return stdMassMap()[t]; }

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
  { id: 'seats', label: 'Cabin Seats', icon: I.pax },
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
  else if (activePanel === 'seats') renderSeats();
  else if (activePanel === 'tanks') renderTanks();
  else if (activePanel === 'envelope') renderEnvelope();
}

// ---- aircraft picker --------------------------------------------------------
el('acPick').onclick = () => {
  const opts = fleet.map((a) => ({ label: a.name + '  ·  ' + (a.id === selected ? 'current' : (a.units?.mass || 'lb')), value: a.id, active: a.id === selected }));
  opts.push({ label: '＋ Add aircraft…', value: '__add' });
  popupMenu(el('acPick'), opts, (v) => {
    if (v === '__add') return addAircraftFlow();
    switchAircraft(v);
  });
};
function addAircraftFlow() {
  // Offer catalog aircraft not already in the fleet, plus a blank.
  const inFleet = new Set(fleet.map((a) => a.id));
  const opts = CATALOG.filter((a) => !inFleet.has(a.id)).map((a) => ({ label: a.name, value: 'cat:' + a.id }));
  opts.push({ label: 'Blank aircraft', value: 'blank' });
  popupMenu(el('acPick'), opts, (v) => {
    let ac;
    if (v === 'blank') ac = blankAircraft();
    else ac = structuredClone(CATALOG.find((a) => a.id === v.slice(4)));
    // ensure unique id
    let id = ac.id, n = 2; while (fleet.some((a) => a.id === id)) id = ac.id + '-' + n++;
    ac.id = id;
    fleet.push(ac); save(); switchAircraft(id);
  });
}
function blankAircraft() {
  return {
    id: 'new-ac', name: 'NEW-AC', units: { mass: 'lb', arm: 'in' },
    index: { sta: 0, scale: 1000, offset: 0 }, mac: { lemac: 0, maclen: 100 },
    limits: { mrw: 0, mtom: 0, mzfm: 0, mlm: 0 },
    envelopes: { TOL: { fwd: [[0, 20], [10000, 20]], aft: [[0, 35], [10000, 35]] }, FLT: { fwd: [[0, 20], [10000, 20]], aft: [[0, 35], [10000, 35]] } },
    basic: { mass: 0, arm: 0 },
    stations: { crew: [], pantry: [], pax: [], cargo: [] },
    standardMasses: { adultMale: 200, adultFemale: 165, child: 75, stretcher: 250, adult: 195 },
    tanks: [],
  };
}

// ---- panels -----------------------------------------------------------------
function renderAll() {
  el('acReg').textContent = aircraft.name;
  el('acType').textContent = aircraft.cabinRows ? 'section' : 'seatmap';
  setUnits();
  el('flightNo').textContent = state.flight?.no || '—';
  el('flightRoute').textContent = state.flight?.route || '';
  bindText('fl_no', () => state.flight.no, (v) => state.flight.no = v);
  bindText('fl_route', () => state.flight.route, (v) => state.flight.route = v);
  bindText('fl_alt', () => state.flight.alt, (v) => state.flight.alt = v);
  renderCrew(); renderPantry(); renderPaxBrush(); renderCabin(); renderCargo(); renderFuel();
  renderNav(); showPanel(); recompute(); renderHistory();
}

function bindNum(id, key) { const e = el(id); e.value = state[key]; e.oninput = () => { state[key] = e.value; recompute(); save(); }; }
function bindText(id, get, set) { const e = el(id); e.value = get() || ''; e.oninput = () => { set(e.value); el('flightNo').textContent = state.flight.no; el('flightRoute').textContent = state.flight.route; save(); }; }

function renderCrew() {
  const host = el('crewList'); host.innerHTML = '';
  for (const c of aircraft.stations?.crew || []) {
    if (state.crew[c.id] == null) state.crew[c.id] = c.mass ?? 0;
    host.appendChild(field(c.label, `arm ${c.arm} ${armU()}`, stepper(state.crew[c.id], 5, (v) => { state.crew[c.id] = v; recompute(); save(); }), massU()));
  }
}

function renderPantry() {
  const host = el('pantryList'); host.innerHTML = '';
  state.pantry = state.pantry || {};
  for (const p of aircraft.stations?.pantry || []) {
    let v = state.pantry[p.id]; if (v === true) v = p.mass; if (v == null) v = p.mass; v = Number(v) || 0;
    const max = p.maxMass ?? p.mass;
    host.appendChild(field(p.label, `default ${p.mass} · max ${max} ${massU()} · arm ${p.arm} ${armU()}`,
      stepper(v, massU() === 'kg' ? 5 : 25, (nv) => { state.pantry[p.id] = nv; recompute(); save(); }, max), massU()));
  }
}

const PAX_CATS = [['male', 'Male'], ['female', 'Female'], ['child', 'Child'], ['infant', 'Infant']];
let customSeatMass = 0;
function renderPaxBrush() {
  const host = el('paxBrush');
  // Section seating has no per-seat category brush.
  host.style.display = aircraft.cabinRows ? 'none' : '';
  host.innerHTML = '';
  if (aircraft.cabinRows) return;
  if (!customSeatMass) customSeatMass = stdMassFor('male');
  for (const [k, label] of PAX_CATS) {
    const b = document.createElement('button');
    b.className = brush === k ? 'on' : '';
    b.textContent = `${label} · ${stdMassFor(k)}${massU()}`;
    b.onclick = () => { brush = k; renderPaxBrush(); };
    host.appendChild(b);
  }
  const cb = document.createElement('button');
  cb.className = brush === 'custom' ? 'on' : '';
  cb.textContent = 'Custom';
  cb.onclick = () => { brush = 'custom'; renderPaxBrush(); };
  host.appendChild(cb);
  if (brush === 'custom') {
    const inp = document.createElement('input');
    inp.type = 'number'; inp.value = customSeatMass; inp.style.width = '90px';
    inp.oninput = () => { customSeatMass = Number(inp.value) || 0; };
    host.appendChild(inp);
    host.appendChild(spanCls('unit', massU()));
  }
}

// Passengers: section loader (counts per row, grouped by section) for
// section-seating aircraft, otherwise the tap-a-seat cabin map.
function renderCabin() {
  const hint = el('paxHint');
  if (aircraft.cabinRows) { if (hint) hint.textContent = 'Tap a section to add passengers.'; return renderSectionCabin(); }
  if (hint) hint.textContent = 'Pick a category above, then tap seats to fill them. Tapping a filled seat clears it.';
  const host = el('cabin'); host.innerHTML = '';
  const seats = aircraft.stations?.pax || [];
  if (!seats.length) { host.innerHTML = '<p class="hint">No seats. Add them in Dispatch &rsaquo; Cabin Seats.</p>'; el('paxCount').textContent = '0 pax'; return; }
  const rows = {};
  for (const s of seats) { const r = s.row ?? 0; (rows[r] = rows[r] || []).push(s); }
  const meanArm = (arr) => arr.reduce((a, s) => a + s.arm, 0) / arr.length;
  const order = Object.keys(rows).sort((a, b) => meanArm(rows[a]) - meanArm(rows[b]));
  const normalSeats = seats.filter((s) => s.type !== 'stretcher');
  const maxRail = Math.max(2, ...normalSeats.map((s) => s.rail || 1));
  const aisleAfter = Math.floor(maxRail / 2);
  for (const r of order) {
    const seatsR = rows[r];
    const normal = seatsR.filter((s) => s.type !== 'stretcher');
    if (normal.length) {
      const rowEl = div('seatrow');
      rowEl.appendChild(spanCls('rownum', 'R' + r));
      for (let rl = 1; rl <= maxRail; rl++) {
        const s = normal.find((x) => (x.rail || 1) === rl);
        rowEl.appendChild(s ? seatEl(s) : div('seat-slot'));
        if (rl === aisleAfter) rowEl.appendChild(spanCls('aisle', '·'));
      }
      host.appendChild(rowEl);
    }
    for (const st of seatsR.filter((s) => s.type === 'stretcher')) host.appendChild(stretcherEl(st));
  }
  el('paxCount').textContent = `${Object.values(state.pax).filter(Boolean).length} occupied`;
}
// Section-seating cabin: one tap-target tile per section. Tapping opens a quick
// editor (− N + / Fill / Clear). Each tile shows occupied/capacity and rows.
function renderSectionCabin() {
  const host = el('cabin'); host.innerHTML = '';
  state.sections = state.sections || {};
  const wrap = div('section-cabin');
  let total = 0;
  for (const sec of cabinSections()) {
    const cnt = sectionTotal(sectionCounts(sec.label));
    total += cnt;
    const tile = div('section-tile' + (cnt > 0 ? ' filled' : ''));
    tile.innerHTML =
      `<div class="st-main"><div class="st-label">${sec.label}</div><div class="st-count">${cnt}/${sec.capacity}</div></div>
       <div class="st-rows">${sec.firstRow}<span>↓</span>${sec.lastRow}</div>`;
    tile.onclick = () => openSectionEditor(tile, sec);
    wrap.appendChild(tile);
  }
  host.appendChild(wrap);
  el('paxCount').textContent = `${total} pax`;
}
function openSectionEditor(tile, sec) {
  closePopup();
  const menu = div('popup-menu section-pop'); _popup = menu;
  menu.onmousedown = (e) => e.stopPropagation();
  // Ensure the section value is a counts object we can mutate.
  state.sections = state.sections || {};
  if (typeof state.sections[sec.label] === 'number') state.sections[sec.label] = { adult: state.sections[sec.label] };
  if (state.sections[sec.label] == null) state.sections[sec.label] = {};
  const cc = state.sections[sec.label];

  const title = div('sp-title'); title.textContent = `Section ${sec.label} · rows ${sec.firstRow}–${sec.lastRow}`;
  const totalEl = div('sp-total');
  const refresh = () => {
    const t = sectionTotal(cc);
    totalEl.textContent = `${t} / ${sec.capacity} pax`;
    tile.classList.toggle('filled', t > 0);
    tile.querySelector('.st-count').textContent = `${t}/${sec.capacity}`;
  };
  menu.append(title, totalEl);

  const addCatRow = (key, label, massGetter) => {
    const row = div('sp-cat');
    const lab = div('sp-cat-label'); lab.innerHTML = `${label} <span>${massGetter()}${massU()}</span>`;
    const ctrl = div('sp-ctrl');
    const minus = btn('−'); minus.className = 'sp-btn sm';
    const plus = btn('+'); plus.className = 'sp-btn sm';
    const nEl = div('sp-n'); nEl.textContent = Number(cc[key]) || 0;
    const set = (v) => {
      v = Math.max(0, Math.round(v));
      const others = sectionTotal(cc) - (Number(cc[key]) || 0);
      if (v + others > sec.capacity) v = sec.capacity - others;
      cc[key] = v; nEl.textContent = v; recompute(); save(); refresh();
    };
    minus.onclick = (e) => { e.preventDefault(); set((Number(cc[key]) || 0) - 1); };
    plus.onclick = (e) => { e.preventDefault(); set((Number(cc[key]) || 0) + 1); };
    ctrl.append(minus, nEl, plus); row.append(lab, ctrl);
    return { row, lab };
  };

  for (const [cat, label] of SECTION_CATS) menu.appendChild(addCatRow(cat, label, () => stdMassFor(cat) ?? 0).row);

  // Custom mass row.
  const cust = addCatRow('customCount', 'Custom', () => Number(cc.customMass) || 0);
  cust.lab.innerHTML = `Custom <input type="number" class="sp-cmass" value="${cc.customMass || 0}" title="custom mass"> ${massU()}`;
  cust.lab.querySelector('.sp-cmass').oninput = (e) => { cc.customMass = Number(e.target.value); recompute(); save(); };
  menu.appendChild(cust.row);

  const quick = div('sp-quick');
  const clr = btn('Clear section'); clr.className = 'btn small ghost';
  clr.onclick = (e) => { e.preventDefault(); for (const k of Object.keys(cc)) delete cc[k]; recompute(); save(); closePopup(); renderSectionCabin(); };
  quick.append(clr); menu.appendChild(quick);

  document.body.appendChild(menu);
  const r = tile.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 8) + 'px';
  setTimeout(() => document.addEventListener('mousedown', closePopup, { once: true }), 0);
}
function stretcherEl(s) {
  const occ = state.pax[s.id] === 'stretcher';
  const d = div('stretcher' + (occ ? ' occupied' : ''));
  const len = s.length ?? 78;
  d.style.minHeight = Math.max(44, Math.min(110, len * 0.6)) + 'px';
  d.innerHTML = `<span class="lbl">${s.label ?? s.id} · STRETCHER</span>` +
    `<span class="meta">${occ ? stdMassFor('stretcher') + ' ' + massU() : 'len ' + len + ' ' + armU() + ' · arm ' + s.arm}</span>`;
  d.onclick = () => {
    if (state.pax[s.id] === 'stretcher') delete state.pax[s.id]; else state.pax[s.id] = 'stretcher';
    renderCabin(); renderNav(); recompute(); save();
  };
  return d;
}
function seatEl(s) {
  const val = state.pax[s.id];
  const isCustom = typeof val === 'number';
  const occupied = val != null && val !== '' && val !== false;
  const cat = isCustom ? 'custom' : (val || '');
  const face = s.rot ? ' face-' + String(s.rot).toLowerCase() : '';
  const d = div('seat ' + (occupied ? cat : 'empty') + face);
  const tag = { male: 'M', female: 'F', child: 'C', infant: 'I', custom: '✶' }[cat] || '';
  const massTxt = occupied ? ((isCustom ? val : stdMassFor(cat)) + massU()) : 'arm ' + s.arm;
  d.innerHTML = `<span class="ic">${occupied ? tag : (s.label ?? s.id)}</span><span class="kg">${massTxt}</span>`;
  d.onclick = () => {
    const apply = brush === 'custom' ? (Number(customSeatMass) || 0) : brush;
    if (state.pax[s.id] === apply) delete state.pax[s.id];
    else state.pax[s.id] = apply;
    renderCabin(); renderNav(); recompute(); save();
  };
  return d;
}

function renderCargo() {
  const host = el('cargoList'); host.innerHTML = '';
  for (const h of aircraft.stations?.cargo || []) {
    host.appendChild(field(h.label, `arm ${h.arm} ${armU()} · max ${h.maxMass} ${massU()}`,
      stepper(state.cargo[h.id] || 0, massU() === 'kg' ? 25 : 50, (v) => { state.cargo[h.id] = v; recompute(); save(); }, h.maxMass), massU()));
  }
}

const FUEL_FIELDS = [['ramp', 'Ramp (block)'], ['taxi', 'Taxi'], ['trip', 'Trip']];
function renderFuel() {
  const host = el('fuelInputs'); host.innerHTML = '';
  const step = massU() === 'kg' ? 25 : 50;
  for (const [k, label] of FUEL_FIELDS) {
    host.appendChild(field(label, '', stepper(state.fuel[k], step, (v) => { state.fuel[k] = v; recompute(); save(); }), massU()));
  }
}

// ---- recompute / summary / chart -------------------------------------------
function recompute() {
  const r = computeLoadsheet(aircraft, buildLoad());
  renderSummary(r); renderFuelDerived(r);
  el('chart').innerHTML = renderEnvelopeSVG(aircraft, r, { width: 430, height: 560 });
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
  const cell = (v, k, accent) => `<div class="readout ${accent ? 'accent' : ''}"><div class="v">${fmt(v)} <small>${massU()}</small></div><div class="k">${k}</div></div>`;
  el('fuelDerived').innerHTML = cell(f.takeoff, 'Takeoff', 1) + cell(f.landing, 'Landing', 1) + cell(f.trip, 'Trip') + cell(f.ramp, 'Ramp');
  let msg = f.sufficient
    ? pill('good', `Landing ≥ minimum reserve (${fmt(f.minReserve)} ${massU()})`)
    : pill('bad', `Landing below minimum reserve (${fmt(f.minReserve)} ${massU()})`);
  const fl = r.fuelLimits;
  if (fl && fl.takeoff.checked) {
    const ok = fl.takeoff.inside && fl.landing.inside;
    const t = fl.takeoff.tanks[0];
    const detail = t ? ` (CG ${t.arm.toFixed(1)} ${armU()} vs ${t.fwd.toFixed(1)}…${t.aft.toFixed(1)})` : '';
    msg += ' ' + (ok ? pill('good', 'Fuel CG within tank limits') : pill('bad', 'Fuel CG outside tank limits' + detail));
  }
  el('fuelMsg').innerHTML = msg;
}
function renderVerdict(r) {
  const v = el('verdict');
  if (r.ok) { v.className = 'verdict-bar good'; v.innerHTML = '✓ All phases within envelope &amp; limits'; return; }
  const issues = [];
  for (const [k, e] of Object.entries(r.envelope)) if (!e.inside) issues.push(`${k.toUpperCase()} CG`);
  for (const [k, c] of Object.entries(r.limits)) if (c.ok === false) issues.push(`${k.toUpperCase()}`);
  if (r.fuelLimits && r.fuelLimits.takeoff.checked && (!r.fuelLimits.takeoff.inside || !r.fuelLimits.landing.inside)) issues.push('Fuel CG');
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
  aircraft.standardMasses = aircraft.standardMasses || {};
  const smMap = { sm_adult: 'adult', sm_male: 'adultMale', sm_female: 'adultFemale', sm_child: 'child', sm_infant: 'infant', sm_stretcher: 'stretcher' };
  for (const [id, key] of Object.entries(smMap)) { el(id).value = aircraft.standardMasses[key] ?? ''; bindCfg(id, () => aircraft.standardMasses, key); }
  renderCrewEditor(); renderPantryEditor();
}
function renderCrewEditor() {
  const host = el('crewEditor'); const crew = aircraft.stations?.crew || [];
  const body = crew.map((c, i) => `<tr>
    <td><input data-i="${i}" data-k="label" value="${c.label ?? ''}" style="width:116px"></td>
    <td><input type="number" data-i="${i}" data-k="mass" value="${c.mass ?? 0}" style="width:62px"></td>
    <td><input type="number" step="0.001" data-i="${i}" data-k="arm" value="${c.arm}" style="width:78px"></td>
    <td><button class="btn small ghost" data-del="${i}" style="color:var(--red)">✕</button></td></tr>`).join('');
  host.innerHTML = `<table class="vtable"><thead><tr><th>Name</th><th>Mass (${massU()})</th><th>Arm (${armU()})</th><th></th></tr></thead><tbody>${body}</tbody></table>
    <button class="btn small" id="addCrew" style="margin-top:8px">+ Add crew</button>`;
  host.querySelectorAll('input[data-i]').forEach((inp) => inp.oninput = () => { const c = aircraft.stations.crew[+inp.dataset.i]; const k = inp.dataset.k; c[k] = k === 'label' ? inp.value : Number(inp.value); dispatchChanged(); });
  host.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { aircraft.stations.crew.splice(+b.dataset.del, 1); renderCrewEditor(); dispatchChanged(); });
  el('addCrew').onclick = () => {
    aircraft.stations.crew = aircraft.stations.crew || [];
    let n = aircraft.stations.crew.length + 1, id = 'c' + n; while (aircraft.stations.crew.some((c) => c.id === id)) id = 'c' + (++n);
    aircraft.stations.crew.push({ id, label: 'Crew ' + n, mass: massU() === 'kg' ? 85 : 200, arm: 0 });
    renderCrewEditor(); dispatchChanged();
  };
}
function renderPantryEditor() {
  const host = el('pantryEditor'); const pantry = aircraft.stations?.pantry || [];
  const body = pantry.map((p, i) => `<tr>
    <td><input data-i="${i}" data-k="label" value="${p.label ?? ''}" style="width:104px"></td>
    <td><input type="number" data-i="${i}" data-k="mass" value="${p.mass ?? 0}" style="width:56px"></td>
    <td><input type="number" data-i="${i}" data-k="maxMass" value="${p.maxMass ?? p.mass ?? 0}" style="width:56px"></td>
    <td><input type="number" step="0.001" data-i="${i}" data-k="arm" value="${p.arm}" style="width:70px"></td>
    <td><button class="btn small ghost" data-del="${i}" style="color:var(--red)">✕</button></td></tr>`).join('');
  host.innerHTML = `<table class="vtable"><thead><tr><th>Name</th><th>Default</th><th>Max</th><th>Arm (${armU()})</th><th></th></tr></thead><tbody>${body}</tbody></table>
    <button class="btn small" id="addPantry" style="margin-top:8px">+ Add pantry item</button>`;
  host.querySelectorAll('input[data-i]').forEach((inp) => inp.oninput = () => { const p = aircraft.stations.pantry[+inp.dataset.i]; const k = inp.dataset.k; p[k] = k === 'label' ? inp.value : Number(inp.value); dispatchChanged(); });
  host.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { aircraft.stations.pantry.splice(+b.dataset.del, 1); renderPantryEditor(); dispatchChanged(); });
  el('addPantry').onclick = () => {
    aircraft.stations.pantry = aircraft.stations.pantry || [];
    let n = aircraft.stations.pantry.length + 1, id = 'p' + n; while (aircraft.stations.pantry.some((p) => p.id === id)) id = 'p' + (++n);
    aircraft.stations.pantry.push({ id, label: 'Pantry ' + n, mass: 0, maxMass: 0, arm: 0 });
    renderPantryEditor(); dispatchChanged();
  };
}

// ---- dispatch: cabin seats --------------------------------------------------
function renderRowEditor(host) {
  const rows = aircraft.cabinRows || [];
  const body = rows.map((r, i) =>
    `<tr>
      <td><input data-i="${i}" data-k="label" value="${r.label}" style="width:46px"></td>
      <td><input data-i="${i}" data-k="section" value="${r.section ?? ''}" style="width:44px"></td>
      <td><input type="number" step="0.001" data-i="${i}" data-k="arm" value="${r.arm}" style="width:84px"></td>
      <td><input type="number" data-i="${i}" data-k="capacity" value="${r.capacity ?? 4}" style="width:50px"></td>
      <td><button class="btn small ghost" data-del="${i}" style="color:var(--red)">✕</button></td>
    </tr>`).join('');
  const mode = aircraft.sectionArmMode || 'mean';
  host.innerHTML = `
    <div class="field"><div class="label"><div class="t">Section arm</div><div class="h">how each section's CG arm is derived</div></div>
      <div class="seg" id="armMode">
        <button data-m="mean" class="${mode === 'mean' ? 'on' : ''}">Average of all rows</button>
        <button data-m="endpoints" class="${mode === 'endpoints' ? 'on' : ''}">First + last row</button>
      </div></div>
    <table class="vtable"><thead><tr><th>Row</th><th>Sect</th><th>Arm (${armU()})</th><th>Cap</th><th></th></tr></thead><tbody>${body}</tbody></table>
    <button class="btn small" id="addRowBtn" style="margin-top:8px">+ Add row</button>
    <p class="hint">Section seating: pilots add passengers per section by category. Rows define each section's arms and capacity.</p>`;
  host.querySelectorAll('#armMode button').forEach((b) => b.onclick = () => { aircraft.sectionArmMode = b.dataset.m; save(); renderRowEditor(host); recompute(); });
  host.querySelectorAll('input[data-i]').forEach((inp) => inp.oninput = () => {
    const r = aircraft.cabinRows[+inp.dataset.i]; const k = inp.dataset.k;
    r[k] = (k === 'label' || k === 'section') ? inp.value : Number(inp.value);
    save(); recompute();
  });
  host.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
    const r = aircraft.cabinRows[+b.dataset.del];
    if (state.rows) delete state.rows[r.id];
    aircraft.cabinRows.splice(+b.dataset.del, 1);
    renderSeats(); renderCabin(); recompute(); save();
  });
  el('addRowBtn').onclick = () => {
    const ids = aircraft.cabinRows.map((r) => r.id);
    let n = aircraft.cabinRows.length + 1, id = 'r' + n; while (ids.includes(id)) { n++; id = 'r' + n; }
    aircraft.cabinRows.push({ id, label: String(n), section: '', arm: 0, capacity: 4 });
    renderSeats(); renderCabin(); recompute(); save();
  };
}
function renderSeats() {
  const host = el('seatEditors');
  if (aircraft.cabinRows) return renderRowEditor(host);
  const seats = aircraft.stations?.pax || [];
  const rows = seats.map((s, i) => {
    const isStr = s.type === 'stretcher';
    const typeCell = `<button class="btn small" data-type="${i}" style="min-width:52px">${isStr ? 'STR' : 'SEAT'}</button>` +
      (isStr ? `<input type="number" data-len="${i}" value="${s.length ?? 78}" title="length (in)" style="width:50px;margin-left:4px">` : '');
    return `<tr>
      <td><input data-i="${i}" data-k="label" value="${s.label ?? s.id}" style="width:46px"></td>
      <td><input type="number" data-i="${i}" data-k="row" value="${s.row ?? 1}" style="width:44px"></td>
      <td><input type="number" data-i="${i}" data-k="rail" value="${s.rail ?? 1}" style="width:44px"></td>
      <td><input type="number" step="0.01" data-i="${i}" data-k="arm" value="${s.arm}" style="width:74px"></td>
      <td>${typeCell}</td>
      <td><button class="btn small" data-rot="${i}" style="min-width:56px">${s.rot ?? 'UP'}</button></td>
      <td><button class="btn small ghost" data-del="${i}" style="color:var(--red)">✕</button></td>
    </tr>`;
  }).join('');
  host.innerHTML = `<table class="vtable"><thead><tr><th>Label</th><th>Row</th><th>Rail</th><th>Arm</th><th>Type / Len</th><th>Face</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <button class="btn small" id="addSeatBtn" style="margin-top:8px">+ Add seat</button>
    <p class="hint">Row + rail set the cabin position; arm drives the CG. Type switches a position to a stretcher with a length. Tap Face to choose the seat direction.</p>`;
  host.querySelectorAll('input[data-i]').forEach((inp) => inp.oninput = () => {
    const s = aircraft.stations.pax[+inp.dataset.i]; const k = inp.dataset.k;
    s[k] = k === 'label' ? inp.value : Number(inp.value);
    save(); renderCabin(); recompute();
  });
  host.querySelectorAll('input[data-len]').forEach((inp) => inp.oninput = () => {
    aircraft.stations.pax[+inp.dataset.len].length = Number(inp.value); save(); renderCabin();
  });
  host.querySelectorAll('[data-rot]').forEach((b) => b.onclick = () => {
    const s = aircraft.stations.pax[+b.dataset.rot];
    popupMenu(b, ['UP', 'RIGHT', 'DOWN', 'LEFT'].map((v) => ({ label: v, value: v, active: (s.rot ?? 'UP') === v })),
      (v) => { s.rot = v; save(); renderSeats(); renderCabin(); });
  });
  host.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => {
    const s = aircraft.stations.pax[+b.dataset.type];
    popupMenu(b, [
      { label: 'Seat', value: 'seat', active: (s.type ?? 'seat') === 'seat' },
      { label: 'Stretcher', value: 'stretcher', active: s.type === 'stretcher' },
    ], (v) => {
      delete state.pax[s.id];
      if (v === 'stretcher') { s.type = 'stretcher'; if (s.length == null) s.length = 78; }
      else s.type = 'seat';
      save(); renderSeats(); renderCabin(); recompute();
    });
  });
  host.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
    const s = aircraft.stations.pax[+b.dataset.del];
    delete state.pax[s.id];
    aircraft.stations.pax.splice(+b.dataset.del, 1);
    renderSeats(); renderCabin(); renderNav(); recompute(); save();
  });
  el('addSeatBtn').onclick = () => {
    const ids = aircraft.stations.pax.map((s) => s.id);
    let n = aircraft.stations.pax.length + 1, id = 's' + n;
    while (ids.includes(id)) { n++; id = 's' + n; }
    const lastRow = Math.max(0, ...aircraft.stations.pax.map((s) => s.row ?? 0));
    aircraft.stations.pax.push({ id, label: String(n), arm: 0, row: lastRow + 1, rail: 1, sect: '', type: 'seat', rot: 'UP' });
    renderSeats(); renderCabin(); recompute(); save();
  };
}

// ---- dispatch: fuel tanks ---------------------------------------------------
function tankArrFor(tk, t) { return t === 'table' ? tk.table : t === 'fwd' ? tk.fwdLimit : tk.aftLimit; }
function ptTableHTML(title, arr, t) {
  const rows = arr.map((pt, i) =>
    `<tr><td><input type="number" data-t="${t}" data-i="${i}" data-f="0" value="${pt[0]}" style="width:84px"></td>
      <td><input type="number" step="0.01" data-t="${t}" data-i="${i}" data-f="1" value="${pt[1]}" style="width:84px"></td>
      <td><button class="btn small ghost" data-delrow="${t}" data-i="${i}">✕</button></td></tr>`).join('');
  return `<div style="font-size:12px;color:var(--muted);margin:12px 0 4px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">${title}</div>
    <table class="vtable"><thead><tr><th>Qty (${massU()})</th><th>Arm (${armU()})</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <button class="btn small" data-addrow="${t}">+ Add point</button>`;
}
function renderTanks() {
  const host = el('tankEditors'); host.innerHTML = '';
  (aircraft.tanks || []).forEach((tk, ti) => {
    const det = document.createElement('details'); det.className = 'env-acc';
    const hasLim = tk.fwdLimit && tk.aftLimit;
    det.innerHTML = `<summary>${tk.name} <span style="color:var(--muted)">· max ${fmt(tk.maxMass)} lb · fill ${tk.fillOrder ?? '-'} / burn ${tk.burnOrder ?? '-'}${hasLim ? ' · CG limits' : ''}</span></summary>
      <div class="grid2">
        <div class="field"><div class="label"><div class="t">Name</div></div><input type="text" class="wide" data-k="name" value="${tk.name}"></div>
        <div class="field"><div class="label"><div class="t">Max mass</div></div><input type="number" data-k="maxMass" value="${tk.maxMass}"><span class="unit">lb</span></div>
        <div class="field"><div class="label"><div class="t">Fill order</div></div><input type="number" data-k="fillOrder" value="${tk.fillOrder ?? 1}"></div>
        <div class="field"><div class="label"><div class="t">Burn order</div></div><input type="number" data-k="burnOrder" value="${tk.burnOrder ?? 1}"></div>
      </div>
      ${ptTableHTML('Fuel-arm table (quantity → CG arm)', tk.table, 'table')}
      ${hasLim ? ptTableHTML('Forward fuel-CG limit (quantity → arm)', tk.fwdLimit, 'fwd') : ''}
      ${hasLim ? ptTableHTML('Aft fuel-CG limit (quantity → arm)', tk.aftLimit, 'aft') : ''}
      <div style="margin-top:12px">
        ${hasLim ? '<button class="btn small ghost" data-rmlim="1">Remove CG limits</button>' : '<button class="btn small" data-addlim="1">+ Add fuel-CG limits</button>'}
        <button class="btn small ghost" data-deltank="1" style="margin-left:8px;color:var(--red)">Delete tank</button>
      </div>`;
    det.querySelectorAll('input[data-k]').forEach((inp) => inp.oninput = () => { const k = inp.dataset.k; tk[k] = k === 'name' ? inp.value : Number(inp.value); save(); recompute(); });
    det.querySelectorAll('input[data-t]').forEach((inp) => inp.oninput = () => { tankArrFor(tk, inp.dataset.t)[+inp.dataset.i][+inp.dataset.f] = Number(inp.value); save(); recompute(); });
    det.querySelectorAll('[data-addrow]').forEach((b) => b.onclick = () => { const arr = tankArrFor(tk, b.dataset.addrow); const last = arr[arr.length - 1] || [0, 0]; arr.push([last[0] + 1000, last[1]]); renderTanks(); recompute(); save(); });
    det.querySelectorAll('[data-delrow]').forEach((b) => b.onclick = () => { tankArrFor(tk, b.dataset.delrow).splice(+b.dataset.i, 1); renderTanks(); recompute(); save(); });
    const addlim = det.querySelector('[data-addlim]');
    if (addlim) addlim.onclick = () => { tk.fwdLimit = [[0, -50], [tk.maxMass, -5]]; tk.aftLimit = [[0, 90], [tk.maxMass, 5]]; renderTanks(); recompute(); save(); };
    const rmlim = det.querySelector('[data-rmlim]');
    if (rmlim) rmlim.onclick = () => { delete tk.fwdLimit; delete tk.aftLimit; renderTanks(); recompute(); save(); };
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
function bindCfg(id, target, key) { el(id).oninput = (e) => { target()[key] = Number(e.target.value); dispatchChanged(); }; }

// ---- pending changes / history (sidebar) -----------------------------------
function renderHistory() {
  const card = el('pendingCard'); const h = histories[selected] || []; const dirty = isDirty();
  card.classList.toggle('hidden', !dirty);
  const edits = h.reduce((a, e) => a + e.changes.length, 0);
  el('pendingCount').innerHTML = dirty ? pill('warn', edits + ' edit' + (edits === 1 ? '' : 's')) : '';
  const list = el('historyList'); list.innerHTML = '';
  for (let i = h.length - 1; i >= 0; i--) {
    const entry = h[i];
    const row = div('hist-entry');
    const items = entry.changes.slice(0, 5).map(describeChange).join('');
    const more = entry.changes.length > 5 ? `<div class="he-c more">+${entry.changes.length - 5} more</div>` : '';
    const rev = `<button class="btn small ghost he-rev" data-i="${i}">Revert</button>`;
    row.innerHTML = `<div class="he-head"><span class="he-time">${new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>${rev}</div><div class="he-desc">${items}${more}</div>`;
    row.querySelector('[data-i]').onclick = () => { if (confirm('Revert this and all later changes?')) revertTo(i); };
    list.appendChild(row);
  }
}
function describeChange(c) {
  const p = prettyPath(c.path);
  if (c.kind === 'add') return `<div class="he-c">＋ ${p}</div>`;
  if (c.kind === 'remove') return `<div class="he-c">－ ${p}</div>`;
  if (c.kind === 'arr') return `<div class="he-c">~ ${p} updated</div>`;
  return `<div class="he-c">${p}: <b>${fmtChange(c.from)}</b> → <b>${fmtChange(c.to)}</b></div>`;
}
function prettyPath(path) {
  return path
    .replace(/^limits\./, 'Limit ').replace(/^index\./, 'Index ').replace(/^mac\./, 'MAC ')
    .replace(/^standardMasses\./, 'Std mass ').replace(/^stations\.crew/, 'Crew').replace(/^stations\.pantry/, 'Pantry')
    .replace(/^stations\.cargo/, 'Cargo').replace(/^envelopes\./, 'Env ').replace(/^tanks/, 'Tank').replace(/^cabinRows/, 'Row')
    .replace(/\.(\d+)\b/g, '[$1]').replace(/^name$/, 'Name').replace(/^sectionArmMode$/, 'Section arm mode');
}
function fmtChange(v) { return typeof v === 'number' ? (+v.toFixed(3)) : (v == null ? '—' : String(v)); }
el('saveDraft').onclick = () => commitDraft();
el('discardDraft').onclick = () => { if (confirm('Discard all pending changes and revert to the saved aircraft?')) discardDraft(); };

const ENV_CURVES = [['TOL', 'fwd', 'Takeoff/Landing — Forward'], ['TOL', 'aft', 'Takeoff/Landing — Aft'], ['FLT', 'fwd', 'In-flight — Forward'], ['FLT', 'aft', 'In-flight — Aft']];
function renderEnvEditors() {
  const host = el('envEditors'); host.innerHTML = '';
  for (const [phase, side, label] of ENV_CURVES) {
    const curve = aircraft.envelopes[phase][side];
    const det = document.createElement('details'); det.className = 'env-acc';
    const rows = curve.map((pt, i) =>
      `<tr><td><input type="number" data-i="${i}" data-f="0" value="${pt[0]}"></td><td><input type="number" step="0.1" data-i="${i}" data-f="1" value="${pt[1]}"></td><td><button class="btn small ghost" data-del="${i}">✕</button></td></tr>`).join('');
    det.innerHTML = `<summary>${label} <span style="color:var(--muted)">(${curve.length})</span></summary>
      <table class="vtable"><thead><tr><th>Mass (${massU()})</th><th>%MAC</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <button class="btn small" data-add="1">+ Add vertex</button>`;
    det.querySelectorAll('input').forEach((inp) => inp.oninput = () => { curve[+inp.dataset.i][+inp.dataset.f] = Number(inp.value); save(); recompute(); });
    det.querySelector('[data-add]').onclick = () => { const last = curve[curve.length - 1] || [26000, 25]; curve.push([last[0] + 1000, last[1]]); renderEnvEditors(); recompute(); save(); };
    det.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { curve.splice(+b.dataset.del, 1); renderEnvEditors(); recompute(); save(); });
    host.appendChild(det);
  }
}
function renderDispatch() { renderAircraft(); renderSeats(); renderTanks(); renderEnvelope(); }
el('xmlImport').onclick = () => {
  try { parseLegacyXml(el('xmlIn').value); save(); renderDispatch(); recompute(); el('xmlIn').value = ''; alert('Imported. Review the values.'); }
  catch (e) { alert('Could not parse: ' + e.message); }
};
el('resetDefault').onclick = () => {
  const tmpl = CATALOG.find((a) => a.id === aircraft.id);
  if (!tmpl) { alert('No catalog template for this aircraft.'); return; }
  if (!confirm('Reset this aircraft (config + load) to the bundled template? Discards customisations and pending changes.')) return;
  const idx = fleet.findIndex((a) => a.id === selected);
  fleet[idx] = clone(tmpl); drafts[selected] = clone(tmpl); aircraft = drafts[selected]; lastSnapshot = clone(aircraft); histories[selected] = [];
  state = loads[selected] = freshLoad(aircraft);
  save(); renderAll();
};
el('dupAircraft').onclick = () => {
  flushHistory();
  const copy = clone(aircraft);
  let id = aircraft.id + '-copy', n = 2; while (fleet.some((a) => a.id === id)) id = aircraft.id + '-copy' + n++;
  copy.id = id; copy.name = aircraft.name + ' (copy)';
  fleet.push(copy); drafts[id] = clone(copy); histories[id] = [];
  save(); switchAircraft(id);
};
el('delAircraft').onclick = () => {
  if (fleet.length <= 1) { alert('At least one aircraft is required.'); return; }
  if (!confirm('Delete ' + aircraft.name + ' from the fleet?')) return;
  fleet = fleet.filter((a) => a.id !== selected); delete drafts[selected]; delete histories[selected]; delete loads[selected];
  selected = fleet[0].id; ensureDraft(selected); aircraft = drafts[selected]; lastSnapshot = clone(aircraft);
  state = loads[selected] || (loads[selected] = freshLoad(aircraft));
  save(); renderAll();
};
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
function stepper(value, step, onChange, max) {
  const wrap = div('stepper');
  const minus = btn('−'), plus = btn('+');
  const inp = document.createElement('input'); inp.type = 'number'; inp.value = value;
  const fire = (v) => { v = Math.max(0, Math.round(v)); if (max != null) v = Math.min(v, max); inp.value = v; onChange(v); };
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
// Floating popup menu anchored to a button. options: [{label, value, active}].
let _popup = null;
function closePopup() { if (_popup) { _popup.remove(); _popup = null; } }
function popupMenu(anchor, options, onPick) {
  closePopup();
  const menu = div('popup-menu'); _popup = menu;
  for (const o of options) {
    const b = document.createElement('button');
    b.className = 'popup-item' + (o.active ? ' on' : '');
    b.textContent = o.label;
    b.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); closePopup(); onPick(o.value); };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = (r.bottom + 4) + 'px';
  setTimeout(() => document.addEventListener('mousedown', closePopup, { once: true }), 0);
}

function el(id) { return document.getElementById(id); }
function div(cls) { const d = document.createElement('div'); if (cls) d.className = cls; return d; }
function spanCls(cls, t) { const s = document.createElement('span'); s.className = cls; s.textContent = t; return s; }
function fmt(n) { return Math.round(n).toLocaleString(); }
function pill(kind, txt) { return `<span class="pill ${kind}">${txt}</span>`; }

renderAll();
