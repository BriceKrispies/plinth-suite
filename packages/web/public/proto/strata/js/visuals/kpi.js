import { h, s } from "../dom.js";
import { num } from "../format.js";
import { axisKind, axisValue, col, numeric, optCol } from "./data.js";

const SPARK_W = 120;
const SPARK_H = 36;

const sparkline = (points, label) => {
  const lo = Math.min(...points.map((p) => p.y));
  const hi = Math.max(...points.map((p) => p.y));
  const x0 = points[0].x;
  const x1 = points.at(-1).x;
  const px = (v) => ((v - x0) / (x1 - x0 || 1)) * SPARK_W;
  const py = (v) => SPARK_H - 3 - ((v - lo) / (hi - lo || 1)) * (SPARK_H - 6);
  const d = points.map((p, i) => `${i ? "L" : "M"}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");
  const last = points.at(-1);
  return s("svg", {
    class: "spark", viewBox: `0 0 ${SPARK_W} ${SPARK_H}`, preserveAspectRatio: "none", role: "img", "aria-label": label,
  },
    s("path", { class: "spark__area", d: `${d} L${SPARK_W},${SPARK_H} L0,${SPARK_H} Z` }),
    s("path", { class: "spark__line", d }),
    s("circle", { class: "spark__end", cx: px(last.x), cy: py(last.y), r: 2.5, "vector-effect": "non-scaling-stroke" }));
};

/** KPI tile: the last row's value and delta, with an optional sparkline from x and y. */
export function mountKpi(host, { result, visual }) {
  const valueCol = col(result, "value", visual.channels.value);
  const deltaCol = optCol(result, "delta", visual.channels.delta);
  const xCol = optCol(result, "x", visual.channels.x);
  const yCol = optCol(result, "y", visual.channels.y);
  const last = result.rows.at(-1);
  const value = last ? numeric(last[valueCol.index]) : null;
  const delta = last && deltaCol ? numeric(last[deltaCol.index]) : null;
  const unit = visual.options?.unit;
  const good = visual.options?.good ?? "up";
  const breach = visual.threshold !== undefined && value !== null && value > visual.threshold.value;
  const tone = delta === null || delta === 0 ? "flat" : delta > 0 === (good === "up") ? "good" : "bad";

  let spark = null;
  if (xCol && yCol) {
    const kind = axisKind(xCol);
    const points = result.rows
      .map((r) => ({ x: kind === "category" ? 0 : axisValue(r[xCol.index], kind), y: numeric(r[yCol.index]) }))
      .filter((p) => p.y !== null && !Number.isNaN(p.x));
    if (kind === "category") points.forEach((p, i) => { p.x = i; });
    if (points.length > 1) {
      spark = sparkline(points, `Trend of ${yCol.name}, ${points.length} points, from ${num(points[0].y, unit)} to ${num(points.at(-1).y, unit)}`);
    }
  }

  const direction = delta === null ? "" : delta > 0 ? "▲" : delta < 0 ? "▼" : "▬";
  const deltaText = delta === null ? null : delta > 0 ? `+${num(delta)}` : num(delta);
  const meaning = tone === "good" ? "favourable" : tone === "bad" ? "unfavourable" : "unchanged";

  host.replaceChildren(
    h("div", { class: "kpi", dataset: { breach: breach ? "true" : "false" } },
      h("p", { class: "kpi__figure" },
        h("span", { class: "kpi__value" }, value === null ? "—" : num(value)),
        unit ? h("span", { class: "kpi__unit" }, unit) : null),
      h("div", { class: "kpi__meta" },
        delta === null ? null : h("p", { class: "delta", dataset: { tone } },
          h("span", { "aria-hidden": "true" }, direction), " ", deltaText,
          h("span", { class: "sr-only" }, ` change, ${meaning}`)),
        breach ? h("p", { class: "flag flag--inline" }, `▲ Above limit ${num(visual.threshold.value, unit)}`) : null),
      spark));
  return { breaches: breach ? 1 : 0, destroy() {} };
}
