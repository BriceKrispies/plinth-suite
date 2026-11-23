/** Real <table> output, used by the table visual and by every "view as table" toggle. */
import { h } from "../dom.js";
import { cell, isNumericType } from "../format.js";
import { col } from "./data.js";

const DEFAULT_PAGE = 200;

export const buildTable = (result, { columns, pageSize = DEFAULT_PAGE, title }) => {
  const cols = columns
    ? columns.map((name) => col(result, "columns", name))
    : result.columns.map((c, index) => ({ index, name: c.name, type: c.type }));
  const rows = result.rows.slice(0, pageSize);
  const clipped = result.rows.length - rows.length;
  return h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": `${title}, data table` },
    h("table", { class: "data-table" },
      h("caption", { class: "visually-hidden" }, `${title}: ${result.rows.length} row${result.rows.length === 1 ? "" : "s"}`),
      h("thead", null, h("tr", null, cols.map((c) =>
        h("th", { scope: "col", class: isNumericType(c.type) ? "num" : null }, c.name)))),
      h("tbody", null, rows.map((row) => h("tr", null, cols.map((c) => {
        const v = row[c.index];
        return h("td", { class: isNumericType(c.type) ? "num" : v === null ? "nil" : null }, cell(v, c.type));
      }))))),
    clipped > 0 ? h("p", { class: "table-note" }, `${clipped} more row${clipped === 1 ? "" : "s"} not shown.`) : null);
};

export const mountTable = (container, { visual, result, title }) => {
  const el = buildTable(result, { columns: visual.columns, pageSize: visual.options?.page_size, title });
  container.append(el);
  return { dispose: () => el.remove() };
};
