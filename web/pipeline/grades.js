// Grade metrics for a block, computed from a sampled elevation profile.
//
// The Python version used only the two endpoint elevations. Here we sample
// along the whole block, smooth the profile, and report several numbers so one
// noisy pixel at an endpoint can't dominate a short block.

import { bearing, compass, densify } from "./geo.js";

export const SHORT_BLOCK_M = 20;
export const EXTREME_GRADE = 35;
const WINDOW_M = 20;

const round = (value, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

function median3(values) {
  return values.map((v, i) => {
    const w = [values[Math.max(0, i - 1)], v, values[Math.min(values.length - 1, i + 1)]];
    return w.sort((a, b) => a - b)[1];
  });
}

function mean3(values) {
  return values.map((v, i) => {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(values.length - 1, i + 1);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += values[k];
    return sum / (hi - lo + 1);
  });
}

/** Median-then-mean smoothing; leaves profiles of <3 samples unchanged. */
export function smooth(values) {
  if (values.length < 3) return values.slice();
  return mean3(median3(values));
}

/**
 * Estimate the elevation exactly at one end of a profile from a least-squares
 * line through the nearest ~fitM meters (at least 3 samples when available).
 * Plain moving averages shrink their window at the ends, which pulls the end
 * values inward and biases the net grade low; a linear fit does not.
 */
export function endpointValue(dists, values, atEnd, fitM = 20) {
  const n = dists.length;
  const origin = atEnd ? dists[n - 1] : dists[0];
  const picked = [];
  for (let k = 0; k < n; k++) {
    const i = atEnd ? n - 1 - k : k;
    if (picked.length >= 3 && Math.abs(dists[i] - origin) > fitM) break;
    picked.push(i);
  }
  let sx = 0;
  let sy = 0;
  for (const i of picked) {
    sx += dists[i] - origin;
    sy += values[i];
  }
  const mx = sx / picked.length;
  const my = sy / picked.length;
  let sxx = 0;
  let sxy = 0;
  for (const i of picked) {
    const dx = dists[i] - origin - mx;
    sxx += dx * dx;
    sxy += dx * (values[i] - my);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return my - slope * mx; // value of the fitted line at the endpoint
}

/**
 * Steepest signed grade (%) over any stretch at least `windowM` long. Falls back
 * to the whole profile when the block is shorter than the window.
 */
export function steepestGrade(dists, elev, windowM = WINDOW_M) {
  const n = dists.length;
  const total = dists[n - 1] - dists[0];
  if (n < 2 || total <= 0) return 0;
  if (total <= windowM) return (100 * (elev[n - 1] - elev[0])) / total;
  let best = 0;
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (j <= i) j = i + 1;
    while (j < n - 1 && dists[j] - dists[i] < windowM) j++;
    if (dists[j] - dists[i] < windowM) break;
    const g = (100 * (elev[j] - elev[i])) / (dists[j] - dists[i]);
    if (Math.abs(g) > Math.abs(best)) best = g;
  }
  return best;
}

/**
 * Compute grade properties for one chain.
 * `dem.sample(lng, lat)` returns meters (or NaN when no data).
 * Grade sign is relative to the chain's drawn direction (first -> last point).
 */
export function computeGrade(chain, dem, { stepM = 10 } = {}) {
  const { points, dists, length } = densify(chain.coords, stepM);
  const raw = points.map(([lng, lat]) => dem.sample(lng, lat));
  const props = {
    id: chain.id,
    osm: chain.osm,
    name: chain.name,
    highway: chain.highway,
    length_m: round(length, 1),
  };
  if (chain.bridge) props.struct = "bridge";
  else if (chain.tunnel) props.struct = "tunnel";

  if (length === 0 || raw.length < 2 || raw.some((v) => !Number.isFinite(v))) {
    return { ...props, grade: 0, grade_abs: 0, grade_cat: 0, flag: "no_elevation" };
  }

  // Bridges and tunnels: the terrain model describes the ground below, not the
  // deck, so interpolate straight between the two ends.
  let profile;
  if (props.struct && length >= 2 * stepM) {
    const z0 = raw[0];
    const z1 = raw[raw.length - 1];
    profile = dists.map((d) => z0 + ((z1 - z0) * d) / length);
  } else {
    profile = smooth(raw);
    profile[0] = endpointValue(dists, raw, false);
    profile[profile.length - 1] = endpointValue(dists, raw, true);
  }

  const zStart = profile[0];
  const zEnd = profile[profile.length - 1];
  const net = (100 * (zEnd - zStart)) / length;
  const steep = steepestGrade(dists, profile);

  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < profile.length; i++) {
    const dz = profile[i] - profile[i - 1];
    if (dz > 0) ascent += dz;
    else descent -= dz;
  }

  const travelUphill = net >= 0 ? 0 : 1;
  const a = chain.coords[travelUphill ? chain.coords.length - 1 : 0];
  const b = chain.coords[travelUphill ? 0 : chain.coords.length - 1];

  let flag = "";
  if (length < SHORT_BLOCK_M) flag = "short";
  else if (Math.abs(net) > EXTREME_GRADE) flag = "extreme";

  const out = {
    ...props,
    grade: round(net),
    grade_abs: round(Math.abs(net)),
    max_grade: round(steep),
    max_grade_abs: round(Math.abs(steep)),
    grade_cat: Math.min(7, Math.floor(Math.abs(net) / 5)),
    z_start: round(zStart),
    z_end: round(zEnd),
    ascent_m: round(ascent),
    descent_m: round(descent),
    uphill_dir: Math.abs(net) < 0.5 ? "" : compass(bearing(a, b)),
  };
  if (flag) out.flag = flag;
  return out;
}
