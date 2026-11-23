// Visual dispatcher plus the two non-SVG visuals: the KPI tile and the data table. Every builder takes the
// query result and the visual spec and returns { el, dispose, minRem }. They never fetch.
import { h, s } from "../../ds/js/dom.js";
import { statTile } from "../../ds/js/stat.js";
import { dataTable, pager } from "../../ds/js/table.js";
import { searchField } from "../../ds/js/field.js";
import { button } from "../../ds/js/button.js";
import { toast } from "../../ds/js/toast.js";
import { cell, isNumericType, label, num, toMs } from "./_format.js";
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
} from "./_chart-kit.js";
import { buildLine, buildScatter } from "./_chart-xy.js";
import { buildBar, buildHeatmap } from "./_chart-grid.js";

export { ChannelError };

// ---- rows: filtering by the page bus --------------------------------------------------------

/** Names of the columns the visual reads (its channels or table columns), without duplicates. */
export const channelColumns = (visual) => {
  if (visual.type === "table") return visual.columns;
  return [...new Set(Object.values(visual.channels))];
};

/**
 * A copy of `result` restricted by the page bus. `window` is `[fromMs, toMs]` applied to the first timestamp
 * column the visual reads; `filter` is `{ key, value }` applied when the result has a column of that name.
 * Returns the same object when nothing applies, so callers can tell.
 */
export const narrowResult = (result, visual, { window, filter } = {}) => {
  if (!result) return result;
  let rows = result.rows;
  let touched = false;
  if (window && Number.isFinite(window[0]) && Number.isFinite(window[1])) {
    const names = channelColumns(visual);
    const time = result.columns.findIndex((c) => c.type === "timestamp" && names.includes(c.name));
    if (time >= 0) {
      rows = rows.filter((r) => {
        const t = toMs(r[time]);
        return t >= window[0] && t <= window[1];
      });
      touched = true;
    }
  }
  if (filter && filter.value !== null && filter.value !== undefined) {
    const at = result.columns.findIndex((c) => c.name === filter.key);
    if (at >= 0) {
      rows = rows.filter((r) => String(r[at]) === String(filter.value));
      touched = true;
    }
  }
  return touched ? { ...result, rows, row_count: rows.length } : result;
};

// ---- table ---------------------------------------------------------------------------------

/** Order two cells of the same column: numbers and instants by value, text by locale, nulls last. */
const comparer = (type) => (x, y) => {
  if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
  if (y === null || y === undefined) return -1;
  if (isNumericType(type)) return Number(x) - Number(y);
  if (type === "timestamp") return toMs(x) - toMs(y);
  return String(x).localeCompare(String(y), "en", { numeric: true });
};

