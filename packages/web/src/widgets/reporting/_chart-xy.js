// Line, area and scatter charts. Each builder returns { el, dispose } and draws into inline SVG.
import { h, s } from "../../ds/js/dom.js";
import { label, num, niceTicks } from "./_format.js";
import {
  axisKind,
  axisValue,
  chartSvg,
  col,
  extent,
  groupRows,
  legend,
  linear,
  mountChart,
  numeric,
  optCol,
  sample,
  seriesClass,
  textWidth,
  timeLabel,
} from "./_chart-kit.js";

const SHAPES = ["circle", "square", "triangle", "diamond", "cross"];

/** Path data for a marker of radius r centred on (cx, cy); shape varies per series so colour is never the only cue. */
const markerPath = (shape, cx, cy, r) => {
  switch (shape) {
    case "square":
      return `M${cx - r},${cy - r}h${2 * r}v${2 * r}h${-2 * r}z`;
    case "triangle":
      return `M${cx},${cy - r}L${cx + r},${cy + r}L${cx - r},${cy + r}z`;
    case "diamond":
      return `M${cx},${cy - r * 1.2}L${cx + r * 1.2},${cy}L${cx},${cy + r * 1.2}L${cx - r * 1.2},${cy}z`;
    case "cross":
      return `M${cx - r},${cy}h${2 * r}M${cx},${cy - r}v${2 * r}`;
    default:
      return `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0z`;
  }
};

const xTicks = (kind, xmin, xmax, cats, plotWidth, small) => {
  const room = Math.max(2, Math.floor(plotWidth / (textWidth("00-00 00:00", small) + 18)));
  if (kind === "category")
    return sample(
      cats.map((c, i) => ({ v: i, text: c })),
      room,
    );
  if (kind === "time") {
    const span = xmax - xmin;
    const n = Math.min(room, 6);
    return Array.from({ length: n }, (_, i) => {
      const v = xmin + (span * i) / Math.max(1, n - 1);
      return { v, text: timeLabel(v, span) };
    });
  }
  const t = niceTicks(xmin, xmax, Math.min(room, 6));
  return t.ticks.filter((v) => v >= xmin && v <= xmax).map((v) => ({ v, text: num(v) }));
};

const figure = (plot, ...rest) => h("figure", { class: "rp-chart" }, plot, ...rest);

const note = (text, tone) => h("p", { class: "rp-chart__note", "data-tone": tone }, text);

/** Draw y gridlines and tick labels; returns nothing, appends to `svg`. */
const yGrid = (svg, ticks, y, m, pw, small) => {
  for (const t of ticks) {
    svg.append(
      s("line", {
        class: t === 0 ? "rp-chart__grid rp-chart__grid--zero" : "rp-chart__grid",
        x1: m.left,
        x2: m.left + pw,
        y1: y(t),
        y2: y(t),
      }),
      s(
        "text",
        {
          class: "rp-chart__tick",
          x: m.left - 8,
          y: y(t),
          dy: "0.32em",
          "text-anchor": "end",
          "font-size": small,
        },
        num(t),
      ),
    );
  }
};

const xAxis = (svg, ticks, x, m, ph, small) => {
  for (const t of ticks) {
    svg.append(
      s("line", {
        class: "rp-chart__xtick",
        x1: m.left + x(t.v),
        x2: m.left + x(t.v),
        y1: m.top + ph,
        y2: m.top + ph + 4,
      }),
      s(
        "text",
        {
          class: "rp-chart__tick",
          x: m.left + x(t.v),
          y: m.top + ph + 6 + small,
          "text-anchor": "middle",
          "font-size": small,
        },
        t.text,
      ),
    );
  }
};

