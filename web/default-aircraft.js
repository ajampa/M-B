// Auto-mirrored from engine/sample-aircraft.json so the app opens from file:// with no server.
// Keep in sync with that file (the JSON is canonical for the Node tests).
export default {
  "id": "sample-jet",
  "name": "Sample Jet (from supplied data)",
  "_note": "Index, MAC and envelope curves are REAL supplied values. Stations, tanks, crew and limits marked _placeholder are stand-ins until AFM data is provided.",
  "units": { "mass": "lb", "arm": "in" },

  "index": { "sta": 514.0, "scale": 11000.0, "offset": 55.0 },
  "mac": { "lemac": 488.025, "maclen": 92.64 },

  "limits": {
    "_placeholder": true,
    "mrw": 48800,
    "mtom": 48300,
    "mzfm": 38000,
    "mlm": 44000
  },

  "envelopes": {
    "TOL": {
      "fwd": [[26000, 20.0], [38000, 20.0], [39500, 16.0], [48300, 29.0]],
      "aft": [[26000, 32.5], [28000, 34.0], [30000, 34.0], [32000, 35.0], [38000, 35.0], [43000, 38.0], [48300, 38.0]]
    },
    "FLT": {
      "fwd": [[26000, 20.0], [38000, 20.0], [39500, 16.0], [44750, 16.0], [48300, 21.0]],
      "aft": [[26000, 35.0], [38000, 35.0], [43000, 38.0], [48300, 38.0]]
    }
  },
  "cgLimits": { "min": 0, "max": 100 },

  "basic": { "_placeholder": true, "mass": 27000, "arm": 511.0, "label": "Basic Mass / Basic Arm (from weighing)" },

  "stations": {
    "crew": [
      { "id": "cpt", "label": "Captain", "arm": 330.0 },
      { "id": "fo", "label": "First Officer", "arm": 330.0 }
    ],
    "pantry": [
      { "id": "pantryA", "label": "Pantry A (fwd galley)", "mass": 250, "arm": 360.0 },
      { "id": "pantryB", "label": "Pantry B (aft galley)", "mass": 180, "arm": 600.0 }
    ],
    "pax": [
      { "id": "1L", "label": "Row 1 L", "arm": 455.0 },
      { "id": "1R", "label": "Row 1 R", "arm": 455.0 },
      { "id": "2L", "label": "Row 2 L", "arm": 490.0 },
      { "id": "2R", "label": "Row 2 R", "arm": 490.0 },
      { "id": "3L", "label": "Row 3 L", "arm": 525.0 },
      { "id": "3R", "label": "Row 3 R", "arm": 525.0 },
      { "id": "4L", "label": "Row 4 L", "arm": 560.0 },
      { "id": "4R", "label": "Row 4 R", "arm": 560.0 }
    ],
    "cargo": [
      { "id": "fwdHold", "label": "Forward Hold", "arm": 250.0, "maxMass": 1500 },
      { "id": "aftHold", "label": "Aft Hold", "arm": 660.0, "maxMass": 1500 }
    ]
  },

  "standardMasses": {
    "_note": "EASA standard masses (lb-equivalents are placeholders).",
    "adultMale": 200,
    "adultFemale": 165,
    "child": 75,
    "infant": 22
  },

  "tanks": [
    {
      "name": "Wing (L+R)",
      "_placeholder": true,
      "maxMass": 9000,
      "fillOrder": 1,
      "burnOrder": 2,
      "table": [[0, 514.0], [2000, 516.0], [4500, 518.0], [9000, 519.5]]
    },
    {
      "name": "Center",
      "_placeholder": true,
      "maxMass": 3000,
      "fillOrder": 2,
      "burnOrder": 1,
      "table": [[0, 508.0], [1500, 509.0], [3000, 510.0]]
    }
  ]
}
;
