import { h, s } from "../dom.js";
import { num, plural } from "../format.js";
import { col, extent, numeric } from "./data.js";
import { chartFrame } from "./frame.js";
import { hatch } from "./marks.js";
import { truncate } from "./scales.js";

/** Category by category grid. Intensity comes from a CSS ramp (`--t`), so the theme owns the colours. */
export const heatmapChart = ({ result, visual, title }) => {
  const x = col(result, "x", visual.channels.x);
  const y = col(result, "y", visual.channels.y);
  const val = col(result, "value", visual.channels.value);
  const unit = visual.options?.unit;
  const limit = visual.threshold?.value;

  const xs = [];
  const ys = [];
  const cells = new Map();
  for (const row of result.rows) {
    const cx = String(row[x.index]);
    const cy = String(row[y.index]);
    if (!xs.includes(cx)) xs.push(cx);
    if (!ys.includes(cy)) ys.push(cy);
    cells.set(`${cx}\u0000${cy}`, numeric(row[val.index]));
  }
  const values = [...cells.values()].filter((v) => v !== null);
  const [lo, hi] = visual.options?.domain ?? (() => {
    const [a, b] = extent(values);
    return [Math.min(0, a), Math.max(1, b)];
  })();
  const t = (v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo || 1)));
  const breached = [];
  for (const cy of ys) for (const cx of xs) {
    const v = cells.get(`${cx}\u0000${cy}`);
    if (limit !== undefined && v !== null && v !== undefined && v > limit) breached.push(`${cx} / ${cy}`);
  }

  const desc =
    `Heatmap of ${val.name} by ${x.name} (${xs.length} columns) and ${y.name} (${ys.length} rows). ` +
    `Values range ${num(lo)} to ${num(hi)}${unit ? ` ${unit}` : ""}.` +
    `${limit === undefined ? "" : ` Limit ${num(limit)}; ${breached.length === 0 ? "no cell exceeds it" : `exceeded in ${breached.join(", ")}`}.`}` +
    " The same rows are available as a table.";

  const ramp = h(
    "div",
    { class: "ramp", "aria-hidden": "true" },
    h("span", null, num(lo)),
    h("span", { class: "ramp-bar", style: limit !== undefined && limit > lo && limit < hi ? `--at:${t(limit) * 100}%` : null }, limit !== undefined && limit > lo && limit < hi ? h("i", { class: "ramp-limit" }) : null),
    h("span", null, `${num(hi)}${unit ? ` ${unit}` : ""}`),
  );

  return chartFrame({
    title: `${title}: heatmap`,
    desc,
    className: "chart-heatmap",
    note: breached.length > 0 ? { text: `Above the limit of ${num(limit, unit)}: ${breached.join(", ")}`, tone: "bad" } : null,
    legendEl: ramp,
    draw: ({ g, width: W, height: H, rem, id }) => {
      const fs = rem * 0.78;
      const labelW = Math.min(W * 0.32, Math.max(...ys.map((c) => Math.min(c.length, 16)), 2) * fs * 0.62 + rem * 0.8);
      const m = { top: rem * 1.7, right: 2, bottom: rem * 0.4, left: labelW };
      const pw = W - m.left - m.right;
      const ph = H - m.top - m.bottom;
      if (pw < 20 || ph < 20) return;
      const cw = pw / xs.length;
      const ch = ph / ys.length;
      const gap = Math.min(3, cw * 0.06, ch * 0.06);

      g.append(hatch(`${id}-hatch`));
      const stride = Math.max(1, Math.ceil((Math.min(14, Math.max(...xs.map((c) => c.length))) * fs * 0.6) / cw));
      xs.forEach((cx, i) => {
        if (i % stride) return;
        g.append(s("text", { class: "tick", x: m.left + cw * (i + 0.5), y: m.top - rem * 0.5, "text-anchor": "middle" }, s("title", null, cx), truncate(cx, Math.max(4, Math.floor(cw / (fs * 0.6))))));
      });
      ys.forEach((cy, j) => {
        g.append(s("text", { class: "tick", x: m.left - rem * 0.5, y: m.top + ch * (j + 0.5), dy: "0.32em", "text-anchor": "end" }, s("title", null, cy), truncate(cy, 16)));
      });

      const showLabels = cw > fs * 2.4 && ch > fs * 1.6;
      ys.forEach((cy, j) => {
        xs.forEach((cx, i) => {
          const v = cells.get(`${cx}\u0000${cy}`);
          const rx = m.left + cw * i + gap / 2;
          const ry = m.top + ch * j + gap / 2;
          const w = cw - gap;
          const hh = ch - gap;
          if (v === undefined || v === null) {
            g.append(s("rect", { class: "cell cell-empty", x: rx, y: ry, width: w, height: hh, rx: 3 }, s("title", null, `${cx} / ${cy}: no value`)));
            return;
          }
          const over = limit !== undefined && v > limit;
          const tt = t(v);
          const tip = `${cx} / ${cy}: ${num(v, unit)}${over ? " (above limit)" : ""}`;
          g.append(s("rect", { class: `mark cell${over ? " is-breach" : ""}`, x: rx, y: ry, width: w, height: hh, rx: 3, style: `--t:${tt.toFixed(3)}`, "data-tip": tip }));
          if (over) {
            g.append(
              s("rect", { class: "cell-hatch", x: rx, y: ry, width: w, height: hh, rx: 3, fill: `url(#${id}-hatch)`, "pointer-events": "none" }),
              s("rect", { class: "cell-ring", x: rx + 1, y: ry + 1, width: w - 2, height: hh - 2, rx: 3, "pointer-events": "none" }),
            );
          }
          if (showLabels)
            g.append(s("text", { class: "cell-label", x: rx + w / 2, y: ry + hh / 2, dy: "0.34em", "text-anchor": "middle", ...(tt > 0.58 ? { "data-hi": "" } : {}), "pointer-events": "none" }, `${over ? "▲ " : ""}${num(v)}`));
        });
      });
    },
  });
};

