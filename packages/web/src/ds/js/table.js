// Data table and pager. DESIGN-SYSTEM 6.11. The caller sorts; the table renders, selects and reports.
import { h, uid } from "./dom.js";
import { icon } from "./icons.js";
import { button } from "./button.js";
import { skeleton } from "./states.js";

export const CARD_BREAKPOINT = "40rem";

const nextDir = (sort, key) =>
  sort?.key !== key
    ? "ascending"
    : sort.dir === "ascending"
      ? "descending"
      : sort.dir === "descending"
        ? null
        : "ascending";

export const dataTable = ({
  caption,
  columns,
  rows,
  rowKey,
  onRowClick,
  rowHref,
  selectable = false,
  selected = [],
  onSelect,
  sort,
  onSort,
  empty,
  loading = false,
  density = "default",
}) => {
  const picked = new Set(selected);
  const keyOf = (row) => (typeof rowKey === "function" ? rowKey(row) : row[rowKey]);
  const cols = columns.length + (selectable ? 1 : 0);
  const headChecks = [];
  const rowChecks = [];

  const syncHead = () => {
    const all = rows.length > 0 && rows.every((r) => picked.has(keyOf(r)));
    const some = rows.some((r) => picked.has(keyOf(r)));
    for (const c of headChecks) {
      c.checked = all;
      c.indeterminate = some && !all;
    }
  };
  const emit = () => onSelect?.([...picked]);

  const headCells = [];
  if (selectable) {
    const all = h("input", { type: "checkbox", "aria-label": "Select all rows" });
    headChecks.push(all);
    all.addEventListener("change", () => {
      for (const r of rows) all.checked ? picked.add(keyOf(r)) : picked.delete(keyOf(r));
      rowChecks.forEach((c) => (c.checked = all.checked));
      syncHead();
      emit();
    });
    headCells.push(h("th", { scope: "col", class: "c-table__select" }, all));
  }
  for (const col of columns) {
    const th = h("th", {
      scope: "col",
      class: `c-table__head${col.align === "end" ? " c-table__cell--num" : ""}`,
      style: col.width ? `inline-size:${col.width}` : null,
    });
    if (col.sortable) {
      const dir = sort?.key === col.key ? sort.dir : "none";
      th.setAttribute("aria-sort", dir ?? "none");
      th.append(
        h(
          "button",
          {
            type: "button",
            class: "c-table__sort",
            onclick: () => onSort?.({ key: col.key, dir: nextDir(sort, col.key) }),
          },
          col.label,
          icon(dir === "ascending" ? "chevron-up" : dir === "descending" ? "chevron-down" : "sort", {
            size: 16,
          }),
        ),
      );
    } else th.append(col.label);
    headCells.push(th);
  }

  const body = h("tbody", {});
  if (loading) {
    body.append(h("tr", {}, h("td", { colspan: cols }, skeleton({ shape: "table", lines: columns.length }))));
  } else if (rows.length === 0) {
    body.append(
      h(
        "tr",
        {},
        h(
          "td",
          { colspan: cols, class: "c-table__empty" },
          empty ?? h("p", { class: "u-muted" }, "Nothing to show"),
        ),
      ),
    );
  } else {
    for (const row of rows) {
      const key = keyOf(row);
      const tr = h("tr", { "data-key": key });
      let firstText = "";
      if (selectable) {
        const c = h("input", { type: "checkbox", checked: picked.has(key) ? true : null });
        rowChecks.push(c);
        c.addEventListener("change", () => {
          c.checked ? picked.add(key) : picked.delete(key);
          syncHead();
          emit();
        });
        tr.append(h("td", { class: "c-table__select", "data-label": "" }, c));
      }
      columns.forEach((col, i) => {
        const raw = col.render ? col.render(row) : row[col.key];
        const content = raw instanceof Node ? raw : String(raw ?? "");
        if (i === 0) firstText = content instanceof Node ? content.textContent : content;
        let cell = content;
        const href = i === 0 ? rowHref?.(row) : null;
        if (href) cell = h("a", { class: "c-table__link", href }, content);
        tr.append(
          h(
            "td",
            { class: col.align === "end" ? "c-table__cell--num u-tabular" : null, "data-label": col.label },
            cell,
          ),
        );
      });
      if (selectable) rowChecks[rowChecks.length - 1].setAttribute("aria-label", `Select ${firstText}`);
      if (onRowClick && !rowHref?.(row)) {
        tr.classList.add("is-clickable");
        tr.addEventListener("click", (e) => {
          if (!e.target.closest("a, button, input")) onRowClick(row);
        });
      }
      body.append(tr);
    }
  }
  const table = h(
    "table",
    {
      class: `c-table__table${density === "compact" ? " c-table__table--compact" : ""}`,
      "aria-busy": loading ? "true" : null,
    },
    h("caption", { class: "c-table__caption" }, caption),
    h("thead", {}, h("tr", {}, ...headCells)),
    body,
  );
  syncHead();
  return h("div", { class: "c-table", id: uid("tbl") }, table);
};

export const pager = ({ nextCursor, onNext, onPrev, label = "Pagination" }) =>
  h(
    "nav",
    { class: "c-pager", "aria-label": label },
    onPrev
      ? button({ label: "Previous", icon: "chevron-left", variant: "secondary", size: "sm", onClick: onPrev })
      : null,
    button({
      label: "Next",
      icon: "chevron-right",
      variant: "secondary",
      size: "sm",
      disabled: nextCursor === null || nextCursor === undefined,
      onClick: () => onNext?.(nextCursor),
    }),
  );
