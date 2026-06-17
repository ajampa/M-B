// Mass & Balance calculation engine.
//
// Pure, framework-free functions. No DOM, no I/O. This module is the single
// source of truth for the maths and is written so it ports cleanly to Swift
// (MassBalanceKit) later. The web UI and the Node test runner both import it.
//
// Coordinate convention for the CG envelope: x = %MAC, y = mass.
// Envelope limit curves are single-valued functions of mass: for any mass the
// forward curve gives one %MAC and the aft curve gives one %MAC. That lets us
// check "inside" by interpolating both limits at the point's mass and also
// report the margin to each limit (which raw point-in-polygon cannot).

// ---------------------------------------------------------------------------
// Coordinate conversions
// ---------------------------------------------------------------------------

// %MAC = (Arm - LEMAC) / MACLEN * 100
export function armToPctMac(arm, mac) {
  return ((arm - mac.lemac) / mac.maclen) * 100;
}

// Arm = LEMAC + %MAC/100 * MACLEN
export function pctMacToArm(pctMac, mac) {
  return mac.lemac + (pctMac / 100) * mac.maclen;
}

// Index = Mass * (Arm - STA) / SCALE + OFFSET
export function armToIndex(mass, arm, index) {
  return (mass * (arm - index.sta)) / index.scale + index.offset;
}

// Arm = STA + (Index - OFFSET) * SCALE / Mass
export function indexToArm(mass, indexValue, index) {
  if (mass === 0) return index.sta;
  return index.sta + ((indexValue - index.offset) * index.scale) / mass;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

// items: [{ mass, arm }] -> { mass, moment, arm }
export function aggregate(items) {
  let mass = 0;
  let moment = 0;
  for (const it of items) {
    const m = Number(it.mass) || 0;
    mass += m;
    moment += m * Number(it.arm);
  }
  return { mass, moment, arm: mass === 0 ? 0 : moment / mass };
}

// Combine two aggregate-style {mass, moment} blocks.
function combine(a, b) {
  const mass = a.mass + b.mass;
  const moment = a.moment + b.moment;
  return { mass, moment, arm: mass === 0 ? 0 : moment / mass };
}

// Attach %MAC and index to a {mass, arm} point.
function describe(point, aircraft) {
  return {
    mass: point.mass,
    arm: point.arm,
    pctMac: armToPctMac(point.arm, aircraft.mac),
    index: armToIndex(point.mass, point.arm, aircraft.index),
  };
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

// Linear interpolation of a curve [[mass, pctMac], ...] (sorted by mass) at a
// query mass. Returns null when the mass is outside the charted range.
export function interpCurve(curve, mass) {
  const pts = [...curve].sort((p, q) => p[0] - q[0]);
  if (mass < pts[0][0] || mass > pts[pts.length - 1][0]) return null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [m0, v0] = pts[i];
    const [m1, v1] = pts[i + 1];
    if (mass >= m0 && mass <= m1) {
      if (m1 === m0) return v0;
      const t = (mass - m0) / (m1 - m0);
      return v0 + t * (v1 - v0);
    }
  }
  return pts[pts.length - 1][1];
}

// Status of a (mass, %MAC) point against one phase envelope ('TOL' | 'FLT').
export function envelopeStatus(aircraft, phaseKey, mass, pctMac) {
  const env = aircraft.envelopes[phaseKey];
  const fwdLimit = interpCurve(env.fwd, mass);
  const aftLimit = interpCurve(env.aft, mass);
  if (fwdLimit === null || aftLimit === null) {
    return { inside: false, massInRange: false, fwdLimit, aftLimit, marginFwd: null, marginAft: null };
  }
  const marginFwd = pctMac - fwdLimit; // >=0 means aft of the forward limit (good)
  const marginAft = aftLimit - pctMac; // >=0 means forward of the aft limit (good)
  return {
    inside: marginFwd >= 0 && marginAft >= 0,
    massInRange: true,
    fwdLimit,
    aftLimit,
    marginFwd,
    marginAft,
  };
}

// Like interpCurve but clamps to the end values instead of returning null when
// the query is outside the charted range. Used for fuel-CG-limit schedules.
export function interpClamp(curve, x) {
  const pts = [...curve].sort((p, q) => p[0] - q[0]);
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, v0] = pts[i];
    const [x1, v1] = pts[i + 1];
    if (x >= x0 && x <= x1) return x1 === x0 ? v0 : v0 + ((x - x0) / (x1 - x0)) * (v1 - v0);
  }
  return pts[pts.length - 1][1];
}

