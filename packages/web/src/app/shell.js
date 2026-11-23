// The built-in shell frame: side nav with live badge counts, top bar with the search trigger, balance chip,
// inbox and bell counts, live mark and the identity-aware avatar menu, plus the toast region. main.js uses
// package A's `src/shell/shell.js` (`mountShell`) when it exists and this one until then, so the page host,
// counts and balance chip work from day one. Package A replaces the bell popover, palette and toast rules.
import { h, clear, announce } from "../ds/js/dom.js";
import { icon } from "../ds/js/icons.js";
import { iconButton, linkButton, button } from "../ds/js/button.js";
import { countBadge, updateCount } from "../ds/js/count-badge.js";
import { menuButton } from "../ds/js/menu.js";
import { avatar } from "../ds/js/avatar.js";
import { statusPill } from "../ds/js/pill.js";
import { kbd } from "../ds/js/kbd.js";
import { points, signedPoints } from "../ds/js/format.js";
import { openDrawer } from "../ds/js/drawer.js";
import { openDialog } from "../ds/js/dialog.js";
import { selectField } from "../ds/js/field.js";
import { toast, toastRegion } from "../ds/js/toast.js";
import { countsStore, meStore, navStore, balanceStore, prefsStore, setTheme, can } from "../core/stores.js";
import { DEV_PEOPLE, principal, switchTo } from "../core/identity.js";
import * as router from "../core/router.js";
import { DEMO } from "../core/base.js";
import * as rt from "../core/rt.js";

const SECTIONS = [
  ["personal", "Personal"],
  ["rewards", "Rewards"],
  ["engage", "Engage"],
  ["insight", "Insight"],
  ["operate", "Operate"],
  ["admin", "Admin"],
];

const COUNT_LABEL = {
  notifications_unread: "unread",
  messages_unread: "unread messages",
  approvals_pending: "awaiting decision",
  tasks_open: "open",
  cart_items: "in cart",
  content_reviews: "to review",
  orders_attention: "need attention",
};

const visibleNav = () =>
  navStore
    .get()
    .filter(
      (p) => p.nav && p.route && !p.route.includes(":") && (!p.nav.permission || can(p.nav.permission)),
    );

// ---- side nav ----

const navContent = (onNavigate) => {
  const root = h("div", { class: "c-nav" });
  const items = [];
  const draw = () => {
    clear(root);
    items.length = 0;
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
          h("span", { class: "c-nav__icon" }, icon(p.nav.icon)),
          h("span", { class: "c-nav__label" }, p.nav.label),
          badge,
        );
        if (onNavigate) a.addEventListener("click", onNavigate);
        items.push({ a, badge, key: p.nav.count });
        list.append(h("li", {}, a));
      }
      root.append(
        h(
          "section",
          { class: "c-nav__section", "aria-labelledby": hid },
          h("h2", { class: "c-nav__heading", id: hid }, title),
          list,
        ),
      );
    }
    markCurrent();
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

// ---- top bar ----

/** Pick someone from the seeded people and reload as them. */
const chooseIdentity = async () => {
  const field = selectField({
    name: "who",
    label: "Person",
    value: principal.handle,
    options: DEV_PEOPLE.map((p) => ({
      value: p.handle,
      label: `${p.name}${p.roles.length ? ` · ${p.roles.join(", ")}` : ""}`,
    })),
  });
  const chosen = await openDialog({
    title: "Switch identity",
    size: "sm",
    body: field,
    actions: [
      { label: "Cancel", value: null },
      { label: "Switch", value: "go", variant: "primary" },
    ],
  });
  if (chosen === "go") switchTo(field.querySelector("select").value);
};

const themeItems = () => {
  const cur = prefsStore.get().theme;
  return [
    {
      label: "System theme",
      checked: cur === "auto",
      separatorBefore: true,
      onSelect: () => setTheme("auto"),
    },
    { label: "Light theme", checked: cur === "light", onSelect: () => setTheme("light") },
    { label: "Dark theme", checked: cur === "dark", onSelect: () => setTheme("dark") },
  ];
};

