/** Line and area charts: direct end-of-line labels, no legend, optional threshold and brushing. */
import { h } from "../dom.js";
import { axisNum, dayHm, hm, num, truncate } from "../format.js";
import { axisKind, axisValue, col, groupRows, numeric, optCol, seriesColor } from "./data.js";
import { createChartHost } from "./host.js";
import { linePath, linear, niceScale, smoothPath, spreadLabels, textWidth, timeTicks } from "./scales.js";
import { marker, root, s } from "./svg.js";

const extent = (values) => values.reduce(([lo, hi], v) => [Math.min(lo, v), Math.max(hi, v)], [Infinity, -Infinity]);

const buildModel = (visual, result, area) => {
  const ch = visual.channels;
  const xc = col(result, "x", ch.x);
  const yc = col(result, "y", ch.y);
  const sc = optCol(result, "series", ch.series);
  const xKind = axisKind(xc);
  const cats = xKind === "category" ? [...new Set(result.rows.map((r) => String(r[xc.index])))] : [];
  const catIndex = new Map(cats.map((c, i) => [c, i]));
  const xOf = (v) => (xKind === "category" ? catIndex.get(String(v)) : axisValue(v, xKind));
  const stacked = Boolean(area && visual.options?.stacked && sc);

  const series = [...groupRows(result, sc)].map(([name, rows]) => ({
    name,
    pts: rows
      .map((r) => ({ x: xOf(r[xc.index]), y: numeric(r[yc.index]) }))
      .filter((p) => p.y !== null && Number.isFinite(p.x))
      .sort((a, b) => a.x - b.x),
  }));

  let layers;
  if (stacked) {
    const xs = [...new Set(series.flatMap((sr) => sr.pts.map((p) => p.x)))].sort((a, b) => a - b);
    const acc = new Map(xs.map((x) => [x, 0]));
    layers = series.map((sr) => {
      const own = new Map(sr.pts.map((p) => [p.x, p.y]));
      return {
        name: sr.name,
        pts: xs.map((x) => {
          const y0 = acc.get(x);
          const raw = own.get(x) ?? 0;
          acc.set(x, y0 + raw);
          return { x, y: y0 + raw, y0, raw };
        }),
      };
    });
  } else {
    layers = series.map((sr) => ({ name: sr.name, pts: sr.pts.map((p) => ({ x: p.x, y: p.y, y0: null, raw: p.y })) }));
  }
  return { xc, yc, xKind, cats, layers, stacked, multi: layers.length > 1 };
};

