// Elevation sampling from "Terrarium" PNG terrain tiles (the format served by
// the AWS Open Data Terrain Tiles dataset).
//
// Terrarium encodes elevation in RGB: meters = (R * 256 + G + B / 256) - 32768.
// Tiles are standard 256px web-mercator XYZ tiles. We fetch every tile covering
// the area up front, then sample synchronously with bilinear interpolation.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";

export const TILE_SIZE = 256;
export const DEFAULT_TILE_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

/** Decode a Terrarium PNG buffer into a Float32Array of meters (256*256). */
export function decodeTerrarium(buffer) {
  const png = PNG.sync.read(buffer);
  if (png.width !== TILE_SIZE || png.height !== TILE_SIZE) {
    throw new Error(`Unexpected tile size ${png.width}x${png.height}`);
  }
  const out = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0; i < out.length; i++) {
    const r = png.data[i * 4];
    const g = png.data[i * 4 + 1];
    const b = png.data[i * 4 + 2];
    out[i] = r * 256 + g + b / 256 - 32768;
  }
  return out;
}

/** Encode meters into a Terrarium PNG buffer. Used by tests and fixtures. */
export function encodeTerrarium(elevations) {
  const png = new PNG({ width: TILE_SIZE, height: TILE_SIZE });
  for (let i = 0; i < elevations.length; i++) {
    const v = Math.min(65535.99, Math.max(0, elevations[i] + 32768));
    const whole = Math.floor(v);
    png.data[i * 4] = Math.floor(whole / 256);
    png.data[i * 4 + 1] = whole % 256;
    png.data[i * 4 + 2] = Math.floor((v - whole) * 256);
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

/** lng/lat -> global pixel coordinates (float) at zoom z. */
export function lngLatToPixel(lng, lat, z) {
  const scale = TILE_SIZE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  const x = ((lng + 180) / 360) * scale;
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/** Global pixel coordinates at zoom z -> lng/lat. */
export function pixelToLngLat(x, y, z) {
  const scale = TILE_SIZE * 2 ** z;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  return { lng, lat };
}

/** All tile coordinates covering a [west, south, east, north] bbox. */
export function tilesForBbox([west, south, east, north], z) {
  const nw = lngLatToPixel(west, north, z);
  const se = lngLatToPixel(east, south, z);
  const max = 2 ** z - 1;
  const x0 = Math.max(0, Math.floor(nw.x / TILE_SIZE));
  const x1 = Math.min(max, Math.floor(se.x / TILE_SIZE));
  const y0 = Math.max(0, Math.floor(nw.y / TILE_SIZE));
  const y1 = Math.min(max, Math.floor(se.y / TILE_SIZE));
  const tiles = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) tiles.push({ z, x, y });
  }
  return tiles;
}

/** Fetch a tile over HTTP with retries. Resolves to a Buffer, or null on 404. */
export async function fetchTileHttp({ z, x, y }, urlTemplate = DEFAULT_TILE_URL) {
  const url = urlTemplate
    .replace("{z}", z)
    .replace("{x}", x)
    .replace("{y}", y);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "street-grades (github.com/ebold123/street-grades)" },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastError;
}

export class TerrainDem {
  /**
   * @param {object} opts
   * @param {number} opts.zoom        Tile zoom level (14 is roughly 7.5 m/pixel at SF).
   * @param {Function} [opts.fetchTile]  async ({z,x,y}) => Buffer|null. Injectable for tests.
   * @param {string} [opts.cacheDir]  Directory to cache downloaded PNGs.
   * @param {number} [opts.maxTiles]  Safety limit on tiles held in memory.
   */
  constructor({ zoom = 14, fetchTile = fetchTileHttp, cacheDir, maxTiles = 2000 } = {}) {
    this.zoom = zoom;
    this.fetchTile = fetchTile;
    this.cacheDir = cacheDir;
    this.maxTiles = maxTiles;
    this.tiles = new Map(); // "x/y" -> Float32Array | null (missing)
    this.missing = 0;
  }

  async #loadTile(tile) {
    const cacheFile = this.cacheDir
      ? path.join(this.cacheDir, String(tile.z), String(tile.x), `${tile.y}.png`)
      : null;
    let buffer = null;
    if (cacheFile) {
      try {
        buffer = await readFile(cacheFile);
      } catch {
        // not cached yet
      }
    }
    if (!buffer) {
      buffer = await this.fetchTile(tile);
      if (buffer && cacheFile) {
        await mkdir(path.dirname(cacheFile), { recursive: true });
        await writeFile(cacheFile, buffer);
      }
    }
    if (!buffer) {
      this.missing++;
      return null;
    }
    return decodeTerrarium(buffer);
  }

  /** Download and decode every tile covering bbox. Concurrency-limited. */
  async prefetch(bbox, { concurrency = 8, onProgress } = {}) {
    const tiles = tilesForBbox(bbox, this.zoom);
    if (tiles.length > this.maxTiles) {
      throw new Error(
        `Region needs ${tiles.length} tiles at zoom ${this.zoom} (limit ${this.maxTiles}). ` +
          "Use a smaller region or a lower --zoom."
      );
    }
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < tiles.length) {
        const tile = tiles[next++];
        const key = `${tile.x}/${tile.y}`;
        if (!this.tiles.has(key)) this.tiles.set(key, await this.#loadTile(tile));
        done++;
        if (onProgress) onProgress(done, tiles.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, tiles.length) }, worker));
    return tiles.length;
  }

  #pixel(gx, gy) {
    const tx = Math.floor(gx / TILE_SIZE);
    const ty = Math.floor(gy / TILE_SIZE);
    const tile = this.tiles.get(`${tx}/${ty}`);
    if (!tile) return NaN;
    const lx = gx - tx * TILE_SIZE;
    const ly = gy - ty * TILE_SIZE;
    return tile[ly * TILE_SIZE + lx];
  }

  /**
   * Bilinear-interpolated elevation in meters at lng/lat, or NaN if any
   * contributing tile is missing. Tiles must have been prefetched.
   */
  sample(lng, lat) {
    const { x, y } = lngLatToPixel(lng, lat, this.zoom);
    // Pixel values describe the pixel center, so shift by half a pixel.
    const fx = x - 0.5;
    const fy = y - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const a = this.#pixel(x0, y0);
    const b = this.#pixel(x0 + 1, y0);
    const c = this.#pixel(x0, y0 + 1);
    const d = this.#pixel(x0 + 1, y0 + 1);
    return (
      a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty
    );
  }
}
