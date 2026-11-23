// The top bar: menu (below the desktop row), brand, page title, palette trigger, balance chip, inbox, bell,
// live mark and the avatar menu with theme and identity switching.
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
import { countsStore, meStore, balanceStore, prefsStore, setTheme } from "../core/stores.js";
import { switchTo } from "../core/identity.js";
import * as router from "../core/router.js";
import { DEMO } from "../core/base.js";
import * as api from "../core/api.js";
import { toast } from "../ds/js/toast.js";
import {
  effectiveExperience,
  getOverride,
  hasGpu,
  setOverride,
  toTown,
  TOWN_FALLBACK_MESSAGE,
} from "../core/experience.js";
import * as rt from "../core/rt.js";
import { navContent } from "./nav.js";
import { createBell } from "./bell.js";
import {
  loadPrincipals,
  synchronousPrincipals,
  targetOf,
  isCurrent,
  openIdentityDialog,
  signOutThisTab,
} from "./identity.js";

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
  let from = null;
  let frame = 0;
  // Count from the old balance to the new one; reduced motion jumps straight to it.
  const animate = (to) => {
    cancelAnimationFrame(frame);
    const reduce =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.reducedMotion === "true";
    if (from === null || reduce || from === to) {
      text.textContent = points(to);
      from = to;
      return;
    }
    const start = performance.now();
    const origin = from;
    const step = (now) => {
      const t = Math.min(1, (now - start) / 600);
      const eased = 1 - (1 - t) ** 3;
      text.textContent = points(Math.round(origin + (to - origin) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    from = to;
  };
  const paint = (b) => {
    chip.hidden = b.balance === null;
    if (b.balance === null) return;
    animate(b.balance);
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

/**
 * The experience choice (classic site, 3D town site, or whatever the site default is). It stores the per-viewer
 * override and goes to the town twin of this page when the result is town. `onChange` redraws a checked list.
 */
const chooseExperience = async (value, onChange) => {
  setOverride(value);
  onChange?.();
  let site = "classic";
  if (value === "site") {
    try {
      site = (await api.call("site.appearance.get")).appearance.experience ?? "classic";
    } catch {
      /* the site default is unknown: stay here */
    }
  }
  if (effectiveExperience(value, site) !== "town") return;
  if (!hasGpu()) {
    toast({ title: TOWN_FALLBACK_MESSAGE, tone: "info", icon: "info" });
    return;
  }
  location.assign(toTown());
};

const experienceItems = (onChange, { separatorBefore = false } = {}) => {
  const cur = getOverride();
  const pick = (value) => () => void chooseExperience(value, onChange);
  return [
    { label: "Classic view", checked: cur === "classic", separatorBefore, onSelect: pick("classic") },
    { label: "3D view", checked: cur === "town", onSelect: pick("town") },
    { label: "Follow site default", checked: cur === "site", onSelect: pick("site") },
  ];
};

const experienceMenu = () => {
  const el = menuButton({
    label: "Choose view: classic or 3D",
    icon: "box",
    variant: "ghost",
    iconOnly: true,
  });
  const draw = () => {
    el.items = experienceItems(draw);
  };
  draw();
  el.classList.add("app__experience");
  return el;
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

const avatarMenu = () => {
  const slot = h("span", { class: "app__avatar" });
  let principals = synchronousPrincipals();
  const draw = () => {
    const me = meStore.get();
    clear(slot);
    if (!me) return;
    const who = me.principal;
    const featured = principals.filter((p) => p.featured && !isCurrent(p));
    slot.append(
      menuButton({
        label: who.display_name,
        variant: "ghost",
        items: [
          { label: "Profile", icon: "user", onSelect: () => router.navigate("/profile") },
          { label: "Settings", icon: "settings", onSelect: () => router.navigate("/settings") },
          ...themeItems(),
          ...experienceItems(draw, { separatorBefore: true }),
          ...featured.map((p, i) => ({
            label: `Switch to ${p.display_name}`,
            icon: "users",
            separatorBefore: i === 0,
            onSelect: () => switchTo(targetOf(p)),
          })),
          {
            label: "Switch to someone else…",
            icon: "users",
            separatorBefore: featured.length === 0,
            onSelect: () => openIdentityDialog(),
          },
          {
            label: "Sign out of this tab",
            icon: "logout",
            danger: true,
            separatorBefore: true,
            onSelect: () => signOutThisTab(),
          },
        ],
      }),
    );
    // Show the avatar beside the name on the trigger.
    slot.querySelector("button")?.prepend(avatar({ name: who.display_name, avatar: who.avatar, size: "sm" }));
  };
  meStore.subscribe(draw);
  prefsStore.subscribe(draw);
  loadPrincipals().then((items) => {
    principals = items;
    draw();
  });
  draw();
  return slot;
};

const badged = (node, count, label) => {
  const badge = countBadge(countsStore.get()[count] ?? 0, { label });
  countsStore.subscribe((c) => updateCount(badge, c[count] ?? 0));
  return h("span", { class: "app__badged" }, node, badge);
};

/** The page title as the router set it, without the product suffix. */
const pageTitle = () => {
  const el = h("p", { class: "app__title", "aria-hidden": "true" });
  const read = () => {
    el.textContent = document.title.replace(/ · Plinth Suite$/, "").replace(/^Plinth Suite$/, "");
  };
  const titleNode = document.querySelector("title");
  if (titleNode)
    new MutationObserver(read).observe(titleNode, { childList: true, characterData: true, subtree: true });
  read();
  return el;
};

export const mountTopbar = (el, { openPalette }) => {
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
    onClick: openPalette,
  });
  search.classList.add("app__search");
  search.setAttribute("aria-keyshortcuts", "Control+K Meta+K");
  search.append(kbd("Ctrl+K"));
  el.append(
    menu,
    h("a", { class: "app__brand", href: router.href("/") }, "Plinth Suite"),
    pageTitle(),
    search,
    h("span", { class: "app__spacer" }),
    balanceChip(),
    experienceMenu(),
    badged(
      linkButton({ href: router.href("/messages"), label: "Inbox", icon: "inbox", variant: "ghost" }),
      "messages_unread",
      "unread messages",
    ),
    createBell(),
    liveMark(),
    avatarMenu(),
  );
};
