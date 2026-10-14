// Fetch road geometry for a bounding box from the Overpass API.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_HIGHWAYS } from "./blocks.js";

export const DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";

// Overpass sheds load with these. Anything else in the 4xx range means our query is wrong,
// so retrying would only repeat the mistake.
const RETRY_STATUS = new Set([429, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Overpass QL for all matching ways in [west, south, east, north]. */
export function buildQuery([west, south, east, north], { highways = DEFAULT_HIGHWAYS, timeout = 300 } = {}) {
  const filter = `^(${highways.join("|")})$`;
  return (
    `[out:json][timeout:${timeout}];` +
    `way["highway"~"${filter}"]["service"!="parking_aisle"](${south},${west},${north},${east});` +
    "out geom;"
  );
}

/** One request. Throws an error with `retryable` set when trying again might help. */
async function requestOnce(endpoint, query, timeoutMs) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "street-grades (github.com/ebold123/street-grades)",
    },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const error = new Error(`Overpass returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    error.retryable = RETRY_STATUS.has(res.status);
    throw error;
  }
  const json = await res.json();
  if (!Array.isArray(json.elements)) throw new Error("Overpass response had no elements");
  // A timed-out or out-of-memory query still answers 200, with a remark and partial data.
  if (json.remark && /error|timed out|out of memory/i.test(json.remark)) {
    throw new Error(`Overpass reported: ${json.remark}`);
  }
  return json;
}

/**
 * Return the Overpass `elements` array (ways with geometry). Results are cached to
 * `cacheFile` so reruns don't hit the API. Busy-server responses, timeouts and network
 * errors are retried with a growing delay, because shared CI machines often get throttled.
 */
export async function fetchWays(
  bbox,
  {
    cacheFile,
    endpoint = process.env.OVERPASS_URL || DEFAULT_ENDPOINT,
    highways,
    attempts = 4,
    retryDelayMs = 10_000,
    timeoutMs = 6 * 60 * 1000,
    log = () => {},
  } = {}
) {
  if (cacheFile) {
    try {
      return JSON.parse(await readFile(cacheFile, "utf8")).elements;
    } catch {
      // not cached yet
    }
  }

  const query = buildQuery(bbox, { highways });
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const json = await requestOnce(endpoint, query, timeoutMs);
      if (cacheFile) {
        await mkdir(path.dirname(cacheFile), { recursive: true });
        await writeFile(cacheFile, JSON.stringify(json));
      }
      return json.elements;
    } catch (error) {
      lastError = error;
      if (error.retryable === false || attempt === attempts) break;
      const wait = retryDelayMs * attempt;
      log(`Overpass attempt ${attempt}/${attempts} failed (${error.message}); retrying in ${Math.round(wait / 1000)} s`);
      await sleep(wait);
    }
  }
  throw lastError;
}
