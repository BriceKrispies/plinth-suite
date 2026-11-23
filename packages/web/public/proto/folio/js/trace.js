/** The change ledger: newest first, each change as a small instrument reading. */
import { h } from "./dom.js";
import { kindOfUri, localClock, shortId } from "./format.js";

const MAX_ITEMS = 24;

const tagOf = (event) => (event.surface === "mcp" ? "live" : event.surface === "driver" ? "replay" : "ui");

export const createTrace = ({ root, list, meta, moreButton, titleOf }) => {
  const seen = new Set();
  let latest = 0;

  moreButton.addEventListener("click", () => {
    const open = moreButton.getAttribute("aria-expanded") !== "true";
    moreButton.setAttribute("aria-expanded", String(open));
    moreButton.textContent = open ? "Show latest only" : "Show all";
  });

  const titleText = (uri) => titleOf(uri) ?? shortId(uri);

  const build = (event, { backfill }) => {
    const tag = tagOf(event);
    return h("li", { class: "event", dataset: { seq: event.seq, tag, node: event.node, ...(backfill ? {} : { justArrived: "" }) } },
      h("div", { class: "event__line" },
        h("span", { class: "event__seq" }, `#${event.seq}`),
        h("span", { class: "event__tag" }, tag),
        backfill ? null : h("time", { class: "event__time", datetime: new Date().toISOString() }, localClock())),
      h("p", { class: "event__actor" }, event.actor,
        event.on_behalf_of ? h("span", { class: "event__actor-for" }, ` for ${event.on_behalf_of}`) : null),
      h("p", { class: "event__what" },
        h("span", { class: "event__kind" }, `${kindOfUri(event.node)} `),
        h("span", { class: "event__title" }, titleText(event.node))),
      h("p", { class: "event__ops" }, event.ops_summary),
      event.rule_id?.length ? h("p", { class: "event__rules" }, event.rule_id.map((r) => h("span", { class: "event__rule" }, r))) : null);
  };

  const updateMeta = () => {
    root.removeAttribute("data-empty");
    meta.textContent = `Through #${latest} · ${list.children.length} shown`;
  };

  return {
    /** Add events. Backfilled events are listed without entry motion. */
    add(items, { backfill }) {
      const fresh = items
        .filter((e) => e.kind !== "present" && !seen.has(e.seq))
        .sort((a, b) => a.seq - b.seq);
      if (!fresh.length) return;
      for (const event of fresh) {
        seen.add(event.seq);
        latest = Math.max(latest, event.seq);
        list.prepend(build(event, { backfill }));
      }
      while (list.children.length > MAX_ITEMS) list.lastElementChild.remove();
      updateMeta();
    },
    /** Titles of newly added nodes are known only after the board reloads. */
    relabel() {
      for (const li of list.children) li.querySelector(".event__title").textContent = titleText(li.dataset.node);
    },
    /** Outline the ledger entry that caused a panel change. */
    link(seq) {
      for (const li of list.children) {
        if (li.dataset.seq === String(seq)) {
          li.setAttribute("data-linked", "");
          setTimeout(() => li.removeAttribute("data-linked"), 6000);
        }
      }
    },
  };
};
