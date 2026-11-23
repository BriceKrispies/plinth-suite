import { h, s } from "./dom.js";
import { formatQuery } from "./board.js";
import { clockSeconds } from "./format.js";
import { patchSearch } from "./url.js";

const closeIcon = () =>
  s("svg", { viewBox: "0 0 16 16", width: 16, height: 16, "aria-hidden": "true", focusable: "false", class: "icon icon--stroke" },
    s("path", { d: "M3.5 3.5l9 9M12.5 3.5l-9 9" }));

const pretty = (value) => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

const pair = (label, content) => h("div", { class: "kv" }, h("dt", null, label), h("dd", null, content));
const code = (text) => h("code", null, text);

const section = (heading, ...content) => {
  const id = `inspector-${heading.toLowerCase().replace(/\W+/g, "-")}`;
  return h("section", { class: "inspector__section", "aria-labelledby": id }, h("h3", { id }, heading), ...content);
};

/**
 * The inspector is a modal `dialog`. Opening moves focus to its close button; closing returns focus to the
 * control that opened it. It stays in sync while open, so a live change to the panel updates it in place.
 */
export function createInspector(dialog) {
  let opener;
  let slug;

  const heading = h("h2", { id: "inspector-title", class: "inspector__title" });
  const closeButton = h("button", { class: "icon-btn", type: "button", autofocus: true, "aria-label": "Close inspector" }, closeIcon());
  const body = h("div", { class: "inspector__body" });
  dialog.replaceChildren(
    h("div", { class: "inspector__sheet" },
      h("header", { class: "inspector__head" },
        h("div", null, h("p", { class: "eyebrow" }, "Inspector"), heading), closeButton),
      body));

  closeButton.addEventListener("click", () => dialog.close());
  // The sheet fills the dialog, so a click that lands on the dialog itself is a click on the backdrop.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    slug = undefined;
    patchSearch({ panel: null });
    const target = opener?.isConnected ? opener : document.getElementById("main");
    opener = undefined;
    target?.focus();
  });

  const render = (entry) => {
    heading.textContent = entry.title;
    const { result, error, visual, node } = entry;
    const scroll = body.scrollTop;
    const kinds = result ? result.columns.map((c) => `${c.name} (${c.type})`).join(", ") : "";
    body.replaceChildren(
      section("Identity",
        h("dl", { class: "kvs" },
          pair("URI", code(node?.uri ?? "unknown")),
          pair("Revision", node ? String(node.revision) : "unknown"),
          pair("Slug", code(entry.slug)),
          pair("Visual", visual?.type ?? "none"))),
      section("Query",
        h("pre", { class: "code" }, h("code", null,
          formatQuery(entry.query).map(([kw, text]) =>
            h("span", { class: "code__line" }, h("span", { class: "code__kw" }, kw), " ", text)))),
        entry.query ? h("details", { class: "raw" }, h("summary", null, "Raw query"), h("pre", { class: "code" }, h("code", null, pretty(entry.query)))) : null),
      section("Visual spec", h("pre", { class: "code" }, h("code", null, pretty(visual ?? {})))),
      section("Result",
        error
          ? h("dl", { class: "kvs" },
              pair("Error", code(error.code)), pair("Message", error.message), error.fix_hint ? pair("Hint", error.fix_hint) : null)
          : result
            ? h("dl", { class: "kvs" },
                pair("As of", h("time", { datetime: String(result.as_of) }, `${clockSeconds(result.as_of)} (${result.as_of})`)),
                pair("Rows", String(result.row_count ?? result.rows.length)),
                pair("Columns", kinds),
                result.policy_hash ? pair("Policy hash", code(result.policy_hash)) : null,
                result.plan_summary === undefined ? null : pair("Plan summary", typeof result.plan_summary === "string" ? result.plan_summary : h("pre", { class: "code" }, h("code", null, pretty(result.plan_summary)))),
                result.watermarks === undefined ? null : pair("Watermarks", h("pre", { class: "code" }, h("code", null, pretty(result.watermarks)))))
            : h("p", { class: "muted" }, "No result yet.")));
    body.scrollTop = scroll;
  };

  return {
    open(entry, from) {
      opener = from ?? opener;
      slug = entry.slug;
      render(entry);
      patchSearch({ panel: entry.slug });
      if (!dialog.open) dialog.showModal();
    },
    /** Keep an open inspector current after a refresh; close it if its panel was removed. */
    sync(entries) {
      if (!dialog.open || slug === undefined) return;
      const entry = entries.find((e) => e.slug === slug);
      if (entry) render(entry);
      else dialog.close();
    },
  };
}
