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

// Distribute a total fuel mass across tanks. Tanks fill in `fillOrder` and burn
// in `burnOrder`. Returns per-tank quantities and the combined {mass, moment, arm}.
export function distributeFuel(tanks, totalMass) {
  const byFill = [...tanks].sort((a, b) => (a.fillOrder ?? a.seq ?? 0) - (b.fillOrder ?? b.seq ?? 0));
  let remaining = Math.max(0, totalMass);
  const qty = {};
  for (const tk of byFill) {
    const put = Math.min(remaining, tk.maxMass);
    qty[tk.name] = put;
    remaining -= put;
  }
  let mass = 0;
  let moment = 0;
  for (const tk of tanks) {
    const q = qty[tk.name] || 0;
    mass += q;
    moment += q * tankArm(tk, q);
  }
  return { qty, mass, moment, arm: mass === 0 ? 0 : moment / mass };
}

// EASA fuel chain. Ramp = Taxi + Trip + Contingency + Alternate + FinalReserve + Extra.
// Returns the breakdown plus takeoff/landing fuel and a minimum-fuel check.
export function fuelChain(fuel) {
  const taxi = num(fuel.taxi);
  const trip = num(fuel.trip);
  const contingency = num(fuel.contingency);
  const alternate = num(fuel.alternate);
  const finalReserve = num(fuel.finalReserve);
  const extra = num(fuel.extra);
  const requiredRamp = taxi + trip + contingency + alternate + finalReserve + extra;
  const ramp = fuel.ramp != null ? num(fuel.ramp) : requiredRamp;
  const takeoff = ramp - taxi;
  const landing = takeoff - trip; // = contingency + alternate + finalReserve + extra
  return {
    ramp,
    taxi,
    trip,
    contingency,
    alternate,
    finalReserve,
    extra,
    takeoff,
    landing,
    requiredRamp,
    sufficient: ramp + 1e-6 >= requiredRamp,
  };
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

  // Fuel chain + fuel CG states.
  const fc = fuelChain(load.fuel || {});
  const tanks = aircraft.tanks || [];
  const takeoffFuel = tanks.length ? distributeFuel(tanks, fc.takeoff) : armlessFuel(fc.takeoff, aircraft);
  const landingFuel = tanks.length ? distributeFuel(tanks, fc.landing) : armlessFuel(fc.landing, aircraft);

  // Phase mass/CG points.
  const tom = combine(zfm, takeoffFuel);
  const ldm = combine(zfm, landingFuel);
  const ramp = combine(zfm, tanks.length ? distributeFuel(tanks, fc.ramp) : armlessFuel(fc.ramp, aircraft));

  const phases = {
    dom: describe(toPoint(dom), aircraft),
    zfm: describe(toPoint(zfm), aircraft),
    tom: describe(toPoint(tom), aircraft),
    ldm: describe(toPoint(ldm), aircraft),
    ramp: describe(toPoint(ramp), aircraft),
  };

  // Envelope verdicts: TOL governs ground/takeoff/landing, FLT governs in-flight.
  const envelope = {
    zfm: envelopeStatus(aircraft, 'FLT', phases.zfm.mass, phases.zfm.pctMac),
    tom: envelopeStatus(aircraft, 'TOL', phases.tom.mass, phases.tom.pctMac),
    ldm: envelopeStatus(aircraft, 'TOL', phases.ldm.mass, phases.ldm.pctMac),
  };

  // In-flight burn path: sample CG as fuel drains from TOM down to LDM.
  const burnPath = buildBurnPath(aircraft, zfm, tanks, fc);

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
    burnPath.every((p) => p.status.inside) &&
    fc.sufficient;

  return { phases, envelope, burnPath, limits, fuel: fc, ok: allOk };
}

function toPoint(block) {
  return { mass: block.mass, arm: block.mass === 0 ? 0 : block.moment / block.mass };
}

// Fallback when no tank tables exist: place fuel at the index reference station.
function armlessFuel(mass, aircraft) {
  const arm = aircraft.index.sta;
  return { mass, moment: mass * arm, arm };
}

function buildBurnPath(aircraft, zfm, tanks, fc) {
  const steps = 8;
  const path = [];
  for (let i = 0; i <= steps; i++) {
    const fuelMass = fc.takeoff - (i / steps) * (fc.takeoff - fc.landing);
    const fuel = tanks.length ? distributeFuel(tanks, fuelMass) : armlessFuel(fuelMass, aircraft);
    const pt = describe(toPoint(combine(zfm, fuel)), aircraft);
    path.push({ ...pt, status: envelopeStatus(aircraft, 'FLT', pt.mass, pt.pctMac) });
  }
  return path;
}

// limit check: value vs max. limit may be undefined (no check).
function check(value, max) {
  if (max == null) return { value, max: null, ok: null };
  return { value, max, ok: value <= max + 1e-6, margin: max - value };
}
