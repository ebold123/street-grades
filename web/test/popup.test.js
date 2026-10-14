import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

// popup.js touches `document` only when called, so install one before use.
globalThis.document = new JSDOM("").window.document;
const { popupContent } = await import("../src/popup.js");

const base = {
  name: "Filbert St",
  highway: "residential",
  osm: 123,
  length_m: 100.4,
  grade: -12.3,
  grade_abs: 12.3,
  max_grade_abs: 18,
  z_start: 60,
  z_end: 47.7,
  uphill_dir: "NE",
};

test("renders grade, direction and elevation", () => {
  const text = popupContent(base).textContent;
  assert.match(text, /Filbert St/);
  assert.match(text, /12\.3%/);
  assert.match(text, /uphill heading NE/);
  assert.match(text, /Steepest 20 m: 18\.0%/);
  assert.match(text, /rises 12\.3 m/);
});

test("untrusted street names are rendered as text, never as markup", () => {
  const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const node = popupContent({ ...base, name: evil });
  assert.equal(node.querySelector("img"), null);
  assert.equal(node.querySelector("script"), null);
  assert.ok(node.textContent.includes(evil));
});

test("links go to openstreetmap.org and a bad osm id produces no link", () => {
  const link = popupContent(base).querySelector("a");
  assert.equal(link.href, "https://www.openstreetmap.org/way/123");
  assert.equal(link.rel, "noopener noreferrer");
  assert.equal(popupContent({ ...base, osm: "1;javascript:alert(1)" }).querySelector("a"), null);
});

test("unnamed streets, flags and structures are explained", () => {
  assert.match(popupContent({ ...base, name: "" }).textContent, /Unnamed residential/);
  assert.match(popupContent({ ...base, flag: "short" }).textContent, /Under 20 m/);
  assert.match(popupContent({ ...base, flag: "extreme" }).textContent, /likely a data error/);
  assert.match(popupContent({ ...base, struct: "bridge" }).textContent, /bridge/);
  assert.match(
    popupContent({ ...base, flag: "no_elevation" }).textContent,
    /No elevation data/
  );
});
