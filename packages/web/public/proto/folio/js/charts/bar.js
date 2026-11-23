/** Bar chart: columns or rows (chosen from label length), grouped or stacked, values labelled on the bars. */
import { h } from "../dom.js";
import { axisNum, dayHm, hm, num, toMs, truncate } from "../format.js";
import { axisKind, col, numeric, optCol, seriesColor } from "./data.js";
import { createChartHost } from "./host.js";
import { linear, niceScale, textWidth } from "./scales.js";
import { hatchPattern, root, s, uid } from "./svg.js";

const labelFor = (v, column) => {
  if (axisKind(column) !== "time") return String(v);
  const ms = toMs(v);
  return Number.isNaN(ms) ? String(v) : dayHm(ms).endsWith("00:00") ? dayHm(ms) : hm(ms);
};

export const mountBar = (container, { visual, result, title }) => {
  const ch = visual.channels;
  const xc = col(result, "x", ch.x);
  const yc = col(result, "y", ch.y);
  const cc = optCol(result, "color", ch.color);
  const unit = visual.options?.unit ?? "";
  const threshold = visual.threshold;

  const cats = [];
  const seriesKeys = [];
  const vals = new Map();
  for (const row of result.rows) {
    const cat = labelFor(row[xc.index], xc);
    const ser = cc ? String(row[cc.index]) : "";
    const v = numeric(row[yc.index]);
    if (v === null) continue;
    if (!vals.has(cat)) { vals.set(cat, new Map()); cats.push(cat); }
    if (!seriesKeys.includes(ser)) seriesKeys.push(ser);
    const m = vals.get(cat);
    m.set(ser, (m.get(ser) ?? 0) + v);
  }
  const ns = seriesKeys.length;
  const stacked = Boolean(visual.options?.stacked && cc);
  const totalOf = (cat) => [...vals.get(cat).values()].reduce((a, b) => a + b, 0);
  const topOf = (cat) => (stacked ? totalOf(cat) : Math.max(...vals.get(cat).values()));
  const horizontal = cats.length > 7 || cats.some((c) => c.length > 10);

  const all = cats.map(topOf);
  const lowAll = cats.flatMap((c) => [...vals.get(c).values()]);
  const vLo = Math.min(0, ...lowAll);
  const vHi = Math.max(0, ...all, threshold ? threshold.value : 0);
  const breached = (v) => Boolean(threshold) && v > threshold.value;

  const describe = () => {
    if (!cats.length) return "No bars to draw.";
    const ranked = [...cats].sort((a, b) => topOf(b) - topOf(a));
    const hi = ranked[0];
    const lo = ranked[ranked.length - 1];
    const above = threshold ? cats.filter((c) => breached(topOf(c))).length : 0;
    return `${cats.length} categories${ns > 1 ? `, ${ns} series${stacked ? ", stacked" : ""}` : ""}. Highest: ${hi}, ${num(topOf(hi), unit)}. Lowest: ${lo}, ${num(topOf(lo), unit)}.${threshold ? ` Threshold ${num(threshold.value, unit)}: ${above} above.` : ""}`;
  };

  const draw = ({ width, height, u }) => {
    const fs = u * 0.75;
    const svg = root(width, height, { title: `${title}. Bar chart`, desc: describe() });
    if (!cats.length) {
      svg.append(s("text", { x: width / 2, y: height / 2, "text-anchor": "middle" }, "No bars to draw."));
      return svg;
    }
    const catW = Math.max(...cats.map((c) => textWidth(truncate(c, 22), fs)));
    const top = u * (ns > 1 ? 2.6 : 1.8);
    let left; let right; let bottom;
    if (horizontal) { left = Math.min(width * 0.36, catW + u * 0.9); right = u * 3.4; bottom = fs * 2.6; }
    else { left = textWidth(axisNum(vHi), fs) + u * 1.1; right = u * 0.8; bottom = fs * 3.2; }
    const pw = width - left - right;
    const ph = height - top - bottom;
    const scale = niceScale(vLo, vHi, Math.max(3, Math.floor((horizontal ? pw / (u * 5) : ph / (u * 3.4)) + 1)));
    const vs = horizontal ? linear(scale.min, scale.max, left, left + pw) : linear(scale.min, scale.max, top + ph, top);
    const bw = (horizontal ? ph : pw) / cats.length;
    const groups = stacked || ns === 1 ? 1 : ns;
    const inner = bw * 0.72;
    const gw = inner / groups;
    const hatchId = uid("hatch");

    const rectFor = (ci, si, v0, v1) => {
      const start = (horizontal ? top : left) + ci * bw + (bw - inner) / 2 + (groups > 1 ? si * gw : 0);
      const a = vs(v0);
      const b = vs(v1);
      return horizontal
        ? { x: Math.min(a, b), y: start, width: Math.abs(b - a), height: gw }
        : { x: start, y: Math.min(a, b), width: gw, height: Math.abs(b - a) };
    };

    const grid = scale.ticks.map((t) =>
      horizontal
        ? [s("line", { x1: vs(t), x2: vs(t), y1: top, y2: top + ph }), s("text", { class: "tick-label", x: vs(t), y: top + ph + fs * 1.6, "text-anchor": "middle" }, axisNum(t))]
        : [s("line", { x1: left, x2: left + pw, y1: vs(t), y2: vs(t) }), s("text", { class: "tick-label", x: left - u * 0.5, y: vs(t) + fs * 0.35, "text-anchor": "end" }, axisNum(t))]);

    const catLabels = (() => {
      if (horizontal) {
        const maxChars = Math.max(4, Math.floor((left - u * 0.9) / (fs * 0.58)));
        return cats.map((c, ci) => s("text", { class: "tick-label", x: left - u * 0.5, y: top + ci * bw + bw / 2 + fs * 0.35, "text-anchor": "end" }, truncate(c, maxChars), s("title", null, c)));
      }
      const stride = Math.max(1, Math.ceil((catW + u) / bw));
      return cats.map((c, ci) => (ci % stride ? null : s("text", { class: "tick-label", x: left + ci * bw + bw / 2, y: top + ph + fs * 1.7, "text-anchor": "middle" }, truncate(c, 12), s("title", null, c))));
    })();

    const bars = [];
    const labels = [];
    cats.forEach((cat, ci) => {
      let acc = 0;
      seriesKeys.forEach((ser, si) => {
        const v = vals.get(cat).get(ser);
        if (v === undefined) return;
        const [v0, v1] = stacked ? [acc, acc + v] : [0, v];
        acc += v;
        const r = rectFor(ci, si, v0, v1);
        const tip = s("title", null, `${cat}${cc ? ` · ${ser}` : ""}: ${num(v, unit)}`);
        bars.push(s("rect", { class: "bar", ...r, style: `fill:${seriesColor(cc ? si : 0)}` }, tip));
        const last = !stacked || si === seriesKeys.length - 1 || [...seriesKeys.slice(si + 1)].every((k) => vals.get(cat).get(k) === undefined);
        const shown = stacked ? totalOf(cat) : v;
        const hot = breached(shown);
        if (hot && last) bars.push(s("rect", { class: "bar-hatch", ...r, fill: `url(#${hatchId})` }));
        if (!last) return;
        const text = `${hot ? "▲ " : ""}${num(shown, unit)}`;
        if (horizontal && gw >= fs * 1.05) {
          labels.push(s("text", { class: hot ? "value-label breach-glyph" : "value-label", x: Math.max(r.x + r.width, vs(0)) + 5, y: r.y + r.height / 2 + fs * 0.35 }, text));
        } else if (!horizontal && gw >= textWidth(text, fs) * 0.9) {
          labels.push(s("text", { class: hot ? "value-label breach-glyph" : "value-label", x: r.x + r.width / 2, y: r.y - 5, "text-anchor": "middle" }, text));
        }
      });
    });

    const parts = [];
    if (threshold && threshold.value >= scale.min && threshold.value <= scale.max) {
      const t = vs(threshold.value);
      const text = `Threshold ${num(threshold.value, unit)}`;
      parts.push(horizontal
        ? [s("line", { class: "threshold-line", x1: t, x2: t, y1: top, y2: top + ph }), s("text", { class: "threshold-label", x: t + 4, y: top - 6 }, text)]
        : [s("line", { class: "threshold-line", x1: left, x2: left + pw, y1: t, y2: t }), s("text", { class: "threshold-label", x: left + pw, y: t - 5, "text-anchor": "end" }, text)]);
    }

    const axis = horizontal
      ? s("line", { class: "axis-line", x1: vs(0), x2: vs(0), y1: top, y2: top + ph })
      : s("line", { class: "axis-line", x1: left, x2: left + pw, y1: vs(0), y2: vs(0) });
    const axisTitle = s("text", { class: "axis-title", x: horizontal ? left : left, y: top - u * (ns > 1 ? 1.5 : 0.7) }, `${yc.name}${unit ? ` (${unit})` : ""}`);

    svg.append(s("defs", null, hatchPattern(hatchId)), s("g", { class: "grid" }, grid), axis, catLabels, bars, labels, parts, axisTitle);
    return svg;
  };

  const host = createChartHost(container, draw);
  let key = null;
  if (ns > 1) {
    key = h("ul", { class: "series-key", role: "list", "aria-label": "Series" },
      seriesKeys.map((k, i) => h("li", { style: { "--c": seriesColor(i) } }, h("i", { "aria-hidden": "true" }), k || yc.name)));
    container.append(key);
  }
  return { dispose() { host.dispose(); key?.remove(); } };
};
