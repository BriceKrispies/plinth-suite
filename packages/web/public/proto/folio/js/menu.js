/** A small, keyboard-complete menu button (WAI-ARIA menu button pattern). */
import { h } from "./dom.js";

let counter = 0;
let current = null;

export const createMenu = ({ label, items }) => {
  const listId = `menu-${++counter}`;
  const button = h("button", { class: "menu__button", type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": listId, "aria-label": label },
    h("span", { "aria-hidden": "true" }, "⋯"));
  const nodes = new Map();
  const list = h("div", { class: "menu__list", role: "menu", id: listId, "aria-label": label, hidden: true },
    items.map((item) => {
      const node = h("button", { type: "button", class: "menu__item", role: item.checkbox ? "menuitemcheckbox" : "menuitem", tabindex: "-1", ...(item.checkbox ? { "aria-checked": "false" } : {}) }, item.label);
      node.addEventListener("click", () => {
        if (node.getAttribute("aria-disabled") === "true") return;
        close(true);
        item.onSelect();
      });
      nodes.set(item.id, node);
      return node;
    }));
  const el = h("div", { class: "panel__menu" }, button, list);

  const enabled = () => [...nodes.values()].filter((n) => n.getAttribute("aria-disabled") !== "true");
  const onOutside = (e) => { if (!el.contains(e.target)) close(false); };

  function open() {
    if (current && current !== close) current(false);
    current = close;
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutside, true);
    enabled()[0]?.focus();
  }
  function close(returnFocus) {
    if (list.hidden) return;
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    if (current === close) current = null;
    if (returnFocus) button.focus();
  }

  button.addEventListener("click", () => (list.hidden ? open() : close(true)));
  button.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) open(); } });
  list.addEventListener("keydown", (e) => {
    const all = enabled();
    const i = all.indexOf(document.activeElement);
    const move = { ArrowDown: all[(i + 1) % all.length], ArrowUp: all[(i - 1 + all.length) % all.length], Home: all[0], End: all[all.length - 1] }[e.key];
    if (move) { e.preventDefault(); move.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "Tab") close(false);
  });

  return {
    el,
    button,
    update(id, { label: text, checked, disabled }) {
      const node = nodes.get(id);
      if (!node) return;
      if (text !== undefined) node.textContent = text;
      if (checked !== undefined) node.setAttribute("aria-checked", String(checked));
      if (disabled !== undefined) node.setAttribute("aria-disabled", String(disabled));
    },
    close: () => close(false),
  };
};
