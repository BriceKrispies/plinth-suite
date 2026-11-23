// Inspector: a modal <dialog> showing a panel's query, visual spec, result metadata, URI and revision.
import { h, clear } from "./dom.js";
import { formatQuery } from "./board.js";
import { num } from "./format.js";

const row = (term, value, mono = true) => [h("dt", null, term), h("dd", { class: mono ? "is-mono" : null }, value)];

const block = (id, title, ...kids) => h("section", { class: "inspector__section", "aria-labelledby": id }, h("h3", { id }, title), ...kids);

const planRows = (plan) => {
  if (plan === null || typeof plan !== "object") return row("Plan summary", String(plan ?? "—"));
  return [
    ...row("Sources", (plan.sources ?? []).join(", ") || "—"),
    ...row("Partitions read", num(plan.partitions_read ?? 0)),
    ...row("Partitions pruned", num(plan.partitions_pruned ?? 0)),
  ];
};

export const createInspector = (dialog, { onClose }) => {
  const mount = dialog.querySelector(".inspector__content");
  let opener = null;
  let slug = null;

  const fill = (entry) => {
    const r = entry.result;
    clear(mount).append(
      h(
        "header",
        { class: "inspector__head" },
        h("div", null, h("p", { class: "inspector__eyebrow" }, "Inspector"), h("h2", { id: "inspector-title", class: "inspector__title" }, entry.title)),
        h("button", { type: "button", class: "inspector__close", autofocus: true, onclick: () => dialog.close() }, "Close"),
      ),
      h(
        "div",
        { class: "inspector__body" },
        block("ins-identity", "Identity", h("dl", { class: "kv" }, ...row("URI", entry.node?.uri ?? "—"), ...row("Revision", entry.node ? String(entry.node.revision) : "—"), ...row("Slug", entry.slug), ...row("Visual", entry.visual?.type ?? "—"))),
        block("ins-query", "Query", h("pre", { class: "code", tabindex: "0" }, h("code", null, formatQuery(entry.query)))),
        block("ins-visual", "Visual spec", h("pre", { class: "code", tabindex: "0" }, h("code", null, JSON.stringify(entry.visual ?? null, null, 2)))),
        block(
          "ins-result",
          "Result",
          r
            ? h(
                "dl",
                { class: "kv" },
                ...row("As of", r.as_of),
                ...row("Rows", `${num(r.row_count)}${r.truncated ? " (truncated)" : ""}`),
                ...(r.policy_hash ? row("Policy hash", r.policy_hash) : []),
                ...row("Result hash", r.result_hash ?? "—"),
                ...planRows(r.plan_summary),
                ...(r.watermarks?.length ? row("Watermarks", r.watermarks.map((w) => `${w.source} ${w.watermark}`).join("; ")) : []),
              )
            : h("p", { class: "inspector__none" }, entry.error ? `${entry.error.code}: ${entry.error.message}` : "No result."),
        ),
      ),
    );
  };

  dialog.addEventListener("close", () => {
    const back = opener && document.contains(opener) ? opener : document.querySelector(`[data-slug="${slug}"] .menu__trigger`);
    slug = null;
    opener = null;
    onClose();
    back?.focus();
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  return {
    get slug() {
      return slug;
    },
    open(entry, from) {
      opener = from ?? document.activeElement;
      slug = entry.slug;
      fill(entry);
      if (!dialog.open) dialog.showModal();
    },
    /** Keep an open inspector current when a realtime change touches its panel. */
    refresh(entry) {
      if (slug !== entry.slug || !dialog.open) return;
      const hadFocus = mount.contains(document.activeElement);
      fill(entry);
      if (hadFocus) mount.querySelector(".inspector__close").focus();
    },
    close() {
      if (dialog.open) dialog.close();
    },
  };
};
