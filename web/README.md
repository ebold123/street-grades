# street-grades (web)

A JavaScript rewrite of street-grades: a Node pipeline that joins OpenStreetMap roads with
elevation tiles and computes the grade of every block, plus a MapLibre viewer. It sits next
to the original Python code and doesn't change it.

## Status

Tested against a **synthetic city** (a street grid over a known hill), where the true grade of
every block can be computed exactly. Not yet run against real San Francisco data: the Overpass
download, the elevation tile download and the default basemap style were not reachable from the
environment this was written in. Run `npm run data -- sf` once and compare a few streets you
know before trusting the numbers.

## Quick start

Requires Node 20 or newer.

```sh
cd web
npm install

# Try it with no network: a synthetic city
npm run data -- --fixture
npm run dev          # then open http://localhost:5173/?region=fixture

# Real data
npm run data -- sf   # downloads roads + elevation, writes public/data/sf.geojson
npm run dev          # http://localhost:5173/
```

Other regions: `kirkland`, `sfpeninsula` (see `pipeline/regions.js`), or any area:

```sh
npm run data -- --bbox -122.52,37.70,-122.35,37.82 --name mycity
```

Options: `--zoom` (elevation tile zoom, default 14), `--step` (profile sampling interval in
meters, default 10), `--out`, `--cache`. Downloads are cached in `.cache/`, so reruns are fast.

## How grades are computed

1. **Roads** come from the Overpass API (`out geom`), filtered like the Python version (no
   footways, paths, steps or parking aisles; also no motorways).
2. **Blocks, not edges.** OSM ways are split at real intersections only. Shape vertices don't
   split a block, and two ways with the same name that meet at a plain continuation node are
   joined. Dead ends, junctions, and changes of name, class, bridge or tunnel end a block.
3. **Elevation** is read from Terrarium PNG terrain tiles (AWS Open Data Terrain Tiles) with
   bilinear interpolation. No GDAL or local raster files are needed.
4. **Profile.** Each block is resampled every 10 m and the elevations are smoothed with a
   3-point median then mean. Endpoint elevations come from a short linear fit, because a plain
   moving average pulls the end values inward and understates the grade.
5. **Bridges and tunnels** interpolate between their two ends, since a terrain model describes
   the ground underneath, not the deck.

Properties on each block (GeoJSON feature):

| Property | Meaning |
|---|---|
| `grade`, `grade_abs` | Net grade in %, end to end. The sign follows the drawn direction. |
| `max_grade`, `max_grade_abs` | Steepest grade over any 20 m stretch |
| `uphill_dir` | Compass direction of travel that goes uphill (empty if flat) |
| `grade_cat` | 0 to 7, in 5% steps (same buckets as the Python version) |
| `length_m`, `z_start`, `z_end`, `ascent_m`, `descent_m` | Length and elevation |
| `flag` | `short` (under 20 m), `extreme` (over 35%) or `no_elevation`; absent when fine |
| `struct` | `bridge` or `tunnel` when elevations were interpolated |
| `osm` | OSM way id of the block's first segment, for checking bad data |

Flagged blocks are drawn dashed and gray in the viewer instead of being silently included.

## Precomputing and hosting

The pipeline runs offline and the viewer needs no backend.

- **Development:** the viewer loads `public/data/<region>.geojson` directly. This is fine for a
  city.
- **Production:** if [tippecanoe](https://github.com/felt/tippecanoe) is on your `PATH`,
  `npm run data` also writes `public/data/<region>.pmtiles`. Upload that single file to any
  static host that supports HTTP range requests (Cloudflare R2, S3 plus a CDN, GitHub Pages
  for small files) and build the viewer pointing at it:

  ```sh
  VITE_PMTILES_URL=https://example.com/tiles/sf.pmtiles npm run build
  ```

  If the file is on a different origin than the site, its bucket needs CORS enabled for `GET`
  and the `Range` header.

Other build-time settings: `VITE_STYLE_URL` (basemap style; defaults to OpenFreeMap's
"positron"), `VITE_REGION` (default region). If the basemap style can't be loaded, the viewer
falls back to a plain background so the grades stay visible.

`public/data` and `.cache` are git-ignored. Generated data is not committed.

## Deploying to GitHub Pages

`.github/workflows/deploy-web.yml` publishes the site automatically. The generated data isn't
committed, so the workflow builds it each time:

1. Runs the tests.
2. Runs `npm run data` for each region in the workflow's `REGIONS` setting (default `sf`),
   downloading roads from Overpass and elevation tiles from AWS. Overpass requests are retried
   with a growing delay, since shared CI machines are sometimes throttled.
3. Refuses to publish a region that looks wrong: fewer than `MIN_BLOCKS` blocks, or more than
   `MAX_NO_ELEVATION` of them without elevation.
4. Builds the site and publishes it.

| Event | What happens |
|---|---|
| Pull request touching `web/` | Steps 1 to 4 run, but nothing is published |
| Push to `main` touching `web/` | Steps 1 to 4, then deploy |
| Actions tab > "Deploy web to GitHub Pages" > Run workflow | Same as a push to `main` |

**One-time setup:** in the repository, go to Settings > Pages > Build and deployment and set
Source to **GitHub Actions**. Until that is set the deploy step fails with a "Pages not
enabled" message. The site is then served at `https://<owner>.github.io/<repo>/`, with
`?region=<id>` choosing the region.

Downloads are cached for a month (the cache key includes the year and month), so most builds
don't touch Overpass at all. To refresh the data sooner, delete the cache under
Actions > Caches and rerun. To add a region, add it to `pipeline/regions.js` and to `REGIONS`
in the workflow.

The site uses relative paths throughout, so it works under any sub-path. The workflow
publishes GeoJSON, which is fine for a city. For a much larger region, build a PMTiles file
(see "Precomputing and hosting" above), host it where you like, and set `VITE_PMTILES_URL` for
the build step.

## Tests

```sh
npm test
```

Covers elevation tile decoding and sampling, block building, grade math (including a check that
a 10% slope reads as 10% on blocks of any length), the full pipeline against the synthetic city
with analytic expected grades, MapLibre style-spec validation of every layer and filter, and
safe rendering of untrusted street names in popups.

## Known limitations

- Elevation quality is the main limit. Terrain tiles in the US are largely derived from USGS
  3DEP, but resolution varies by place and some sources include building heights. Check
  downtown areas. A different `--zoom` or tile source can be passed through `TerrainDem`.
- A region needs every elevation tile in memory (a limit of 2000 tiles is enforced). That is
  fine for a city or a peninsula; for a state, split it into regions.
- The Overpass query covers the whole bounding box at once, which can time out for large areas.
- No elevation profile chart or routing yet.
