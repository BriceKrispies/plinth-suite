/** The inspector: a modal dialog with the panel's URI, query, visual spec and result metadata. */
import { h } from "./dom.js";
import { kindOfUri, pretty, queryClauses } from "./format.js";

const facts = (rows) =>
  h("dl", { class: "facts" }, rows.filter(([, v]) => v !== undefined && v !== null && v !== "").flatMap(([k, v]) => [h("dt", null, k), h("dd", null, String(v))]));

const section = (heading, ...body) => h("section", { class: "inspector__section" }, h("h3", null, heading), ...body);

const raw = (summary, value) =>
  h("details", null, h("summary", null, summary), h("pre", null, h("code", null, pretty(value))));

const planText = (plan) => (plan === undefined || plan === null ? undefined : typeof plan === "string" ? plan : JSON.stringify(plan));

export const createInspector = (dialog) => {
  let opener = null;

  dialog.addEventListener("close", () => {
    if (opener?.isConnected) opener.focus();
    opener = null;
  });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  const body = ({ entry, result, error }) => {
    const node = entry.node;
    const visual = entry.visual;
    const channels = visual?.channels
      ? Object.entries(visual.channels).map(([k, v]) => [`channel ${k}`, v])
      : visual?.columns ? [["columns", visual.columns.join(", ")]] : [];
    return [
      section("Identity", facts([
        ["Kind", node?.kind ?? "Panel"], ["Slug", entry.slug], ["URI", node?.uri], ["Revision", node?.revision],
      ])),
      section("Query",
        typeof entry.query === "object" && entry.query
          ? h("dl", { class: "clauses" }, queryClauses(entry.query).flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]))
          : h("p", null, "No query available."),
        entry.query ? raw("Query document (JSON)", entry.query) : null),
      section("Visual",
        facts([["Type", visual?.type], ...channels, ["Threshold", visual?.threshold ? `${visual.threshold.value} (${visual.threshold.style})` : undefined]]),
        visual ? raw("Visual spec (JSON)", visual) : null),
      section("Result",
        result
          ? facts([
              ["As of", result.as_of], ["Rows", `${result.row_count}${result.truncated ? " (truncated)" : ""}`],
              ["Columns", result.columns.map((c) => `${c.name}:${c.type}`).join(", ")],
              ["Policy hash", result.policy_hash], ["Plan summary", planText(result.plan_summary)],
              ["Watermarks", result.watermarks?.length ? result.watermarks.map((w) => `${w.source} ${w.watermark}`).join("; ") : undefined],
              ["Result hash", result.result_hash], ["Cache", result.cache],
            ])
          : h("p", null, error ? `The query failed: ${error.code}. ${error.message ?? ""}` : "The result has not arrived yet.")),
    ];
  };

  return {
    open(view, trigger) {
      opener = trigger ?? null;
      const title = h("h2", { class: "inspector__title", id: "inspector-title", tabindex: "-1" }, view.entry.title);
      dialog.replaceChildren(
        h("header", { class: "inspector__head" },
          h("div", null, h("p", { class: "inspector__eyebrow" }, "Inspector"), title),
          h("button", { class: "inspector__close", type: "button", onclick: () => dialog.close() }, "Close")),
        h("div", { class: "inspector__scroll" }, body(view)));
      dialog.showModal();
      title.focus();
    },
  };
};
