/** Scatter: series are told apart by marker shape and a direct label, not by a legend. */
import { axisNum, num, truncate } from "../format.js";
import { axisKind, axisValue, col, groupRows, numeric, optCol, seriesColor } from "./data.js";
import { createChartHost } from "./host.js";
import { linear, niceScale, spreadLabels, textWidth, timeTicks } from "./scales.js";
import { marker, root, s, shapeFor } from "./svg.js";

export const mountScatter = (container, { visual, result, title }) => {
  const ch = visual.channels;
  const xc = col(result, "x", ch.x);
  const yc = col(result, "y", ch.y);
  const sc = optCol(result, "series", ch.series);
  const zc = optCol(result, "size", ch.size);
  const unit = visual.options?.unit ?? "";
  const xKind = axisKind(xc);

  const series = [...groupRows(result, sc)].map(([name, rows]) => ({
    name,
    pts: rows
      .map((r) => ({ x: axisValue(r[xc.index], xKind === "category" ? "value" : xKind), y: numeric(r[yc.index]), z: zc ? numeric(r[zc.index]) : null }))
      .filter((p) => p.y !== null && Number.isFinite(p.x)),
  }));
  const pts = series.flatMap((sr) => sr.pts);
  const zs = pts.map((p) => p.z).filter((z) => z !== null);
  const [zLo, zHi] = zs.length ? [Math.min(...zs), Math.max(...zs)] : [0, 1];

  const describe = () => {
    if (!pts.length) return "No points.";
    return `${pts.length} points${series.length > 1 ? ` in ${series.length} series (${series.map((x) => x.name).join(", ")})` : ""}. ${xc.name} ranges ${axisNum(Math.min(...pts.map((p) => p.x)))} to ${axisNum(Math.max(...pts.map((p) => p.x)))}; ${yc.name} ranges ${num(Math.min(...pts.map((p) => p.y)), unit)} to ${num(Math.max(...pts.map((p) => p.y)), unit)}.`;
  };

  const draw = ({ width, height, u }) => {
    const fs = u * 0.75;
    const svg = root(width, height, { title: `${title}. Scatter plot`, desc: describe() });
    if (!pts.length) {
      svg.append(s("text", { x: width / 2, y: height / 2, "text-anchor": "middle" }, "No points to plot."));
      return svg;
    }
    const multi = series.length > 1;
    const xMin = Math.min(...pts.map((p) => p.x));
    const xMax = Math.max(...pts.map((p) => p.x));
    const yScale = niceScale(Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y)), Math.max(3, Math.round(height / (u * 3.6))));
    const left = Math.max(...yScale.ticks.map((t) => textWidth(axisNum(t), fs))) + u * 0.9;
    const right = multi ? Math.min(width * 0.28, Math.max(...series.map((x) => textWidth(truncate(x.name, 16), fs * 1.1))) + u * 1.6) : u * 1.2;
    const top = u * 1.7;
    const bottom = fs * 3.9;
    const pw = width - left - right;
    const ph = height - top - bottom;
    const xScale = xKind === "time" ? null : niceScale(xMin, xMax, Math.max(3, Math.floor(pw / (u * 5))));
    const x0 = xScale ? xScale.min : xMin;
    const x1 = xScale ? xScale.max : (xMax === xMin ? xMax + 1 : xMax);
    const px = linear(x0, x1, left + u * 0.5, left + pw - u * 0.5);
    const py = linear(yScale.min, yScale.max, top + ph, top);
    const axisY = top + ph;
    const radius = (z) => (z === null ? 4.5 : u * (0.3 + 0.45 * Math.sqrt((z - zLo) / (zHi - zLo || 1))));

    let xTicks; let xFormat = axisNum;
    if (xKind === "time") {
      const t = timeTicks(x0, x1, Math.max(2, Math.floor(pw / (u * 5.5))));
      xTicks = t.ticks; xFormat = t.format;
    } else xTicks = xScale.ticks;

    const parts = [];
    series.forEach((sr, i) => {
      const color = seriesColor(i);
      sr.pts.forEach((p) => parts.push(marker(shapeFor(i), px(p.x), py(p.y), radius(p.z), { style: `fill:${color};fill-opacity:.72;stroke:${color}`, "stroke-width": 1.2 },
        s("title", null, `${multi ? `${sr.name} · ` : ""}${xc.name} ${xFormat(p.x)}, ${yc.name} ${num(p.y, unit)}${p.z === null ? "" : `, ${zc.name} ${num(p.z)}`}`))));
    });
    if (multi) {
      const items = series.map((sr, i) => {
        const far = sr.pts.reduce((a, b) => (b.x > a.x ? b : a), sr.pts[0]);
        return { i, y: far ? py(far.y) : top, x: far ? px(far.x) : left };
      });
      spreadLabels(items, fs * 1.3, top + fs * 0.4, top + ph).forEach((it) =>
        parts.push(s("text", { class: "direct-label", x: it.x + u * 0.9, y: it.ly + fs * 0.35, style: `fill:${seriesColor(it.i)}` }, truncate(series[it.i].name, 16))));
    }

    svg.append(
      s("g", { class: "grid" }, yScale.ticks.map((t) => s("line", { x1: left, x2: left + pw, y1: py(t), y2: py(t) }))),
      yScale.ticks.map((t) => s("text", { class: "tick-label", x: left - u * 0.5, y: py(t) + fs * 0.35, "text-anchor": "end" }, axisNum(t))),
      s("line", { class: "axis-line", x1: left, x2: left + pw, y1: axisY, y2: axisY }),
      xTicks.map((t) => s("text", { class: "tick-label", x: px(t), y: axisY + fs * 1.7, "text-anchor": "middle" }, xFormat(t))),
      s("text", { class: "axis-title", x: left, y: top - u * 0.7 }, `${yc.name}${unit ? ` (${unit})` : ""}`),
      s("text", { class: "axis-title", x: left + pw, y: height - 2, "text-anchor": "end" }, `${xc.name}${xKind === "time" ? " · UTC" : ""}${zc ? ` · size: ${zc.name}` : ""}`),
      parts,
    );
    return svg;
  };

  const host = createChartHost(container, draw);
  return { dispose: () => host.dispose() };
};