export const mountXY = (container, { visual, result, title }, area = false) => {
  const m = buildModel(visual, result, area);
  const unit = visual.options?.unit ?? "";
  const threshold = visual.threshold;
  const smooth = Boolean(visual.options?.smooth);
  const brushable = Boolean(visual.options?.brush);
  const points = m.layers.flatMap((l) => l.pts);
  const kind = area ? "Area chart" : "Line chart";

  const fmtX = (v, span) => {
    if (m.xKind === "category") return m.cats[Math.max(0, Math.min(m.cats.length - 1, Math.round(v)))] ?? "";
    if (m.xKind === "time") return span > 864e5 ? dayHm(v) : hm(v);
    return axisNum(v);
  };

  // Domains
  let [xLo, xHi] = points.length ? extent(points.map((p) => p.x)) : [0, 1];
  if (m.xKind === "category") { xLo = 0; xHi = Math.max(0, m.cats.length - 1); }
  if (xLo === xHi) { const pad = m.xKind === "time" ? 18e5 : 0.5; xLo -= pad; xHi += pad; }
  const yVals = points.map((p) => p.y);
  if (area) yVals.push(0);
  if (threshold) yVals.push(threshold.value);
  const [yLo, yHi] = points.length ? extent(yVals) : [0, 1];

  const countAbove = threshold ? points.filter((p) => !m.stacked && p.y > threshold.value).length : 0;
  const describe = () => {
    if (!points.length) return "No plottable points.";
    const parts = m.layers.slice(0, 5).map((l) => {
      const [lo, hi] = extent(l.pts.map((p) => p.raw));
      const last = l.pts[l.pts.length - 1];
      return `${l.name || m.yc.name}: ${l.pts.length} points, latest ${num(last.raw, unit)}, range ${num(lo, unit)} to ${num(hi, unit)}`;
    });
    const t = threshold ? ` Threshold ${num(threshold.value, unit)}: ${countAbove} point${countAbove === 1 ? "" : "s"} above.` : "";
    return `${parts.join(". ")}.${t}`;
  };

  let brush = null;
  let meta = null;
  let readout = null;

  const draw = ({ width, height, u }) => {
    const fs = u * 0.75;
    const svg = root(width, height, { title: `${title}. ${kind}`, desc: describe() });
    if (!points.length) {
      svg.append(s("text", { x: width / 2, y: height / 2, "text-anchor": "middle" }, "No plottable points in this result."));
      return svg;
    }
    const yScale = niceScale(yLo, yHi, Math.max(3, Math.round(height / (u * 3.6))));
    const left = Math.max(...yScale.ticks.map((t) => textWidth(axisNum(t), fs))) + u * 0.9;
    const lastOf = (l) => l.pts[l.pts.length - 1];
    const endText = m.layers.map((l) => (m.multi ? truncate(l.name, 18) : num(lastOf(l).raw, unit)));
    const right = Math.min(width * 0.3, Math.max(...endText.map((t) => textWidth(t, fs * 1.1))) + u * 1.2);
    const top = u * 1.7;
    const bottom = fs * 3.9;
    const pw = width - left - right;
    const ph = height - top - bottom;
    meta = { left, pw, x0: xLo, x1: xHi };
    const xs = linear(xLo, xHi, left, left + pw);
    const ys = linear(yScale.min, yScale.max, top + ph, top);
    const base = yScale.min <= 0 && yScale.max >= 0 ? 0 : yScale.min;

    const grid = s("g", { class: "grid" }, yScale.ticks.map((t) => s("line", { x1: left, x2: left + pw, y1: ys(t), y2: ys(t) })));
    const yLabels = yScale.ticks.map((t) => s("text", { class: "tick-label", x: left - u * 0.5, y: ys(t) + fs * 0.35, "text-anchor": "end" }, axisNum(t)));

    // X axis ticks
    let xTicks;
    let xFormat = (v) => axisNum(v);
    if (m.xKind === "time") {
      const t = timeTicks(xLo, xHi, Math.max(2, Math.floor(pw / (u * 5.5))));
      xTicks = t.ticks; xFormat = t.format;
    } else if (m.xKind === "category") {
      const labelW = Math.max(...m.cats.map((c) => textWidth(truncate(c, 12), fs))) + u;
      const per = pw / Math.max(1, m.cats.length - 1);
      const stride = Math.max(1, Math.ceil(labelW / per));
      xTicks = m.cats.map((_, i) => i).filter((i) => i % stride === 0);
      xFormat = (i) => truncate(m.cats[i], 12);
    } else {
      xTicks = niceScale(xLo, xHi, Math.max(3, Math.floor(pw / (u * 5)))).ticks.filter((t) => t >= xLo && t <= xHi);
    }
    const axisY = top + ph;
    const xAxis = s("g", null,
      s("line", { class: "axis-line", x1: left, x2: left + pw, y1: axisY, y2: axisY }),
      xTicks.map((t) => s("line", { class: "axis-line", x1: xs(t), x2: xs(t), y1: axisY, y2: axisY + u * 0.3 })),
      xTicks.map((t) => s("text", { class: "tick-label", x: xs(t), y: axisY + fs * 1.7, "text-anchor": "middle" }, xFormat(t))));

    const titles = [
      s("text", { class: "axis-title", x: left, y: top - u * 0.7 }, `${m.yc.name}${unit ? ` (${unit})` : ""}`),
      s("text", { class: "axis-title", x: left + pw, y: height - 2, "text-anchor": "end" }, `${m.xc.name}${m.xKind === "time" ? " · UTC" : ""}`),
    ];

    const parts = [];
    if (brush) {
      const a = xs(Math.min(...brush));
      const b = xs(Math.max(...brush));
      parts.push(s("rect", { class: "brush-sel", x: a, y: top, width: Math.max(1, b - a), height: ph }));
    }

    if (threshold && threshold.value >= yScale.min && threshold.value <= yScale.max) {
      const ty = ys(threshold.value);
      parts.push(
        s("line", { class: "threshold-line", x1: left, x2: left + pw, y1: ty, y2: ty }),
        s("text", { class: "threshold-label", x: left + 4, y: ty - 5 }, `Threshold ${num(threshold.value, unit)}`));
    }

    m.layers.forEach((layer, i) => {
      const color = seriesColor(i);
      const px = layer.pts.map((p) => [xs(p.x), ys(p.y)]);
      const top2 = smooth ? smoothPath(px) : linePath(px);
      if (area) {
        const floor = layer.pts.map((p) => [xs(p.x), ys(p.y0 ?? base)]).reverse();
        parts.push(s("path", { class: "series-area", style: `fill:${color}`, d: `${top2}L${floor.map((p) => p.join(" ")).join("L")}Z` }));
      }
      parts.push(s("path", { class: "series-line", style: `stroke:${color}`, d: top2 }));
      if (threshold && !m.stacked) {
        layer.pts.filter((p) => p.y > threshold.value).forEach((p) =>
          parts.push(marker("triangle", xs(p.x), ys(p.y), 4.5, { class: "breach-marker" })));
      }
    });

    // Direct labels at the end of each line (no legend).
    const items = m.layers.map((l, i) => ({ i, y: ys(lastOf(l).y), x: xs(lastOf(l).x) }));
    spreadLabels(items, fs * 1.3, top + fs * 0.4, top + ph).forEach((it) => {
      const color = seriesColor(it.i);
      parts.push(
        marker("circle", it.x, it.y, 3.2, { style: `fill:${color}`, stroke: "none" }),
        s("text", { class: m.multi ? "direct-label" : "value-label", x: it.x + u * 0.55, y: it.ly + fs * 0.35, style: m.multi ? `fill:${color}` : null }, endText[it.i]));
    });

    if (points.length <= 400) {
      m.layers.forEach((layer) => layer.pts.forEach((p) =>
        parts.push(s("circle", { class: "hit", cx: xs(p.x), cy: ys(p.y), r: 7 },
          s("title", null, `${m.multi ? `${layer.name} · ` : ""}${fmtX(p.x, xHi - xLo)}: ${num(p.raw, unit)}`)))));
    }

    svg.append(grid, ...yLabels, xAxis, ...titles, ...parts);
    return svg;
  };

  const host = createChartHost(container, draw, { brush: brushable, label: brushable ? `${title}. Arrow keys select a range, Escape clears it.` : undefined });
  if (m.stacked) host.frame.dataset.stacked = "";

  if (brushable) {
    const summary = h("span", null);
    readout = h("div", { class: "chart-readout", hidden: true }, summary,
      h("button", { type: "button", onclick: () => setBrush(null) }, "Clear"));
    container.append(readout);
    host.frame.tabIndex = 0;
    host.frame.setAttribute("role", "group");

    const setBrush = (next) => {
      brush = next;
      if (!brush) { readout.hidden = true; host.redraw(); return; }
      const [a, b] = [Math.min(...brush), Math.max(...brush)];
      const inside = points.filter((p) => p.x >= a && p.x <= b);
      const mean = inside.length ? inside.reduce((t, p) => t + p.raw, 0) / inside.length : null;
      const span = xHi - xLo;
      summary.textContent = `${fmtX(a, span)} to ${fmtX(b, span)} · ${inside.length} point${inside.length === 1 ? "" : "s"}${mean === null ? "" : ` · mean ${num(mean, unit)}`}`;
      readout.hidden = false;
      host.redraw();
    };

    const dataX = (event) => {
      const rect = host.frame.getBoundingClientRect();
      const t = (event.clientX - rect.left - meta.left) / meta.pw;
      return meta.x0 + Math.max(0, Math.min(1, t)) * (meta.x1 - meta.x0);
    };
    let anchor = null;
    host.frame.addEventListener("pointerdown", (e) => {
      if (!meta || e.button !== 0) return;
      anchor = dataX(e);
      host.frame.setPointerCapture(e.pointerId);
    });
    host.frame.addEventListener("pointermove", (e) => { if (anchor !== null) setBrush([anchor, dataX(e)]); });
    host.frame.addEventListener("pointerup", (e) => {
      if (anchor === null) return;
      const moved = Math.abs(dataX(e) - anchor) > (meta.x1 - meta.x0) * 0.01;
      anchor = null;
      if (!moved) setBrush(null);
    });
    host.frame.addEventListener("keydown", (e) => {
      if (!meta || !["ArrowLeft", "ArrowRight", "Escape"].includes(e.key)) return;
      e.preventDefault();
      if (e.key === "Escape") return setBrush(null);
      const span = meta.x1 - meta.x0;
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const [a, b] = brush ? [Math.min(...brush), Math.max(...brush)] : [meta.x0 + span * 0.35, meta.x0 + span * 0.6];
      const step = span * 0.05 * dir;
      const next = e.shiftKey ? [a, b + step] : [a + step, b + step];
      setBrush(next.map((v) => Math.max(meta.x0, Math.min(meta.x1, v))));
    });
  }

  return { dispose() { host.dispose(); readout?.remove(); } };
};
