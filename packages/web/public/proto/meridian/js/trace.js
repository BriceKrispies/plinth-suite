// Trace ribbon: recent change events, newest first, read like an instrument panel.
import { h } from "./dom.js";
import { actorLabel, kindOf, tagOf } from "./events.js";
import { clockSeconds } from "./format.js";

const MAX_ITEMS = 24;

export const createTrace = (root, { titleOf }) => {
  const list = root.querySelector(".ribbon__list");
  const empty = root.querySelector(".ribbon__empty");
  const toggle = root.querySelector(".ribbon__toggle");
  const head = root.querySelector(".ribbon__head-seq");
  const items = []; // { el, uri, titleEl }

  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Show latest only" : "Show recent";
  });

  const place = (item) => {
    list.prepend(item.el);
    items.unshift(item);
    while (items.length > MAX_ITEMS) items.pop().el.remove();
    empty.hidden = true;
  };

  const eventItem = (e) => {
    const tag = tagOf(e);
    const titleEl = h("span", { class: "trace__title" }, titleOf(e.node));
    const el = h(
      "li",
      { class: "trace is-entering", "data-tag": tag },
      h("p", { class: "trace__top" }, h("span", { class: "trace__seq" }, h("span", { class: "sr-only" }, "Change "), `#${e.seq}`), h("span", { class: "trace__tag" }, tag), h("time", { class: "trace__time" }, clockSeconds(Date.now()))),
      h("p", { class: "trace__who" }, actorLabel(e.actor), e.on_behalf_of ? h("span", { class: "trace__behalf" }, ` for ${actorLabel(e.on_behalf_of)}`) : null),
      h("p", { class: "trace__what" }, h("span", { class: "trace__kind" }, kindOf(e.node)), " ", titleEl),
      h("p", { class: "trace__ops" }, e.ops_summary),
      e.rule_id.length > 0 ? h("ul", { class: "trace__rules", "aria-label": "Rules" }, e.rule_id.map((r) => h("li", null, r))) : null,
    );
    return { el, uri: e.node, titleEl };
  };

  return {
    /** Add change events (any order); the newest ends up first. */
    push(events) {
      for (const e of [...events].sort((a, b) => a.seq - b.seq)) place(eventItem(e));
    },
    /** Add a local, non-commit row such as a brush or parameter edit. Never animated. */
    session(text) {
      const el = h("li", { class: "trace", "data-tag": "session" }, h("p", { class: "trace__top" }, h("span", { class: "trace__seq" }, "—"), h("span", { class: "trace__tag" }, "session"), h("time", { class: "trace__time" }, clockSeconds(Date.now()))), h("p", { class: "trace__what" }, text));
      place({ el, uri: null, titleEl: null });
    },
    /** Titles of new panels are only known after the board refetch. */
    retitle() {
      for (const it of items) if (it.uri) it.titleEl.textContent = titleOf(it.uri);
    },
    setHead(seq) {
      head.textContent = `#${seq}`;
    },
  };
};
