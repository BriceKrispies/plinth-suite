import { s } from "../dom.js";
import { num, plural } from "../format.js";
import { col, extent, numeric, optCol } from "./data.js";
import { chartFrame, legend } from "./frame.js";
import { hatch, marker } from "./marks.js";
import { band, linear, niceScale, truncate } from "./scales.js";

/** Vertical bars: one per category, grouped or stacked by the optional colour channel. */
export const barChart = ({ result, visual, title }) => {
  const x = col(result, "x", visual.channels.x);
  const y = col(result, "y", visual.channels.y);
  const colour = optCol(result, "color", visual.channels.color);
  const unit = visual.options?.unit;
  const limit = visual.threshold?.value;
  const stacked = visual.options?.stacked === true && colour !== undefined;

  const cats = [];
  const names = [];
  const cells = new Map(); // `${cat}\u0000${name}` -> value
  for (const row of result.rows) {
    const cat = String(row[x.index]);
    const name = colour ? String(row[colour.index]) : y.name;
    const v = numeric(row[y.index]);
    if (v === null) continue;
    if (!cats.includes(cat)) cats.push(cat);
    if (!names.includes(name)) names.push(name);
    const key = `${cat}\u0000${name}`;
    cells.set(key, (cells.get(key) ?? 0) + v);
  }
  const value = (cat, name) => cells.get(`${cat}\u0000${name}`);
  const bars = [];
  for (const [ci, cat] of cats.entries()) {
    let acc = 0;
    for (const [ni, name] of names.entries()) {
      const v = value(cat, name);
      if (v === undefined) continue;
      bars.push(stacked ? { cat, ci, name, ni, v, y0: acc, y1: (acc += v) } : { cat, ci, name, ni, v, y0: 0, y1: v });
    }
  }
  const over = (b) => limit !== undefined && b.v > limit;
  const breaches = bars.filter(over).length;
  const [vLo, vHi] = extent(bars.flatMap((b) => [b.y0, b.y1]));

  const desc =
    `Bar chart of ${y.name} by ${x.name}${colour ? `, ${stacked ? "stacked" : "grouped"} by ${colour.name}` : ""}. ` +
    `${plural(cats.length, "category", "categories")}, highest ${num(vHi)}${unit ? ` ${unit}` : ""}.` +
    `${limit === undefined ? "" : ` Limit ${num(limit)}; ${breaches === 0 ? "no bar exceeds it" : `${plural(breaches, "bar")} exceed it`}.`}` +
    " The same rows are available as a table.";

  return chartFrame({
    title: `${title}: bar chart`,
    desc,
    className: "chart-bar",
    note: breaches > 0 ? { text: `${plural(breaches, "bar")} above the limit of ${num(limit, unit)}`, tone: "bad" } : null,
    legendEl: names.length > 1 ? legend(names.map((name, index) => ({ name, index, shape: "square" }))) : null,
    draw: ({ g, width: W, height: H, rem, id }) => {
      const fs = rem * 0.78;
      const yScale = niceScale(Math.min(0, vLo), Math.max(vHi, limit ?? -Infinity), Math.max(2, Math.floor(H / (rem * 3.6))));
      const ticks = yScale.ticks.map((v) => ({ v, label: yScale.label(v) }));
      const longest = Math.min(14, Math.max(1, ...cats.map((c) => c.length)));
      const m = { top: rem * 1.7, right: rem, bottom: rem * 2.1, left: Math.max(...ticks.map((t) => t.label.length), 2) * fs * 0.62 + rem * 1.2 };
      const pw = W - m.left - m.right;
      const rotate = pw / Math.max(1, cats.length) < longest * fs * 0.6;
      if (rotate) m.bottom = longest * fs * 0.5 + rem * 1.2;
      const ph = H - m.top - m.bottom;
      if (pw < 20 || ph < 20) return;

      const Y = linear(yScale.domain[0], yScale.domain[1], m.top + ph, m.top);
      const outer = band(cats.length, m.left, m.left + pw, 0.3);
      const inner = stacked ? 1 : names.length;
      const bw = outer.bandwidth / inner;

      g.append(hatch(`${id}-hatch`));
      const grid = s("g", { class: "gridlines" });
      for (const t of ticks) {
        grid.append(s("line", { x1: m.left, x2: m.left + pw, y1: Y(t.v), y2: Y(t.v) }));
        g.append(s("text", { class: "tick", x: m.left - rem * 0.5, y: Y(t.v), dy: "0.32em", "text-anchor": "end" }, t.label));
      }
      g.prepend(grid);
      g.append(s("text", { class: "axis-title", x: m.left - rem * 0.5, y: m.top - rem * 0.8 }, `${y.name}${unit ? ` (${unit})` : ""}`));

      const baseline = Y(Math.max(yScale.domain[0], Math.min(0, yScale.domain[1])));
      g.append(s("line", { class: "axis-line", x1: m.left, x2: m.left + pw, y1: baseline, y2: baseline }));
      for (const [i, cat] of cats.entries()) {
        const cx = outer.start(i) + outer.bandwidth / 2;
        const attrs = rotate
          ? { class: "tick", x: cx, y: m.top + ph + rem * 0.9, "text-anchor": "end", transform: `rotate(-38 ${cx} ${m.top + ph + rem * 0.9})` }
          : { class: "tick", x: cx, y: m.top + ph + rem * 1.35, "text-anchor": "middle" };
        g.append(s("text", attrs, s("title", null, cat), truncate(cat, 14)));
      }

      for (const b of bars) {
        const xPos = outer.start(b.ci) + (stacked ? 0 : b.ni * bw);
        const top = Math.min(Y(b.y0), Y(b.y1));
        const height = Math.max(1, Math.abs(Y(b.y0) - Y(b.y1)));
        const tip = `${b.cat}${colour ? ` · ${b.name}` : ""}: ${num(b.v, unit)}${over(b) ? " (above limit)" : ""}`;
        const rect = { x: xPos, y: top, width: Math.max(1, bw - (stacked || inner === 1 ? 0 : 1.5)), height, rx: 2 };
        g.append(s("rect", { class: `mark bar series-${b.ni % 6}${over(b) ? " is-breach" : ""}`, ...rect, "data-tip": tip }));
        if (over(b)) {
          g.append(
            s("rect", { class: "bar-hatch", ...rect, fill: `url(#${id}-hatch)`, "pointer-events": "none" }),
            s("path", { class: "breach-mark", d: marker("triangle", xPos + rect.width / 2, top - rem * 0.55, rem * 0.36), "pointer-events": "none" }),
          );
        }
      }
      if (limit !== undefined && limit >= yScale.domain[0] && limit <= yScale.domain[1]) {
        g.append(
          s("line", { class: "limit-line", x1: m.left, x2: m.left + pw, y1: Y(limit), y2: Y(limit) }),
          s("text", { class: "limit-label", x: m.left + pw, y: Y(limit) - rem * 0.35, "text-anchor": "end" }, `Limit ${num(limit, unit)}`),
        );
      }
    },
  });
};
