import {
  addProtocol,
  MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import {
  colorExpression,
  flaggedFilter,
  MAX_STOP,
  okFilter,
  SOURCE_ID,
  STOPS,
  streetLayers,
} from "./layers.js";
import { popupContent } from "./popup.js";
import "./style.css";

// ---- Configuration -------------------------------------------------------
// Build-time env vars:
//   VITE_STYLE_URL    MapLibre style JSON for the basemap
//   VITE_PMTILES_URL  URL of a .pmtiles file; if unset we load GeoJSON from /data
//   VITE_REGION       Default region id (default "sf")
const STYLE_URL = import.meta.env.VITE_STYLE_URL || "https://tiles.openfreemap.org/styles/positron";
const PMTILES_URL = import.meta.env.VITE_PMTILES_URL || "";
const BASE = import.meta.env.BASE_URL;

const BLANK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#f4f1ea" } }],
};

// ---- State ---------------------------------------------------------------
const params = new URLSearchParams(location.search);
const requestedRegion = params.get("region") || import.meta.env.VITE_REGION || "sf";
// Only allow simple ids so the value can't escape the /data directory.
const region = /^[a-z0-9_-]+$/i.test(requestedRegion) ? requestedRegion : "sf";

const state = { metric: "grade_abs", minGrade: 0, showFlagged: true };

const $ = (id) => document.getElementById(id);

// ---- Helpers -------------------------------------------------------------
function buildLegend() {
  const gradient = STOPS.map(([v, c]) => `${c} ${(v / MAX_STOP) * 100}%`).join(", ");
  $("ramp").style.background = `linear-gradient(to right, ${gradient})`;
  const ticks = $("ticks");
  for (const [v] of STOPS) {
    const tick = document.createElement("span");
    tick.style.left = `${(v / MAX_STOP) * 100}%`;
    tick.textContent = v === MAX_STOP ? `${v}%+` : `${v}%`;
    ticks.appendChild(tick);
  }
}

async function loadMeta() {
  try {
    const res = await fetch(`${BASE}data/${region}.meta.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

async function resolveStyle() {
  try {
    const res = await fetch(STYLE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return STYLE_URL;
  } catch {
    return BLANK_STYLE; // keep the grades usable even without a basemap
  }
}

// ---- Map -----------------------------------------------------------------
function addStreets(map) {
  const vector = Boolean(PMTILES_URL);
  map.addSource(
    SOURCE_ID,
    vector
      ? { type: "vector", url: `pmtiles://${PMTILES_URL}` }
      : { type: "geojson", data: `${BASE}data/${region}.geojson` }
  );
  for (const layer of streetLayers({ vector, state })) map.addLayer(layer);
}

function applyState(map) {
  map.setFilter("streets-ok", okFilter(state));
  map.setFilter("streets-casing", okFilter(state));
  map.setFilter("streets-flagged", flaggedFilter(state));
  map.setPaintProperty("streets-ok", "line-color", colorExpression(state.metric));
}

function wireControls(map) {
  for (const radio of document.querySelectorAll('input[name="metric"]')) {
    radio.addEventListener("change", () => {
      state.metric = radio.value;
      applyState(map);
    });
  }
  const slider = $("min-grade");
  slider.addEventListener("input", () => {
    state.minGrade = Number(slider.value);
    $("min-grade-out").textContent = `${state.minGrade}%`;
    applyState(map);
  });
  $("show-flagged").addEventListener("change", (event) => {
    state.showFlagged = event.target.checked;
    applyState(map);
  });
}

function wireInteraction(map) {
  const layers = ["streets-ok", "streets-flagged"];
  const hit = (point) =>
    map.queryRenderedFeatures(
      [
        [point.x - 6, point.y - 6],
        [point.x + 6, point.y + 6],
      ],
      { layers }
    )[0];

  map.on("mousemove", (e) => {
    map.getCanvas().style.cursor = hit(e.point) ? "pointer" : "";
  });
  map.on("click", (e) => {
    const feature = hit(e.point);
    if (!feature) return;
    new Popup({ closeButton: true, maxWidth: "280px" })
      .setLngLat(e.lngLat)
      .setDOMContent(popupContent(feature.properties))
      .addTo(map);
  });
}

async function main() {
  buildLegend();
  const [meta, style] = await Promise.all([loadMeta(), resolveStyle()]);

  if (meta) {
    $("region").textContent = meta.name;
    if (meta.synthetic) {
      const banner = $("banner");
      banner.textContent = "Synthetic test data: a made-up street grid over a made-up hill.";
      banner.hidden = false;
    }
  } else {
    $("region").textContent = region;
    const error = $("error");
    error.textContent = `No data for "${region}" yet. In the web folder, run: npm run data -- ${region}`;
    error.hidden = false;
  }

  if (PMTILES_URL) addProtocol("pmtiles", new Protocol().tile);

  const map = new MapLibreMap({
    container: "map",
    style,
    ...(meta
      ? { bounds: meta.bbox, fitBoundsOptions: { padding: 40 } }
      : { center: [-122.44, 37.76], zoom: 12 }),
    attributionControl: { compact: true },
  });
  map.addControl(new NavigationControl({ visualizePitch: false }), "top-right");
  map.addControl(new ScaleControl({ unit: "imperial" }), "bottom-right");

  map.on("load", () => {
    if (meta) addStreets(map);
    wireControls(map);
    wireInteraction(map);
  });
  map.on("error", (e) => console.warn("map error:", e.error?.message || e));
}

main();
