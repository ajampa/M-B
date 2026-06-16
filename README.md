# M&B — Aircraft Mass & Balance Calculator

Mass & Balance tool for commercial aircraft. **End goal:** a native SwiftUI iPad app
for pilots (offline) + a web editor for admins, synced via Supabase, supporting EASA
& FAA across a multi-type fleet.

**This stage is a local, no-backend prototype** that proves the three hard parts before
any infrastructure is built:

1. A correct, detailed M&B **calculation engine** (DOM → ZFM → TOM → LDM → Ramp, index
   & %MAC, fuel chain, fuel-burn CG travel).
2. A **CG envelope visualization** that shows where the aircraft sits at all times.
3. A **clean configuration UI** that replaces the legacy XML data entry.

It is built from a real supplied aircraft (index system, MAC, four CG envelope curves).

## Run it

**Engine tests (in this repo, no install):**
```bash
npm test            # or: node test/engine.test.mjs
node test/render-svg.mjs envelope-preview.svg   # render the envelope to SVG
```

**The app:** open `web/index.html` in a browser (iPad Safari works). No build, no server
required — aircraft data is mirrored into `web/default-aircraft.js` and your edits persist
to `localStorage`. To serve it instead: `python3 -m http.server -d web` then open `:8000`.

- **Pilot / Load** tab: section-by-section entry (basic mass, crew, pantry, seat-map
  passengers, cargo, fuel) with a live loadsheet + envelope chart.
- **Configure Aircraft** tab: edit the index system, MAC, structural limits and envelope
  vertices with a live preview; or paste the legacy XML to bootstrap.

## Layout

```
engine/   massbalance.mjs (pure engine, ports to Swift) + sample-aircraft.json
test/     engine.test.mjs (golden vectors) + vectors.json + render-svg.mjs
web/      index.html, app.js, chart.js, styles.css, default-aircraft.js
docs/     data-dictionary.md (fields + formulas)
```

See `docs/data-dictionary.md` for formulas and which values are real vs placeholder, and
the project plan for the path to the SwiftUI app + Supabase backend.
