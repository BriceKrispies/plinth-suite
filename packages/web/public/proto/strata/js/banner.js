import { h } from "./dom.js";

/** Page-level notices under the masthead, keyed so each source can set and clear its own. */
export function createBanner(root) {
  const notices = new Map();

  const paint = () => {
    root.replaceChildren(
      ...[...notices.values()].map((n) =>
        h("div", { class: "banner", dataset: { tone: n.tone } },
          h("span", { class: "banner__icon", "aria-hidden": "true" }, n.tone === "bad" ? "▲" : "●"),
          h("p", { class: "banner__text" }, h("strong", null, n.title), " ", n.message),
          n.action ? h("button", { class: "btn btn--quiet", type: "button", onClick: n.action.run }, n.action.label) : null)));
    root.hidden = notices.size === 0;
  };

  return {
    set(key, notice) {
      if (notice) notices.set(key, notice);
      else notices.delete(key);
      paint();
    },
  };
}
