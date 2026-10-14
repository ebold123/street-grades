import assert from "node:assert/strict";
import test from "node:test";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { LEGEND_TICKS, MAX_STOP, okFilter, STOPS, streetLayers } from "../src/layers.js";

const sourceFor = (vector) =>
  vector
    ? { type: "vector", tiles: ["https://example.com/{z}/{x}/{y}.pbf"] }
    : { type: "geojson", data: { type: "FeatureCollection", features: [] } };

const styleFor = (vector, state) => ({
  version: 8,
  sources: { streets: sourceFor(vector) },
  layers: streetLayers({ vector, state }),
});

test("layers and filters are valid per the MapLibre style spec in every UI state", () => {
  for (const vector of [false, true]) {
    for (const metric of ["grade_abs", "max_grade_abs"]) {
      for (const showFlagged of [true, false]) {
        for (const minGrade of [0, 10, 25]) {
          const state = { metric, minGrade, showFlagged };
          const errors = validateStyleMin(styleFor(vector, state));
          assert.deepEqual(
            errors.map((e) => e.message),
            [],
            `vector=${vector} ${JSON.stringify(state)}`
          );
        }
      }
    }
  }
});

test("vector layers name the tippecanoe layer; geojson layers do not", () => {
  const state = { metric: "grade_abs", minGrade: 0, showFlagged: true };
  assert.ok(streetLayers({ vector: true, state }).every((l) => l["source-layer"] === "streets"));
  assert.ok(streetLayers({ vector: false, state }).every((l) => !("source-layer" in l)));
});

test("color stops are ascending and the legend maximum matches the last stop", () => {
  const values = STOPS.map(([v]) => v);
  assert.deepEqual(values, [...values].sort((a, b) => a - b));
  assert.equal(MAX_STOP, values.at(-1));
});

test("legend ticks stay within the ramp and far enough apart not to overlap", () => {
  assert.equal(LEGEND_TICKS[0], 0);
  assert.equal(LEGEND_TICKS.at(-1), MAX_STOP);
  for (let i = 1; i < LEGEND_TICKS.length; i++) {
    // A 268 px ramp gives 8.9 px per percentage point; labels are about 30 px wide,
    // so 4 points (36 px) is the minimum gap that keeps them apart.
    assert.ok(LEGEND_TICKS[i] - LEGEND_TICKS[i - 1] >= 4, `ticks ${i - 1} and ${i}`);
  }
});

test("the unflagged filter excludes flagged blocks and applies the threshold", () => {
  const filter = okFilter({ metric: "max_grade_abs", minGrade: 8, showFlagged: true });
  const text = JSON.stringify(filter);
  assert.ok(text.includes('"has","flag"'));
  assert.ok(text.includes("max_grade_abs"));
  assert.ok(text.includes(">="));
  assert.ok(text.includes("8"));
});
