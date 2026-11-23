import { formatQuery } from "./board.js";
import { h } from "./dom.js";
import { stamp } from "./format.js";

const pretty = (v) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

const field = (name, value, mono = true) =>
  value === undefined || value === null || value === ""
    ? null
    : [h("dt", null, name), h("dd", { class: mono ? "mono" : null }, value)];

const section = (heading, ...kids) => h("section", { class: "insp-section", "aria-label": heading }, h("h3", null, heading), ...kids);

/** Modal inspector. Focus moves to the heading on open and returns to the opener on close. */
export const createInspector = (dialog, { fallbackFocus }) => {
  const heading = dialog.querySelector("#inspector-title");
  const kind = dialog.querySelector("#inspector-kind");
  const body = dialog.querySelector("#inspector-body");
  const closeButton = dialog.querySelector("#inspector-close");
  let opener = null;

  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close(); // a click on the backdrop lands on the dialog element itself
  });
  dialog.addEventListener("close", () => {
    const target = opener?.isConnected ? opener : fallbackFocus();
    opener = null;
    target?.focus();
  });

  const open = (entry, from) => {
    opener = from;
    heading.textContent = entry.title;
    kind.textContent = `Inspect · ${entry.visual?.type ?? "panel"}`;
    const r = entry.result;
    body.replaceChildren(
      section(
        "Identity",
        h("dl", { class: "kv" }, field("URI", entry.node?.uri), field("Slug", entry.slug), field("Revision", entry.node?.revision === undefined ? undefined : `r${entry.node.revision}`), field("Placement", `x ${entry.at.x}, y ${entry.at.y}, ${entry.at.w} × ${entry.at.h}`)),
      ),
      section(
        "Query",
        h("dl", { class: "kv query" }, formatQuery(entry.query).map(([k, v]) => field(k, v))),
        h("details", null, h("summary", null, "Raw query"), h("pre", { class: "code", tabindex: "0" }, pretty(entry.query ?? null))),
      ),
      section("Visual spec", h("pre", { class: "code", tabindex: "0" }, pretty(entry.visual ?? null))),
      section(
        "Result",
        r
          ? h(
              "dl",
              { class: "kv" },
              field("As of", stamp(r.as_of)),
              field("Rows", String(r.row_count ?? r.rows.length)),
              field("Columns", r.columns.map((c) => `${c.name} (${c.type})`).join(", ")),
              field("Policy hash", r.policy_hash),
              field("Plan", r.plan_summary === undefined ? undefined : pretty(r.plan_summary)),
              field("Watermarks", r.watermarks === undefined ? undefined : pretty(r.watermarks)),
              field("Result hash", r.result_hash),
            )
          : h("p", { class: "muted" }, entry.error ? `${entry.error.code}: ${entry.error.message}` : "No result yet."),
      ),
    );
    if (!dialog.open) dialog.showModal();
    heading.focus();
  };

  return { open };
};
