import { h, icon, uid } from "./dom.js";

/**
 * Disclosure menu button with arrow-key navigation. `items` is read each time the menu opens, so
 * labels may change between openings. Escape and outside clicks close it and return focus to the button.
 */
export const createMenu = ({ label, items }) => {
  const id = uid("menu");
  const list = h("ul", { class: "menu-list", role: "menu", id, "aria-label": label, hidden: true });
  const button = h(
    "button",
    { type: "button", class: "btn btn-icon", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": id, "aria-label": label },
    icon("more"),
  );
  const root = h("div", { class: "menu" }, button, list);

  const entries = () => [...list.querySelectorAll('[role="menuitem"]')];
  const close = (restore = true) => {
    if (list.hidden) return;
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    if (restore) button.focus();
  };
  const outside = (e) => {
    if (!root.contains(e.target)) close(false);
  };
  const open = (focusLast = false) => {
    list.replaceChildren(
      ...items().map((item) =>
        h(
          "li",
          { role: "none" },
          h("button", { type: "button", role: "menuitem", tabindex: "-1", onclick: () => (close(false), item.run()) }, icon(item.icon), h("span", null, item.label)),
        ),
      ),
    );
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", outside, true);
    const all = entries();
    (focusLast ? all[all.length - 1] : all[0])?.focus();
  };

  button.addEventListener("click", () => (list.hidden ? open() : close()));
  button.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      open(e.key === "ArrowUp");
    }
  });
  list.addEventListener("keydown", (e) => {
    const all = entries();
    const at = all.indexOf(document.activeElement);
    const go = (i) => (e.preventDefault(), all[(i + all.length) % all.length].focus());
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
    else if (e.key === "Escape") (e.preventDefault(), close());
    else if (e.key === "Tab") close(false);
  });
  root.addEventListener("focusout", (e) => {
    if (!list.hidden && e.relatedTarget && !root.contains(e.relatedTarget)) close(false);
  });
  return { el: root, button, close };
};
