// Map layer definitions, kept free of DOM and MapLibre imports so they can be
// validated against the style spec in tests.

// Grade (%) -> color. Shared by the map expression and the legend.
export const STOPS = [
  [0, "#2a9d8f"],
  [3, "#8ac46f"],
  [6, "#e9c46a"],
  [10, "#f4a261"],
  [15, "#e76f51"],
  [20, "#b5179e"],
  [30, "#3a0ca3"],
];
export const MAX_STOP = STOPS[STOPS.length - 1][0];
// Legend labels. Fewer than STOPS: the 0% and 3% labels would overlap on a narrow ramp.
export const LEGEND_TICKS = [0, 6, 10, 15, 20, 30];
export const FLAGGED_COLOR = "#7a7f87";

export const SOURCE_ID = "streets";

/** Line color driven by a numeric grade property. */
export function colorExpression(property) {
  return ["interpolate", ["linear"], ["get", property], ...STOPS.flat()];
}

/** state: { metric: "grade_abs" | "max_grade_abs", minGrade: number, showFlagged: boolean } */
export function okFilter(state) {
  return [
    "all",
    ["!", ["has", "flag"]],
    [">=", ["to-number", ["get", state.metric], 0], state.minGrade],
  ];
}

export function flaggedFilter(state) {
  return ["all", ["has", "flag"], ["==", ["literal", state.showFlagged], true]];
}

/**
 * The three line layers: a dark casing so light colors read on a light basemap,
 * the colored grade line, and a dashed gray line for unreliable blocks.
 * `vector` selects a vector-tile source (PMTiles) over GeoJSON.
 */
export function streetLayers({ vector, state }) {
  const sourceLayer = vector ? { "source-layer": "streets" } : {};
  const width = ["interpolate", ["exponential", 1.5], ["zoom"], 11, 0.6, 14, 2.2, 17, 7];
  const casingWidth = ["interpolate", ["exponential", 1.5], ["zoom"], 11, 1.4, 14, 3.6, 17, 10];
  const round = { "line-cap": "round", "line-join": "round" };
  return [
    {
      id: "streets-casing",
      type: "line",
      source: SOURCE_ID,
      ...sourceLayer,
      layout: round,
      filter: okFilter(state),
      paint: { "line-color": "#1f2328", "line-opacity": 0.3, "line-width": casingWidth },
    },
    {
      id: "streets-ok",
      type: "line",
      source: SOURCE_ID,
      ...sourceLayer,
      layout: round,
      filter: okFilter(state),
      paint: { "line-color": colorExpression(state.metric), "line-width": width },
    },
    {
      id: "streets-flagged",
      type: "line",
      source: SOURCE_ID,
      ...sourceLayer,
      layout: { "line-join": "round" },
      filter: flaggedFilter(state),
      paint: { "line-color": FLAGGED_COLOR, "line-width": width, "line-dasharray": [2, 1.5] },
    },
  ];
}
