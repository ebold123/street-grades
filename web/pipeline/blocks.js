// Turn OSM ways into "blocks": chains of segments that run between real
// intersections. OSM ways are often split at arbitrary points and carry many
// shape vertices; blocks are closer to what a cyclist or runner thinks of as
// "that stretch of street".
//
// Algorithm: split every way into 2-node segments, build a node graph, then
// walk chains of segments. A node ends a chain (a "break") when it is a dead
// end, a junction of 3+ segments, or the street changes name/class/structure.

/** highway values we keep by default. Mirrors the Python version, which dropped
 * paths, footways, steps and parking aisles. Motorways are excluded because
 * they aren't open to cyclists or runners. */
export const DEFAULT_HIGHWAYS = [
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "cycleway",
  "trunk_link",
  "primary_link",
  "secondary_link",
  "tertiary_link",
];

export function isRoad(tags = {}, highways = DEFAULT_HIGHWAYS) {
  if (!highways.includes(tags.highway)) return false;
  if (tags.service === "parking_aisle") return false;
  return true;
}

const isStructure = (value) => Boolean(value) && value !== "no";

/** Two segments belong to the same street if their keys match. */
function segmentKey(seg) {
  const structure = `${seg.bridge ? "b" : ""}${seg.tunnel ? "t" : ""}`;
  return seg.name ? `n:${seg.name}|${structure}` : `h:${seg.highway}|${structure}`;
}

/**
 * Build chains from Overpass `out geom` way elements.
 * Each way needs `nodes` (ids) and `geometry` ([{lat, lon}]) of equal length.
 *
 * @returns {Array<{id:number, coords:number[][], name:string, highway:string,
 *   bridge:boolean, tunnel:boolean, osm:number, fromNode:number, toNode:number}>}
 */
export function buildChains(ways, { highways = DEFAULT_HIGHWAYS } = {}) {
  const segments = [];
  const nodeCoord = new Map();
  const incident = new Map(); // nodeId -> segment indexes

  const touch = (node, segIndex) => {
    let list = incident.get(node);
    if (!list) incident.set(node, (list = []));
    list.push(segIndex);
  };

  for (const way of ways) {
    const tags = way.tags || {};
    if (!isRoad(tags, highways)) continue;
    const { nodes, geometry } = way;
    if (!nodes || !geometry || nodes.length !== geometry.length) continue;
    const props = {
      osm: way.id,
      name: tags.name || "",
      highway: tags.highway,
      bridge: isStructure(tags.bridge),
      tunnel: isStructure(tags.tunnel),
    };
    for (let i = 0; i < nodes.length; i++) {
      nodeCoord.set(nodes[i], [geometry[i].lon, geometry[i].lat]);
    }
    for (let i = 0; i < nodes.length - 1; i++) {
      if (nodes[i] === nodes[i + 1]) continue;
      const index = segments.length;
      segments.push({ a: nodes[i], b: nodes[i + 1], ...props, visited: false });
      touch(nodes[i], index);
      touch(nodes[i + 1], index);
    }
  }

  const isBreak = (node) => {
    const list = incident.get(node);
    if (list.length !== 2) return true;
    return segmentKey(segments[list[0]]) !== segmentKey(segments[list[1]]);
  };

  const chains = [];

  const walk = (startNode, firstIndex) => {
    const coords = [nodeCoord.get(startNode)];
    const first = segments[firstIndex];
    let node = startNode;
    let index = firstIndex;
    const used = [];
    for (;;) {
      const seg = segments[index];
      seg.visited = true;
      used.push(seg);
      node = seg.a === node ? seg.b : seg.a;
      coords.push(nodeCoord.get(node));
      if (isBreak(node)) break;
      const next = incident.get(node).find((i) => !segments[i].visited);
      if (next === undefined) break; // closed loop returned to its start
      index = next;
    }
    chains.push({
      id: chains.length,
      coords,
      name: first.name,
      highway: first.highway,
      bridge: used.some((s) => s.bridge),
      tunnel: used.some((s) => s.tunnel),
      osm: first.osm,
      fromNode: startNode,
      toNode: node,
    });
  };

  // Chains that start at a break node.
  for (const [node, list] of incident) {
    if (!isBreak(node)) continue;
    for (const index of list) {
      if (!segments[index].visited) walk(node, index);
    }
  }
  // Whatever is left are pure loops with no break node (e.g. a cul-de-sac ring).
  for (let i = 0; i < segments.length; i++) {
    if (!segments[i].visited) walk(segments[i].a, i);
  }

  return chains;
}
