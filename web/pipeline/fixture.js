// A synthetic city for tests and offline demos: an 9x9 street grid draped over
// a Gaussian hill, plus a tile "server" that serves Terrarium PNGs generated
// from the same hill function. No network access is needed, and the true grade
// of every block is known, so the pipeline can be checked end to end.

import { encodeTerrarium, pixelToLngLat, TILE_SIZE } from "./dem.js";

export const CENTER = { lng: -122.44, lat: 37.755 };
const METERS_PER_DEG_LAT = 110540;
const METERS_PER_DEG_LNG = 111320 * Math.cos((CENTER.lat * Math.PI) / 180);

const BLOCK_M = 100;
const GRID = 9; // 9 x 9 intersections
const HILL_HEIGHT_M = 120;
const HILL_RADIUS_M = 250;
const BASE_ELEVATION_M = 40;

/** Local east/north offsets in meters from the fixture center. */
export function toLocalMeters(lng, lat) {
  return {
    east: (lng - CENTER.lng) * METERS_PER_DEG_LNG,
    north: (lat - CENTER.lat) * METERS_PER_DEG_LAT,
  };
}

/** The true terrain: a smooth hill centered on CENTER. */
export function fixtureElevation(lng, lat) {
  const { east, north } = toLocalMeters(lng, lat);
  const r2 = east * east + north * north;
  return BASE_ELEVATION_M + HILL_HEIGHT_M * Math.exp(-r2 / (HILL_RADIUS_M * HILL_RADIUS_M));
}

const lngAt = (east) => CENTER.lng + east / METERS_PER_DEG_LNG;
const latAt = (north) => CENTER.lat + north / METERS_PER_DEG_LAT;

export const FIXTURE_BBOX = [
  lngAt(-(GRID / 2) * BLOCK_M),
  latAt(-(GRID / 2) * BLOCK_M),
  lngAt((GRID / 2) * BLOCK_M),
  latAt((GRID / 2) * BLOCK_M),
];

/** Overpass-style way elements: GRID east-west and GRID north-south streets. */
export function fixtureWays() {
  const half = (GRID - 1) / 2;
  const nodeId = (i, j) => 1 + i * 100 + j; // intersection ids
  let midId = 100000; // mid-block shape vertices, unique per way
  const ways = [];
  let wayId = 1;

  const makeWay = (name, points, extraTags = {}) => {
    const nodes = [];
    const geometry = [];
    points.forEach((p, k) => {
      nodes.push(p.id);
      geometry.push({ lat: latAt(p.north), lon: lngAt(p.east) });
      const next = points[k + 1];
      if (next) {
        // collinear shape vertex halfway along the block
        nodes.push(midId++);
        geometry.push({
          lat: latAt((p.north + next.north) / 2),
          lon: lngAt((p.east + next.east) / 2),
        });
      }
    });
    ways.push({
      type: "way",
      id: wayId++,
      tags: { highway: "residential", name, ...extraTags },
      nodes,
      geometry,
    });
  };

  for (let j = 0; j < GRID; j++) {
    // east-west street at row j
    const row = [];
    for (let i = 0; i < GRID; i++) {
      row.push({ id: nodeId(i, j), east: (i - half) * BLOCK_M, north: (j - half) * BLOCK_M });
    }
    // Make one street a bridge so the structure path is exercised.
    makeWay(`${j + 1}st Avenue`, row, j === GRID - 1 ? { bridge: "yes" } : {});
  }
  for (let i = 0; i < GRID; i++) {
    // north-south street at column i
    const col = [];
    for (let j = 0; j < GRID; j++) {
      col.push({ id: nodeId(i, j), east: (i - half) * BLOCK_M, north: (j - half) * BLOCK_M });
    }
    makeWay(`${String.fromCharCode(65 + i)} Street`, col);
  }

  // Things the filter must drop.
  ways.push({
    type: "way",
    id: wayId++,
    tags: { highway: "footway", name: "Not A Road" },
    nodes: [900001, 900002],
    geometry: [
      { lat: latAt(0), lon: lngAt(0) },
      { lat: latAt(20), lon: lngAt(20) },
    ],
  });
  return ways;
}

/** Terrarium tile source backed by `fixtureElevation`. Matches fetchTile's contract. */
export async function fixtureFetchTile({ z, x, y }) {
  const elevations = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      // sample at the pixel center, matching how TerrainDem interprets pixels
      const { lng, lat } = pixelToLngLat(x * TILE_SIZE + px + 0.5, y * TILE_SIZE + py + 0.5, z);
      elevations[py * TILE_SIZE + px] = fixtureElevation(lng, lat);
    }
  }
  return encodeTerrarium(elevations);
}
