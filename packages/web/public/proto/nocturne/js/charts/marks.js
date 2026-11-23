import { s } from "../dom.js";

export const SHAPES = ["circle", "square", "diamond", "triangle", "cross", "ring"];

/** Marker outlines as path data, so legend swatches and plotted points share one definition. */
export const marker = (shape, cx, cy, r) => {
  switch (shape) {
    case "square":
      return `M${cx - r},${cy - r}h${2 * r}v${2 * r}h${-2 * r}z`;
    case "diamond":
      return `M${cx},${cy - r * 1.25}L${cx + r * 1.25},${cy}L${cx},${cy + r * 1.25}L${cx - r * 1.25},${cy}z`;
    case "triangle":
      return `M${cx},${cy - r * 1.2}L${cx + r * 1.15},${cy + r * 0.9}L${cx - r * 1.15},${cy + r * 0.9}z`;
    case "cross":
      return `M${cx - r},${cy - r}L${cx + r},${cy + r}M${cx + r},${cy - r}L${cx - r},${cy + r}`;
    default:
      return `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
};

const fix = (n) => Math.round(n * 100) / 100;

/** Polyline path. Points are [x, y] pairs; smooth uses a cardinal spline that stays within the data range. */
export const linePath = (pts, smooth) => {
  if (pts.length === 0) return "";
  if (!smooth || pts.length < 3) return pts.map(([x, y], i) => `${i ? "L" : "M"}${fix(x)},${fix(y)}`).join("");
  let d = `M${fix(pts[0][0])},${fix(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const lo = Math.min(p1[1], p2[1]);
    const hi = Math.max(p1[1], p2[1]);
    const c1y = Math.min(hi, Math.max(lo, p1[1] + (p2[1] - p0[1]) / 6));
    const c2y = Math.min(hi, Math.max(lo, p2[1] - (p3[1] - p1[1]) / 6));
    d += `C${fix(p1[0] + (p2[0] - p0[0]) / 6)},${fix(c1y)} ${fix(p2[0] - (p3[0] - p1[0]) / 6)},${fix(c2y)} ${fix(p2[0])},${fix(p2[1])}`;
  }
  return d;
};

/** Diagonal hatch used for every threshold breach, so breach never relies on colour alone. */
export const hatch = (id) =>
  s(
    "defs",
    null,
    s(
      "pattern",
      { id, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
      s("rect", { class: "hatch-bg", width: 6, height: 6 }),
      s("line", { class: "hatch-line", x1: 0, y1: 0, x2: 0, y2: 6, "stroke-width": 2.2 }),
    ),
  );
