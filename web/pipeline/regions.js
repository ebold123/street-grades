// Named regions. Bounding boxes are [west, south, east, north] in degrees.
// These mirror the WHERE table in street-grades/find_intersections.py, with the
// min/max corners normalized (the Python table has some swapped corners).

export const REGIONS = {
  sf: {
    name: "San Francisco",
    bbox: [-122.537718, 37.708052, -122.341117, 37.806875],
  },
  kirkland: {
    name: "Kirkland",
    bbox: [-122.2575, 47.674, -122.1444, 47.7654],
  },
  sfpeninsula: {
    name: "SF Peninsula",
    bbox: [-122.47, 37.2, -121.95, 37.5],
  },
};

/** Parse "west,south,east,north" into a normalized bbox array. */
export function parseBbox(text) {
  const parts = text.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid --bbox "${text}". Expected west,south,east,north`);
  }
  const [a, b, c, d] = parts;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}