const balanceChip = () => {
  const text = h("span", { class: "u-tabular" });
  const tier = h("span", { class: "app__tier" });
  const delta = h("span", { class: "app__delta u-tabular", hidden: true });
  const chip = h(
    "a",
    { class: "c-chip-link", href: router.href("/points") },
    icon("coins", { size: 16 }),
    text,
    tier,
    delta,
  );
  let lastSeq = null;
  const paint = (b) => {
    chip.hidden = b.balance === null;
    if (b.balance === null) return;
    text.textContent = points(b.balance);
    chip.setAttribute("aria-label", `Balance ${points(b.balance)}`);
    clear(tier);
    if (b.tier?.tier) tier.append(statusPill("tier", b.tier.tier));
    if (b.lastDelta && b.lastDelta.seq !== lastSeq) {
      lastSeq = b.lastDelta.seq;
      delta.textContent = signedPoints(b.lastDelta.delta);
      delta.hidden = false;
      delta.classList.add("u-arrive");
      setTimeout(() => {
        delta.hidden = true;
        delta.classList.remove("u-arrive");
      }, 6000);
    }
  };
  balanceStore.subscribe(paint);
  paint(balanceStore.get());
  return chip;
};

const liveMark = () => {
  const text = h("span", { class: "c-live__text" }, "Connecting");
  const el = h("span", { class: "c-live", "data-state": "connecting" }, text);
  let warned = false;
  rt.onState((state) => {
    el.dataset.state = state;
    text.textContent =
      state === "live" ? (DEMO ? "Demo" : "Live") : state === "offline" ? "Reconnecting" : "Connecting";
    if (state === "offline" && !warned) {
      warned = true;
      announce("Reconnecting");
    } else if (state === "live" && warned) {
      warned = false;
      announce("Live again");
    }
  });
  return el;
};

const avatarMenu = () => {
  const slot = h("span", { class: "app__avatar" });
  const draw = () => {
    const me = meStore.get();
    clear(slot);
    if (!me) return;
    const who = me.principal;
    const featured = DEV_PEOPLE.filter((p) => p.featured && p.handle !== principal.handle);
    slot.append(
      menuButton({
        label: who.display_name,
        variant: "ghost",
        items: [
          { label: "Profile", icon: "user", onSelect: () => router.navigate("/profile") },
          { label: "Settings", icon: "settings", onSelect: () => router.navigate("/settings") },
          ...themeItems(),
          ...featured.map((p, i) => ({
            label: `Switch to ${p.name}`,
            icon: "users",
            separatorBefore: i === 0,
            onSelect: () => switchTo(p.handle),
          })),
          { label: "Switch to someone else…", icon: "users", onSelect: chooseIdentity },
        ],
      }),
    );
    // Show the avatar beside the name on the trigger.
    const trigger = slot.querySelector("button");
    trigger?.prepend(avatar({ name: who.display_name, avatar: who.avatar, size: "sm" }));
  };
  meStore.subscribe(draw);
  prefsStore.subscribe(draw);
  draw();
  return slot;
};

const badged = (node, count, label) => {
  const badge = countBadge(countsStore.get()[count] ?? 0, { label });
  countsStore.subscribe((c) => updateCount(badge, c[count] ?? 0));
  return h("span", { class: "app__badged" }, node, badge);
};

const mountTopbar = (el, navHost) => {
  const menu = iconButton({
    icon: "menu",
    label: "Open navigation",
    onClick: () => {
      const content = navContent(() => drawer.close());
      const drawer = openDrawer({
        title: "Navigation",
        side: "start",
        width: "sm",
        body: content,
        onClose: () => content.dispose(),
      });
    },
  });
  menu.classList.add("app__menu");
  const search = button({
    label: "Search or run a command",
    icon: "search",
    variant: "secondary",
    onClick: () => openPalette(),
  });
  search.classList.add("app__search");
  search.setAttribute("aria-keyshortcuts", "Control+K Meta+K");
  search.append(kbd("Ctrl+K"));
  el.append(
    menu,
    h("a", { class: "app__brand", href: router.href("/") }, "Plinth Suite"),
    search,
    h("span", { class: "app__spacer" }),
    balanceChip(),
    badged(
      linkButton({ href: router.href("/messages"), label: "Inbox", icon: "inbox", variant: "ghost" }),
      "messages_unread",
      "unread messages",
    ),
    badged(
      iconButton({ icon: "bell", label: "Notifications", onClick: () => router.navigate("/notifications") }),
      "notifications_unread",
      "unread",
    ),
    liveMark(),
    avatarMenu(),
  );
  void navHost;
};

