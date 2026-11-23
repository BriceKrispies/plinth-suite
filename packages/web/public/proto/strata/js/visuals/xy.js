import { h, s } from "../dom.js";
import { clock, num, timeLabel } from "../format.js";
import { axisKind, axisValue, col, groupRows, numeric, optCol } from "./data.js";
import {
  chartSvg, legendList, linear, mountPlot, niceScale, thresholdMark, timeTicks, triangle, yAxis,
} from "./core.js";

/** Line, area and scatter charts: one x/y plane, optional series, threshold, tooltip and (line) brushing. */
const prepare = (result, visual) => {
  const type = visual.type;
  const x = col(result, "x", visual.channels.x);
  const y = col(result, "y", visual.channels.y);
  const series = optCol(result, "series", visual.channels.series);
  const size = type === "scatter" ? optCol(result, "size", visual.channels.size) : undefined;
  const kind = axisKind(x);
  const categories = kind === "category" ? [...new Set(result.rows.map((r) => String(r[x.index])))] : [];
  const xOf = (raw) => (kind === "category" ? categories.indexOf(String(raw)) : axisValue(raw, kind));

  const groups = [...groupRows(result, series)].map(([name, rows], i) => {
    const points = rows
      .map((r) => ({
        x: xOf(r[x.index]), y: numeric(r[y.index]), size: size ? numeric(r[size.index]) : null, label: r[x.index],
      }))
      .filter((p) => !Number.isNaN(p.x));
    if (type !== "scatter") points.sort((a, b) => a.x - b.x);
    return { name: name || y.name, i, points };
  });

  const stacked = type === "area" && visual.options?.stacked === true && groups.length > 1;
  if (type === "area") {
    const xs = [...new Set(groups.flatMap((g) => g.points.map((p) => p.x)))].sort((a, b) => a - b);
    const running = new Map(xs.map((v) => [v, 0]));
    for (const g of groups) {
      const byX = new Map(g.points.map((p) => [p.x, p.y]));
      g.points = xs.map((v) => {
        const value = byX.get(v) ?? (stacked ? 0 : null);
        const base = stacked ? running.get(v) : 0;
        if (stacked) running.set(v, base + (value ?? 0));
        return { x: v, y: value, y0: base, y1: value === null ? null : base + value, label: v };
      });
    }
  } else {
    for (const g of groups) for (const p of g.points) { p.y0 = 0; p.y1 = p.y; }
  }
  return { type, x, y, kind, categories, groups, stacked, size };
};

const describe = (m, visual, breaches) => {
  const values = m.groups.flatMap((g) => g.points.map((p) => p.y)).filter((v) => v !== null);
  const unit = visual.options?.unit;
  const range = values.length ? `from ${num(Math.min(...values), unit)} to ${num(Math.max(...values), unit)}` : "with no values";
  const series = m.groups.length > 1 ? `, ${m.groups.length} series` : "";
  const limit = visual.threshold ? ` Limit ${num(visual.threshold.value, unit)}: ${breaches === 0 ? "not exceeded" : `exceeded by ${breaches} point${breaches === 1 ? "" : "s"}`}.` : "";
  return `${m.y.name} ${range}${series}.${limit} Use View as table for exact values.`;
};

