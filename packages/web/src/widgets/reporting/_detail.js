// Generic, safe rendering of an arbitrary detail value (approval detail, audit change ops, diff ops): scalars as
// text, lists of records as small tables, nested records as definition lists, everything else as indented text.
import { h } from "../../ds/js/dom.js";
import { dataTable } from "../../ds/js/table.js";
import { jsonText } from "./_common.js";

const MAX_COLS = 8;

const pretty = (key) =>
  String(key)
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

const scalarText = (v) => {
  if (v === null || v === undefined) return "–";
  if (typeof v === "object") {
    const text = JSON.stringify(v);
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
  }
  return String(v);
};

const isRecord = (v) => v && typeof v === "object" && !Array.isArray(v);

const table = (caption, rows) => {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, MAX_COLS);
  return dataTable({
    caption,
    density: "compact",
    rowKey: (r) => r.__i,
    rows: rows.map((r, i) => ({ ...r, __i: i })),
    columns: keys.map((k) => ({ key: k, label: pretty(k), render: (r) => scalarText(r[k]) })),
  });
};

/** A node for any value. `caption` names tables; `depth` stops deep recursion. */
export const valueNode = (value, caption = "Detail", depth = 0) => {
  if (Array.isArray(value)) {
    if (value.length === 0) return h("span", { class: "u-muted" }, "None");
    if (value.every(isRecord)) return table(caption, value);
    return h("span", {}, value.map(scalarText).join(", "));
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return h("span", { class: "u-muted" }, "None");
    if (depth >= 2) return h("pre", { class: "rp-code", tabindex: "0" }, h("code", {}, jsonText(value)));
    return h(
      "dl",
      { class: "rp-kv" },
      ...entries.flatMap(([k, v]) => [
        h("dt", {}, pretty(k)),
        h("dd", {}, valueNode(v, pretty(k), depth + 1)),
      ]),
    );
  }
  return h("span", {}, scalarText(value));
};

/** Sections of a record: one headed block per key. */
export const detailSections = (detail) => {
  const entries = Object.entries(detail ?? {});
  if (entries.length === 0) return h("p", { class: "u-muted" }, "No further detail.");
  return h(
    "div",
    { class: "rp-detail" },
    ...entries.map(([k, v]) =>
      h(
        "section",
        { class: "rp-detail__section" },
        h("h4", { class: "rp-detail__title" }, pretty(k)),
        valueNode(v, pretty(k)),
      ),
    ),
  );
};

/** A change op (`{ op, path, value }`) as one line of plain text. */
export const opLine = (op) => {
  const path = op.path ?? "";
  if (op.op === "set") return `set ${path || "(document)"} = ${scalarText(op.value)}`;
  if (op.op === "remove") return `remove ${path}`;
  if (op.op === "delete") return "delete node";
  if (op.op === "create") return `create ${op.kind ?? "node"} ${op.slug ?? ""}`.trim();
  return jsonText(op);
};
