# Data Dictionary & Formulas

This prototype proves the Mass & Balance maths, the envelope visualization, and a
clean configuration UI — with **no backend**. Data is the bundled sample aircraft,
editable in the **Configure Aircraft** tab and persisted to `localStorage`.

## Core formulas

| Quantity | Formula |
|---|---|
| % MAC | `(Arm − LEMAC) / MACLEN × 100` |
| Arm from %MAC | `LEMAC + %MAC/100 × MACLEN` |
| Index | `Mass × (Arm − STA) / SCALE + OFFSET` |
| CG arm | `Σ(massᵢ × armᵢ) / Σ massᵢ` |
| DOM | Basic Mass + crew + pantry + removable equipment |
| ZFM | DOM + passengers + cargo  (≤ MZFM) |
| Takeoff fuel | Ramp − Taxi |
| TOM | ZFM + Takeoff fuel  (≤ MTOM) |
| LDM | TOM − Trip fuel  (≤ MLM) |
| Ramp/Taxi mass | ZFM + Ramp fuel  (≤ MRW) |

## Fuel chain (EASA)

`Ramp = Taxi + Trip + Contingency + Alternate + Final reserve + Extra`
`Landing fuel = Takeoff − Trip = Contingency + Alternate + Final reserve + Extra`

The engine flags when **Ramp < minimum required**. FAA terminology will map onto the
same structure via a regulation profile in a later phase.

## Aircraft config (`engine/sample-aircraft.json`)

| Field | Meaning | Source |
|---|---|---|
| `index.sta/scale/offset` | Index reference station, divisor, constant | **supplied** |
| `mac.lemac/maclen` | Leading-edge MAC station, MAC length | **supplied** |
| `envelopes.{TOL,FLT}.{fwd,aft}` | CG limit curves as `[mass, %MAC]` vertices | **supplied** |
| `limits.{mrw,mtom,mzfm,mlm}` | Structural mass limits | _placeholder_ |
| `basic.{mass,arm}` | Basic Mass / Basic Arm from weighing | _placeholder_ |
| `stations.{crew,pantry,pax,cargo}` | Load points with arms | _placeholder_ |
| `tanks[]` | Fuel tanks with `[qty, arm]` moment tables + burn order | _placeholder_ |
| `standardMasses` | Passenger standard masses | _placeholder_ |

**Supplied** values are real; **placeholder** values are stand-ins until AFM data
(weighing report, fuel moment tables, station arms, structural limits) is provided.

## Envelope handling

- Each phase envelope is a closed polygon: forward curve (left/forward edge) + aft
  curve (right/aft edge), each a single-valued function of mass.
- A load point is **inside** when, at its mass, its %MAC is ≥ the forward limit and
  ≤ the aft limit. The engine also returns the **margin** to each limit.
- `TOL` (takeoff/landing) governs TOM and LDM; `FLT` (in-flight) governs ZFM and the
  sampled fuel-burn path from TOM down to LDM.

## Legacy XML import

The Configure tab accepts the original tag format to bootstrap a new aircraft:

```
<INDEX STA="514.000" SCALE="11000.000" OFFSET="55.000"/>
<MAC LEMAC="488.025" MACLEN="92.64"/>
<FWDCGFLT>(26000,20.0)(38000,20.0)...</FWDCGFLT>
<AFTCGFLT>...</AFTCGFLT>
<FWDCGTOL>...</FWDCGTOL>
<AFTCGTOL>...</AFTCGTOL>
```