const csvCell = (v) => {
  const text = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Sortable, searchable, paged table over a result (the table visual and every chart's "view as table").
 * `state` is `{ sort: {key, dir}|null, page, q }` kept by the caller so it survives a live re-render.
 * `onRow(rowObject)` opens a row detail (the caller decides how).
 */
export const buildTable = (result, columnNames, { caption, pageSize = 25, state, onRow } = {}) => {
  const st = state ?? { sort: null, page: 0, q: "" };
  const cols = columnNames.map((name) => col(result, "columns", name));
  const body = h("div", { class: "rp-table__body" });
  const status = h("p", { class: "rp-table__status", "aria-live": "polite" });
  const toObject = (row) => Object.fromEntries(cols.map((c) => [c.name, row[c.index]]));

  const visibleRows = () => {
    let list = result.rows.map((row, i) => ({ i, row }));
    const q = st.q.trim().toLowerCase();
    if (q)
      list = list.filter(({ row }) => cols.some((c) => cell(row[c.index], c.type).toLowerCase().includes(q)));
    const sc = st.sort && cols.find((c) => c.name === st.sort.key);
    if (sc && st.sort.dir) {
      const cmp = comparer(sc.type);
      const sign = st.sort.dir === "descending" ? -1 : 1;
      list = [...list].sort((a, b) => sign * cmp(a.row[sc.index], b.row[sc.index]));
    }
    return list;
  };

  const paint = (restoreSort) => {
    const all = visibleRows();
    const pages = Math.max(1, Math.ceil(all.length / pageSize));
    st.page = Math.min(st.page, pages - 1);
    const slice = all.slice(st.page * pageSize, (st.page + 1) * pageSize);
    const table = dataTable({
      caption,
      columns: cols.map((c) => ({
        key: c.name,
        label: label(c.name),
        align: isNumericType(c.type) ? "end" : "start",
        sortable: true,
        render: (r) => cell(r.row[c.index], c.type),
      })),
      rows: slice,
      rowKey: (r) => r.i,
      sort: st.sort,
      onSort: (next) => {
        st.sort = next.dir ? next : null;
        st.page = 0;
        paint(next.key);
      },
      onRowClick: onRow ? (r) => onRow(toObject(r.row)) : undefined,
      density: "compact",
      empty: h("p", { class: "u-muted" }, st.q ? `No rows match “${st.q}”.` : "This query returned no rows."),
    });
    body.replaceChildren(
      table,
      ...[
        all.length > pageSize
          ? pager({
              label: `${caption} pages`,
              nextCursor: st.page < pages - 1 ? String(st.page + 1) : null,
              onNext: () => {
                st.page += 1;
                paint();
              },
              onPrev:
                st.page > 0
                  ? () => {
                      st.page -= 1;
                      paint();
                    }
                  : undefined,
            })
          : null,
      ].filter(Boolean),
    );
    const from = all.length === 0 ? 0 : st.page * pageSize + 1;
    status.textContent =
      all.length === result.rows.length
        ? `${num(from)} to ${num(from + slice.length - (all.length ? 1 : 0))} of ${num(all.length)} rows${result.truncated ? " (truncated by the query limit)" : ""}`
        : `${num(all.length)} of ${num(result.rows.length)} rows match`;
    if (restoreSort) {
      const idx = cols.findIndex((c) => c.name === restoreSort);
      body.querySelectorAll(".c-table__sort")[idx]?.focus();
    }
  };

  const copy = button({
    label: "Copy CSV",
    icon: "copy",
    variant: "ghost",
    size: "sm",
    onClick: async () => {
      const lines = [cols.map((c) => csvCell(c.name)).join(",")];
      for (const { row } of visibleRows()) lines.push(cols.map((c) => csvCell(row[c.index])).join(","));
      try {
        await navigator.clipboard.writeText(lines.join("\n"));
        toast({ title: "Copied as CSV", body: `${lines.length - 1} rows`, tone: "success" });
      } catch {
        toast({ title: "Could not copy", body: "The browser refused clipboard access.", tone: "warning" });
      }
    },
  });
  const search = searchField({
    name: "q",
    label: "Filter rows",
    value: st.q,
    placeholder: "Filter rows",
    onInput: (v) => {
      st.q = v;
      st.page = 0;
      paint();
    },
  });
  paint();
  return {
    el: h("div", { class: "rp-table" }, h("div", { class: "rp-table__tools" }, search, copy), body, status),
    dispose() {},
    minRem: 12,
  };
};

// ---- KPI -----------------------------------------------------------------------------------

const signed = (d) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${num(Math.abs(d))}`;

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

  let spark;
  if (sx && sy && result.rows.length > 1) {
    const kind = axisKind(sx);
    spark = result.rows
      .map((r, i) => ({ x: kind === "category" ? i : axisValue(r[sx.index], kind), y: numeric(r[sy.index]) }))
      .filter((p) => p.y !== null && Number.isFinite(p.x))
      .sort((a, b) => a.x - b.x)
      .map((p) => p.y);
  }
  const el = h(
    "div",
    { class: "rp-kpi", "data-breach": breach ? "true" : "false" },
    statTile({
      label: ctx.title,
      value: v === null ? "–" : num(v),
      unit,
      delta: d === null ? undefined : signed(d),
      good,
      spark,
      hint: breach ? `Above threshold ${num(limit, unit)}` : undefined,
    }),
    breach
      ? h("p", { class: "rp-chart__note", "data-tone": "breach" }, `▲ Above threshold ${num(limit, unit)}`)
      : null,
  );
  return { el, dispose() {}, minRem: 7 };
};

/** A larger trend drawn under a KPI at big sizes; reuses the chart plumbing. */
export const kpiTrend = (result, visual, ctx) => {
  const sx = optCol(result, "x", visual.channels.x);
  const sy = optCol(result, "y", visual.channels.y);
  if (!sx || !sy || result.rows.length < 2) return null;
  const kind = axisKind(sx);
  const unit = visual.options?.unit;
  const pts = result.rows
    .map((r, i) => ({ x: kind === "category" ? i : axisValue(r[sx.index], kind), y: numeric(r[sy.index]) }))
    .filter((p) => p.y !== null && Number.isFinite(p.x))
    .sort((a, b) => a.x - b.x);
  if (pts.length < 2) return null;
  const [y0, y1] = extent(pts.map((p) => p.y));
  const desc = `Trend of ${label(sy.name)} over ${label(sx.name)}, ${pts.length} points, from ${num(pts[0].y, unit)} to ${num(pts.at(-1).y, unit)}, low ${num(y0, unit)}, high ${num(y1, unit)}.`;
  const host = h("div", { class: "rp-kpi__spark" });
  const mounted = mountChart(host, ({ width, height }) => {
    const [x0, x1] = extent(pts.map((p) => p.x));
    const px = linear(x0, x1, 2, width - 4);
    const py = linear(y0, y1 === y0 ? y0 + 1 : y1, height - 4, 4);
    const line = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`)
      .join("");
    const svg = chartSvg({
      width,
      height,
      title: `${ctx.title}: trend`,
      desc,
      className: "rp-chart__svg--spark",
    });
    svg.append(
      s("path", {
        class: "rp-chart__area rp-s0",
        d: `${line}L${px(x1).toFixed(1)},${height}L${px(x0).toFixed(1)},${height}z`,
      }),
      s("path", { class: "rp-chart__line rp-s0", d: line }),
      s("circle", {
        class: "rp-chart__pt rp-s0 is-last",
        cx: px(pts.at(-1).x),
        cy: py(pts.at(-1).y),
        r: 3.2,
      }),
    );
    return svg;
  });
  return { el: host, dispose: mounted.dispose };
};

// ---- dispatch ------------------------------------------------------------------------------

/**
 * Build the visual. Throws ChannelError when a channel maps a column the query did not return.
 * ctx: { title, window, onBrush, onSelect, selected, tableState, onRow, pageSize }.
 */
export const buildVisual = (visual, result, ctx) => {
  switch (visual.type) {
    case "kpi":
      return buildKpi(result, visual, ctx);
    case "table":
      return buildTable(result, visual.columns, {
        caption: ctx.title,
        pageSize: visual.options?.page_size ?? ctx.pageSize ?? 25,
        state: ctx.tableState,
        onRow: ctx.onRow,
      });
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