// ---- a small built-in palette: jump to any nav page; package A replaces it with the full palette ----

let paletteEl = null;
const openPalette = () => {
  if (!paletteEl || paletteEl.open) return;
  const list = h("ul", { class: "app__palette-list", role: "listbox", "aria-label": "Pages" });
  const input = h("input", {
    class: "c-field__control",
    type: "search",
    placeholder: "Go to a page",
    "aria-label": "Search pages",
  });
  const draw = () => {
    clear(list);
    const q = input.value.trim().toLowerCase();
    for (const p of visibleNav()
      .filter((x) => x.nav.label.toLowerCase().includes(q))
      .slice(0, 8)) {
      list.append(
        h(
          "li",
          { role: "option" },
          h(
            "a",
            { class: "c-nav__item", href: router.href(p.route), onclick: () => paletteEl.close() },
            icon(p.nav.icon),
            p.nav.label,
          ),
        ),
      );
    }
  };
  input.addEventListener("input", draw);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") list.querySelector("a")?.click();
  });
  clear(paletteEl);
  paletteEl.append(h("div", { class: "app__palette" }, input, list));
  draw();
  paletteEl.showModal();
  input.focus();
};

const ownEvents = (rtApi) => {
  const me = () => meStore.get()?.member?.handle;
  rtApi.on("points.posted", (ev) => {
    if (ev.payload.member === me() && ev.payload.delta > 0)
      toast({
        title: `${signedPoints(ev.payload.delta)}`,
        body: ev.payload.memo,
        tone: "success",
        icon: "coins",
      });
  });
  rtApi.on("badge.awarded", (ev) => {
    if (ev.payload.member?.handle === me())
      toast({
        title: `Badge earned: ${ev.payload.title}`,
        tone: "signal",
        icon: "trophy",
        action: { label: "View badges", href: router.href("/badges") },
      });
  });
  rtApi.on(
    "tier.changed",
    (ev) =>
      ev.payload.member === me() &&
      toast({ title: `You reached ${ev.payload.to}`, tone: "signal", icon: "crown" }),
  );
  rtApi.on(
    "order.status_changed",
    (ev) =>
      ev.payload.member === me() &&
      toast({
        title: `Order ${ev.payload.order_no} ${ev.payload.to}`,
        tone: "info",
        icon: "box",
        action: { label: "View order", href: router.href("/store/orders") },
      }),
  );
  rtApi.on("task.assigned", (ev) =>
    toast({
      title: `Task assigned: ${ev.payload.title}`,
      tone: "info",
      icon: "task",
      action: { label: "Open tasks", href: router.href("/tasks") },
    }),
  );
  rtApi.on("approval.requested", (ev) =>
    toast({
      title: "Approval requested",
      body: ev.payload.title,
      tone: "warning",
      icon: "check-circle",
      action: { label: "Review", href: router.href("/approvals") },
    }),
  );
  rtApi.on(
    "message.received",
    (ev) =>
      !router.current().path.startsWith("/messages") &&
      toast({
        title: `New message from ${ev.payload.from.display_name}`,
        body: ev.payload.subject,
        tone: "info",
        icon: "inbox",
        action: { label: "Open", href: router.href(`/messages/t/${ev.payload.thread_id}`) },
      }),
  );
};

/** Same name and shape as package A's entry point. */
export const mountShell = ({ nav, topbar, toasts, palette }) => {
  toastRegion(toasts);
  paletteEl = palette;
  nav.append(
    h(
      "div",
      { class: "c-nav__brand" },
      h("a", { class: "app__brand", href: router.href("/") }, "Plinth Suite"),
    ),
    navContent(),
  );
  mountTopbar(topbar, nav);
  ownEvents(rt);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openPalette();
    }
  });
};
