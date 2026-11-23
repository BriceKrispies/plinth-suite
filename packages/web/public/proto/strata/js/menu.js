import { h, s } from "./dom.js";

const dotsIcon = () =>
  s("svg", { viewBox: "0 0 16 16", width: 16, height: 16, "aria-hidden": "true", focusable: "false", class: "icon" },
    s("circle", { cx: 3, cy: 8, r: 1.4 }), s("circle", { cx: 8, cy: 8, r: 1.4 }), s("circle", { cx: 13, cy: 8, r: 1.4 }));

/**
 * A disclosure menu: a button that reveals a list of real buttons. Escape closes it and returns focus,
 * arrow keys move between items, and leaving it by Tab or pointer closes it without stealing focus.
 */
export function createMenu({ id, label }) {
  const button = h("button", {
    class: "icon-btn", type: "button", "aria-expanded": "false", "aria-controls": `${id}-list`, "aria-label": label,
  }, dotsIcon());
  const list = h("ul", { class: "menu__list", id: `${id}-list`, hidden: true });
  const root = h("div", { class: "menu" }, button, list);

  const items = () => [...list.querySelectorAll("button:not([hidden]):not(:disabled)")];

  const close = (refocus) => {
    if (list.hidden) return;
    list.hidden = true;
    root.removeAttribute("data-open");
    button.setAttribute("aria-expanded", "false");
    if (refocus) button.focus();
  };
  const open = () => {
    list.hidden = false;
    root.dataset.open = "";
    button.setAttribute("aria-expanded", "true");
    items()[0]?.focus();
  };

  button.addEventListener("click", () => (list.hidden ? open() : close(true)));
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !list.hidden) {
      e.stopPropagation();
      close(true);
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !list.hidden) {
      e.preventDefault();
      const all = items();
      const at = all.indexOf(document.activeElement);
      const next = e.key === "ArrowDown" ? (at + 1) % all.length : (at - 1 + all.length) % all.length;
      all[next]?.focus();
    }
  });
  root.addEventListener("focusout", (e) => {
    if (e.relatedTarget && !root.contains(e.relatedTarget)) close(false);
  });
  const outside = (e) => {
    if (!root.contains(e.target)) close(false);
  };
  document.addEventListener("pointerdown", outside);

  return {
    root,
    button,
    close,
    addItem(text, onSelect, { toggle = false } = {}) {
      const item = h("button", { class: "menu__item", type: "button", "aria-pressed": toggle ? "false" : null }, text);
      item.addEventListener("click", onSelect);
      list.append(h("li", null, item));
      return item;
    },
    destroy() {
      document.removeEventListener("pointerdown", outside);
    },
  };
}