/** Hover readout: a vertical rule and the values at the nearest x. Pure enhancement; the table view has the data. */
const attachReadout = (svg, overlay, { m, pw, ph, stops, text, fs }) => {
  const rule = s("line", { class: "rp-chart__rule", y1: m.top, y2: m.top + ph, visibility: "hidden" });
  const out = s("text", { class: "rp-chart__readout", x: m.left + pw, y: fs * 0.95, "text-anchor": "end" });
  svg.append(rule, out);
  const move = (e) => {
    const box = svg.getBoundingClientRect();
    const px = e.clientX - box.left - m.left;
    let best = stops[0];
    for (const st of stops) if (Math.abs(st.px - px) < Math.abs(best.px - px)) best = st;
    rule.setAttribute("x1", m.left + best.px);
    rule.setAttribute("x2", m.left + best.px);
    rule.setAttribute("visibility", "visible");
    out.textContent = text(best);
  };
  const leave = () => {
    rule.setAttribute("visibility", "hidden");
    out.textContent = "";
  };
  overlay.addEventListener("pointermove", move);
  overlay.addEventListener("pointerleave", leave);
};

/** Drag across the plot to select a time window (session state, reported through ctx.onBrush). */
const attachBrush = (svg, overlay, { m, pw, ph, invert, onBrush }) => {
  const band = s("rect", { class: "rp-chart__brush", y: m.top, height: ph, visibility: "hidden" });
  svg.insertBefore(band, overlay);
  let x0 = null;
  const local = (e) => Math.min(pw, Math.max(0, e.clientX - svg.getBoundingClientRect().left - m.left));
  overlay.addEventListener("pointerdown", (e) => {
    x0 = local(e);
    overlay.setPointerCapture(e.pointerId);
  });
  overlay.addEventListener("pointermove", (e) => {
    if (x0 === null) return;
    const a = Math.min(x0, local(e));
    const b = Math.max(x0, local(e));
    band.setAttribute("x", m.left + a);
    band.setAttribute("width", b - a);
    band.setAttribute("visibility", "visible");
  });
  overlay.addEventListener("pointerup", (e) => {
    if (x0 === null) return;
    const a = Math.min(x0, local(e));
    const b = Math.max(x0, local(e));
    x0 = null;
    band.setAttribute("visibility", "hidden");
    if (b - a > 6) onBrush([Math.round(invert(a)), Math.round(invert(b))]);
  });
};

