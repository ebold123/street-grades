// Orchestration: OSM ways + elevation -> GeoJSON features with grade properties.
// Kept free of file and network code so it can be tested directly.

import { buildChains } from "./blocks.js";
import { extent } from "./geo.js";
import { computeGrade } from "./grades.js";

const roundCoord = (n) => Math.round(n * 1e6) / 1e6;

/**
 * @param {object} opts
 * @param {object[]} opts.ways   Overpass `out geom` way elements.
 * @param {import("./dem.js").TerrainDem} opts.dem
 * @param {number} [opts.stepM]  Profile sampling interval in meters.
 * @param {(msg: string) => void} [opts.log]
 */
export async function computeFeatures({ ways, dem, stepM = 10, log = () => {} }) {
  const chains = buildChains(ways);
  if (chains.length === 0) throw new Error("No road segments found in the input ways.");
  log(`Built ${chains.length} blocks from ${ways.length} ways`);

  const area = extent(chains.map((c) => c.coords));
  const tileCount = await dem.prefetch(area, {
    onProgress: (done, total) => {
      if (done === total || done % 25 === 0) log(`Elevation tiles ${done}/${total}`);
    },
  });
  if (dem.missing > 0) log(`Warning: ${dem.missing} of ${tileCount} elevation tiles were missing`);

  const features = chains.map((chain) => ({
    type: "Feature",
    id: chain.id,
    properties: computeGrade(chain, dem, { stepM }),
    geometry: {
      type: "LineString",
      coordinates: chain.coords.map(([lng, lat]) => [roundCoord(lng), roundCoord(lat)]),
    },
  }));
  return { features, area };
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/** Summary stats for logging and for the viewer's metadata file. */
export function summarize(features) {
  const flags = { short: 0, extreme: 0, no_elevation: 0 };
  const usable = [];
  for (const { properties: p } of features) {
    if (p.flag) flags[p.flag]++;
    else usable.push(p);
  }
  const sorted = usable.map((p) => p.grade_abs).sort((a, b) => a - b);
  const steepest = [...usable]
    .sort((a, b) => b.grade_abs - a.grade_abs)
    .slice(0, 10)
    .map((p) => ({ name: p.name || "(unnamed)", osm: p.osm, grade: p.grade, length_m: p.length_m }));
  return {
    blocks: features.length,
    flagged: flags,
    medianGrade: sorted.length ? quantile(sorted, 0.5) : 0,
    p95Grade: sorted.length ? quantile(sorted, 0.95) : 0,
    steepest,
  };
}
