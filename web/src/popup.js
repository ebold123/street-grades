// Popup content for a clicked block. Built with DOM APIs and textContent only:
// street names come from OpenStreetMap and must be treated as untrusted text.

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function popupContent(p) {
  const root = el("div", undefined, "popup");
  const fallbackName = `Unnamed ${String(p.highway || "street").replace(/_/g, " ")}`;
  root.appendChild(el("h3", p.name || fallbackName));

  const grade = Number(p.grade_abs) || 0;
  if (p.flag === "no_elevation") {
    root.appendChild(el("p", "No elevation data for this block."));
  } else {
    root.appendChild(el("p", `${grade.toFixed(1)}%`, "big"));
    root.appendChild(
      el("p", p.uphill_dir ? `Net grade, uphill heading ${p.uphill_dir}` : "Net grade (essentially flat)")
    );
    root.appendChild(el("p", `Steepest 20 m: ${Number(p.max_grade_abs).toFixed(1)}%`));
    const low = Math.min(p.z_start, p.z_end);
    const high = Math.max(p.z_start, p.z_end);
    root.appendChild(
      el(
        "p",
        `${Number(p.length_m).toFixed(0)} m long, rises ${(high - low).toFixed(1)} m ` +
          `(${low.toFixed(0)} m to ${high.toFixed(0)} m)`
      )
    );
  }

  const notes = [];
  if (p.struct) notes.push(`This is a ${p.struct}: elevation is interpolated between its ends.`);
  if (p.flag === "short") notes.push("Under 20 m long, so the grade may be unreliable.");
  if (p.flag === "extreme") notes.push("Over 35%: likely a data error. Check the OSM way.");
  for (const note of notes) root.appendChild(el("p", note, "note"));

  const osm = Number(p.osm);
  if (Number.isFinite(osm)) {
    const link = el("a", "View on OpenStreetMap");
    link.href = `https://www.openstreetmap.org/way/${osm}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const wrap = el("p");
    wrap.appendChild(link);
    root.appendChild(wrap);
  }
  return root;
}