export const buildLine = (result, visual, ctx) => {
  const isArea = visual.type === "area";
  const x = col(result, "x", visual.channels.x);
  const y = col(result, "y", visual.channels.y);
  const series = optCol(result, "series", visual.channels.series);
  const kind = axisKind(x);
  const unit = visual.options?.unit;
  const limit = visual.threshold?.value;
  const cats = kind === "category" ? [...new Set(result.rows.map((r) => String(r[x.index])))] : [];
  const xOf = (row) =>
    kind === "category" ? cats.indexOf(String(row[x.index])) : axisValue(row[x.index], kind);

  const groups = [...groupRows(result, series).entries()].map(([name, rows]) => ({
    name: name || label(y.name),
    pts: rows
      .map((r) => ({ x: xOf(r), y: numeric(r[y.index]), raw: r[x.index] }))
      .filter((p) => p.y !== null && Number.isFinite(p.x))
      .sort((a, b) => a.x - b.x),
  }));
  const stacked = isArea && visual.options?.stacked === true && groups.length > 1;
  if (stacked) {
    const totals = new Map();
    for (const g of groups) {
      for (const p of g.pts) {
        p.y0 = totals.get(p.x) ?? 0;
        p.y1 = p.y0 + p.y;
        totals.set(p.x, p.y1);
      }
    }
  } else {
    for (const g of groups) {
      for (const p of g.pts) {
        p.y0 = null;
        p.y1 = p.y;
      }
    }
  }

  const all = groups.flatMap((g) => g.pts);
  const [xmin, xmax] = extent(all.map((p) => p.x));
  const [ymin, ymax] = extent(all.map((p) => p.y1));
  const lo = Math.min(isArea ? 0 : ymin - (ymax - ymin) * 0.08, limit ?? Infinity);
  const hi = Math.max(ymax + (isArea ? 0 : (ymax - ymin) * 0.08), limit ?? -Infinity);
  const yt = niceTicks(lo, hi, 5);
  const over = limit === undefined ? [] : all.filter((p) => p.y > limit);
  const stops = [...new Set(all.map((p) => p.x))].sort((a, b) => a - b);
  const gaps = stops
    .slice(1)
    .map((v, i) => v - stops[i])
    .sort((a, b) => a - b);
  const maxGap =
    kind === "category" || gaps.length < 3 ? Infinity : Math.max(gaps[Math.floor(gaps.length / 2)] * 4, 1);
  const [last] = groups[0]?.pts.slice(-1) ?? [];
  const brushable =
    !isArea && visual.options?.brush !== false && kind === "time" && typeof ctx.onBrush === "function";

  const kindName = isArea ? "Area chart" : "Line chart";
  const desc =
    `${kindName} of ${label(y.name)} by ${label(x.name)}, ${all.length} points` +
    (groups.length > 1 ? ` in ${groups.length} series: ${groups.map((g) => g.name).join(", ")}` : "") +
    `. Lowest ${num(ymin, unit)}, highest ${num(ymax, unit)}` +
    (last && groups.length === 1 ? `, latest ${num(last.y, unit)}` : "") +
    (limit === undefined ? "." : `. Threshold ${num(limit, unit)}: ${over.length} values above it.`);
  const title = `${ctx.title}: ${kindName.toLowerCase()}`;

  const plot = h("div", { class: "rp-chart__plot" });
  const mounted = mountChart(plot, ({ width, height, fs }) => {
    const small = fs * 0.75;
    const labelW = Math.max(...yt.ticks.map((t) => textWidth(num(t), small)));
    const m = { top: fs * 1.8, right: 14, bottom: small + 16, left: Math.ceil(labelW) + 12 };
    const pw = width - m.left - m.right;
    const ph = height - m.top - m.bottom;
    const sx =
      kind === "category"
        ? (v) => ((v + 0.5) / cats.length) * pw
        : xmax === xmin
          ? () => pw / 2
          : linear(xmin, xmax, 0, pw);
    const sy = linear(yt.min, yt.max, m.top + ph, m.top);
    const svg = chartSvg({ width, height, title, desc, className: `rp-chart__svg--${visual.type}` });

    svg.append(
      s(
        "text",
        { class: "rp-chart__caption", x: 0, y: fs * 0.95, "font-size": small },
        label(y.name) + (unit ? ` (${unit})` : "") + (kind === "time" ? ", times UTC" : ""),
      ),
    );
    yGrid(svg, yt.ticks, sy, m, pw, small);
    xAxis(svg, xTicks(kind, xmin, xmax, cats, pw, small), sx, m, ph, small);

    if (ctx.window && kind === "time") {
      const [a, b] = ctx.window.map((t) => Math.min(pw, Math.max(0, sx(t))));
      svg.append(
        s("rect", {
          class: "rp-chart__window",
          x: m.left + a,
          y: m.top,
          width: Math.max(0, b - a),
          height: ph,
        }),
      );
    }

    groups.forEach((g, i) => {
      const cls = seriesClass(i);
      const pts = g.pts.map((p) => [m.left + sx(p.x), sy(p.y1), p]);
      if (pts.length === 0) return;
      // A line never bridges a long gap: sparse series would otherwise draw a misleading ramp between
      // two far-apart observations. Runs of points are drawn separately; a lone point is a marker.
      const runs = [];
      for (const pt of pts) {
        const run = runs[runs.length - 1];
        if (run && pt[2].x - run[run.length - 1][2].x <= maxGap) run.push(pt);
        else runs.push([pt]);
      }
      for (const run of runs) {
        const top = run
          .map(([px, py], k) => `${k === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`)
          .join("");
        if (isArea && run.length > 1) {
          const bottom = run
            .slice()
            .reverse()
            .map(([px, , p]) => `L${px.toFixed(1)},${sy(p.y0 ?? yt.min).toFixed(1)}`)
            .join("");
          svg.append(s("path", { class: `rp-chart__area ${cls}`, d: `${top}${bottom}z` }));
        }
        if (run.length > 1) svg.append(s("path", { class: `rp-chart__line ${cls}`, d: top }));
        else svg.append(s("circle", { class: `rp-chart__pt ${cls}`, cx: run[0][0], cy: run[0][1], r: 2.8 }));
      }
      if (pts.length <= 36 && runs.some((r) => r.length > 1))
        for (const [px, py] of pts)
          svg.append(s("circle", { class: `rp-chart__pt ${cls}`, cx: px, cy: py, r: 2.4 }));
    });

    if (limit !== undefined) {
      svg.append(
        s("line", {
          class: "rp-chart__threshold",
          x1: m.left,
          x2: m.left + pw,
          y1: sy(limit),
          y2: sy(limit),
        }),
        s(
          "text",
          {
            class: "rp-chart__threshold-label",
            x: m.left + pw,
            y: sy(limit) - 5,
            "text-anchor": "end",
            "font-size": small,
          },
          `Threshold ${num(limit, unit)}`,
        ),
      );
      for (const p of over) {
        const cx = m.left + sx(p.x);
        const cy = sy(p.y1);
        svg.append(s("path", { class: "rp-chart__breach", d: markerPath("diamond", cx, cy, 4.2) }));
      }
    }
    if (groups.length === 1 && last) {
      svg.append(
        s(
          "text",
          {
            class: "rp-chart__direct",
            x: m.left + sx(last.x),
            y: sy(last.y1) - 9,
            "text-anchor": "end",
            "font-size": fs * 0.85,
          },
          num(last.y, unit),
        ),
      );
    }

    const overlay = s("rect", {
      class: "rp-chart__overlay",
      x: m.left,
      y: m.top,
      width: Math.max(0, pw),
      height: Math.max(0, ph),
    });
    svg.append(overlay);
    if (stops.length > 0) {
      const byX = (px) => groups.map((g) => [g.name, g.pts.find((p) => p.x === px)]).filter(([, p]) => p);
      const labelOf = (v) =>
        kind === "category" ? cats[v] : kind === "time" ? new Date(v).toISOString().slice(11, 16) : num(v);
      attachReadout(svg, overlay, {
        m,
        pw,
        ph,
        fs,
        stops: stops.map((v) => ({ v, px: sx(v) })),
        text: (st) =>
          `${labelOf(st.v)}  ${byX(st.v)
            .map(([n, p]) => (groups.length > 1 ? `${n} ${num(p.y, unit)}` : num(p.y, unit)))
            .join("  ·  ")}`,
      });
    }
    if (brushable) {
      attachBrush(svg, overlay, {
        m,
        pw,
        ph,
        invert: (px) => xmin + (px / pw) * (xmax - xmin),
        onBrush: ctx.onBrush,
      });
    }
    return svg;
  });

  const key =
    groups.length > 1
      ? legend(
          groups.map((g, i) => ({ name: g.name, cls: seriesClass(i), kind: isArea ? "area" : "line" })),
          "Series",
        )
      : null;
  const breach =
    limit === undefined
      ? null
      : note(
          over.length > 0
            ? `▲ ${over.length} ${over.length === 1 ? "value" : "values"} over ${num(limit, unit)}`
            : `No values over ${num(limit, unit)}`,
          over.length > 0 ? "breach" : "ok",
        );
  const hint = brushable
    ? h("p", { class: "rp-chart__hint" }, "Drag across the chart to select a time window.")
    : null;
  return { el: figure(plot, key, breach, hint), dispose: mounted.dispose, minRem: 9 };
};

