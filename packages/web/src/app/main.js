// Boot (UI-MAP 3.2): identity, `me.get` into the stores, realtime, `pages.list` into the nav store, the shell
// (package A's `src/shell/shell.js` when present, the built-in one until then), then the router.
import "../core/module-styles.js";
import { $, h } from "../ds/js/dom.js";
import { button } from "../ds/js/button.js";
import { errorState } from "../ds/js/states.js";
import * as api from "../core/api.js";
import * as rt from "../core/rt.js";
import * as router from "../core/router.js";
import { onRevoked } from "../core/identity.js";
import { applyMe, wireStores, startClock, navStore, meStore, prefsStore } from "../core/stores.js";
import { render, presentNode } from "../core/page-host.js";
import { defineWidgetElement } from "../core/plinth-widget.js";
import { transition, supported as canTransition, vtName } from "../core/transition.js";
import { toast } from "../ds/js/toast.js";
import {
  consumeUrlOverride,
  effectiveExperience,
  getOverride,
  hasGpu,
  toTown,
  TOWN_FALLBACK_MESSAGE,
} from "../core/experience.js";
import { stripBase } from "../core/base.js";
import { mountShell as mountBuiltinShell } from "./shell.js";
import { registerStyleguide } from "./styleguide.js";

const shellModules = import.meta.glob("../shell/shell.js");

const showRevoked = () => {
  rt.disconnect();
  const app = $(".app");
  app?.replaceChildren(
    h(
      "main",
      { class: "app__revoked", tabindex: "-1" },
      h("h1", {}, "This tab was signed out"),
      h("p", {}, "The session for this tab was revoked from another place. Reload to start a new one."),
      button({ label: "Reload", variant: "primary", onClick: () => location.reload() }),
    ),
  );
  $(".app__revoked")?.focus();
};

/** A fixed banner under the top bar while the socket is offline, with the retry countdown. */
const offlineBanner = () => {
  const text = h("span", {});
  const retry = button({
    label: "Retry now",
    size: "sm",
    variant: "secondary",
    onClick: () => rt.retryNow(),
  });
  const banner = h("div", { class: "app__banner", role: "status", hidden: true }, text, retry);
  document.body.append(banner);
  let tick = 0;
  rt.onState((state, info) => {
    clearInterval(tick);
    banner.hidden = state !== "offline";
    if (state !== "offline") return;
    let left = Math.ceil((info.retryInMs ?? 1000) / 1000);
    const draw = () => {
      text.textContent = `Offline. Trying again in ${left} s.`;
      left = Math.max(0, left - 1);
    };
    draw();
    tick = setInterval(draw, 1000);
  });
};

/** Mark nav items that appeared live (not at boot) so they fade in. */
const markNewNavItems = (before) => {
  for (const a of document.querySelectorAll(".c-nav__item[data-route]")) {
    if (before.has(a.dataset.route) || a.classList.contains("is-entering")) continue;
    a.classList.add("is-entering");
    const done = () => a.classList.remove("is-entering");
    a.addEventListener("animationend", done, { once: true });
    setTimeout(done, 800);
  }
};

/** Name the side-nav items so a live add or remove glides instead of jumping (cleared when the transition ends). */
const nameNavItems = () => {
  for (const a of document.querySelectorAll(".c-nav__item[data-route]"))
    a.style.viewTransitionName = vtName("nav", a.dataset.route);
};
const clearNavNames = () => {
  for (const a of document.querySelectorAll(".c-nav__item")) a.style.viewTransitionName = "";
};

/** Re-read `pages.list` into the nav store; entries that are new since the last read animate in. */
const refreshNav = async (animate) => {
  const pages = await api.call("pages.list");
  const items = pages.items.filter((p) => p.nav);
  const before = new Set(navStore.get().map((p) => p.route));
  const changed = items.length !== before.size || items.some((p) => !before.has(p.route));
  if (animate && changed && canTransition()) {
    // a view transition moves the survivors and grows the new items; no enter class on top of it
    await transition(
      () => {
        navStore.set(items);
        nameNavItems();
      },
      { kind: "nav", setup: nameNavItems, cleanup: clearNavNames },
    );
    return;
  }
  navStore.set(items);
  if (animate) markNewNavItems(before);
};

