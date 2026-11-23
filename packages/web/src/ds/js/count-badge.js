import { h } from "./dom.js";
import { number } from "./format.js";
import { PElement, define, reflect, swapClass } from "./element-base.js";

/**
 * `<p-count value label max tone>`: a count badge. Changing `value` rewrites the visible number and the
 * screen-reader text; the badge hides itself at zero or less.
 */
export class PCount extends PElement {
  static observedAttributes = ["value", "label", "max", "tone"];
  #tone = null;

  /** Kept for callers that read the legacy `_count` bag. */
  get _count() {
    return { label: this.label ?? "", max: this.max };
  }

  render() {
    const n = Number(this.getAttribute("value")) || 0;
    const label = this.label ?? "";
    const max = this.max;
    const over = n > max;
    this.classList.add("c-count");
    this.#tone = swapClass(this, this.#tone, this.tone ? `c-count--${this.tone}` : null);
    this.replaceChildren(
      h(
        "span",
        { class: "c-count__n u-tabular", "aria-hidden": label ? "true" : null },
        over ? `${max}+` : number(n),
      ),
      ...[
        label ? h("span", { class: "sr-only" }, over ? `more than ${max} ${label}` : `${n} ${label}`) : null,
      ].filter(Boolean),
    );
    this.hidden = n <= 0;
    this.dataset.n = String(n);
  }
}
reflect(PCount, {
  value: ["value", "number", 0],
  label: ["label", "string"],
  max: ["max", "number", 99],
  tone: ["tone", "string"],
});
define("p-count", PCount);

export const countBadge = (n, { label = "", max = 99, tone } = {}) => {
  const el = document.createElement("p-count");
  return el.configure({ value: Number(n) || 0, label: label || null, max, tone: tone ?? null });
};

export const updateCount = (el, n) => {
  el.value = Number(n) || 0;
};
