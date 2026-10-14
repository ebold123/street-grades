import assert from "node:assert/strict";
import test from "node:test";
import { densify, haversine } from "../pipeline/geo.js";
import { computeGrade, endpointValue, smooth, steepestGrade } from "../pipeline/grades.js";
import { computeFeatures, summarize } from "../pipeline/pipeline.js";
import { TerrainDem } from "../pipeline/dem.js";
import { fixtureElevation, fixtureFetchTile, fixtureWays } from "../pipeline/fixture.js";

// A DEM stub with a perfectly linear slope: `slopePct` rise per meter going north.
const planeDem = (slopePct, base = 50) => ({
  sample: (lng, lat) => base + (slopePct / 100) * (lat - 37.75) * 110540,
});

const northSouthChain = (meters, extra = {}) => ({
  id: 1,
  osm: 7,
  name: "Test St",
  highway: "residential",
  bridge: false,
  tunnel: false,
  coords: [
    [-122.4, 37.75],
    [-122.4, 37.75 + meters / 110540],
  ],
  ...extra,
});

test("haversine: one degree of latitude is about 111 km", () => {
  const d = haversine([0, 0], [0, 1]);
  assert.ok(Math.abs(d - 111195) < 100, `got ${d}`);
});

test("densify keeps endpoints and spacing <= step", () => {
  const { points, dists, length } = densify(
    [
      [-122.4, 37.75],
      [-122.4, 37.751],
      [-122.399, 37.751],
    ],
    10
  );
  assert.deepEqual(points[0], [-122.4, 37.75]);
  assert.ok(Math.abs(points.at(-1)[0] - -122.399) < 1e-12);
  for (let i = 1; i < dists.length; i++) assert.ok(dists[i] - dists[i - 1] <= 10 + 1e-9);
  assert.ok(Math.abs(dists.at(-1) - length) < 1e-9);
});

test("a 10% slope yields a 10% grade (no endpoint bias)", () => {
  for (const meters of [40, 100, 250]) {
    const g = computeGrade(northSouthChain(meters), planeDem(10));
    assert.ok(Math.abs(g.grade - 10) < 0.2, `${meters} m: got ${g.grade}`);
    assert.equal(g.uphill_dir, "N");
  }
});

test("grade_cat buckets by 5% steps and caps at 7", () => {
  // Use slopes away from the bucket boundaries so rounding can't flip them.
  assert.equal(computeGrade(northSouthChain(100), planeDem(2)).grade_cat, 0);
  assert.equal(computeGrade(northSouthChain(100), planeDem(12)).grade_cat, 2);
  assert.equal(computeGrade(northSouthChain(100), planeDem(33)).grade_cat, 6);
  assert.equal(computeGrade(northSouthChain(100), planeDem(60)).grade_cat, 7);
});

test("walking the other way flips the sign and uphill direction stays N", () => {
  const chain = northSouthChain(100);
  chain.coords.reverse();
  const g = computeGrade(chain, planeDem(10));
  assert.ok(Math.abs(g.grade + 10) < 0.2, `got ${g.grade}`);
  assert.equal(g.grade_abs, Math.abs(g.grade));
  assert.equal(g.uphill_dir, "N");
});

test("a flat street has no uphill direction", () => {
  const g = computeGrade(northSouthChain(100), planeDem(0));
  assert.equal(g.grade, 0);
  assert.equal(g.uphill_dir, "");
});

test("a single bad elevation sample is suppressed by smoothing", () => {
  // 100 m of flat road with one 15 m spike in the middle.
  const spiky = {
    sample: (lng, lat) => (Math.abs(lat - (37.75 + 50 / 110540)) < 2e-5 ? 65 : 50),
  };
  const g = computeGrade(northSouthChain(100), spiky);
  assert.ok(Math.abs(g.grade) < 1, `got ${g.grade}`);
  assert.ok(Math.abs(smooth([50, 50, 65, 50, 50])[2] - 50) < 1e-9);
});

test("short blocks are flagged", () => {
  const g = computeGrade(northSouthChain(12), planeDem(5));
  assert.equal(g.flag, "short");
});

test("absurd grades are flagged extreme", () => {
  const g = computeGrade(northSouthChain(60), planeDem(50));
  assert.equal(g.flag, "extreme");
});

test("missing elevation is flagged and does not throw", () => {
  const g = computeGrade(northSouthChain(60), { sample: () => NaN });
  assert.equal(g.flag, "no_elevation");
  assert.equal(g.grade, 0);
});

test("bridges interpolate between the ends instead of following the terrain below", () => {
  // Terrain dips 30 m under the middle of a bridge; the deck should ignore it.
  const valley = {
    sample: (lng, lat) => {
      const t = (lat - 37.75) * 110540; // meters north
      return 50 - 30 * Math.sin((Math.PI * t) / 100);
    },
  };
  const g = computeGrade(northSouthChain(100, { bridge: true }), valley);
  assert.equal(g.struct, "bridge");
  assert.ok(Math.abs(g.grade) < 0.5, `net ${g.grade}`);
  assert.ok(Math.abs(g.max_grade) < 0.5, `max ${g.max_grade}`);
});

test("steepestGrade finds a steep section hidden in a gentle block", () => {
  const dists = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const elev = [0, 0, 0, 0, 0, 0, 4, 8, 12, 12, 12]; // 20 m ramp at 40%
  const steep = steepestGrade(dists, elev, 20);
  assert.ok(steep > 35, `got ${steep}`);
});

test("endpointValue recovers the end of a line exactly", () => {
  const dists = [0, 10, 20, 30, 40];
  const values = dists.map((d) => 100 + 0.1 * d);
  assert.ok(Math.abs(endpointValue(dists, values, false) - 100) < 1e-9);
  assert.ok(Math.abs(endpointValue(dists, values, true) - 104) < 1e-9);
});

test("end to end on the synthetic city matches analytic grades", async () => {
  const dem = new TerrainDem({ zoom: 14, fetchTile: fixtureFetchTile });
  const { features } = await computeFeatures({ ways: fixtureWays(), dem });

  // 9 columns + 9 rows of streets, 8 blocks each; the footway is excluded.
  assert.equal(features.length, 2 * 9 * 8);

  let checked = 0;
  for (const f of features) {
    const p = f.properties;
    if (p.struct) continue; // bridge uses end-to-end interpolation; checked below
    const [a, b] = [f.geometry.coordinates[0], f.geometry.coordinates.at(-1)];
    const expected = (100 * (fixtureElevation(...b) - fixtureElevation(...a))) /
      haversine(a, b);
    assert.ok(
      Math.abs(p.grade - expected) < 1.0,
      `${p.name} ${a} -> ${b}: got ${p.grade}, expected ${expected.toFixed(2)}`
    );
    checked++;
  }
  assert.ok(checked > 100);

  // The bridge street (row 9) has deck elevation interpolated end to end.
  const bridges = features.filter((f) => f.properties.struct === "bridge");
  assert.ok(bridges.length > 0);

  // No invented properties on every feature.
  for (const f of features) {
    for (const key of ["grade", "grade_abs", "max_grade", "length_m", "grade_cat"]) {
      assert.ok(key in f.properties || f.properties.flag === "no_elevation", `missing ${key}`);
    }
  }

  const stats = summarize(features);
  assert.equal(stats.blocks, features.length);
  assert.ok(stats.steepest.length > 0);
});
