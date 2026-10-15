# street-grades

Find out how steep any street in the world is. This is a tool for cyclists and runners, to help you pick the hilliest (or flattest) routes. It joins OpenStreetMap road networks with elevation data, splits the roads into city blocks, and computes the grade of each block. The results are shown on an interactive map.

**Live map:** https://ebold123.github.io/street-grades/ (San Francisco)

The project is a Node pipeline plus a [MapLibre](https://maplibre.org) viewer, both in [`web/`](web/README.md). The original Python version is kept below under [Obsolete python code](#obsolete-python-code).

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
- Thanks to the open-elevation project for the concise GDAL raster code used by the Python version. https://github.com/Jorl17/open-elevation
- Inspired by the SF grade map that I use for all my bike rides: http://hillmapper.com/

# Obsolete python code

The original Python implementation (`street-grades/`) is no longer maintained. The JavaScript version above replaces it. The notes below are kept for reference.

## setup
Mac setup:
- Install [Homebrew](https://brew.sh) if you don't have it.
- `brew install python gdal`
- Create and activate a virtual environment. macOS doesn't ship `pip` or `python` commands (only `pip3`/`python3`), and Homebrew's Python won't let you `pip install` packages globally. Inside the venv, `pip` and `python` work.
    - `python3 -m venv .venv`
    - `source .venv/bin/activate` # Run this again in every new terminal before using the scripts.
- `pip install --upgrade pip`
- `pip install "GDAL==$(gdal-config --version)"` # The GDAL Python package version must match the GDAL library installed by brew.
- `pip install -r requirements.txt`

## get yer data
### You'll need elevation data. You must download geotiff files yourself.
I get mine here: https://dds.cr.usgs.gov/srtm/version2_1/SRTM1/Region_04/

There are a few elevation datasets out there. Thanks to the US Government for creating and providing them. In general, you should prefer "1m" data over "30m" data; and "30m" data over "90m" data. The average city block (in San Francisco) is around 150m. When your elevation data is accurate to 30m, and elevation changes rapidly, that results in some inaccurate readings.

Your downloaded data should be in hgt or tif format. Put it in data/ dir under this path. The scripts below will, by default, look in data/ for downloaded elevation raster data.

### The script downloads the street data. You don't need to manually download street data.
Luckily the osmnet python module handles all of the OSM work - we specify a bounding box, and it downloads all of the OSM road network within that box. But you have to do extra work to obtain the elevation dataset.

## run
- `python street_grades/find_intersections.py <region name>`; where <region name> is some hardcoded city area in find_intersections.py.
    - Or: `python street-grades/find_intersections.py kirkland`
- This generates street data in `/tmp/<region name>`
    - Outputs street intersections to /tmp/<region name>/intersections_with_coordinates.csv
    - The output csv has a row street, with the endpoint coordinates of each intersection at the ends of that block. 

- `python street_grades/grades --edges_csv \<street intersections data\>`
Ex: `python street-grades/grades.py --edges_csv /tmp/kirkland/edges_with_coordinates.csv`
    - Outputs /tmp/e3.csv with a row per "block", the endpoint coordinates of that block; and the elevations at each end of the block, and the grade of the street.

## visualize
- Take your browser to kepler.gl
- Drag the csv grades file generated by `grades` in as a data source.
- Try setting "grade" as a tooltip
- Or coloring edges by "grade"
- Or coloring edges by "grade_category"

## Known bugs & Shortcomings
I'm not going to be unemployed forever, and that means there's a bunch of stuff that just won't look right when you run this code.
- We use OSM edges & nodes. These are not conceptually the same as a city block, or a street. It would be great to merge adjacent edges into logical "city blocks" when appopriate.
- Sometimes an OSM segment is just a few meters wrong, and we output ridiculous grades.
- 30m elevation data isn't too accurate, since we often look at grades on streets that are just 100-200m long. Being 30m off can generate some less accurate grades.
- The USGS SRTM datasets also seem to recognize building height as elevation. Downtown San Francisco is full of incorrectly labeled steep streets.
