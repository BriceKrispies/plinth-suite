/** KPI: the last row's value as a serif numeral, its delta in words, and an optional trend line. */
import { h } from "../dom.js";
import { num } from "../format.js";
import { axisKind, axisValue, col, numeric, optCol } from "./data.js";
import { s } from "./svg.js";

const sparkline = (result, ch, label) => {
  const x = optCol(result, "x", ch.x);
  const y = optCol(result, "y", ch.y);
  if (!x || !y || result.rows.length < 2) return null;
  const kind = axisKind(x);
  const pts = result.rows
    .map((r) => [axisValue(r[x.index], kind === "category" ? "value" : kind), numeric(r[y.index])])
    .filter(([a, b]) => Number.isFinite(a) && b !== null)
    .sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return null;
  const [x0, x1] = [pts[0][0], pts[pts.length - 1][0]];
  const ys = pts.map((p) => p[1]);
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const W = 200;
  const H = 48;
  const X = (v) => ((v - x0) / (x1 - x0 || 1)) * W;
  const Y = (v) => H - 3 - ((v - y0) / (y1 - y0 || 1)) * (H - 6);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join("");
  return s("svg", { class: "kpi__spark", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label": `${label} trend over ${pts.length} points, from ${num(ys[0])} to ${num(ys[ys.length - 1])}` },
    s("path", { class: "fill", d: `${line}L${W} ${H}L0 ${H}Z` }),
    s("path", { class: "line", d: line }));
};

export const mountKpi = (container, { visual, result, title }) => {
  const ch = visual.channels;
  const value = col(result, "value", ch.value);
  const delta = optCol(result, "delta", ch.delta);
  const last = result.rows[result.rows.length - 1];
  const v = last ? numeric(last[value.index]) : null;
  const d = last && delta ? numeric(last[delta.index]) : null;
  const unit = visual.options?.unit;
  const over = visual.threshold !== undefined && v !== null && v > visual.threshold.value;
  const good = visual.options?.good ?? "up";
  const tone = d === null || d === 0 ? "flat" : (d > 0) === (good === "up") ? "good" : "bad";
  const word = d === null ? "" : d > 0 ? "up" : d < 0 ? "down" : "unchanged";

  const el = h("div", { class: "kpi", dataset: { tone, ...(over ? { over: "" } : {}) } },
    h("p", { class: "kpi__figure" },
      h("span", { class: "kpi__value" }, v === null ? "—" : num(v)),
      unit ? h("span", { class: "kpi__unit" }, unit) : null),
    d === null ? null : h("p", { class: "kpi__delta" },
      h("span", { "aria-hidden": "true" }, d > 0 ? "▲" : d < 0 ? "▼" : "▬"),
      h("span", null, `${word} ${d === 0 ? "" : num(Math.abs(d))}`.trim())),
    over ? h("p", { class: "kpi__flag" }, `▲ Above threshold ${num(visual.threshold.value, unit)}`) : null,
    sparkline(result, ch, title));
  container.append(el);
  return { dispose: () => el.remove() };
};
