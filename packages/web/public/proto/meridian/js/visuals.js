// Visual dispatcher plus the two non-SVG-chart visuals: KPI tile (with sparkline) and table.
import { h, s } from "./dom.js";
import { cell, isNumericType, label, num } from "./format.js";
import {
  ChannelError,
  axisKind,
  axisValue,
  chartSvg,
  col,
  extent,
  linear,
  mountChart,
  numeric,
  optCol,
} from "./chart-kit.js";
import { buildLine, buildScatter } from "./chart-xy.js";
import { buildBar, buildHeatmap } from "./chart-grid.js";

export { ChannelError };

// ---- table ---------------------------------------------------------------------------------

/** A real <table>. Used for the table visual and for every chart's "view as table" alternative. */
export const buildTable = (result, columnNames, { caption, pageSize = 200 } = {}) => {
  const cols = columnNames.map((name) => col(result, "columns", name));
  const rows = result.rows.slice(0, pageSize);
  const table = h(
    "table",
    { class: "data" },
    h("caption", { class: "sr-only" }, caption ?? "Query result"),
    h("thead", null, h("tr", null, cols.map((c) => h("th", { scope: "col", class: isNumericType(c.type) ? "is-num" : null }, label(c.name))))),
    h(
      "tbody",
      null,
      rows.map((row) =>
        h(
          "tr",
          null,
          cols.map((c) => {
            const v = row[c.index];
            return h("td", { class: isNumericType(c.type) ? "is-num" : v === null ? "is-nil" : null }, cell(v, c.type));
          }),
        ),
      ),
    ),
  );
  const more = result.rows.length > rows.length ? h("p", { class: "chart__note" }, `Showing ${rows.length} of ${result.rows.length} rows.`) : null;
  return { el: h("div", { class: "table" }, h("div", { class: "table__scroll", tabindex: "0", role: "region", "aria-label": caption ? `${caption} table` : "Table" }, table), more), dispose() {} };
};

/** Columns a chart's channels read, in channel order, without duplicates. */
export const channelColumns = (visual) => {
  if (visual.type === "table") return visual.columns;
  return [...new Set(Object.values(visual.channels))];
};

// ---- KPI -----------------------------------------------------------------------------------

const buildKpi = (result, visual, ctx) => {
  const value = col(result, "value", visual.channels.value);
  const delta = optCol(result, "delta", visual.channels.delta);
  const sx = optCol(result, "x", visual.channels.x);
  const sy = optCol(result, "y", visual.channels.y);
  const last = result.rows[result.rows.length - 1];
  const v = last ? numeric(last[value.index]) : null;
  const d = last && delta ? numeric(last[delta.index]) : null;
  const unit = visual.options?.unit;
  const limit = visual.threshold?.value;
  const good = visual.options?.good ?? "up";
  const breach = limit !== undefined && v !== null && v > limit;
  const tone = d === null || d === 0 ? "flat" : d > 0 === (good === "up") ? "good" : "bad";

  const el = h("div", { class: "kpi", "data-breach": breach ? "true" : "false" });
  el.append(
    h(
      "p",
      { class: "kpi__value" },
      h("span", { class: "kpi__figure" }, v === null ? "—" : num(v)),
      unit ? h("span", { class: "kpi__unit" }, unit) : null,
    ),
  );
  const meta = h("p", { class: "kpi__meta" });
  if (d !== null) {
    meta.append(
      h(
        "span",
        { class: "kpi__delta", "data-tone": tone },
        h("span", { "aria-hidden": "true" }, d > 0 ? "▲" : d < 0 ? "▼" : "▬"),
        ` ${num(Math.abs(d))}`,
        h("span", { class: "kpi__word" }, d === 0 ? " unchanged" : tone === "good" ? " improving" : " worsening"),
      ),
    );
  }
  if (breach) meta.append(h("span", { class: "kpi__breach" }, `▲ Above threshold ${num(limit, unit)}`));
  if (meta.childElementCount > 0) el.append(meta);

  let dispose = () => {};
  if (sx && sy && result.rows.length > 1) {
    const kind = axisKind(sx);
    const pts = result.rows
      .map((r) => ({ x: kind === "category" ? 0 : axisValue(r[sx.index], kind), y: numeric(r[sy.index]) }))
      .map((p, i) => ({ ...p, x: kind === "category" ? i : p.x }))
      .filter((p) => p.y !== null && Number.isFinite(p.x));
    const [y0, y1] = extent(pts.map((p) => p.y));
    const desc = `Trend of ${label(sy.name)} over ${label(sx.name)}, ${pts.length} points, from ${num(pts[0].y, unit)} to ${num(pts.at(-1).y, unit)}, low ${num(y0, unit)}, high ${num(y1, unit)}.`;
    const host = h("div", { class: "kpi__spark" });
    const mounted = mountChart(host, ({ width, height }) => {
      const [x0, x1] = extent(pts.map((p) => p.x));
      const px = linear(x0, x1, 2, width - 4);
      const py = linear(y0, y1 === y0 ? y0 + 1 : y1, height - 4, 4);
      const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join("");
      const svg = chartSvg({ width, height, title: `${ctx.title}: trend`, desc, className: "chart__svg--spark" });
      svg.append(
        s("path", { class: "chart__area s0", d: `${line}L${px(x1).toFixed(1)},${height}L${px(x0).toFixed(1)},${height}z` }),
        s("path", { class: "chart__line s0", d: line }),
        s("circle", { class: "chart__pt s0 is-last", cx: px(pts.at(-1).x), cy: py(pts.at(-1).y), r: 3.2 }),
      );
      return svg;
    });
    dispose = mounted.dispose;
    el.append(host);
  }
  return { el, dispose };
};

// ---- dispatch ------------------------------------------------------------------------------

/**
 * Build the visual for a panel. Throws ChannelError when a channel maps a column the query did
 * not return. ctx: { title, window, onBrush }.
 */
export const buildVisual = (visual, result, ctx) => {
  switch (visual.type) {
    case "kpi":
      return buildKpi(result, visual, ctx);
    case "table":
      return buildTable(result, visual.columns, { caption: ctx.title, pageSize: visual.options?.page_size });
    case "bar":
      return buildBar(result, visual, ctx);
    case "heatmap":
      return buildHeatmap(result, visual, ctx);
    case "scatter":
      return buildScatter(result, visual, ctx);
    case "line":
    case "area":
      return buildLine(result, visual, ctx);
    default:
      throw new ChannelError(`Unknown visual type '${visual.type}'.`);
  }
};
