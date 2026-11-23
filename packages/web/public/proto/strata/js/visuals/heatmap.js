import { s, uid } from "../dom.js";
import { num } from "../format.js";
import { col, numeric } from "./data.js";
import { chartSvg, hatchDef, mountPlot, triangle } from "./core.js";

const clip = (text, room) => (text.length <= room ? text : `${text.slice(0, Math.max(1, room - 1))}…`);

/**
 * Heatmap: a sequential scale from one hue. Cells over the threshold carry a hatch, a heavier outline and a
 * triangle glyph in addition to colour, so the breach survives greyscale and colour-vision differences.
 */
export function mountHeatmap(host, { result, visual }) {
  const xc = col(result, "x", visual.channels.x);
  const yc = col(result, "y", visual.channels.y);
  const vc = col(result, "value", visual.channels.value);
  const unit = visual.options?.unit;
  const threshold = visual.threshold;

  const xs = [...new Set(result.rows.map((r) => String(r[xc.index])))];
  const ys = [...new Set(result.rows.map((r) => String(r[yc.index])))];
  const cells = result.rows.map((r) => ({ x: xs.indexOf(String(r[xc.index])), y: ys.indexOf(String(r[yc.index])), v: numeric(r[vc.index]) }));
  const values = cells.map((c) => c.v).filter((v) => v !== null);
  const [min, max] = visual.options?.domain ?? [Math.min(0, ...values), Math.max(1, ...values)];
  const breached = cells.filter((c) => threshold && c.v !== null && c.v > threshold.value);
  const grid = new Map(cells.map((c) => [`${c.x}:${c.y}`, c]));
  const t = (v) => Math.min(1, Math.max(0, (v - min) / (max - min || 1)));

  const handle = mountPlot(host, {
    draw({ width, height, rem }) {
      const fs = rem * 0.75;
      const gap = 3;
      const rowLabel = Math.min(width * 0.3, Math.ceil(Math.max(...ys.map((l) => l.length)) * fs * 0.6) + rem * 0.6);
      const legendH = rem * 2.2;
      const headH = rem * 1.6;
      const gridW = width - rowLabel;
      const gridH = height - legendH - headH;
      const cw = gridW / xs.length;
      const ch = gridH / ys.length;

      const over = breached.map((c) => `${ys[c.y]} / ${xs[c.x]} ${num(c.v, unit)}`);
      const svg = chartSvg(
        width, height, `Heatmap of ${vc.name} by ${xc.name} and ${yc.name}`,
        `${ys.length} rows by ${xs.length} columns, values from ${num(Math.min(...values), unit)} to ${num(Math.max(...values), unit)}.` +
          (threshold ? ` Limit ${num(threshold.value, unit)}: ${over.length === 0 ? "not exceeded" : `exceeded in ${over.join("; ")}`}.` : "") +
          " Use View as table for exact values.",
      );
      const hatch = uid("hatch");
      svg.append(hatchDef(hatch));

      svg.append(
        s("g", { class: "axis axis--x" },
          xs.map((label, i) => s("text", { x: rowLabel + cw * i + cw / 2, y: headH - rem * 0.5, "text-anchor": "middle" }, clip(label, Math.floor(cw / (fs * 0.6)))))),
        s("g", { class: "axis axis--row" },
          ys.map((label, j) => s("text", { x: rowLabel - rem * 0.5, y: headH + ch * j + ch / 2, dy: "0.32em", "text-anchor": "end" }, clip(label, Math.floor((rowLabel - rem * 0.5) / (fs * 0.6)))))));

      const body = s("g", { class: "cells" });
      for (let j = 0; j < ys.length; j += 1) {
        for (let i = 0; i < xs.length; i += 1) {
          const c = grid.get(`${i}:${j}`);
          const x = rowLabel + cw * i + gap / 2;
          const y = headH + ch * j + gap / 2;
          const w = cw - gap;
          const hgt = ch - gap;
          if (!c || c.v === null) {
            body.append(s("rect", { class: "cell cell--empty", x, y, width: w, height: hgt, rx: 5 }));
            continue;
          }
          const tt = t(c.v);
          const breach = threshold && c.v > threshold.value;
          const g = s("g", { class: breach ? "cell-group cell-group--breach" : "cell-group" },
            s("title", null, `${ys[j]} / ${xs[i]}: ${num(c.v, unit)}${breach ? " (over limit)" : ""}`),
            s("rect", { class: "cell", style: `--t:${tt.toFixed(3)}`, x, y, width: w, height: hgt, rx: 5 }));
          if (breach) {
            g.append(
              s("rect", { class: "cell__hatch", x, y, width: w, height: hgt, rx: 5, style: `fill:url(#${hatch})` }),
              s("rect", { class: "cell__ring", x: x + 1, y: y + 1, width: w - 2, height: hgt - 2, rx: 4 }));
          }
          if (w > fs * 2.2 && hgt > fs * 1.6) {
            g.append(s("text", { class: tt > 0.72 ? "cell__value cell__value--on-hi" : "cell__value", x: x + w / 2, y: y + hgt / 2, dy: "0.34em", "text-anchor": "middle" }, num(c.v)));
            if (breach && w > fs * 3.4) g.append(s("path", { class: "cell__flag", d: triangle(x + w - 9, y + 10, 4.5) }));
          }
          body.append(g);
        }
      }
      svg.append(body);

      // colour key with the threshold marked on it
      const keyW = Math.min(rem * 14, width * 0.6);
      const keyX = rowLabel;
      const keyY = height - legendH + rem * 0.5;
      const gradId = uid("scale");
      svg.append(
        s("defs", null, s("linearGradient", { id: gradId },
          s("stop", { offset: "0%", class: "scale__lo" }), s("stop", { offset: "100%", class: "scale__hi" }))),
        s("g", { class: "scale" },
          s("rect", { x: keyX, y: keyY, width: keyW, height: rem * 0.5, rx: rem * 0.25, fill: `url(#${gradId})` }),
          s("text", { x: keyX, y: keyY + rem * 1.3, "text-anchor": "start" }, num(min, unit)),
          s("text", { x: keyX + keyW, y: keyY + rem * 1.3, "text-anchor": "end" }, num(max, unit)),
          threshold && threshold.value > min && threshold.value < max
            ? s("g", null,
                s("line", { class: "scale__limit", x1: keyX + keyW * t(threshold.value), x2: keyX + keyW * t(threshold.value), y1: keyY - 3, y2: keyY + rem * 0.5 + 3 }),
                s("text", { class: "scale__limit-label", x: keyX + keyW * t(threshold.value), y: keyY + rem * 1.3, "text-anchor": "middle" }, `▲ ${num(threshold.value, unit)}`))
            : null));
      return svg;
    },
  });
  handle.breaches = breached.length;
  return handle;
}
