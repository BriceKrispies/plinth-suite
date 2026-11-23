import { h } from "./dom.js";

export const kbd = (keys) => {
  const parts = String(keys).split("+");
  return h(
    "span",
    { class: "c-kbd", "aria-label": parts.join(" plus ") },
    ...parts.flatMap((p, i) => [
      i > 0 ? h("span", { class: "c-kbd__plus", "aria-hidden": "true" }, "+") : null,
      h("kbd", { "aria-hidden": "true" }, p),
    ]),
  );
};