/** The look change reveals as a circle growing from the top bar's right end, where the viewer's controls sit. */
const revealFromTopbar = () => {
  const bar = document.getElementById("app-topbar")?.getBoundingClientRect();
  const x = innerWidth - 48;
  const y = bar ? bar.top + bar.height / 2 : 28;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.documentElement.animate(
    { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
    { duration: 560, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)", pseudoElement: "::view-transition-new(root)" },
  );
};

/**
 * The experience swap (UI-MAP "Experience swap"). Returns true when this page is navigating to the town site.
 * At boot a town result with a GPU redirects; without one the viewer stays here with a one-time toast.
 * Live (`live`), only a viewer who follows the site swaps, and only when the site default changed to town.
 */
let siteExperience = null;
let shellReady = false;
let noticePending = false;
const noGpuNotice = () => {
  try {
    if (sessionStorage.getItem("plinth.experience.notice")) return;
    sessionStorage.setItem("plinth.experience.notice", "1");
  } catch {
    /* storage blocked: the notice may repeat */
  }
  if (shellReady) toast({ title: TOWN_FALLBACK_MESSAGE, tone: "info", icon: "info" });
  else noticePending = true;
};
const goTown = (live) => {
  const go = () => location.replace(toTown());
  if (live && canTransition()) void transition(async () => go(), { kind: "route" }).catch(go);
  else go();
};
const applyExperience = (experience, live) => {
  const previous = siteExperience;
  siteExperience = experience === "town" ? "town" : "classic";
  if (live && (previous === siteExperience || siteExperience !== "town" || getOverride() !== "site"))
    return false;
  if (effectiveExperience(getOverride(), siteExperience) !== "town") return false;
  if (!hasGpu()) {
    noGpuNotice();
    return false;
  }
  goTown(live);
  return true;
};

/**
 * The site's look and density (`site.appearance.get`, set by `site.appearance.set` on the Program node).
 * The look goes to <html data-look>; the site density applies unless the viewer chose a compact density of their own.
 * The viewer's light/dark theme is never touched. A live change (not the boot read) runs in a view transition.
 */
const applyAppearance = async (animate = false) => {
  const { appearance } = await api.call("site.appearance.get");
  if (applyExperience(appearance.experience, animate)) return;
  const own = meStore.get()?.preferences?.ui?.density;
  const density =
    appearance.density && (own === undefined || own === "comfortable") ? appearance.density : null;
  const apply = () => {
    document.documentElement.dataset.look = appearance.look;
    if (density) prefsStore.update((p) => ({ ...p, density }));
  };
  const changed =
    document.documentElement.dataset.look !== appearance.look ||
    (density !== null && prefsStore.get().density !== density);
  if (animate && changed) await transition(apply, { kind: "look", reveal: revealFromTopbar });
  else apply();
};

const debounced = (fn, ms) => {
  let t = 0;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
};

const boot = async () => {
  // Static demo (GitHub Pages): recorded data and a stand-in realtime socket, installed before anything fetches.
  if (import.meta.env.MODE === "demo") {
    const { installDemo } = await import("../../../demo-data/src/mock.js");
    await installDemo({ base: import.meta.env.BASE_URL });
  }
  defineWidgetElement();
  onRevoked(showRevoked);
  router.setRenderer(render);
  registerStyleguide();

  consumeUrlOverride();
  let bootError = null;
  try {
    applyMe(await api.call("me.get"));
    startClock();
  } catch (e) {
    bootError = e;
  }
  if (!bootError) {
    rt.connect();
    wireStores(rt);
    offlineBanner();
    try {
      await refreshNav(false);
    } catch (e) {
      console.error(e);
    }
    try {
      await applyAppearance();
    } catch (e) {
      console.error(e);
    }
    // live: pages created, changed or removed re-fill the nav; a Program change re-applies the look
    const nodeOf = (kind) => (c) => String(c.node).includes(`/${kind}/`);
    const navSoon = debounced(() => refreshNav(true).catch(console.error), 150);
    const lookSoon = debounced(() => applyAppearance(true).catch(console.error), 150);
    rt.onChange(nodeOf("Page"), navSoon);
    rt.onChange(nodeOf("Program"), lookSoon);
    // the agent moved this screen (ui.present): outline the widget, or open the Page
    rt.onPresent((f) => void presentNode(f.node).catch(console.error));
  }

  const loader = shellModules["../shell/shell.js"];
  const mountShell = loader ? (await loader()).mountShell : mountBuiltinShell;
  mountShell({ nav: $("#app-nav"), topbar: $("#app-topbar"), toasts: $("#toasts"), palette: $("#palette") });

  shellReady = true;
  if (noticePending) toast({ title: TOWN_FALLBACK_MESSAGE, tone: "info", icon: "info" });

  if (bootError && !stripBase(location.pathname).startsWith("/styleguide")) {
    $("#main").replaceChildren(errorState({ error: bootError, retry: () => location.reload() }));
    return;
  }
  router.start();
};

boot();
