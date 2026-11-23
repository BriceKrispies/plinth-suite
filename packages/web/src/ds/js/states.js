// Empty, loading and error states. DESIGN-SYSTEM 6.17. Skeletons are static; they appear after a 300 ms delay.
import { h } from "./dom.js";
import { icon } from "./icons.js";
import { button } from "./button.js";

export const emptyState = ({ icon: ic = "inbox", title, body, action } = {}) =>
  h(
    "section",
    { class: "c-state c-state--empty" },
    h("span", { class: "c-state__icon" }, icon(ic, { size: 24 })),
    h("p", { class: "c-state__title" }, title),
    body ? h("p", { class: "c-state__body" }, body) : null,
    action ?? null,
  );

const bars = (n) =>
  Array.from({ length: n }, (_, i) =>
    h("span", { class: "c-skeleton__bar", style: `--_w:${Math.max(35, 100 - i * 18)}%` }),
  );

export const skeleton = ({ lines = 3, shape = "text" } = {}) => {
  const root = h("div", { class: `c-skeleton c-skeleton--${shape}`, "aria-hidden": "true" });
  if (shape === "table") {
    root.append(h("span", { class: "c-skeleton__bar c-skeleton__bar--head" }));
    for (let i = 0; i < 5; i += 1) {
      root.append(
        h(
          "div",
          { class: "c-skeleton__row", style: `--_cols:${Math.max(1, lines)}` },
          ...Array.from({ length: Math.max(1, lines) }, () => h("span", { class: "c-skeleton__bar" })),
        ),
      );
    }
  } else if (shape === "card") root.append(h("span", { class: "c-skeleton__block" }), ...bars(lines));
  else if (shape === "tile")
    root.append(
      h("span", { class: "c-skeleton__bar c-skeleton__bar--label" }),
      h("span", { class: "c-skeleton__bar c-skeleton__bar--value" }),
    );
  else root.append(...bars(lines));
  return root;
};

const KNOWN = {
  FORBIDDEN: "You do not have access to this",
  UNKNOWN_REFERENCE: "We could not find that",
  UNREACHABLE: "The server could not be reached",
  VALIDATION_FAILED: "Something in the request was not accepted",
};

export const errorState = ({ error, retry } = {}) => {
  const info = error?.info ?? error ?? {};
  return h(
    "section",
    { class: "c-state c-state--error", role: "alert" },
    h("span", { class: "c-state__icon c-state__icon--danger" }, icon("alert", { size: 24 })),
    h("p", { class: "c-state__title" }, KNOWN[info.code] ?? "Something went wrong"),
    h(
      "p",
      { class: "c-state__body" },
      info.code ? h("code", {}, info.code) : null,
      info.code && info.message ? " " : null,
      info.message ?? "",
    ),
    retry ? button({ label: "Try again", icon: "history", variant: "secondary", onClick: retry }) : null,
  );
};

/** Text-only loading line; the caller adds a skeleton after 300 ms when it wants one (see delayedSkeleton). */
export const loading = (label) =>
  h("p", { class: "c-state c-state--loading", role: "status" }, `Loading ${label}`);

/** Resolves a skeleton node into `host` only if still loading after 300 ms. Returns cancel(). */
export const delayedSkeleton = (host, opts) => {
  host.setAttribute("aria-busy", "true");
  const timer = setTimeout(() => host.append(skeleton(opts)), 300);
  return () => {
    clearTimeout(timer);
    host.removeAttribute("aria-busy");
    host.querySelectorAll(":scope > .c-skeleton").forEach((n) => n.remove());
  };
};
