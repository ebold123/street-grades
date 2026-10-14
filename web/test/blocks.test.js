import assert from "node:assert/strict";
import test from "node:test";
import { buildChains, isRoad } from "../pipeline/blocks.js";

// helper: a way along a list of [id, lng, lat]
const way = (id, tags, pts) => ({
  type: "way",
  id,
  tags: { highway: "residential", ...tags },
  nodes: pts.map((p) => p[0]),
  geometry: pts.map((p) => ({ lon: p[1], lat: p[2] })),
});

test("isRoad drops footways, steps, paths and parking aisles", () => {
  assert.equal(isRoad({ highway: "residential" }), true);
  assert.equal(isRoad({ highway: "footway" }), false);
  assert.equal(isRoad({ highway: "steps" }), false);
  assert.equal(isRoad({ highway: "path" }), false);
  assert.equal(isRoad({ highway: "service", service: "parking_aisle" }), false);
  assert.equal(isRoad({ highway: "motorway" }), false);
});

test("shape vertices inside a way do not split a block", () => {
  const chains = buildChains([
    way(1, { name: "Main St" }, [
      [1, 0, 0],
      [2, 0.0005, 0],
      [3, 0.001, 0],
      [4, 0.0015, 0],
    ]),
  ]);
  assert.equal(chains.length, 1);
  assert.equal(chains[0].coords.length, 4);
});

test("a crossing street splits a way at the intersection", () => {
  const chains = buildChains([
    way(1, { name: "Main St" }, [
      [1, 0, 0],
      [2, 0.001, 0],
      [3, 0.002, 0],
    ]),
    way(2, { name: "Cross St" }, [
      [4, 0.001, -0.001],
      [2, 0.001, 0],
      [5, 0.001, 0.001],
    ]),
  ]);
  // 2 blocks of Main St + 2 blocks of Cross St
  assert.equal(chains.length, 4);
  assert.equal(chains.filter((c) => c.name === "Main St").length, 2);
});

test("two ways with the same name join across a degree-2 node", () => {
  const chains = buildChains([
    way(1, { name: "Main St" }, [
      [1, 0, 0],
      [2, 0.001, 0],
    ]),
    way(2, { name: "Main St" }, [
      [2, 0.001, 0],
      [3, 0.002, 0],
    ]),
  ]);
  assert.equal(chains.length, 1);
  assert.equal(chains[0].coords.length, 3);
});

test("a name change breaks the chain", () => {
  const chains = buildChains([
    way(1, { name: "Main St" }, [
      [1, 0, 0],
      [2, 0.001, 0],
    ]),
    way(2, { name: "Other Ave" }, [
      [2, 0.001, 0],
      [3, 0.002, 0],
    ]),
  ]);
  assert.equal(chains.length, 2);
});

test("a bridge section is its own chain and is flagged", () => {
  const chains = buildChains([
    way(1, { name: "Span Rd" }, [
      [1, 0, 0],
      [2, 0.001, 0],
    ]),
    way(2, { name: "Span Rd", bridge: "yes" }, [
      [2, 0.001, 0],
      [3, 0.002, 0],
    ]),
  ]);
  assert.equal(chains.length, 2);
  assert.deepEqual(
    chains.map((c) => c.bridge).sort(),
    [false, true]
  );
});

test("a closed loop with no junctions still becomes a chain", () => {
  const chains = buildChains([
    way(1, { name: "Ring Rd" }, [
      [1, 0, 0],
      [2, 0.001, 0],
      [3, 0.001, 0.001],
      [4, 0, 0.001],
      [1, 0, 0],
    ]),
  ]);
  assert.equal(chains.length, 1);
  assert.equal(chains[0].coords.length, 5);
});

test("non-road ways and malformed ways are ignored", () => {
  const chains = buildChains([
    way(1, { highway: "footway", name: "Trail" }, [
      [1, 0, 0],
      [2, 0.001, 0],
    ]),
    { type: "way", id: 2, tags: { highway: "residential" }, nodes: [1, 2], geometry: [] },
  ]);
  assert.equal(chains.length, 0);
});