// Check each tank's fuel CG against its FWD/AFT tank-CG-limit schedule (arm vs
// quantity). Tanks without limits are skipped. Returns the per-tank detail and
// whether all limited tanks are inside.
export function tankLimitCheck(tanks, qtyMap) {
  let checked = false;
  let inside = true;
  const detail = [];
  for (const tk of tanks) {
    if (!tk.fwdLimit || !tk.aftLimit) continue;
    checked = true;
    const qty = qtyMap[tk.name] || 0;
    const arm = tankArm(tk, qty);
    const fwd = interpClamp(tk.fwdLimit, qty);
    const aft = interpClamp(tk.aftLimit, qty);
    const ok = arm >= fwd - 1e-6 && arm <= aft + 1e-6;
    if (!ok) inside = false;
    detail.push({ name: tk.name, qty, arm, fwd, aft, inside: ok });
  }
  return { checked, inside, tanks: detail };
}

// Combined fuel CG if every limited tank sat at its FORWARD limit, and at its
// AFT limit, for a given per-tank quantity state. Tanks without limits use
// their actual arm. Returns null when no tank carries limits. Used to draw the
// allowable fuel-CG corridor inside the main CG envelope.
export function fuelLimitArms(tanks, qtyMap) {
  let mass = 0, fwdMoment = 0, aftMoment = 0, any = false;
  for (const tk of tanks) {
    const q = qtyMap[tk.name] || 0;
    mass += q;
    if (tk.fwdLimit && tk.aftLimit) {
      any = true;
      fwdMoment += q * interpClamp(tk.fwdLimit, q);
      aftMoment += q * interpClamp(tk.aftLimit, q);
    } else {
      const a = tankArm(tk, q);
      fwdMoment += q * a;
      aftMoment += q * a;
    }
  }
  if (!any) return null;
  return { mass, fwdArm: mass ? fwdMoment / mass : 0, aftArm: mass ? aftMoment / mass : 0 };
}

// Build a closed polygon ring [[pctMac, mass], ...] for drawing an envelope.
export function envelopePolygon(env) {
  const fwd = [...env.fwd].sort((a, b) => a[0] - b[0]); // mass ascending
  const aft = [...env.aft].sort((a, b) => b[0] - a[0]); // mass descending
  const ring = [];
  for (const [mass, pct] of fwd) ring.push([pct, mass]);
  for (const [mass, pct] of aft) ring.push([pct, mass]);
  return ring; // caller closes by linking last->first
}

// ---------------------------------------------------------------------------
// Fuel
// ---------------------------------------------------------------------------

// Interpolate a tank's arm at a given quantity from its AFM moment/arm table
// [[qty, arm], ...]. Fuel CG moves non-linearly with quantity, hence a table.
export function tankArm(tank, qty) {
  const t = [...tank.table].sort((a, b) => a[0] - b[0]);
  if (qty <= t[0][0]) return t[0][1];
  if (qty >= t[t.length - 1][0]) return t[t.length - 1][1];
  for (let i = 0; i < t.length - 1; i++) {
    const [q0, a0] = t[i];
    const [q1, a1] = t[i + 1];
    if (qty >= q0 && qty <= q1) {
      const f = (qty - q0) / (q1 - q0);
      return a0 + f * (a1 - a0);
    }
  }
  return t[t.length - 1][1];
}

// Fill a total fuel mass into tanks by `fillOrder` (lowest first). Returns the
// per-tank quantity map.
export function fillTanks(tanks, totalMass) {
  const byFill = [...tanks].sort((a, b) => (a.fillOrder ?? a.seq ?? 0) - (b.fillOrder ?? b.seq ?? 0));
  let remaining = Math.max(0, totalMass);
  const qty = {};
  for (const tk of byFill) {
    const put = Math.min(remaining, tk.maxMass);
    qty[tk.name] = put;
    remaining -= put;
  }
  return qty;
}

// Burn `burnAmount` out of an existing per-tank state in `burnOrder` (lowest
// first), so a tank empties before the next one is touched. Returns a new map.
export function burnTanks(tanks, startQty, burnAmount) {
  const qty = { ...startQty };
  const byBurn = [...tanks].sort((a, b) => (a.burnOrder ?? a.seq ?? 0) - (b.burnOrder ?? b.seq ?? 0));
  let remaining = Math.max(0, burnAmount);
  for (const tk of byBurn) {
    const take = Math.min(remaining, qty[tk.name] || 0);
    qty[tk.name] = (qty[tk.name] || 0) - take;
    remaining -= take;
  }
  return qty;
}

