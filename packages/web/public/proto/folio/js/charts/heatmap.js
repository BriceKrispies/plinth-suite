/** Heatmap: cells coloured by value; cells above the threshold carry a hatch, a heavy outline and a triangle. */
import { axisNum, num, truncate } from "../format.js";
import { col, numeric } from "./data.js";
import { createChartHost } from "./host.js";
import { textWidth } from "./scales.js";
import { hatchPattern, root, s, uid } from "./svg.js";

export const mountHeatmap = (container, { visual, result, title }) => {
  const ch = visual.channels;
  const xc = col(result, "x", ch.x);
  const yc = col(result, "y", ch.y);
  const vc = col(result, "value", ch.value);
  const unit = visual.options?.unit ?? "";
  const threshold = visual.threshold;

  const xs = [...new Set(result.rows.map((r) => String(r[xc.index])))];
  const ys = [...new Set(result.rows.map((r) => String(r[yc.index])))];
  const grid = new Map();
  for (const r of result.rows) grid.set(`${String(r[xc.index])}\u0000${String(r[yc.index])}`, numeric(r[vc.index]));
  const present = [...grid.values()].filter((v) => v !== null);
  let [dLo, dHi] = visual.options?.domain ?? [Math.min(...present), Math.max(...present, threshold ? threshold.value : -Infinity)];
  if (!Number.isFinite(dLo) || !Number.isFinite(dHi)) { dLo = 0; dHi = 1; }
  if (dLo === dHi) dHi = dLo + 1;
  const breached = (v) => v !== null && Boolean(threshold) && v > threshold.value;

  const describe = () => {
    if (!present.length) return "No values.";
    const hot = [...grid].filter(([, v]) => breached(v)).map(([k, v]) => `${k.split("\u0000").join(" / ")} ${num(v, unit)}`);
    const peak = [...grid].filter(([, v]) => v !== null).sort((a, b) => b[1] - a[1])[0];
    return `${ys.length} rows by ${xs.length} columns of ${vc.name}. Peak: ${peak[0].split("\u0000").join(" / ")}, ${num(peak[1], unit)}.${threshold ? ` Threshold ${num(threshold.value, unit)}: ${hot.length ? `breached by ${hot.join("; ")}` : "not breached"}.` : ""}`;
  };

  const draw = ({ width, height, u }) => {
    const fs = u * 0.75;
    const svg = root(width, height, { title: `${title}. Heatmap`, desc: describe() });
    if (!present.length) {
      svg.append(s("text", { x: width / 2, y: height / 2, "text-anchor": "middle" }, "No values to colour."));
      return svg;
    }
    const left = Math.min(width * 0.3, Math.max(...ys.map((y) => textWidth(truncate(y, 18), fs))) + u * 0.8);
    const top = fs * 3.2;
    const keyH = fs * 3.4;
    const pw = width - left;
    const ph = height - top - keyH;
    const cw = pw / xs.length;
    const chh = ph / ys.length;
    const hatchId = uid("hatch");
    const gradId = uid("grad");
    const maxChars = Math.max(4, Math.floor((left - u * 0.8) / (fs * 0.58)));

    const colLabels = xs.map((x, i) => s("text", { class: "tick-label", x: left + i * cw + cw / 2, y: top - fs * 0.9, "text-anchor": "middle" }, truncate(x, Math.max(3, Math.floor(cw / (fs * 0.58))))));
    const rowLabels = ys.map((y, j) => s("text", { class: "tick-label", x: left - u * 0.5, y: top + j * chh + chh / 2 + fs * 0.35, "text-anchor": "end" }, truncate(y, maxChars), s("title", null, y)));
    const title2 = s("text", { class: "axis-title", x: 0, y: fs * 0.9 }, `${yc.name} × ${xc.name} · ${vc.name}${unit ? ` (${unit})` : ""}`);

    const cells = [];
    ys.forEach((y, j) => xs.forEach((x, i) => {
      const v = grid.get(`${x}\u0000${y}`);
      const gx = left + i * cw;
      const gy = top + j * chh;
      const tip = s("title", null, `${y} / ${x}: ${v === null || v === undefined ? "no value" : num(v, unit)}${breached(v) ? " (above threshold)" : ""}`);
      if (v === null || v === undefined) {
        cells.push(s("rect", { class: "heat-cell", "data-empty": "", x: gx + 1, y: gy + 1, width: Math.max(0, cw - 2), height: Math.max(0, chh - 2) }, tip));
        return;
      }
      const t = Math.max(0, Math.min(1, (v - dLo) / (dHi - dLo)));
      const dense = t > 0.5;
      const hot = breached(v);
      cells.push(s("rect", { class: "heat-cell", "data-breach": hot ? "" : null, x: gx + 1, y: gy + 1, width: Math.max(0, cw - 2), height: Math.max(0, chh - 2), style: `fill:color-mix(in oklch, var(--heat-lo), var(--heat-hi) ${(t * 100).toFixed(1)}%)` }, tip));
      if (hot) cells.push(s("rect", { class: "bar-hatch", x: gx + 2, y: gy + 2, width: Math.max(0, cw - 4), height: Math.max(0, chh - 4), fill: `url(#${hatchId})`, "pointer-events": "none" }));
      const text = num(v);
      if (cw > textWidth(text, fs * 1.1) + 6 && chh > fs * 1.6) {
        cells.push(s("text", { class: "heat-text", "data-dense": dense ? "" : null, x: gx + cw / 2, y: gy + chh / 2 + fs * 0.4, "text-anchor": "middle", style: `font-size:${(fs * 1.1).toFixed(1)}px` }, text));
        if (hot && cw > textWidth(text, fs * 1.1) + fs * 2.4) cells.push(s("text", { class: "heat-glyph", "data-dense": dense ? "" : null, x: gx + cw - 6, y: gy + fs * 1.3, "text-anchor": "end" }, "▲"));
      } else if (hot) {
        cells.push(s("text", { class: "heat-glyph", "data-dense": dense ? "" : null, x: gx + cw / 2, y: gy + chh / 2 + fs * 0.4, "text-anchor": "middle" }, "▲"));
      }
    }));

    // Scale key: a gradient ramp with its ends labelled, and the threshold marked on it.
    const kx = left;
    const kw = Math.min(pw, u * 16);
    const ky = height - keyH + fs * 1.1;
    const keyParts = [
      s("defs", null,
        s("linearGradient", { id: gradId, x1: 0, x2: 1, y1: 0, y2: 0 },
          s("stop", { offset: 0, style: "stop-color:var(--heat-lo)" }),
          s("stop", { offset: 1, style: "stop-color:var(--heat-hi)" })),
        hatchPattern(hatchId)),
      s("rect", { x: kx, y: ky, width: kw, height: fs * 0.7, fill: `url(#${gradId})`, stroke: "var(--rule-strong)", "stroke-width": 1 }),
      s("text", { class: "tick-label", x: kx, y: ky + fs * 1.9 }, axisNum(dLo)),
      s("text", { class: "tick-label", x: kx + kw, y: ky + fs * 1.9, "text-anchor": "end" }, axisNum(dHi)),
    ];
    if (threshold && threshold.value > dLo && threshold.value < dHi) {
      const tx = kx + ((threshold.value - dLo) / (dHi - dLo)) * kw;
      keyParts.push(
        s("line", { class: "threshold-line", x1: tx, x2: tx, y1: ky - 3, y2: ky + fs * 0.7 + 3 }),
        s("text", { class: "threshold-label", x: tx, y: ky + fs * 1.9, "text-anchor": "middle" }, `▲ ${axisNum(threshold.value)}`));
    }
    svg.append(title2, ...colLabels, ...rowLabels, ...cells, ...keyParts);
    return svg;
  };

  const host = createChartHost(container, draw);
  return { dispose: () => host.dispose() };
};
