// Small inline charts for tiles and table cells. DESIGN-SYSTEM 6.20. Full charts live in the reporting module.
import { h, s, frameOnce } from "./dom.js";
import { number, percent } from "./format.js";

const summarize = (label, values) => {
  if (values.length === 0) return `${label}, no data`;
  const hi = Math.max(...values);
  return `${label}, ${values.length} values, from ${number(values[0])} to ${number(values[values.length - 1])}, highest ${number(hi)} at ${values.indexOf(hi) + 1}`;
};

const hiddenList = (values, labels) =>
  h(
    "ul",
    { class: "sr-only" },
    ...values.map((v, i) => h("li", {}, `${labels?.[i] ?? i + 1}: ${number(v)}`)),
  );

const wrap = (svg, extra) => h("span", { class: "c-chart-wrap" }, svg, extra);

const svgBase = (cls, label, summary, w, hgt, kids) =>
  s(
    "svg",
    {
      class: `c-chart ${cls}`,
      role: "img",
      "aria-label": label,
      viewBox: `0 0 ${w} ${hgt}`,
      preserveAspectRatio: "none",
    },
    s("title", {}, summary),
    ...kids,
  );

export const sparkline = (values, { label = "Trend" } = {}) => {
  const W = 120;
  const H = 32;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map(
    (v, i) => `${(i / Math.max(1, values.length - 1)) * W},${H - 3 - ((v - lo) / span) * (H - 6)}`,
  );
  const svg = svgBase("c-chart--spark", label, summarize(label, values), W, H, [
    s("polyline", {
      class: "c-chart__line",
      points: pts.join(" "),
      fill: "none",
      "vector-effect": "non-scaling-stroke",
    }),
  ]);
  return wrap(svg, hiddenList(values));
};

export const miniBars = (values, { labels, label = "Values" } = {}) => {
  const W = 120;
  const H = 48;
  const hi = Math.max(...values, 1);
  const gap = 2;
  const bw = (W - gap * (values.length - 1)) / Math.max(1, values.length);
  const svg = svgBase(
    "c-chart--bars",
    label,
    summarize(label, values),
    W,
    H,
    values.map((v, i) => {
      const bh = Math.max(1, (v / hi) * (H - 2));
      return s(
        "rect",
        { class: "c-chart__bar", x: i * (bw + gap), y: H - bh, width: bw, height: bh },
        s("title", {}, `${labels?.[i] ?? i + 1}: ${number(v)}`),
      );
    }),
  );
  return wrap(svg, hiddenList(values, labels));
};

const MARKERS = ["circle", "square", "triangle", "diamond", "cross"];

const marker = (i) => {
  const shape = MARKERS[i % 5];
  const c = `c-chart__marker c-chart__marker--${i % 5}`;
  if (shape === "circle") return s("circle", { class: c, cx: 6, cy: 6, r: 4 });
  if (shape === "square") return s("rect", { class: c, x: 2, y: 2, width: 8, height: 8 });
  if (shape === "triangle") return s("path", { class: c, d: "M6 1.5L11 10H1z" });
  if (shape === "diamond") return s("path", { class: c, d: "M6 1L11 6 6 11 1 6z" });
  return s("path", { class: `${c} c-chart__marker--line`, d: "M2 2L10 10M10 2L2 10" });
};

export const donut = (parts, { label = "Share" } = {}) => {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const R = 15.915;
  let offset = 25;
  const arcs = parts.map((p, i) => {
    const len = (p.value / total) * 100;
    const arc = s("circle", {
      class: `c-chart__arc c-chart__arc--${i % 5}`,
      cx: 21,
      cy: 21,
      r: R,
      fill: "none",
      "stroke-dasharray": `${Math.max(0, len - 0.6)} ${100 - Math.max(0, len - 0.6)}`,
      "stroke-dashoffset": offset,
    });
    offset -= len;
    return arc;
  });
  const svg = s(
    "svg",
    { class: "c-chart c-chart--donut", role: "img", "aria-label": label, viewBox: "0 0 42 42" },
    s("title", {}, `${label}: ${parts.map((p) => `${p.label} ${percent(p.value / total)}`).join(", ")}`),
    s("circle", { class: "c-chart__track", cx: 21, cy: 21, r: R, fill: "none" }),
    ...arcs,
  );
  const legend = h(
    "ul",
    { class: "c-chart__legend" },
    ...parts.map((p, i) =>
      h(
        "li",
        {},
        s(
          "svg",
          { class: "c-chart__key", viewBox: "0 0 12 12", width: 12, height: 12, "aria-hidden": "true" },
          marker(i),
        ),
        h("span", { class: "c-chart__legend-label" }, p.label),
        h("span", { class: "u-tabular" }, `${number(p.value)} · ${percent(p.value / total)}`),
      ),
    ),
  );
  const root = h("div", { class: "c-chart-donut" }, svg, legend);
  const redraw = frameOnce(() => {});
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(redraw).observe(root);
  return root;
};
