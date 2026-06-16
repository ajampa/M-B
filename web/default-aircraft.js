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
      "name": "Main",
      "maxMass": 9720,
      "fillOrder": 1,
      "burnOrder": 3,
      "table": [[0,473.5],[338,473.5],[675,475.8],[1013,477.6],[1350,479.0],[1688,480.3],[2025,481.5],[2363,482.6],[2700,483.7],[3038,484.8],[3375,486.0],[3713,487.2],[4050,488.3],[4388,489.5],[4725,490.6],[5063,491.7],[5400,492.8],[5738,493.8],[6075,494.9],[6413,495.9],[6750,496.9],[7088,497.8],[7425,498.8],[7763,499.8],[8100,500.8],[8438,501.8],[8775,502.9],[9113,504.1],[9450,505.4],[9720,506.6]]
    },
    {
      "name": "Aux",
      "maxMass": 7169,
      "fillOrder": 2,
      "burnOrder": 1,
      "table": [[0,456.0],[338,456.0],[675,458.0],[1013,460.0],[1350,460.7],[1688,461.1],[2025,461.1],[2363,459.3],[2700,457.9],[3038,457.7],[3375,457.5],[3713,457.2],[4050,456.8],[4388,456.4],[4725,455.9],[5063,455.3],[5400,454.7],[5738,454.0],[6075,453.3],[6224,452.9],[6413,452.5],[6750,451.7],[7088,450.8],[7169,450.6]]
    },
    {
      "name": "Tail",
      "maxMass": 3112,
      "fillOrder": 3,
      "burnOrder": 2,
      "table": [[0,745.5],[330,745.5],[675,755.3],[1013,761.0],[1350,764.5],[1688,766.7],[2025,768.3],[2363,769.5],[2700,770.7],[3038,771.5],[3112,771.7]]
    }
  ]
}
;
