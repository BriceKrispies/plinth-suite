// The widget frame: header (title, count, options menu) and body slot. DESIGN-SYSTEM 13.1.
import { h, uid, clear, announce } from "./dom.js";
import { menuButton } from "./menu.js";
import { countBadge, updateCount } from "./count-badge.js";
import { skeleton, errorState, emptyState } from "./states.js";

const UNAVAILABLE = {
  forbidden: { icon: "lock", title: "Not available to you", body: "Your role does not include this widget." },
  missing: { icon: "x", title: "Removed", body: "The configured item no longer exists." },
  unknown_widget: { icon: "alert", title: "Unknown widget", body: "This widget is not in the catalogue." },
};

export const widgetFrame = ({ id, title, count, size = "m", menu = [], chrome = "card" } = {}) => {
  const tid = uid("w");
  const titleEl = h("h2", { class: "c-widget__title", id: `${tid}-title` }, title);
  const badge = countBadge(count ?? 0, { label: "items" });
  const trigger = menu.length
    ? menuButton({
        label: `Widget options for ${title}`,
        icon: "more",
        iconOnly: true,
        variant: "ghost",
        size: "sm",
        items: menu,
      })
    : null;
  const body = h("div", { class: "c-widget__body" });
  // WCAG 2.1.1: a body that scrolls must be reachable by keyboard; it becomes a focusable, named region only then.
  const syncScrollable = () => {
    const scrolls = body.scrollHeight > body.clientHeight || body.scrollWidth > body.clientWidth;
    if (scrolls && !body.hasAttribute("tabindex")) {
      body.setAttribute("tabindex", "0");
      body.setAttribute("role", "region");
      body.setAttribute("aria-labelledby", `${tid}-title`);
    } else if (!scrolls && body.getAttribute("tabindex") === "0") {
      body.removeAttribute("tabindex");
      body.removeAttribute("role");
      body.removeAttribute("aria-labelledby");
    }
  };
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(syncScrollable);
    ro.observe(body);
    new MutationObserver(syncScrollable).observe(body, { childList: true, subtree: true });
  }
  const stateHost = h("div", { class: "c-widget__state", hidden: true });
  const element = h(
    "section",
    {
      class: `c-widget c-widget--${size} c-widget--${chrome}`,
      "aria-labelledby": `${tid}-title`,
      "data-widget": id,
    },
    h(
      "header",
      { class: "c-widget__header" },
      titleEl,
      badge,
      trigger ? h("div", { class: "c-widget__menu" }, trigger) : null,
    ),
    stateHost,
    body,
  );
  let cancelSkeleton = null;
  const settle = () => {
    cancelSkeleton?.();
    cancelSkeleton = null;
    element.removeAttribute("aria-busy");
    clear(stateHost);
    stateHost.hidden = true;
    body.hidden = false;
  };
  const setState = (state, info = {}) => {
    settle();
    if (state === "loading") {
      body.hidden = !info.keepBody;
      stateHost.hidden = false;
      element.setAttribute("aria-busy", "true");
      const timer = setTimeout(
        () => stateHost.append(skeleton({ shape: size === "s" ? "tile" : "card", lines: 3 })),
        300,
      );
      cancelSkeleton = () => clearTimeout(timer);
    } else if (state === "error") {
      body.hidden = true;
      stateHost.hidden = false;
      stateHost.append(errorState({ error: info.error, retry: info.retry }));
    } else if (state === "unavailable") {
      const u = UNAVAILABLE[info.reason] ?? UNAVAILABLE.forbidden;
      body.hidden = true;
      stateHost.hidden = false;
      stateHost.append(emptyState({ icon: u.icon, title: u.title, body: u.body }));
    } else if (state === "empty" && info.content) {
      stateHost.hidden = false;
      stateHost.append(info.content);
    }
  };
  setState("loading");
  return {
    element,
    body,
    setTitle: (text) => {
      titleEl.textContent = text;
      trigger?.querySelector("button")?.setAttribute("aria-label", `Widget options for ${text}`);
    },
    setCount: (n) => updateCount(badge, n),
    setState,
    /** Realtime placement: draw the signal rule and announce (never on first load). */
    arrive: () => {
      element.classList.add("u-arrive");
      setTimeout(() => element.classList.remove("u-arrive"), 6000);
      announce(`Widget added: ${titleEl.textContent}`);
    },
  };
};