// Combined mass/moment/arm of a per-tank quantity state, using each tank's
// non-linear fuel-arm table.
export function tankStateMoment(tanks, qty) {
  let mass = 0;
  let moment = 0;
  for (const tk of tanks) {
    const q = qty[tk.name] || 0;
    mass += q;
    moment += q * tankArm(tk, q);
  }
  return { qty, mass, moment, arm: mass === 0 ? 0 : moment / mass };
}

// Fill a total fuel mass and return its {qty, mass, moment, arm} in one step.
export function distributeFuel(tanks, totalMass) {
  return tankStateMoment(tanks, fillTanks(tanks, totalMass));
}

// Fuel chain (simplified): the dispatcher enters Ramp (block), Taxi and Trip.
//   Takeoff = Ramp − Taxi      Landing = Takeoff − Trip
// `minReserve` (sum of tank minimum reserves) is the floor for landing fuel.
export function fuelChain(fuel, minReserve = 0) {
  const ramp = num(fuel.ramp);
  const taxi = num(fuel.taxi);
  const trip = num(fuel.trip);
  const takeoff = ramp - taxi;
  const landing = takeoff - trip;
  return { ramp, taxi, trip, takeoff, landing, minReserve, sufficient: landing + 1e-6 >= minReserve };
}

function num(v) {
  return Number(v) || 0;
}

// ---------------------------------------------------------------------------
// Full loadsheet
// ---------------------------------------------------------------------------

// load: {
//   basicMass, basicArm,
//   crew:[{mass,arm}], pantry:[{mass,arm}], equip:[{mass,arm}],
//   pax:[{mass,arm}], cargo:[{mass,arm}],
//   fuel:{ ramp, taxi, trip, contingency, alternate, finalReserve, extra }
// }
export function computeLoadsheet(aircraft, load) {
  const L = aircraft.limits || {};

  // Dry Operating Mass: basic + crew + pantry + removable equipment.
  const basic = { mass: num(load.basicMass), moment: num(load.basicMass) * num(load.basicArm) };
  const crew = aggregate(load.crew || []);
  const pantry = aggregate(load.pantry || []);
  const equip = aggregate(load.equip || []);
  const dom = [basic, crew, pantry, equip].reduce(combine, { mass: 0, moment: 0 });

  // Payload + Zero Fuel Mass.
  const pax = aggregate(load.pax || []);
  const cargo = aggregate(load.cargo || []);
  const zfm = [dom, pax, cargo].reduce(combine, { mass: 0, moment: 0 });

  // Fuel chain + fuel CG states. Tanks are FILLED by fillOrder; the in-flight
  // state is the takeoff fill BURNED by burnOrder, so landing CG reflects the
  // real drain sequence and each tank's fuel-arm table.
  const tanks = aircraft.tanks || [];
  const hasTanks = tanks.length > 0;
  const minReserve = tanks.reduce((a, t) => a + (t.minReserve || 0), 0);
  const fc = fuelChain(load.fuel || {}, minReserve);
  const takeoffQty = hasTanks ? fillTanks(tanks, fc.takeoff) : null;
  const landingQty = hasTanks ? burnTanks(tanks, takeoffQty, fc.takeoff - fc.landing) : null;
  const takeoffFuel = hasTanks ? tankStateMoment(tanks, takeoffQty) : armlessFuel(fc.takeoff, aircraft);
  const landingFuel = hasTanks ? tankStateMoment(tanks, landingQty) : armlessFuel(fc.landing, aircraft);

  // Phase mass/CG points.
  const tom = combine(zfm, takeoffFuel);
  const ldm = combine(zfm, landingFuel);
  const ramp = combine(zfm, hasTanks ? distributeFuel(tanks, fc.ramp) : armlessFuel(fc.ramp, aircraft));

  const phases = {
    basic: describe(toPoint(basic), aircraft),
    dom: describe(toPoint(dom), aircraft),
    zfm: describe(toPoint(zfm), aircraft),
    tom: describe(toPoint(tom), aircraft),
    ldm: describe(toPoint(ldm), aircraft),
    ramp: describe(toPoint(ramp), aircraft),
  };

  // Component breakdown (for the detailed loadsheet).
  const breakdown = {
    crew: crew.mass, pantry: pantry.mass, equip: equip.mass,
    pax: pax.mass, cargo: cargo.mass, payload: pax.mass + cargo.mass,
  };

  // Envelope verdicts: TOL governs ground/takeoff/landing, FLT governs in-flight.
  const envelope = {
    zfm: envelopeStatus(aircraft, 'FLT', phases.zfm.mass, phases.zfm.pctMac),
    tom: envelopeStatus(aircraft, 'TOL', phases.tom.mass, phases.tom.pctMac),
    ldm: envelopeStatus(aircraft, 'TOL', phases.ldm.mass, phases.ldm.pctMac),
    ramp: envelopeStatus(aircraft, 'TOL', phases.ramp.mass, phases.ramp.pctMac),
  };

  // In-flight burn path (TOM -> LDM, the operational range) for the envelope
  // verdict, plus a full fuel line (TOM -> ZFM, fuel down to zero) for drawing
  // so the CG line connects all the way to the zero-fuel point.
  const burnPath = buildFuelLine(aircraft, zfm, tanks, fc, fc.takeoff - fc.landing, 24);
  const fuelLine = buildFuelLine(aircraft, zfm, tanks, fc, fc.takeoff, 40);

  // Fuel-CG (tank schedule) limit checks at takeoff and landing fuel states.
  const fuelLimits = {
    takeoff: hasTanks ? tankLimitCheck(tanks, takeoffQty) : { checked: false, inside: true, tanks: [] },
    landing: hasTanks ? tankLimitCheck(tanks, landingQty) : { checked: false, inside: true, tanks: [] },
  };

  // Structural limit checks.
  const limits = {
    mzfm: check(phases.zfm.mass, L.mzfm),
    mtom: check(phases.tom.mass, L.mtom),
    mlm: check(phases.ldm.mass, L.mlm),
    mrw: check(phases.ramp.mass, L.mrw),
  };

  const allOk =
    Object.values(limits).every((c) => c.ok !== false) &&
    Object.values(envelope).every((e) => e.inside) &&
    burnPath.every((p) => p.status.inside && p.limit.inside) &&
    fc.sufficient;

  return { phases, breakdown, envelope, burnPath, fuelLine, fuelLimits, limits, fuel: fc, ok: allOk };
}

