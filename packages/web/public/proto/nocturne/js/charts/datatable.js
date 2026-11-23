import { h } from "../dom.js";
import { cell, isNumericType, plural } from "../format.js";

const LIMIT = 500;

/**
 * A real table of a query result. Used as the "view as table" alternative for every chart, and
 * (with `sortable`) as the table visual itself. `extra` adds one derived column, e.g. status against a limit.
 */
export const dataTable = ({ result, columns, caption, labelledBy, sortable = false, pageSize = LIMIT, extra }) => {
  const cols = (columns ?? result.columns.map((c) => c.name)).map((name) => {
    const index = result.columns.findIndex((c) => c.name === name);
    return { name, index, type: index < 0 ? "string" : result.columns[index].type };
  });
  let rows = result.rows.map((r, i) => ({ r, i }));
  let sort = null; // {index, dir}
  let shown = pageSize;

  const thead = h("thead");
  const tbody = h("tbody");
  const more = h("button", { type: "button", class: "btn btn-quiet btn-sm", hidden: true, onclick: () => ((shown += pageSize), paint()) });
  const status = h("p", { class: "table-status" });

  const compare = (a, b) => {
    const [x, y] = [a.r[sort.index], b.r[sort.index]];
    if (x === y) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
  };

  const header = () => {
    const tr = h("tr");
    for (const c of cols) {
      const numeric = isNumericType(c.type);
      const active = sort?.index === c.index;
      const th = h("th", { scope: "col", class: numeric ? "num" : null, "aria-sort": sortable ? (active ? (sort.dir > 0 ? "ascending" : "descending") : "none") : null });
      if (sortable && c.index >= 0)
        th.append(
          h("button", { type: "button", class: "sort", onclick: () => ((sort = { index: c.index, dir: active && sort.dir > 0 ? -1 : 1 }), (rows = [...rows].sort(compare)), header(), paint()) }, c.name, h("span", { class: "sort-mark", "aria-hidden": "true" }, active ? (sort.dir > 0 ? "▲" : "▼") : "")),
        );
      else th.append(c.name);
      tr.append(th);
    }
    if (extra) tr.append(h("th", { scope: "col" }, extra.header));
    thead.replaceChildren(tr);
  };

  const paint = () => {
    const slice = rows.slice(0, shown);
    tbody.replaceChildren(
      ...slice.map(({ r }) => {
        const tr = h("tr", { "data-flag": extra?.flag(r) ? "" : null });
        for (const c of cols) {
          const v = c.index < 0 ? null : r[c.index];
          tr.append(h("td", { class: isNumericType(c.type) ? "num" : v === null || v === undefined ? "nil" : null }, cell(v, c.type)));
        }
        if (extra) tr.append(h("td", { class: "flagcell" }, extra.text(r)));
        return tr;
      }),
    );
    more.hidden = rows.length <= shown;
    more.textContent = `Show ${Math.min(pageSize, rows.length - shown)} more`;
    status.textContent = `${plural(rows.length, "row")}${rows.length > shown ? `, showing ${shown}` : ""}`;
  };

  header();
  paint();
  return h(
    "div",
    { class: "table-wrap" },
    h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": caption, "aria-labelledby": labelledBy }, h("table", { class: "data" }, h("caption", { class: "vh" }, caption), thead, tbody)),
    h("div", { class: "table-foot" }, status, more),
  );
};
