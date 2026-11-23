// The side navigation: sections and items from navStore, current marker, live count badges.
import { h, clear } from "../ds/js/dom.js";
import { countBadge, updateCount } from "../ds/js/count-badge.js";
import { countsStore, meStore, navStore, can } from "../core/stores.js";
import * as router from "../core/router.js";
import { safeIcon } from "./kit.js";
import { icon } from "../ds/js/icons.js";

const OPEN_KEY = "plinth.nav.open";
const readOpen = () => {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};
const writeOpen = (v) => {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(v));
  } catch {
    /* the choice lasts for this page view */
  }
};

export const SECTIONS = [
  ["personal", "Personal"],
  ["rewards", "Rewards"],
  ["engage", "Engage"],
  ["insight", "Insight"],
  ["operate", "Operate"],
  ["admin", "Admin"],
];

export const COUNT_LABEL = {
  notifications_unread: "unread",
  messages_unread: "unread messages",
  approvals_pending: "awaiting decision",
  tasks_open: "open",
  cart_items: "in cart",
  content_reviews: "to review",
  orders_attention: "need attention",
};

/** Nav pages the viewer may use (pages with a nav entry, no route parameters). */
export const visibleNav = () =>
  navStore
    .get()
    .filter(
      (p) => p.nav && p.route && !p.route.includes(":") && (!p.nav.permission || can(p.nav.permission)),
    );

/** The nav body. `onNavigate` runs when an item is followed (the phone drawer closes itself). */
export const navContent = (onNavigate) => {
  const root = h("div", { class: "c-nav" });
  const items = [];
  const sections = [];
  const saved = readOpen();
  const isOpen = (key) => saved[key] ?? key === "personal";
  const setOpen = (sec, open) => {
    sec.btn.setAttribute("aria-expanded", String(open));
    sec.list.hidden = !open;
  };

  const markCurrent = () => {
    const path = router.current().path;
    // Exactly one item is current: the longest route that equals or prefixes the path.
    let best = null;
    for (const it of items) {
      const route = it.a.dataset.route;
      const hit = route === "/" ? path === "/" : path === route || path.startsWith(`${route}/`);
      if (hit && (!best || route.length > best.a.dataset.route.length)) best = it;
    }
    for (const it of items) {
      if (it === best) it.a.setAttribute("aria-current", "page");
      else it.a.removeAttribute("aria-current");
    }
    // The section holding the current page is always open, so the marker is never hidden.
    for (const sec of sections) if (best && sec.list.contains(best.a)) setOpen(sec, true);
  };

  const draw = () => {
    clear(root);
    items.length = 0;
    sections.length = 0;
    const nav = visibleNav();
    for (const [key, title] of SECTIONS) {
      const entries = nav.filter((p) => p.nav.section === key).sort((a, b) => a.nav.order - b.nav.order);
      if (entries.length === 0) continue;
      const hid = `nav-${key}`;
      const list = h("ul", { class: "c-nav__list" });
      for (const p of entries) {
        const badge = p.nav.count
          ? countBadge(countsStore.get()[p.nav.count] ?? 0, { label: COUNT_LABEL[p.nav.count] })
          : null;
        if (badge && p.nav.count === "approvals_pending") badge.classList.add("c-count--warning");
        const a = h(
          "a",
          { class: "c-nav__item", href: router.href(p.route), "data-route": p.route },
          h("span", { class: "c-nav__icon" }, safeIcon(p.nav.icon, "list")),
          h("span", { class: "c-nav__label" }, p.nav.label),
          badge,
        );
        if (onNavigate) a.addEventListener("click", onNavigate);
        items.push({ a, badge, key: p.nav.count });
        list.append(h("li", {}, a));
      }
      const lid = `nav-${key}-list`;
      list.id = lid;
      const btn = h(
        "button",
        { class: "c-nav__toggle", type: "button", "aria-controls": lid, "aria-expanded": "false" },
        h("span", { class: "c-nav__toggle-label" }, title),
        h("span", { class: "c-nav__chevron", "aria-hidden": "true" }, icon("chevron-down", { size: 16 })),
      );
      const el = h(
        "section",
        { class: "c-nav__section", "aria-labelledby": hid },
        h("h2", { class: "c-nav__heading", id: hid }, btn),
        list,
      );
      const sec = { key, el, btn, list };
      btn.addEventListener("click", () => {
        const open = btn.getAttribute("aria-expanded") !== "true";
        setOpen(sec, open);
        saved[key] = open;
        writeOpen(saved);
      });
      setOpen(sec, isOpen(key));
      sections.push(sec);
      root.append(el);
    }
    markCurrent();
  };

  const offs = [
    navStore.subscribe(draw),
    meStore.subscribe(draw),
    router.onRoute(markCurrent),
    countsStore.subscribe((c) => {
      for (const it of items) if (it.badge) updateCount(it.badge, c[it.key] ?? 0);
    }),
  ];
  draw();
  root.dispose = () => offs.forEach((off) => off());
  return root;
};