function toPoint(block) {
  return { mass: block.mass, arm: block.mass === 0 ? 0 : block.moment / block.mass };
}

// Fallback when no tank tables exist: place fuel at the index reference station.
function armlessFuel(mass, aircraft) {
  const arm = aircraft.index.sta;
  return { mass, moment: mass * arm, arm };
}

// Sample the CG as takeoff fuel is consumed in burn order. Burns from 0 up to
// `burnMax` (e.g. trip fuel for the operational path, or all takeoff fuel to
// reach the zero-fuel point). Each sample uses the real per-tank remaining
// quantity, fuel-arm table, envelope verdict and tank-CG-limit verdict.
function buildFuelLine(aircraft, zfm, tanks, fc, burnMax, steps) {
  const hasTanks = tanks.length > 0;
  const takeoffQty = hasTanks ? fillTanks(tanks, fc.takeoff) : null;
  const path = [];
  for (let i = 0; i <= steps; i++) {
    const burned = (i / steps) * burnMax;
    const qty = hasTanks ? burnTanks(tanks, takeoffQty, burned) : null;
    const fuel = hasTanks ? tankStateMoment(tanks, qty) : armlessFuel(fc.takeoff - burned, aircraft);
    const pt = describe(toPoint(combine(zfm, fuel)), aircraft);
    const sample = {
      ...pt,
      fuelRemaining: fc.takeoff - burned,
      fuelArm: fuel.arm,
      status: envelopeStatus(aircraft, 'FLT', pt.mass, pt.pctMac),
      limit: hasTanks ? tankLimitCheck(tanks, qty) : { checked: false, inside: true, tanks: [] },
    };
    // Allowable fuel-CG corridor: total CG if fuel sat at its fwd / aft limit.
    const lim = hasTanks ? fuelLimitArms(tanks, qty) : null;
    if (lim) {
      const fwdPt = describe(toPoint(combine(zfm, { mass: lim.mass, moment: lim.mass * lim.fwdArm })), aircraft);
      const aftPt = describe(toPoint(combine(zfm, { mass: lim.mass, moment: lim.mass * lim.aftArm })), aircraft);
      sample.fwd = { mass: fwdPt.mass, pctMac: fwdPt.pctMac };
      sample.aft = { mass: aftPt.mass, pctMac: aftPt.pctMac };
    }
    path.push(sample);
  }
  return path;
}

// limit check: value vs max. limit may be undefined (no check).
function check(value, max) {
  if (max == null) return { value, max: null, ok: null };
  return { value, max, ok: value <= max + 1e-6, margin: max - value };
}
