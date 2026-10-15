# street-grades

Find out how steep any street in the world is. This is a tool for cyclists and runners, to help you pick the hilliest (or flattest) routes. It joins OpenStreetMap road networks with elevation data, splits the roads into city blocks, and computes the grade of each block. The results are shown on an interactive map.

**Live map:** https://ebold123.github.io/street-grades/ (San Francisco)

The project is a Node pipeline plus a [MapLibre](https://maplibre.org) viewer, both in [`web/`](web/README.md).

# How it works

1. **Roads** are downloaded from the OpenStreetMap Overpass API, leaving out footways, paths, steps, parking aisles and motorways.
2. **Blocks.** OSM ways are split only at real intersections, so a block is what a person would call a block, not a raw OSM edge.
3. **Elevation** comes from Terrarium terrain tiles (AWS Open Data) with bilinear interpolation. No GDAL or manual downloads.
4. **Grades.** Each block is sampled every 10 m, smoothed, and measured end to end and over its steepest 20 m. Bridges and tunnels interpolate between their ends. Suspect blocks (very short, over 35%, or missing elevation) are flagged and drawn dashed gray.
5. **Viewer.** The map colors each block by grade and shows details on click. It needs no backend: the data is a static file.

Details, the output format and all options are in [`web/README.md`](web/README.md).

# Code layout

| Path | What it is |
|---|---|
| `web/pipeline/` | The data pipeline: Overpass fetch (`overpass.js`), elevation tiles (`dem.js`), block building (`blocks.js`), grade math (`grades.js`), regions (`regions.js`), and a synthetic test city (`fixture.js`) |
| `web/src/` | The MapLibre viewer: map setup (`main.js`), layers and color scale (`layers.js`), click popups (`popup.js`) |
| `web/test/` | Tests, run with `npm test` |
| `.github/workflows/deploy-web.yml` | Builds the data and site, and deploys to GitHub Pages |

# Run it locally

Requires Node 20 or newer.

```sh
cd web
npm install
npm run data -- --fixture   # synthetic city, no network needed
npm run dev                 # http://localhost:5173/?region=fixture

npm run data -- sf          # real San Francisco data (roads + elevation)
npm run dev                 # http://localhost:5173/
```

Other regions are in `web/pipeline/regions.js`, or pass any area with `--bbox west,south,east,north --name mycity`.

# Deploys

The site deploys to GitHub Pages through GitHub Actions. The generated data isn't committed, so each build creates it:

| Event | What happens |
|---|---|
| Pull request touching `web/` | Runs the tests, builds the data and site. Does not deploy. |
| Push to `main` touching `web/` | Same, then deploys. |
| Actions tab > "Deploy web to GitHub Pages" > Run workflow | Same as a push to `main`. |

The build refuses to publish a region that looks wrong (too few blocks, or too many without elevation). Downloads are cached for a month.

**One-time setup:** in the repository, set Settings > Pages > Build and deployment > Source to **GitHub Actions**. If Source is left on "Deploy from a branch", GitHub publishes this README instead of the map.

To add a region, add it to `web/pipeline/regions.js` and to `REGIONS` in the workflow. For large regions, build a PMTiles file and set `VITE_PMTILES_URL` (see `web/README.md`).

# See also
- [SF Public Works street key map](https://bsm.sfdpw.org/subdivision/keymap/): the city's official map of San Francisco streets and subdivisions.
- [Hillmapper](http://hillmapper.com/): a map of street grades in San Francisco.

# Credit
- Thanks to the open-elevation project for the concise GDAL raster code in the original Python version of this project. https://github.com/Jorl17/open-elevation
- Inspired by the SF grade map that I use for all my bike rides: http://hillmapper.com/
