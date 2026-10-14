#!/usr/bin/env node
// CLI: build street-grade data for a region.
//
//   node pipeline/build.js sf
//   node pipeline/build.js --bbox -122.52,37.70,-122.35,37.82 --name mycity
//   node pipeline/build.js --fixture        # synthetic city, no network
//
// Writes public/data/<id>.geojson and <id>.meta.json, and, if `tippecanoe` is
// on your PATH, public/data/<id>.pmtiles as well.

import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parseArgs } from "node:util";
import { fetchTileHttp, TerrainDem } from "./dem.js";
import { FIXTURE_BBOX, fixtureFetchTile, fixtureWays } from "./fixture.js";
import { fetchWays } from "./overpass.js";
import { computeFeatures, summarize } from "./pipeline.js";
import { parseBbox, REGIONS } from "./regions.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    bbox: { type: "string" },
    name: { type: "string" },
    zoom: { type: "string", default: "14" },
    step: { type: "string", default: "10" },
    out: { type: "string", default: "public/data" },
    cache: { type: "string", default: ".cache" },
    fixture: { type: "boolean", default: false },
    "no-pmtiles": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

function usage() {
  console.log(`Usage: node pipeline/build.js <region> [options]

Regions: ${Object.keys(REGIONS).join(", ")}

Options:
  --bbox west,south,east,north   Custom area instead of a named region
  --name <id>                    Output name for a custom --bbox (default: custom)
  --zoom <n>                     Elevation tile zoom (default 14, ~7.5 m/pixel)
  --step <meters>                Profile sampling interval (default 10)
  --out <dir>                    Output directory (default public/data)
  --cache <dir>                  Download cache (default .cache)
  --fixture                      Use the synthetic test city (no network)
  --no-pmtiles                   Skip tippecanoe even if it is installed`);
}

function haveTippecanoe() {
  const probe = spawnSync("tippecanoe", ["--version"], { stdio: "ignore" });
  return !probe.error;
}

async function main() {
  if (values.help) return usage();

  let id;
  let label;
  let bbox;
  if (values.fixture) {
    id = "fixture";
    label = "Synthetic test city";
    bbox = FIXTURE_BBOX;
  } else if (values.bbox) {
    id = values.name || "custom";
    label = id;
    bbox = parseBbox(values.bbox);
  } else if (positionals[0] && REGIONS[positionals[0]]) {
    id = positionals[0];
    label = REGIONS[id].name;
    bbox = REGIONS[id].bbox;
  } else {
    usage();
    process.exitCode = 1;
    return;
  }

  const zoom = Number(values.zoom);
  const stepM = Number(values.step);
  const log = (msg) => console.log(msg);

  log(`Region: ${label} [${bbox.join(", ")}]`);
  const ways = values.fixture
    ? fixtureWays()
    : await fetchWays(bbox, { cacheFile: path.join(values.cache, "osm", `${id}.json`), log });

  const dem = new TerrainDem({
    zoom,
    fetchTile: values.fixture ? fixtureFetchTile : fetchTileHttp,
    cacheDir: values.fixture ? undefined : path.join(values.cache, "dem"),
  });

  const { features } = await computeFeatures({ ways, dem, stepM, log });
  const stats = summarize(features);

  await mkdir(values.out, { recursive: true });
  const geojsonPath = path.join(values.out, `${id}.geojson`);
  await writeFile(geojsonPath, JSON.stringify({ type: "FeatureCollection", features }));

  const meta = {
    id,
    name: label,
    bbox,
    center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
    generatedAt: new Date().toISOString(),
    demZoom: zoom,
    stepM,
    synthetic: values.fixture,
    stats,
  };
  await writeFile(path.join(values.out, `${id}.meta.json`), JSON.stringify(meta, null, 2));

  log(`Wrote ${geojsonPath}`);
  log(
    `${stats.blocks} blocks, median grade ${stats.medianGrade}%, 95th percentile ${stats.p95Grade}%. ` +
      `Flagged: ${stats.flagged.short} short, ${stats.flagged.extreme} extreme, ${stats.flagged.no_elevation} no elevation.`
  );
  log("Steepest blocks (unflagged):");
  for (const s of stats.steepest) {
    log(`  ${String(s.grade).padStart(6)}%  ${s.length_m} m  ${s.name}  (osm way ${s.osm})`);
  }

  if (values["no-pmtiles"]) return;
  if (!haveTippecanoe()) {
    log("tippecanoe not found; skipping .pmtiles (the viewer can use the GeoJSON directly).");
    return;
  }
  const pmtilesPath = path.join(values.out, `${id}.pmtiles`);
  log(`Running tippecanoe -> ${pmtilesPath}`);
  const result = spawnSync(
    "tippecanoe",
    [
      "-o", pmtilesPath,
      "-l", "streets",
      "-Z", "11",
      "-z", "16",
      "--drop-densest-as-needed",
      "--extend-zooms-if-still-dropping",
      "--force",
      geojsonPath,
    ],
    { stdio: "inherit" }
  );
  if (result.status !== 0) throw new Error("tippecanoe failed");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
