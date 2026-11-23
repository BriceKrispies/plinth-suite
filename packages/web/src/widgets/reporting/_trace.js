// Trace ribbon: recent change events, newest first, read like an instrument panel.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { actorLabel, kindOf, tagOf } from "./_events.js";
import { isoInstant, utcTime } from "./_format.js";

const MAX_ITEMS = 24;

export const createTrace = ({ titleOf }) => {
  const list = h("ol", { class: "rp-trace__list", "aria-label": "Changes, newest first" });
  const empty = h(
    "p",
    { class: "rp-trace__empty" },
    "No changes yet. They appear here as they are committed.",
  );
  const head = h("span", { class: "rp-trace__head u-tabular" }, "");
  const toggle = button({
    label: "Show recent",
    variant: "ghost",
    size: "sm",
    onClick: () => {
      const open = root.dataset.open !== "true";
      root.dataset.open = String(open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.querySelector(".c-button__label").textContent = open ? "Show latest only" : "Show recent";
    },
  });
  toggle.setAttribute("aria-expanded", "false");
  const root = h(
    "section",
    { class: "rp-trace", "aria-label": "Trace of recent changes", "data-open": "false" },
    h(
      "header",
      { class: "rp-trace__bar" },
      h("h3", { class: "rp-trace__title" }, "Trace"),
      h("span", { class: "rp-trace__label" }, "Head ", head),
      toggle,
    ),
    list,
    empty,
  );
  const items = [];

  const place = (item) => {
    list.prepend(item.el);
    items.unshift(item);
    while (items.length > MAX_ITEMS) items.pop().el.remove();
    empty.hidden = true;
  };
  const stamp = (ms) => h("time", { class: "rp-trace__time", datetime: isoInstant(ms) }, utcTime(ms));

  const eventItem = (e, backfill) => {
    const tag = tagOf(e);
    const titleEl = h("span", { class: "rp-trace__name" }, titleOf(e.node));
    const el = h(
      "li",
      { class: backfill ? "rp-trace__item" : "rp-trace__item u-arrive", "data-tag": tag, "data-seq": e.seq },
      h(
        "p",
        { class: "rp-trace__top" },
        h(
          "span",
          { class: "rp-trace__seq u-tabular" },
          h("span", { class: "sr-only" }, "Change "),
          `#${e.seq}`,
        ),
        h("span", { class: "rp-trace__tag" }, tag),
        backfill ? h("span", { class: "rp-trace__time" }, "earlier") : stamp(Date.now()),
      ),
      h(
        "p",
        { class: "rp-trace__who" },
        actorLabel(e.actor),
        e.on_behalf_of
          ? h("span", { class: "rp-trace__behalf" }, ` for ${actorLabel(e.on_behalf_of)}`)
          : null,
      ),
      h(
        "p",
        { class: "rp-trace__what" },
        h("span", { class: "rp-trace__kind" }, kindOf(e.node)),
        " ",
        titleEl,
      ),
      e.ops_summary ? h("p", { class: "rp-trace__ops" }, e.ops_summary) : null,
      e.rule_id?.length
        ? h(
            "ul",
            { class: "rp-trace__rules", "aria-label": "Rules" },
            e.rule_id.map((r) => h("li", {}, r)),
          )
        : null,
    );
    return { el, uri: e.node, titleEl };
  };

  return {
    el: root,
    /** Add change events in any order; the newest ends up first. Backfilled history never animates. */
    push(events, { backfill = false } = {}) {
      for (const e of [...events].sort((a, b) => a.seq - b.seq)) place(eventItem(e, backfill));
    },
    /** A local, non-commit row such as a brush or parameter edit. */
    session(text) {
      const el = h(
        "li",
        { class: "rp-trace__item", "data-tag": "session" },
        h(
          "p",
          { class: "rp-trace__top" },
          h("span", { class: "rp-trace__seq" }, "–"),
          h("span", { class: "rp-trace__tag" }, "session"),
          stamp(Date.now()),
        ),
        h("p", { class: "rp-trace__what" }, text),
      );
      place({ el, uri: null, titleEl: null });
    },
    /** Titles of new panels are known only after the board refetch. */
    retitle() {
      for (const it of items) if (it.uri) it.titleEl.textContent = titleOf(it.uri);
    },
    setHead(seq) {
      head.textContent = `#${seq}`;
    },
  };
};
