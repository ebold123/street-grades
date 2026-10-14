// Small geometry helpers. Coordinates are [lng, lat] pairs (GeoJSON order).

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/** Great-circle distance in meters between two lng/lat points. */
export function haversine([lng1, lat1], [lng2, lat2]) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Cumulative distance (meters) at each vertex of a polyline. */
export function cumulativeDistances(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  }
  return cum;
}

/**
 * Resample a polyline into evenly spaced points, spacing <= stepM.
 * Always includes both endpoints. Returns { points, dists, length }.
 */
export function densify(coords, stepM = 10) {
  const cum = cumulativeDistances(coords);
  const length = cum[cum.length - 1];
  if (coords.length < 2 || length === 0) {
    return { points: [coords[0]], dists: [0], length: 0 };
  }
  const n = Math.max(1, Math.ceil(length / stepM));
  const points = [];
  const dists = [];
  let seg = 0;
  for (let k = 0; k <= n; k++) {
    const d = (k / n) * length;
    while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
    const segLen = cum[seg + 1] - cum[seg];
    const t = segLen > 0 ? (d - cum[seg]) / segLen : 0;
    const [x0, y0] = coords[seg];
    const [x1, y1] = coords[seg + 1];
    points.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    dists.push(d);
  }
  return { points, dists, length };
}

/** Initial compass bearing in degrees [0, 360) from a to b. */
export function bearing([lng1, lat1], [lng2, lat2]) {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Bearing in degrees -> 8-point compass label. */
export function compass(deg) {
  return COMPASS[Math.round(deg / 45) % 8];
}

/** Bounding box [west, south, east, north] of a list of [lng, lat] points. */
export function extent(coordLists) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const coords of coordLists) {
    for (const [lng, lat] of coords) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return [west, south, east, north];
}
