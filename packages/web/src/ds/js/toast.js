// Toasts. DESIGN-SYSTEM 6.9: max four visible, newest on top, a queue for the rest, timers pause on hover and focus.
import { h } from "./dom.js";
import { icon } from "./icons.js";
import { iconButton } from "./button.js";

const TONE_ICON = {
  neutral: null,
  info: "info",
  success: "check-circle",
  warning: "alert",
  danger: "alert",
  signal: "bolt",
};
const MAX_VISIBLE = 4;

let region = null;
const visible = new Set();
const queue = [];

export const toastRegion = (el) => {
  region = el;
  el.classList.add("toasts");
};

const pump = () => {
  while (region && visible.size < MAX_VISIBLE && queue.length > 0) show(queue.shift());
};

function show(entry) {
  const { opts, handle } = entry;
  const tone = opts.tone ?? "neutral";
  const ic = opts.icon ?? TONE_ICON[tone];
  let remaining = opts.timeout ?? 6000;
  let started = 0;
  let timer = 0;
  let hovered = false;
  let focused = false;
  const el = h("article", {
    class: `c-toast c-toast--${tone}`,
    role: tone === "danger" ? "alert" : "status",
  });
  const dismiss = () => {
    if (!visible.has(el)) return;
    clearTimeout(timer);
    visible.delete(el);
    el.dataset.leaving = "";
    const gone = () => {
      el.remove();
      pump();
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) gone();
    else {
      el.addEventListener("animationend", gone, { once: true });
      setTimeout(gone, 400);
    }
  };
  handle.dismiss = dismiss;
  const action = opts.action
    ? opts.action.href
      ? h(
          "a",
          {
            class: "c-toast__action",
            href: opts.action.href,
            onclick: () => (opts.action.onClick?.(), dismiss()),
          },
          opts.action.label,
        )
      : h(
          "button",
          { type: "button", class: "c-toast__action", onclick: () => (opts.action.onClick?.(), dismiss()) },
          opts.action.label,
        )
    : null;
  el.append(
    ...[ic ? h("span", { class: "c-toast__icon" }, icon(ic)) : null].filter(Boolean),
    h(
      "div",
      { class: "c-toast__text" },
      h("p", { class: "c-toast__title" }, opts.title),
      opts.body ? h("p", { class: "c-toast__body" }, opts.body) : null,
      action,
    ),
    iconButton({ icon: "x", label: "Dismiss notification", size: "sm", onClick: dismiss }),
  );
  const arm = () => {
    clearTimeout(timer);
    if (!remaining || hovered || focused) return;
    started = Date.now();
    timer = setTimeout(dismiss, remaining);
  };
  const pause = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = 0;
    remaining = Math.max(1000, remaining - (Date.now() - started));
  };
  el.addEventListener("pointerenter", () => ((hovered = true), pause()));
  el.addEventListener("pointerleave", () => ((hovered = false), arm()));
  el.addEventListener("focusin", () => ((focused = true), pause()));
  el.addEventListener("focusout", () => ((focused = false), arm()));
  visible.add(el);
  region.prepend(el);
  arm();
}

export const toast = (opts) => {
  const handle = { dismiss: () => {} };
  const entry = { opts, handle };
  if (!region) region = document.getElementById("toasts");
  if (visible.size < MAX_VISIBLE && region) show(entry);
  else {
    queue.push(entry);
    handle.dismiss = () => {
      const i = queue.indexOf(entry);
      if (i >= 0) queue.splice(i, 1);
    };
  }
  return { dismiss: () => handle.dismiss() };
};
