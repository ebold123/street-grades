import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeTerrarium,
  encodeTerrarium,
  lngLatToPixel,
  pixelToLngLat,
  TerrainDem,
  tilesForBbox,
  TILE_SIZE,
} from "../pipeline/dem.js";
import { CENTER, fixtureElevation, fixtureFetchTile } from "../pipeline/fixture.js";

test("Terrarium encode/decode round-trips to within 1/256 m", () => {
  const input = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0; i < input.length; i++) input[i] = -50 + (i % 997) * 0.37;
  const output = decodeTerrarium(encodeTerrarium(input));
  for (let i = 0; i < input.length; i += 331) {
    assert.ok(Math.abs(output[i] - input[i]) <= 1 / 256 + 1e-6, `index ${i}`);
  }
});

test("lngLatToPixel and pixelToLngLat are inverses", () => {
  for (const z of [10, 14]) {
    const { x, y } = lngLatToPixel(CENTER.lng, CENTER.lat, z);
    const back = pixelToLngLat(x, y, z);
    assert.ok(Math.abs(back.lng - CENTER.lng) < 1e-9);
    assert.ok(Math.abs(back.lat - CENTER.lat) < 1e-9);
  }
});

test("known tile: San Francisco at zoom 10 is tile 163/395", () => {
  const { x, y } = lngLatToPixel(-122.4194, 37.7749, 10);
  assert.equal(Math.floor(x / TILE_SIZE), 163);
  assert.equal(Math.floor(y / TILE_SIZE), 395);
});

test("tilesForBbox covers a box spanning a tile edge", () => {
  const tiles = tilesForBbox([-122.5, 37.7, -122.3, 37.8], 12);
  assert.ok(tiles.length > 1);
  assert.ok(tiles.every((t) => t.z === 12));
});

test("sampling a synthetic hill matches the true elevation", async () => {
  const dem = new TerrainDem({ zoom: 14, fetchTile: fixtureFetchTile });
  const d = 0.004; // ~400 m around the hill center, crossing tile edges
  await dem.prefetch([CENTER.lng - d, CENTER.lat - d, CENTER.lng + d, CENTER.lat + d]);
  let worst = 0;
  for (let i = -8; i <= 8; i++) {
    for (let j = -8; j <= 8; j++) {
      const lng = CENTER.lng + (i * d) / 8.3;
      const lat = CENTER.lat + (j * d) / 8.3;
      worst = Math.max(worst, Math.abs(dem.sample(lng, lat) - fixtureElevation(lng, lat)));
    }
  }
  assert.ok(worst < 0.1, `worst error ${worst} m`);
});

test("missing tiles yield NaN and are counted", async () => {
  const dem = new TerrainDem({ zoom: 14, fetchTile: async () => null });
  await dem.prefetch([CENTER.lng, CENTER.lat, CENTER.lng + 0.001, CENTER.lat + 0.001]);
  assert.ok(Number.isNaN(dem.sample(CENTER.lng, CENTER.lat)));
  assert.ok(dem.missing > 0);
});

test("prefetch refuses regions that need too many tiles", async () => {
  const dem = new TerrainDem({ zoom: 14, maxTiles: 10, fetchTile: fixtureFetchTile });
  await assert.rejects(dem.prefetch([-123, 37, -122, 38]), /limit 10/);
});
