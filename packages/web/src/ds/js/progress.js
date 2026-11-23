// Progress bar and ring. DESIGN-SYSTEM 6.19.
import { h, s } from "./dom.js";
import { percent } from "./format.js";

export const progressBar = ({ value, max = 100, label, tone = "info" }) =>
  h(
    "div",
    { class: `c-progress c-progress--${tone}` },
    h("progress", { value, max, "aria-label": label }),
    h("span", { class: "c-progress__text u-tabular" }, percent(max ? value / max : 0)),
  );

export const progressRing = ({ value, max = 100, label, size = 40 }) => {
  const px = Math.max(32, Math.min(96, size));
  const frac = max ? Math.min(1, value / max) : 0;
  const R = 16;
  const C = 2 * Math.PI * R;
  return s(
    "svg",
    { class: "c-ring", role: "img", viewBox: "0 0 40 40", width: px, height: px },
    s("title", {}, `${label}, ${percent(frac)}`),
    s("circle", { class: "c-ring__track", cx: 20, cy: 20, r: R, fill: "none", "stroke-width": 4 }),
    s("circle", {
      class: "c-ring__arc",
      cx: 20,
      cy: 20,
      r: R,
      fill: "none",
      "stroke-width": 4,
      "stroke-dasharray": `${C * frac} ${C}`,
      transform: "rotate(-90 20 20)",
    }),
    s(
      "text",
      {
        class: "c-ring__text",
        x: 20,
        y: 20,
        "text-anchor": "middle",
        "dominant-baseline": "central",
        "aria-hidden": "true",
      },
      `${Math.round(frac * 100)}`,
    ),
  );
};
