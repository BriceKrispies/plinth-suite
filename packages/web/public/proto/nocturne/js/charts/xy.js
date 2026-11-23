import { h, s } from "../dom.js";
import { num, plural } from "../format.js";
import { axisKind, axisValue, col, extent, groupRows, numeric, optCol } from "./data.js";
import { chartFrame, legend } from "./frame.js";
import { hatch, linePath, marker, SHAPES } from "./marks.js";
import { continuousTicks, linear, niceScale, truncate } from "./scales.js";

/**
 * Line, area and scatter share one cartesian engine: they differ only in how a series is painted.
 * x may be time, a number or a category; categories are placed on integer positions.
 */
export const xyChart = (type, { result, visual, title }) => {
  const ch = visual.channels;
  const x = col(result, "x", ch.x);
  const y = col(result, "y", ch.y);
  const ser = optCol(result, "series", ch.series);
  const size = optCol(result, "size", ch.size);
  const kind = axisKind(x);
  const unit = visual.options?.unit;
  const limit = visual.threshold?.value;
  const stacked = type === "area" && visual.options?.stacked === true;
  const smooth = visual.options?.smooth === true;
  const brushable = type === "line" && visual.options?.brush === true && kind !== "category";

  const groups = [...groupRows(result, ser)].map(([name, rows], index) => ({
    name: name || y.name,
    index,
    pts: rows
      .map((r) => ({ raw: axisValue(r[x.index], kind), y: numeric(r[y.index]), z: size ? numeric(r[size.index]) : null }))
      .filter((p) => p.y !== null && (kind === "category" || Number.isFinite(p.raw))),
  }));
  const cats = kind === "category" ? [...new Set(groups.flatMap((g) => g.pts.map((p) => p.raw)))] : null;
  for (const g of groups) {
    for (const p of g.pts) p.xv = cats ? cats.indexOf(p.raw) : p.raw;
    if (!cats) g.pts.sort((a, b) => a.xv - b.xv);
  }

  if (type === "area") {
    const xs = [...new Set(groups.flatMap((g) => g.pts.map((p) => p.xv)))].sort((a, b) => a - b);
    const base = new Map(xs.map((v) => [v, 0]));
    for (const g of groups) {
      const own = new Map(g.pts.map((p) => [p.xv, p.y]));
      g.band = (stacked ? xs : g.pts.map((p) => p.xv)).map((v) => {
        const y0 = stacked ? base.get(v) : 0;
        const y1 = y0 + (own.get(v) ?? 0);
        if (stacked) base.set(v, y1);
        return { xv: v, y0, y1 };
      });
    }
  }

  const allX = groups.flatMap((g) => g.pts.map((p) => p.xv));
  const full = cats ? [0, Math.max(0, cats.length - 1)] : extent(allX);
  const state = { zoom: null };
  const allY = groups.flatMap((g) => g.pts.map((p) => p.y));
  const breaches = limit === undefined ? 0 : allY.filter((v) => v > limit).length;
  const [yMin, yMax] = extent(allY);

  const unitTxt = unit ? ` ${unit}` : "";
  const desc =
    `${type[0].toUpperCase()}${type.slice(1)} chart of ${y.name} by ${x.name}` +
    `${ser ? `, one series per ${ser.name} (${groups.map((g) => g.name).join(", ")})` : ""}. ` +
    `${plural(allY.length, "point")}. ${y.name} ranges from ${num(yMin)} to ${num(yMax)}${unitTxt}.` +
    `${limit === undefined ? "" : ` Limit ${num(limit)}${unitTxt}; ${breaches === 0 ? "no points exceed it" : `${plural(breaches, "point")} exceed it`}.`}` +
    ` The same rows are available as a table.`;

  const resetButton = brushable
    ? h("button", { type: "button", class: "btn btn-quiet btn-sm", hidden: true, onclick: () => ((state.zoom = null), built.frame.redraw()) }, "Reset zoom")
    : null;

  const built = chartFrame({
    title: `${title}: ${type} chart`,
    desc,
    toolbar: resetButton,
    idleTip: brushable ? "Drag across the chart to zoom" : "",
    className: `chart-${type}`,
    note: breaches > 0 ? { text: `${plural(breaches, "point")} above the limit of ${num(limit, unit)}`, tone: "bad" } : null,
    legendEl: groups.length > 1 ? legend(groups.map((g) => ({ name: g.name, index: g.index, shape: type === "scatter" ? SHAPES[g.index % SHAPES.length] : "square" }))) : null,
    draw: ({ g, svg, width: W, height: H, rem, id, tip, frame }) => {
      const fs = rem * 0.78;
      if (resetButton) resetButton.hidden = !state.zoom;
      const [xa, xb] = state.zoom ?? full;
      const inView = (p) => p.xv >= xa && p.xv <= xb;

      // Value domain, from the points in view plus the limit.
      const seen = [];
      for (const gr of groups) {
        const source = type === "area" ? gr.band.map((b) => ({ xv: b.xv, y: b.y1 })) : gr.pts;
        for (const p of source) if (inView(p)) seen.push(p.y);
      }
      if (limit !== undefined) seen.push(limit);
      let [lo, hi] = extent(seen);
      if (type === "area" || (lo >= 0 && lo < hi * 0.5)) lo = Math.min(lo, 0);
      const yScale = niceScale(lo, hi, Math.max(2, Math.floor(H / (rem * 3.6))));
      const ticksY = yScale.ticks.map((v) => ({ v, label: yScale.label(v) }));

      const m = { top: rem * 1.7, right: rem * 1, bottom: rem * 2.1, left: Math.max(...ticksY.map((t) => t.label.length), 2) * fs * 0.62 + rem * 1.2 };
      const pw = W - m.left - m.right;
      const ph = H - m.top - m.bottom;
      if (pw < 20 || ph < 20) return;

      const pad = xa === xb ? 1 : cats ? 0.5 : type === "scatter" ? (xb - xa) * 0.04 : 0;
      const d0 = xa - pad;
      const d1 = xb + pad;
      const X = linear(d0, d1, m.left, m.left + pw);
      const invert = (px) => d0 + ((px - m.left) / pw) * (d1 - d0);
      const Y = linear(yScale.domain[0], yScale.domain[1], m.top + ph, m.top);

      g.append(hatch(`${id}-hatch`), s("clipPath", { id: `${id}-clip` }, s("rect", { x: m.left, y: m.top, width: pw, height: ph })));

      // Grid and y axis
      const grid = s("g", { class: "gridlines" });
      for (const t of ticksY) {
        grid.append(s("line", { x1: m.left, x2: m.left + pw, y1: Y(t.v), y2: Y(t.v) }));
        g.append(s("text", { class: "tick", x: m.left - rem * 0.5, y: Y(t.v), dy: "0.32em", "text-anchor": "end" }, t.label));
      }
      g.prepend(grid);
      g.append(s("text", { class: "axis-title", x: m.left - rem * 0.5, y: m.top - rem * 0.8, "text-anchor": "start" }, `${y.name}${unit ? ` (${unit})` : ""}`));

      // x axis
      let xTicks;
      if (cats) {
        const stride = Math.max(1, Math.ceil((Math.min(14, Math.max(...cats.map((c) => c.length))) * fs * 0.62) / (pw / cats.length)));
        xTicks = cats.map((c, i) => ({ v: i, label: truncate(c, 14) })).filter((_, i) => i % stride === 0);
      } else {
        const t = continuousTicks(kind, d0, d1,Math.max(2, Math.floor(pw / (fs * 7))));
        xTicks = t.ticks.map((v) => ({ v, label: t.label(v) }));
      }
      const axis = s("g", { class: "axis-x" });
      axis.append(s("line", { x1: m.left, x2: m.left + pw, y1: m.top + ph, y2: m.top + ph }));
      for (const t of xTicks) {
        axis.append(s("line", { x1: X(t.v), x2: X(t.v), y1: m.top + ph, y2: m.top + ph + rem * 0.3 }));
        axis.append(s("text", { class: "tick", x: X(t.v), y: m.top + ph + rem * 1.35, "text-anchor": "middle" }, t.label));
      }
      g.append(axis);

      const plot = s("g", { "clip-path": `url(#${id}-clip)` });
      g.append(plot);

      // Limit band: hatched above the limit line.
      if (limit !== undefined && limit >= yScale.domain[0] && limit <= yScale.domain[1]) {
        plot.append(s("rect", { class: "limit-band", x: m.left, y: m.top, width: pw, height: Math.max(0, Y(limit) - m.top), fill: `url(#${id}-hatch)` }));
      }

      const flat = [];
      const radius = rem * 0.3;
      const [zLo, zHi] = size ? extent(groups.flatMap((gr) => gr.pts.map((p) => p.z ?? 0))) : [0, 1];
      for (const gr of groups) {
        const cls = `series-${gr.index % 6}`;
        const label = (p) => `${gr.name === y.name && !ser ? "" : `${gr.name} · `}${cats ? p.raw : kind === "time" ? new Date(p.raw).toISOString().slice(0, 16).replace("T", " ") : num(p.raw)}: ${num(p.y, unit)}`;
        if (type === "scatter") {
          const shape = SHAPES[gr.index % SHAPES.length];
          for (const p of gr.pts) {
            const r = size && p.z !== null ? rem * (0.28 + 0.6 * Math.sqrt((p.z - zLo) / (zHi - zLo || 1))) : radius * 1.3;
            const over = limit !== undefined && p.y > limit;
            plot.append(
              s("path", {
                class: `mark point ${cls}${over ? " is-breach" : ""}`,
                d: marker(shape, X(p.xv), Y(p.y), r),
                "data-tip": `${label(p)}${size && p.z !== null ? ` · ${size.name} ${num(p.z)}` : ""}`,
              }),
            );
          }
          continue;
        }
        if (type === "area") {
          const top = gr.band.map((b) => [X(b.xv), Y(b.y1)]);
          const bottom = gr.band.map((b) => [X(b.xv), Y(b.y0)]).reverse();
          if (top.length > 1)
            plot.append(s("path", { class: `area ${cls}`, d: `${linePath(top, smooth)}L${bottom.map(([px, py]) => `${px},${py}`).join("L")}Z` }));
          plot.append(s("path", { class: `line ${cls}`, d: linePath(top, smooth) }));
        } else {
          plot.append(s("path", { class: `line ${cls}`, d: linePath(gr.pts.map((p) => [X(p.xv), Y(p.y)]), smooth) }));
        }
        for (const p of gr.pts) {
          const px = X(p.xv);
          const py = Y(p.y);
          flat.push({ px, py, text: label(p), cls });
          if (limit !== undefined && p.y > limit) plot.append(s("path", { class: "mark breach-mark", d: marker("triangle", px, py, rem * 0.38), "data-tip": `${label(p)} (above limit)` }));
          else if (gr.pts.length <= 48) plot.append(s("circle", { class: `dot ${cls}`, cx: px, cy: py, r: radius }));
        }
      }

      if (limit !== undefined && limit >= yScale.domain[0] && limit <= yScale.domain[1]) {
        g.append(
          s("line", { class: "limit-line", x1: m.left, x2: m.left + pw, y1: Y(limit), y2: Y(limit) }),
          s("text", { class: "limit-label", x: m.left + pw, y: Y(limit) - rem * 0.35, "text-anchor": "end" }, `Limit ${num(limit, unit)}`),
        );
      }
      if (type === "scatter") return;

      // Nearest-point readout, plus brushing when enabled.
      const cursor = s("g", { class: "cursor", hidden: true }, s("line", { y1: m.top, y2: m.top + ph }), s("circle", { r: radius * 1.9 }));
      const brush = s("rect", { class: "brush", y: m.top, height: ph, width: 0 });
      const overlay = s("rect", { class: "overlay", x: m.left, y: m.top, width: pw, height: ph });
      g.append(cursor, brush, overlay);
      let drag = null;
      const local = (e) => {
        const r = svg.getBoundingClientRect();
        return [Math.min(m.left + pw, Math.max(m.left, e.clientX - r.left)), e.clientY - r.top];
      };
      overlay.addEventListener("pointermove", (e) => {
        const [mx, my] = local(e);
        if (drag !== null) {
          brush.setAttribute("x", Math.min(drag, mx));
          brush.setAttribute("width", Math.abs(mx - drag));
          return;
        }
        let best = null;
        let dist = Infinity;
        for (const f of flat) {
          const d = Math.abs(f.px - mx) + Math.abs(f.py - my) * 0.25;
          if (d < dist) [best, dist] = [f, d];
        }
        if (!best) return;
        cursor.removeAttribute("hidden");
        cursor.firstChild.setAttribute("x1", best.px);
        cursor.firstChild.setAttribute("x2", best.px);
        cursor.lastChild.setAttribute("cx", best.px);
        cursor.lastChild.setAttribute("cy", best.py);
        tip(best.text);
      });
      overlay.addEventListener("pointerleave", () => (cursor.setAttribute("hidden", ""), tip("")));
      if (brushable) {
        overlay.addEventListener("pointerdown", (e) => {
          overlay.setPointerCapture(e.pointerId);
          drag = local(e)[0];
          brush.setAttribute("x", drag);
          brush.setAttribute("width", 0);
        });
        overlay.addEventListener("pointerup", (e) => {
          if (drag === null) return;
          const [mx] = local(e);
          const [a, b] = [Math.min(drag, mx), Math.max(drag, mx)];
          drag = null;
          brush.setAttribute("width", 0);
          if (b - a > 8) {
            state.zoom = [invert(a), invert(b)];
            frame.redraw();
          }
        });
        overlay.addEventListener("dblclick", () => ((state.zoom = null), frame.redraw()));
      }
    },
  });
  return built;
};
