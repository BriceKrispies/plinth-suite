import { h, s, uid } from "../dom.js";
import { num } from "../format.js";

/** Shared chart plumbing: scales, ticks, the measured plot, legend, tooltip and threshold marks. */
export const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

const niceStep = (raw) => {
  const base = 10 ** Math.floor(Math.log10(raw));
  const f = raw / base;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * base;
};

export const niceScale = (min, max, count = 5) => {
  let lo = min;
  let hi = max;
  if (!(hi > lo)) {
    const pad = Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const step = niceStep((hi - lo) / Math.max(1, count));
  const first = Math.floor(lo / step);
  const last = Math.ceil(hi / step);
  const ticks = [];
  for (let i = first; i <= last; i += 1) ticks.push(+(i * step).toFixed(10));
  return { lo: first * step, hi: last * step, ticks };
};

export const linear = (d0, d1, r0, r1) => {
  const k = (r1 - r0) / (d1 - d0 || 1);
  const f = (v) => r0 + (v - d0) * k;
  f.invert = (p) => d0 + (p - r0) / k;
  return f;
};

const MIN = 60e3;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TIME_STEPS = [MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 30 * DAY];

/** Ticks on round local times rather than evenly spaced instants. */
export const timeTicks = (min, max, count) => {
  const step = TIME_STEPS.find((t) => (max - min) / t <= count) ?? TIME_STEPS.at(-1);
  const offset = new Date(min).getTimezoneOffset() * MIN;
  const ticks = [];
  for (let t = Math.ceil((min - offset) / step) * step + offset; t <= max; t += step) ticks.push(t);
  return ticks.length >= 2 ? ticks : [min, max];
};

export const triangle = (x, y, r) => `M${x},${y - r} L${x + r},${y + r * 0.8} L${x - r},${y + r * 0.8} Z`;

export const legendList = (names) =>
  names.length < 2
    ? null
    : h("ul", { class: "legend", "aria-label": "Series" },
        names.map((name, i) =>
          h("li", { class: "legend__item" },
            h("span", { class: "swatch", dataset: { s: i % 6 }, "aria-hidden": "true" }), name)));

export const hatchDef = (id) =>
  s("defs", null,
    s("pattern", { id, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
      s("line", { x1: 0, y1: 0, x2: 0, y2: 6, class: "hatch" })));

/** The accessible root of a chart: role="img" named by a title and described by a desc. */
export const chartSvg = (width, height, label, description) => {
  const id = uid("chart");
  return s("svg", {
    class: "plot", viewBox: `0 0 ${width} ${height}`, width, height, role: "img",
    "aria-labelledby": `${id}-title ${id}-desc`,
  }, s("title", { id: `${id}-title` }, label), s("desc", { id: `${id}-desc` }, description));
};

export const yAxis = (ticks, y, format, left, right) =>
  s("g", { class: "axis axis--y" },
    ticks.map((t) =>
      s("g", null,
        s("line", { class: "grid", x1: left, x2: right, y1: y(t), y2: y(t) }),
        s("text", { x: left - 8, y: y(t), dy: "0.32em", "text-anchor": "end" }, format(t)))));

export const thresholdMark = (threshold, y, left, right, unit) =>
  s("g", { class: "threshold" },
    s("line", {
      class: threshold.style === "solid" ? "threshold__line" : "threshold__line threshold__line--dashed",
      x1: left, x2: right, y1: y(threshold.value), y2: y(threshold.value),
    }),
    s("text", { class: "threshold__label", x: right, y: y(threshold.value) - 6, "text-anchor": "end" },
      `▲ Limit ${num(threshold.value, unit)}`));

/**
 * A chart host: optional legend row, then a plot that is measured and redrawn whenever it resizes.
 * `draw({width, height, rem, tooltip})` must return an svg element.
 */
export function mountPlot(host, { legend, hint, draw }) {
  const plot = h("div", { class: "chart__plot" });
  const tipTitle = h("p", { class: "tip__title" });
  const tipRows = h("ul", { class: "tip__rows" });
  const tip = h("div", { class: "tip", hidden: true, "aria-hidden": "true" }, tipTitle, tipRows);
  plot.append(tip);
  const top = legend || hint ? h("div", { class: "chart__top" }, legend, hint) : null;
  host.replaceChildren(h("div", { class: "chart" }, top, plot));

  const tooltip = {
    show(x, y, width, title, rows) {
      tipTitle.textContent = title;
      tipRows.replaceChildren(
        ...rows.map((r) =>
          h("li", null,
            r.s === undefined ? null : h("span", { class: "swatch", dataset: { s: r.s % 6 } }),
            h("span", { class: "tip__key" }, r.label),
            h("b", null, r.value))));
      tip.hidden = false;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
      tip.dataset.flip = x > width / 2 ? "left" : "right";
    },
    hide() {
      tip.hidden = true;
    },
  };

  let svg;
  let frame = 0;
  const observer = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (width < 8 || height < 8) return;
      const next = draw({ width, height, rem: remPx(), tooltip });
      svg?.remove();
      plot.prepend(next);
      svg = next;
    });
  });
  observer.observe(plot);

  return {
    breaches: 0,
    destroy() {
      observer.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}
