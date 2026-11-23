const NS = "http://www.w3.org/2000/svg";
let counter = 0;

/** Create an SVG element. Children may be nodes or strings (text nodes). */
export const s = (tag, attrs, ...children) => {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    el.setAttribute(key, String(value));
  }
  el.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return el;
};

export const uid = (prefix) => `${prefix}-${++counter}`;

/** Root svg with accessible name, description and a viewBox equal to the pixel box. */
export const root = (width, height, { title, desc }) => {
  const titleId = uid("t");
  const descId = uid("d");
  return s(
    "svg",
    { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-labelledby": `${titleId} ${descId}` },
    s("title", { id: titleId }, title),
    s("desc", { id: descId }, desc),
  );
};

/** Diagonal hatch fill, so a breach is shown by texture as well as colour. */
export const hatchPattern = (id) =>
  s("pattern", { id, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
    s("line", { class: "hatch-line", x1: 0, y1: 0, x2: 0, y2: 6 }));

const SHAPES = ["circle", "square", "diamond", "triangle", "cross"];
export const shapeFor = (i) => SHAPES[i % SHAPES.length];

/** A point marker whose shape identifies the series without colour. */
export const marker = (shape, cx, cy, r, attrs, ...kids) => {
  switch (shape) {
    case "square": return s("rect", { ...attrs, x: cx - r, y: cy - r, width: 2 * r, height: 2 * r }, ...kids);
    case "diamond": return s("path", { ...attrs, d: `M${cx} ${cy - r * 1.3}L${cx + r * 1.3} ${cy}L${cx} ${cy + r * 1.3}L${cx - r * 1.3} ${cy}Z` }, ...kids);
    case "triangle": return s("path", { ...attrs, d: `M${cx} ${cy - r * 1.2}L${cx + r * 1.2} ${cy + r}L${cx - r * 1.2} ${cy + r}Z` }, ...kids);
    case "cross": return s("path", { ...attrs, d: `M${cx - r} ${cy - r}L${cx + r} ${cy + r}M${cx + r} ${cy - r}L${cx - r} ${cy + r}`, fill: "none", "stroke-width": 2 }, ...kids);
    default: return s("circle", { ...attrs, cx, cy, r }, ...kids);
  }
};