export function mountXy(host, { result, visual, win, onBrush }) {
  const m = prepare(result, visual);
  const unit = visual.options?.unit;
  const threshold = visual.threshold;
  const isScatter = m.type === "scatter";
  const brushable = m.type === "line" && m.kind === "time" && visual.options?.brush !== false;
  const allPoints = m.groups.flatMap((g) => g.points.map((p) => ({ ...p, g: g.i, name: g.name })));
  const breaches = threshold ? allPoints.filter((p) => p.y1 !== null && p.y1 > threshold.value).length : 0;

  const xs = allPoints.map((p) => p.x);
  let xMin = Math.min(...xs);
  let xMax = Math.max(...xs);
  if (!(xMax > xMin)) { xMin -= 1; xMax += 1; }
  const ys = allPoints.flatMap((p) => [p.y0, p.y1]).filter((v) => v !== null);
  let yMin = Math.min(...ys, threshold?.value ?? Infinity);
  let yMax = Math.max(...ys, threshold?.value ?? -Infinity);
  if (m.type === "area" || (m.type === "line" && yMin >= 0 && yMin < yMax * 0.5)) yMin = Math.min(0, yMin);
  if (!Number.isFinite(yMin)) { yMin = 0; yMax = 1; }
  const yScale = niceScale(yMin, yMax, 4);
  const xScale = isScatter && m.kind === "value" ? niceScale(xMin, xMax, 5) : undefined;

  const handle = mountPlot(host, {
    legend: legendList(m.groups.map((g) => g.name)),
    hint: brushable ? h("p", { class: "chart__hint", "aria-hidden": "true" }, "Drag to select a window") : null,
    draw({ width, height, rem, tooltip }) {
      const fs = rem * 0.75;
      const yLabels = yScale.ticks.map((t) => num(t, unit));
      const left = Math.ceil(Math.max(...yLabels.map((l) => l.length)) * fs * 0.6) + rem * 0.9;
      const right = width - rem * 0.9;
      const top = rem * 0.9;
      const bottom = height - rem * 1.7;
      const y = linear(yScale.lo, yScale.hi, bottom, top);
      const x0 = xScale ? xScale.lo : xMin;
      const x1 = xScale ? xScale.hi : xMax;
      const x = linear(x0, x1, left + rem * 0.4, right - rem * 0.4);

      const label = `${m.type === "scatter" ? "Scatter plot" : `${m.type === "area" ? "Area" : "Line"} chart`} of ${m.y.name} by ${m.x.name}`;
      const svg = chartSvg(width, height, label, describe(m, visual, breaches));
      svg.append(yAxis(yScale.ticks, y, (t) => num(t, unit), left, right));

      // x axis
      let xTicks;
      if (m.kind === "category") {
        const stride = Math.ceil((Math.max(...m.categories.map((c) => c.length)) * fs * 0.6 + 8) / ((right - left) / Math.max(1, m.categories.length)));
        xTicks = m.categories.map((c, i) => ({ v: i, text: c })).filter((_, i) => i % stride === 0);
      } else if (m.kind === "time") {
        xTicks = timeTicks(xMin, xMax, Math.max(2, Math.floor((right - left) / (rem * 5.5)))).map((v) => ({ v, text: timeLabel(v, xMax - xMin) }));
      } else {
        const ticks = xScale ? xScale.ticks : niceScale(xMin, xMax, 5).ticks;
        xTicks = ticks.map((v) => ({ v, text: num(v) }));
      }
      svg.append(
        s("g", { class: "axis axis--x" },
          s("line", { class: "axis__base", x1: left, x2: right, y1: bottom, y2: bottom }),
          xTicks.filter((t) => x(t.v) >= left - 1 && x(t.v) <= right + 1).map((t) =>
            s("g", null,
              s("line", { class: "tick", x1: x(t.v), x2: x(t.v), y1: bottom, y2: bottom + 4 }),
              s("text", { x: x(t.v), y: bottom + rem * 1.25, "text-anchor": "middle" }, t.text)))));

      if (threshold) svg.append(thresholdMark(threshold, y, left, right, unit));

      if (brushable && win) {
        const a = Math.max(left, x(win[0]));
        const b = Math.min(right, x(win[1]));
        if (b > a) {
          svg.append(
            s("rect", { class: "window", x: a, y: top, width: b - a, height: bottom - top }),
            s("text", { class: "window__label", x: a + 4, y: top + fs + 2 }, `${clock(win[0])} → ${clock(win[1])}`));
        }
      }

      // marks
      const marks = s("g", { class: "marks" });
      for (const g of m.groups) {
        const dataset = { s: g.i % 6 };
        if (!isScatter) {
          const runs = [];
          let run = [];
          for (const p of g.points) {
            if (p.y1 === null) { if (run.length) runs.push(run); run = []; } else run.push(p);
          }
          if (run.length) runs.push(run);
          for (const r of runs) {
            const d = r.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y1).toFixed(1)}`).join(" ");
            if (m.type === "area") {
              const back = [...r].reverse().map((p) => `L${x(p.x).toFixed(1)},${y(p.y0).toFixed(1)}`).join(" ");
              marks.append(s("path", { class: "area", dataset, d: `${d} ${back} Z` }));
            }
            marks.append(s("path", { class: "line", dataset, d }));
          }
        }
        const dense = g.points.length > 70;
        for (const p of g.points) {
          if (p.y1 === null) continue;
          const px = x(p.x);
          const py = y(p.y1);
          const breach = threshold && p.y1 > threshold.value;
          if (breach) marks.append(s("path", { class: "mark mark--breach", d: triangle(px, py, 5.5) }));
          else if (isScatter) {
            const r = p.size === null ? 4.5 : 3.5 + Math.min(10, Math.sqrt(Math.abs(p.size)) * 0.6);
            marks.append(s("circle", { class: "dot dot--scatter", dataset, cx: px, cy: py, r }));
          } else if (!dense) marks.append(s("circle", { class: "dot", dataset, cx: px, cy: py, r: 3 }));
        }
      }
      svg.append(marks);

      // interaction: tooltip and brush share one transparent hit layer
      const hover = s("g", { class: "hover", hidden: true });
      const guide = s("line", { class: "hover__guide", y1: top, y2: bottom });
      const ring = s("circle", { class: "hover__ring", r: 6 });
      hover.append(isScatter ? ring : guide);
      const hit = s("rect", { class: brushable ? "hit hit--brush" : "hit", x: left, y: top, width: right - left, height: bottom - top });
      const band = s("rect", { class: "window window--draft", y: top, height: bottom - top, hidden: true });
      svg.append(hover, band, hit);

      const local = (event) => {
        const box = svg.getBoundingClientRect();
        return { px: event.clientX - box.left, py: event.clientY - box.top };
      };
      const fmtX = (p) => (m.kind === "time" ? new Date(p.x).toLocaleString("en-GB", { hour12: false }) : m.kind === "category" ? m.categories[p.x] : num(p.x));

      const showNearest = (px, py) => {
        if (isScatter) {
          let best;
          let bestD = 28 * 28;
          for (const p of allPoints) {
            if (p.y1 === null) continue;
            const d = (x(p.x) - px) ** 2 + (y(p.y1) - py) ** 2;
            if (d < bestD) { bestD = d; best = p; }
          }
          if (!best) { hover.setAttribute("hidden", ""); tooltip.hide(); return; }
          ring.setAttribute("cx", x(best.x));
          ring.setAttribute("cy", y(best.y1));
          hover.removeAttribute("hidden");
          tooltip.show(x(best.x), y(best.y1), width, `${m.x.name} ${num(best.x)}`, [
            { s: best.g, label: m.groups.length > 1 ? best.name : m.y.name, value: num(best.y1, unit) },
            ...(best.size === null ? [] : [{ label: "size", value: num(best.size) }]),
          ]);
          return;
        }
        const value = x.invert(px);
        let nearest = allPoints[0];
        for (const p of allPoints) if (Math.abs(p.x - value) < Math.abs(nearest.x - value)) nearest = p;
        const here = allPoints.filter((p) => p.x === nearest.x && p.y !== null);
        guide.setAttribute("x1", x(nearest.x));
        guide.setAttribute("x2", x(nearest.x));
        hover.removeAttribute("hidden");
        tooltip.show(x(nearest.x), top + 8, width, fmtX(nearest), here.map((p) => ({ s: p.g, label: p.name, value: num(p.y, unit) })));
      };

      let dragStart = null;
      hit.addEventListener("pointermove", (e) => {
        const { px, py } = local(e);
        if (dragStart !== null) {
          const a = Math.min(dragStart, px);
          const b = Math.max(dragStart, px);
          band.setAttribute("x", Math.max(left, a));
          band.setAttribute("width", Math.max(0, Math.min(right, b) - Math.max(left, a)));
          return;
        }
        showNearest(px, py);
      });
      hit.addEventListener("pointerleave", () => {
        if (dragStart !== null) return;
        hover.setAttribute("hidden", "");
        tooltip.hide();
      });
      if (brushable) {
        hit.addEventListener("pointerdown", (e) => {
          dragStart = local(e).px;
          hit.setPointerCapture(e.pointerId);
          hover.setAttribute("hidden", "");
          tooltip.hide();
          band.removeAttribute("hidden");
          band.setAttribute("width", 0);
        });
        const finish = (e) => {
          if (dragStart === null) return;
          const a = Math.min(dragStart, local(e).px);
          const b = Math.max(dragStart, local(e).px);
          dragStart = null;
          band.setAttribute("hidden", "");
          if (b - a > 6) onBrush?.([Math.round(x.invert(Math.max(left, a))), Math.round(x.invert(Math.min(right, b)))]);
        };
        hit.addEventListener("pointerup", finish);
        hit.addEventListener("pointercancel", () => { dragStart = null; band.setAttribute("hidden", ""); });
      }
      return svg;
    },
  });
  handle.breaches = breaches;
  return handle;
}
