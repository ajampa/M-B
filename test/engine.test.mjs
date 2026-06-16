// Zero-dependency test runner: `node test/engine.test.mjs`
// Validates the engine against the hand-checked golden vectors.

import { readFile } from 'node:fs/promises';
import {
  armToPctMac,
  pctMacToArm,
  armToIndex,
  interpCurve,
  envelopeStatus,
  computeLoadsheet,
} from '../engine/massbalance.mjs';

const aircraft = JSON.parse(await readFile(new URL('./fixture-aircraft.json', import.meta.url)));
const V = JSON.parse(await readFile(new URL('./vectors.json', import.meta.url)));

let pass = 0;
let fail = 0;
const TOL = 1e-3;

function near(a, b, tol = TOL) {
  return Math.abs(a - b) <= tol;
}
function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}  ${detail}`);
  }
}

console.log('Conversions');
for (const c of V.conversions) {
  if (c.expectPctMac != null) {
    const got = armToPctMac(c.arm, aircraft.mac);
    ok(c.what, near(got, c.expectPctMac, 1e-4), `got ${got}`);
  }
  if (c.expectArm != null) {
    const got = pctMacToArm(c.pctMac, aircraft.mac);
    ok(c.what, near(got, c.expectArm, 1e-3), `got ${got}`);
  }
  if (c.expectIndex != null) {
    const got = armToIndex(c.mass, c.arm, aircraft.index);
    ok(c.what, near(got, c.expectIndex, 1e-4), `got ${got}`);
  }
}

console.log('Envelope curve interpolation');
for (const t of V.interp) {
  const got = interpCurve(aircraft.envelopes[t.phase][t.curve], t.mass);
  ok(t.what, got !== null && near(got, t.expect, 1e-6), `got ${got}`);
}

console.log('Envelope point checks');
for (const e of V.envelope) {
  const st = envelopeStatus(aircraft, e.phase, e.mass, e.pctMac);
  ok(e.what, st.inside === e.expectInside, `inside=${st.inside}`);
}

console.log('Integration loadsheet');
{
  const r = computeLoadsheet(aircraft, V.integration.load);
  const ex = V.integration.expect;
  ok('zfm mass', near(r.phases.zfm.mass, ex.zfm.mass, 1), `got ${r.phases.zfm.mass}`);
  ok('zfm %MAC', near(r.phases.zfm.pctMac, ex.zfm.pctMac, 0.05), `got ${r.phases.zfm.pctMac.toFixed(4)}`);
  ok('tom mass', near(r.phases.tom.mass, ex.tom.mass, 1), `got ${r.phases.tom.mass}`);
  ok('tom %MAC', near(r.phases.tom.pctMac, ex.tom.pctMac, 0.05), `got ${r.phases.tom.pctMac.toFixed(4)}`);
  ok('ldm mass', near(r.phases.ldm.mass, ex.ldm.mass, 1), `got ${r.phases.ldm.mass}`);
  ok('ldm %MAC', near(r.phases.ldm.pctMac, ex.ldm.pctMac, 0.05), `got ${r.phases.ldm.pctMac.toFixed(4)}`);
  ok('ramp mass', near(r.phases.ramp.mass, ex.ramp.mass, 1), `got ${r.phases.ramp.mass}`);
  ok('fuel ramp', near(r.fuel.ramp, ex.fuel.ramp, 1), `got ${r.fuel.ramp}`);
  ok('fuel takeoff', near(r.fuel.takeoff, ex.fuel.takeoff, 1), `got ${r.fuel.takeoff}`);
  ok('fuel landing', near(r.fuel.landing, ex.fuel.landing, 1), `got ${r.fuel.landing}`);
  ok('fuel sufficient', r.fuel.sufficient === ex.fuel.sufficient);
  const allInside = r.envelope.zfm.inside && r.envelope.tom.inside && r.envelope.ldm.inside;
  ok('all phases inside envelope', allInside === ex.allInside, `got ${allInside}`);
  ok('overall ok', r.ok === ex.ok, `got ${r.ok}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
