// Rendering one reporting entry: the visual (or its table alternative), the error and empty states, the foot
// line, and the inspector content. Shared by the single-visual widgets, reporting.panel and reporting.board.
import { h } from "../../ds/js/dom.js";
import { emptyState } from "../../ds/js/states.js";
import { number } from "../../ds/js/format.js";
import { ChannelError, buildTable, buildVisual, channelColumns, narrowResult } from "./_visuals.js";
import { formatQuery, summarizeQuery } from "./_query-text.js";
import { isoInstant, num, utcTime } from "./_format.js";
import { keyValues, jsonText } from "./_common.js";

/** Vertical room a chart needs besides the plot: heading, padding, caption. */
export const CHROME_REM = 5.5;

const stateBlock = (kind, ...kids) => h("div", { class: `rp-state rp-state--${kind}` }, ...kids);

/**
 * entry: { title, query, visual, result?, error? }
 * opts: { showTable, window, filter, tableState, onBrush, onSelect, selected, onRow, pageSize }
 * Returns { el, dispose, minRem, state: "ready"|"error"|"empty", chartable }.
 */
export const renderEntry = (entry, opts = {}) => {
  const e = entry;
  const chartable = Boolean(
    e.result && !e.error && e.visual && e.visual.type !== "table" && e.result.rows.length > 0,
  );
  if (e.error || !e.result) {
    const err = e.error ?? { code: "NO_RESULT", message: "The query returned no result." };
    return {
      el: stateBlock(
        "error",
        h("p", { class: "rp-state__code" }, err.code),
        h("p", { class: "rp-state__text" }, err.message),
        err.fix_hint ? h("p", { class: "rp-state__hint" }, err.fix_hint) : null,
      ),
      dispose() {},
      minRem: 0,
      state: "error",
      chartable,
    };
  }
  if (e.result.rows.length === 0) {
    return {
      el: stateBlock(
        "empty",
        h("p", { class: "rp-state__title" }, "No rows for this query"),
        h("p", { class: "rp-state__text rp-state__text--mono" }, summarizeQuery(e.query)),
      ),
      dispose() {},
      minRem: 0,
      state: "empty",
      chartable,
    };
  }
  const narrowed = narrowResult(e.result, e.visual, { window: opts.window, filter: opts.filter });
  if (narrowed.rows.length === 0) {
    return {
      el: stateBlock(
        "empty",
        h("p", { class: "rp-state__title" }, "Nothing in the selected range"),
        h(
          "p",
          { class: "rp-state__text" },
          "The window or filter chosen in another widget leaves no rows here. Clear it to see everything again.",
        ),
      ),
      dispose() {},
      minRem: 0,
      state: "empty",
      chartable,
    };
  }
  const ctx = {
    title: e.title,
    window: opts.window ?? undefined,
    onBrush: opts.onBrush,
    onSelect: opts.onSelect,
    selected: opts.selected,
    tableState: opts.tableState,
    onRow: opts.onRow,
    pageSize: opts.pageSize,
  };
  try {
    const built =
      opts.showTable && chartable
        ? buildTable(narrowed, channelColumns(e.visual), {
            caption: e.title,
            pageSize: opts.pageSize ?? 25,
            state: opts.tableState,
            onRow: opts.onRow,
          })
        : buildVisual(e.visual, narrowed, ctx);
    return {
      el: built.el,
      dispose: built.dispose,
      minRem: built.minRem ? built.minRem + CHROME_REM : 0,
      state: "ready",
      chartable,
    };
  } catch (err) {
    if (!(err instanceof ChannelError)) throw err;
    return {
      el: stateBlock(
        "error",
        h("p", { class: "rp-state__code" }, "CHANNEL_MAPPING"),
        h("p", { class: "rp-state__text" }, err.message),
      ),
      dispose() {},
      minRem: 0,
      state: "error",
      chartable,
    };
  }
};

/** "source:suite.badge_awards" -> "Badge awards". */
export const friendlySource = (from) => {
  const slug = String(from)
    .replace(/^source:/, "")
    .replace(/^suite\./, "")
    .replace(/[._-]+/g, " ")
    .trim();
  return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : String(from);
};

/** Source, as-of and row count line under a visual. */
export const entryFoot = (e) => {
  if (!e.result) return null;
  const asOf = Date.parse(e.result.as_of);
  return h(
    "footer",
    { class: "rp-foot" },
    e.query?.from
      ? h("span", { title: String(e.query.from) }, "Source: ", friendlySource(e.query.from))
      : null,
    h(
      "span",
      {},
      "As of ",
      Number.isNaN(asOf) ? e.result.as_of : h("time", { datetime: isoInstant(asOf) }, utcTime(asOf)),
    ),
    h(
      "span",
      {},
      `${num(e.result.row_count)} ${e.result.row_count === 1 ? "row" : "rows"}${e.result.truncated ? " (truncated)" : ""}`,
    ),
  );
};

const planRows = (plan) => {
  if (plan === null || typeof plan !== "object") return [["Plan summary", String(plan ?? "–")]];
  return [
    ["Sources", (plan.sources ?? []).join(", ") || "–"],
    ["Partitions read", number(plan.partitions_read ?? 0)],
    ["Partitions pruned", number(plan.partitions_pruned ?? 0)],
  ];
};

/** The inspector content: identity, query, visual spec and result metadata. */
export const inspectorBody = (entry) => {
  const r = entry.result;
  const block = (title, ...kids) =>
    h("section", { class: "rp-inspector__section" }, h("h3", {}, title), ...kids);
  return h(
    "div",
    { class: "rp-inspector" },
    block(
      "Identity",
      keyValues(
        [
          ["URI", entry.node?.uri ?? "–"],
          ["Revision", entry.node ? String(entry.node.revision) : "–"],
          ["Slug", entry.slug ?? entry.node?.slug ?? "–"],
          ["Visual", entry.visual?.type ?? "–"],
        ].map(([k, v]) => [k, h("span", { class: "u-mono" }, v)]),
      ),
    ),
    block("Query", h("pre", { class: "rp-code", tabindex: "0" }, h("code", {}, formatQuery(entry.query)))),
    block(
      "Visual spec",
      h("pre", { class: "rp-code", tabindex: "0" }, h("code", {}, jsonText(entry.visual ?? null))),
    ),
    block(
      "Result",
      r
        ? keyValues([
            ["As of", r.as_of],
            ["Rows", `${num(r.row_count)}${r.truncated ? " (truncated)" : ""}`],
            ["Policy hash", r.policy_hash ?? "none"],
            ["Result hash", r.result_hash ?? "–"],
            ...planRows(r.plan_summary),
            ...(r.watermarks?.length
              ? [["Watermarks", r.watermarks.map((w) => `${w.source} ${w.watermark}`).join("; ")]]
              : []),
          ])
        : entry.error
          ? emptyState({ icon: "alert", title: entry.error.code, body: entry.error.message })
          : h("p", { class: "u-muted" }, "No result."),
    ),
  );
};
