// APG Tabs, automatic activation. DESIGN-SYSTEM 6.10.
import { h, uid } from "./dom.js";
import { countBadge } from "./count-badge.js";

/** Same helper the router uses so `?tab=` writes are not treated as navigation. */
export const replaceQuery = (key, value) => {
  const url = new URL(location.href);
  if (value === null || value === undefined) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
};

export const tabs = ({ label, items, selected, onChange, urlParam }) => {
  const id = uid("tabs");
  const fromUrl = urlParam ? new URLSearchParams(location.search).get(urlParam) : null;
  let current = [selected, fromUrl, items[0]?.id].find((v) => v && items.some((i) => i.id === v));
  const list = h("div", { class: "c-tabs__list", role: "tablist", "aria-label": label });
  const panels = new Map();
  const root = h("div", { class: "c-tabs" }, h("div", { class: "c-tabs__scroll" }, list));
  const buttons = items.map((item) => {
    const b = h(
      "button",
      {
        type: "button",
        class: "c-tabs__tab",
        role: "tab",
        id: `${id}-t-${item.id}`,
        "aria-controls": `${id}-p-${item.id}`,
        "data-id": item.id,
      },
      h("span", {}, item.label),
      item.count !== undefined ? countBadge(item.count, { label: "items" }) : null,
    );
    b.addEventListener("click", () => select(item.id, false));
    list.append(b);
    return b;
  });
  let initial = true;
  const select = (itemId, focus) => {
    current = itemId;
    buttons.forEach((b) => {
      const on = b.dataset.id === itemId;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
      if (on && !initial) b.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    for (const [k, p] of panels) p.hidden = k !== itemId;
    if (!panels.has(itemId)) {
      const item = items.find((i) => i.id === itemId);
      const panel = h(
        "div",
        {
          class: "c-tabs__panel",
          role: "tabpanel",
          id: `${id}-p-${itemId}`,
          "aria-labelledby": `${id}-t-${itemId}`,
          tabindex: "0",
        },
        item.panel(),
      );
      panels.set(itemId, panel);
      root.append(panel);
    }
    if (urlParam) replaceQuery(urlParam, itemId);
    onChange?.(itemId);
  };
  list.addEventListener("keydown", (e) => {
    const i = buttons.findIndex((b) => b.dataset.id === current);
    let n = null;
    if (e.key === "ArrowRight") n = (i + 1) % buttons.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = buttons.length - 1;
    if (n === null) return;
    e.preventDefault();
    select(buttons[n].dataset.id, true);
  });
  if (current) select(current, false);
  initial = false;
  return root;
};
