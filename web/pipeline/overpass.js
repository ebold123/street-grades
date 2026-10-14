// Fetch road geometry for a bounding box from the Overpass API.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_HIGHWAYS } from "./blocks.js";

export const DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";

/** Overpass QL for all matching ways in [west, south, east, north]. */
export function buildQuery([west, south, east, north], { highways = DEFAULT_HIGHWAYS, timeout = 300 } = {}) {
  const filter = `^(${highways.join("|")})$`;
  return (
    `[out:json][timeout:${timeout}];` +
    `way["highway"~"${filter}"]["service"!="parking_aisle"](${south},${west},${north},${east});` +
    "out geom;"
  );
}

/**
 * Return the Overpass `elements` array (ways with geometry). Results are cached
 * to `cacheFile` so reruns don't hit the API.
 */
export async function fetchWays(bbox, { cacheFile, endpoint = process.env.OVERPASS_URL || DEFAULT_ENDPOINT, highways } = {}) {
  if (cacheFile) {
    try {
      return JSON.parse(await readFile(cacheFile, "utf8")).elements;
    } catch {
      // not cached yet
    }
  }
  const query = buildQuery(bbox, { highways });
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "street-grades (github.com/ebold123/street-grades)",
    },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(6 * 60 * 1000),
  });
  if (!res.ok) {
    throw new Error(`Overpass returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = await res.json();
  if (!Array.isArray(json.elements)) throw new Error("Overpass response had no elements");
  if (json.remark && /error|timed out|out of memory/i.test(json.remark)) {
    throw new Error(`Overpass reported: ${json.remark}`);
  }
  if (cacheFile) {
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify(json));
  }
  return json.elements;
}