export const buildScatter = (result, visual, ctx) => {
  const x = col(result, "x", visual.channels.x);
  const y = col(result, "y", visual.channels.y);
  const series = optCol(result, "series", visual.channels.series);
  const size = optCol(result, "size", visual.channels.size);
  const kx = axisKind(x);
  const ky = axisKind(y);
  const unit = visual.options?.unit;
  const groups = [...groupRows(result, series).entries()].map(([name, rows]) => ({
    name: name || label(y.name),
    pts: rows
      .map((r) => ({
        x: axisValue(r[x.index], kx === "category" ? "value" : kx),
        y: numeric(r[y.index]),
        z: size ? numeric(r[size.index]) : null,
        row: r,
      }))
      .filter((p) => p.y !== null && Number.isFinite(p.x)),
  }));
  const all = groups.flatMap((g) => g.pts);
  const [xmin, xmax] = extent(all.map((p) => p.x));
  const [ymin, ymax] = extent(all.map((p) => p.y));
  const [zmin, zmax] = extent(all.filter((p) => p.z !== null).map((p) => p.z));
  const yt = niceTicks(Math.min(0, ymin), ymax, 5);
  const desc =
    `Scatter plot of ${label(y.name)} against ${label(x.name)}, ${all.length} points` +
    (groups.length > 1 ? ` in ${groups.length} series: ${groups.map((g) => g.name).join(", ")}` : "") +
    `. ${label(y.name)} ranges from ${num(ymin, unit)} to ${num(ymax, unit)}.`;
  const title = `${ctx.title}: scatter plot`;

  const plot = h("div", { class: "rp-chart__plot" });
  const mounted = mountChart(plot, ({ width, height, fs }) => {
    const small = fs * 0.75;
    const labelW = Math.max(...yt.ticks.map((t) => textWidth(num(t), small)));
    const m = { top: fs * 1.8, right: 16, bottom: small + 26, left: Math.ceil(labelW) + 12 };
    const pw = width - m.left - m.right;
    const ph = height - m.top - m.bottom;
    const pad = (xmax - xmin) * 0.04 || 1;
    const sx = linear(xmin - pad, xmax + pad, 0, pw);
    const sy = linear(yt.min, yt.max, m.top + ph, m.top);
    const radius = (z) => (z === null || zmax === zmin ? 4.5 : 3 + 7 * Math.sqrt((z - zmin) / (zmax - zmin)));
    const svg = chartSvg({ width, height, title, desc, className: "rp-chart__svg--scatter" });
    svg.append(
      s(
        "text",
        { class: "rp-chart__caption", x: 0, y: fs * 0.95, "font-size": small },
        label(y.name) + (unit ? ` (${unit})` : "") + (kx === "time" ? ", times UTC" : ""),
      ),
    );
    yGrid(svg, yt.ticks, sy, m, pw, small);
    xAxis(
      svg,
      xTicks(kx === "category" ? "value" : kx, xmin, xmax, [], pw, small),
      (v) => sx(v),
      m,
      ph,
      small,
    );
    svg.append(
      s(
        "text",
        {
          class: "rp-chart__caption",
          x: m.left + pw,
          y: height - 2,
          "text-anchor": "end",
          "font-size": small,
        },
        label(x.name),
      ),
    );
    groups.forEach((g, gi) => {
      const shape = SHAPES[gi % SHAPES.length];
      for (const p of g.pts) {
        const cx = m.left + sx(p.x);
        const cy = sy(p.y);
        svg.append(
          s(
            "path",
            {
              class: `rp-chart__mark ${seriesClass(gi)}${shape === "cross" ? " is-stroke" : ""}`,
              d: markerPath(shape, cx, cy, radius(p.z)),
            },
            s(
              "title",
              null,
              `${g.name}: ${label(x.name)} ${kx === "time" ? new Date(p.x).toISOString().slice(0, 16) : num(p.x)}, ${label(y.name)} ${num(p.y, unit)}${p.z !== null ? `, ${label(size.name)} ${num(p.z)}` : ""}`,
            ),
          ),
        );
      }
    });
    return svg;
  });
  const key =
    groups.length > 1
      ? legend(
          groups.map((g, i) => ({ name: g.name, cls: seriesClass(i), kind: "dot" })),
          "Series",
        )
      : null;
  return { el: figure(plot, key), dispose: mounted.dispose, minRem: 9 };
};
