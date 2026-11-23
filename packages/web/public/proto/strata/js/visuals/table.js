import { h } from "../dom.js";
import { cell, isNumericType } from "../format.js";
import { col } from "./data.js";

/**
 * A real table. `columns` are result columns; `flag(row)` may add a trailing text column so that a threshold
 * breach is stated in words, not only in colour.
 */
export const buildTable = (result, columns, { limit = 200, flag, caption } = {}) => {
  const rows = result.rows.slice(0, limit);
  return h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": caption ?? "Data table" },
    h("table", { class: "data" },
      h("caption", { class: "sr-only" }, `${caption ?? "Data"}: ${rows.length} of ${result.rows.length} rows`),
      h("thead", null,
        h("tr", null,
          columns.map((c) => h("th", { scope: "col", class: isNumericType(c.type) ? "num" : null }, c.name)),
          flag ? h("th", { scope: "col" }, "Status") : null)),
      h("tbody", null,
        rows.map((row) => {
          const note = flag?.(row) ?? "";
          return h("tr", { dataset: note ? { breach: "true" } : {} },
            columns.map((c) => {
              const v = row[c.index];
              return h("td", { class: isNumericType(c.type) ? "num" : v === null ? "nil" : null }, cell(v, c.type));
            }),
            flag ? h("td", { class: "status" }, note) : null);
        }))));
};

/** The table visual itself. */
export function mountTable(host, { result, visual, title }) {
  const columns = visual.columns.map((name) => col(result, "columns", name));
  host.replaceChildren(buildTable(result, columns, { limit: visual.options?.page_size ?? 200, caption: title }));
  return { breaches: 0, destroy() {} };
}
