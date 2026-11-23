// APG Menu Button. DESIGN-SYSTEM 6.8. The list is a top-layer popover; on phones it opens as a sheet.
import { h, uid } from "./dom.js";
import { button } from "./button.js";
import { icon } from "./icons.js";
import { kbd } from "./kbd.js";
import { anchorTo } from "./popover.js";
import { openSheet } from "./sheet.js";
import { PElement, define, reflect } from "./element-base.js";

const isPhone = () => window.matchMedia("(max-width: 39.99rem)").matches;

const itemNode = (item, close, radio) => {
  const el = h(
    "button",
    {
      type: "button",
      class: `c-menu__item${item.danger ? " c-menu__item--danger" : ""}`,
      role: radio ? "menuitemradio" : "menuitem",
      "aria-checked": radio ? String(Boolean(item.checked)) : null,
      "aria-disabled": item.disabled ? "true" : null,
      "aria-keyshortcuts": item.shortcut ? item.shortcut.replace(/\+/g, "+") : null,
      tabindex: "-1",
    },
    item.icon ? h("span", { class: "c-menu__icon" }, icon(item.icon)) : h("span", { class: "c-menu__icon" }),
    h("span", { class: "c-menu__label" }, item.label),
    radio && item.checked ? h("span", { class: "c-menu__check" }, icon("check", { size: 16 })) : null,
    item.shortcut ? kbd(item.shortcut) : null,
  );
  el.addEventListener("click", () => {
    if (item.disabled) return;
    close();
    item.onSelect?.();
  });
  return el;
};

/**
 * `<p-menu-button label icon variant size icon-only>`: an APG menu button. The items are a property (they carry
 * handlers): `[{ label, icon, shortcut, danger, disabled, checked, separatorBefore, onSelect }]`. The element is
 * the `.c-menu` wrapper and holds the trigger and the popover list; `:state(open)` is set while the list shows.
 */
export class PMenuButton extends PElement {
  static observedAttributes = ["label", "icon", "variant", "size", "icon-only"];
  #items = [];
  #teardown = null;

  get items() {
    return this.#items;
  }

  set items(v) {
    this.#items = Array.isArray(v) ? v : [];
    this.requestRender();
  }

  /** The trigger button, for callers that need to focus it or anchor to it. */
  get trigger() {
    return this.querySelector(":scope > .c-button");
  }

  /** Close the list, optionally returning focus to the trigger. */
  close(restore = false) {
    this.#teardown?.close(restore);
  }

  render() {
    this.#teardown?.dispose();
    this.classList.add("c-menu");
    const { list, trigger, dispose, close } = this.#build();
    this.#teardown = { dispose, close };
    this.replaceChildren(trigger, list);
  }

  disconnectedCallback() {
    this.#teardown?.close(false);
  }

  #build() {
    const items = this.#items;
    const label = this.label ?? "";
    const id = uid("menu");
    const trigger = button({
      label,
      icon: this.icon ?? undefined,
      variant: this.variant,
      size: this.size,
      iconOnly: this.iconOnly,
    });
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.id = `${id}-btn`;
    const list = h("ul", {
      class: "c-menu__list",
      role: "menu",
      id: `${id}-list`,
      "aria-labelledby": trigger.id,
      popover: "auto",
    });
    let open = false;
    let release = () => {};
    const setOpen = (on) => {
      open = on;
      this.setState("open", on);
    };
    function close(restore) {
      if (!open) return;
      setOpen(false);
      release();
      if (list.matches(":popover-open")) list.hidePopover();
      trigger.setAttribute("aria-expanded", "false");
      if (restore) trigger.focus();
    }
    const nodes = [];
    for (const item of items) {
      if (item.separatorBefore) list.append(h("li", { role: "separator", class: "c-menu__sep" }));
      const radio = item.checked !== undefined;
      const node = itemNode(item, () => close(true), radio);
      nodes.push(node);
      list.append(h("li", { role: "none" }, node));
    }
    const focusAt = (i) => {
      if (nodes.length === 0) return;
      nodes[(i + nodes.length) % nodes.length].focus();
    };
    const show = (at) => {
      if (isPhone()) {
        const holder = h("div", { class: "c-menu c-menu--sheet" });
        const sheetList = h("ul", { class: "c-menu__list c-menu__list--sheet", role: "menu" });
        let sheet;
        for (const item of items) {
          const radio = item.checked !== undefined;
          const node = itemNode(item, () => sheet.close(), radio);
          node.tabIndex = 0;
          sheetList.append(h("li", { role: "none" }, node));
        }
        holder.append(sheetList);
        sheet = openSheet({ title: typeof label === "string" ? label : "Menu", body: holder });
        return;
      }
      setOpen(true);
      list.showPopover();
      release = anchorTo(trigger, list, "bottom-start");
      trigger.setAttribute("aria-expanded", "true");
      focusAt(at === "last" ? -1 : 0);
    };
    list.addEventListener("toggle", (e) => {
      if (e.newState === "closed") {
        setOpen(false);
        release();
        trigger.setAttribute("aria-expanded", "false");
      }
    });
    trigger.addEventListener("click", () => (open ? close(true) : show("first")));
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        show("first");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        show("last");
      }
    });
    list.addEventListener("keydown", (e) => {
      const i = nodes.indexOf(document.activeElement);
      if (e.key === "ArrowDown") focusAt(i + 1);
      else if (e.key === "ArrowUp") focusAt(i - 1);
      else if (e.key === "Home") focusAt(0);
      else if (e.key === "End") focusAt(-1);
      else if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
        return;
      } else if (e.key === "Tab") {
        close(false);
        return;
      } else if (e.key.length === 1 && /\S/.test(e.key)) {
        const ch = e.key.toLowerCase();
        const ordered = [...nodes.slice(i + 1), ...nodes.slice(0, i + 1)];
        ordered.find((n) => n.textContent.trim().toLowerCase().startsWith(ch))?.focus();
        return;
      } else return;
      e.preventDefault();
    });
    return {
      nodes,
      list,
      trigger,
      close,
      dispose: () => close(false),
    };
  }
}
reflect(PMenuButton, {
  label: ["label", "string"],
  icon: ["icon", "string"],
  variant: ["variant", "string", "secondary"],
  size: ["size", "string", "md"],
  iconOnly: ["icon-only", "bool"],
});
define("p-menu-button", PMenuButton);

export const menuButton = ({
  label,
  icon: ic,
  variant = "secondary",
  items = [],
  iconOnly = false,
  size = "md",
}) => {
  const el = document.createElement("p-menu-button");
  return el.configure({ label, icon: ic ?? null, variant, size, iconOnly, items });
};
