// Popover API placed with CSS anchor positioning (anchor-name, position-anchor, position-area). DESIGN-SYSTEM 6.7.
import { h, frameOnce, uid } from "./dom.js";

const GAP = 6;

/** True where the browser can place a floating element against an anchor in CSS alone. */
export const anchorSupported = () => typeof CSS !== "undefined" && CSS.supports("position-anchor: --a");

/** Static fallback for browsers without anchor positioning: place `el` (fixed) next to `anchor`, once per call. */
const placeStatic = (anchor, el, placement) => {
  const a = anchor.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  let [vertical, horizontal] = placement.split("-");
  if (vertical === "bottom" && a.bottom + GAP + r.height > vh && a.top - GAP - r.height > 0) vertical = "top";
  else if (vertical === "top" && a.top - GAP - r.height < 0) vertical = "bottom";
  const top = vertical === "bottom" ? a.bottom + GAP : a.top - GAP - r.height;
  const left = horizontal === "end" ? a.right - r.width : a.left;
  el.style.top = `${Math.max(8, Math.min(top, vh - r.height - 8))}px`;
  el.style.left = `${Math.max(8, Math.min(left, vw - r.width - 8))}px`;
};

/**
 * Tie `el` to `anchor`. Each anchor gets a unique `--anchor-<id>` name; the floating element points at it with
 * `position-anchor`, and popover.css turns `data-placement` into `position-area` plus flip fallbacks. Without
 * anchor positioning the element is placed statically on open and on resize and scroll. Returns a release function.
 * Shared with menu.js.
 */
export const anchorTo = (anchor, el, placement = "bottom-start") => {
  el.dataset.placement = placement;
  if (anchorSupported()) {
    const name = anchor.style.getPropertyValue("anchor-name") || `--anchor-${uid("a")}`;
    anchor.style.setProperty("anchor-name", name);
    el.style.setProperty("position-anchor", name);
    return () => {};
  }
  const reposition = frameOnce(() => placeStatic(anchor, el, placement));
  placeStatic(anchor, el, placement);
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);
  return () => {
    window.removeEventListener("resize", reposition);
    window.removeEventListener("scroll", reposition, true);
  };
};

export const popover = (anchor, content, { placement = "bottom-start", onClose, label = "Details" } = {}) => {
  const body = typeof content === "function" ? content() : content;
  const el = h(
    "div",
    {
      class: "c-popover",
      popover: "auto",
      role: "dialog",
      "aria-label": body?.getAttribute?.("aria-label") ?? label,
    },
    body,
  );
  document.body.append(el);
  let closed = false;
  let release = () => {};
  const finish = () => {
    if (closed) return;
    closed = true;
    release();
    anchor.setAttribute?.("aria-expanded", "false");
    el.remove();
    onClose?.();
  };
  el.addEventListener("toggle", (e) => {
    if (e.newState === "closed") finish();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      el.hidePopover();
      anchor.focus?.();
    }
  });
  const byKeyboard = document.activeElement === anchor && !anchor.matches(":hover");
  el.showPopover();
  release = anchorTo(anchor, el, placement);
  anchor.setAttribute?.("aria-expanded", "true");
  if (byKeyboard)
    el.querySelector("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")?.focus();
  return {
    close: () => {
      if (!closed && el.matches(":popover-open")) el.hidePopover();
      finish();
    },
    element: el,
  };
};
