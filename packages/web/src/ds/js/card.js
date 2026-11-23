// Card (tier 1). DESIGN-SYSTEM 6.12.
import { h, uid } from "./dom.js";

export const card = ({ title, eyebrow, actions, body, footer, href, tone, sub } = {}) => {
  const tid = uid("card");
  const titleNode = title ? (href ? h("a", { class: "c-card__link", href }, title) : title) : null;
  const hasHead = title || eyebrow || actions;
  const root = h(
    title ? "section" : "div",
    {
      class: `c-card${tone ? ` c-card--${tone}` : ""}${href ? " c-card--linked" : ""}${sub ? " c-card--sub" : ""}`,
      "aria-labelledby": title ? tid : null,
    },
    hasHead
      ? h(
          "header",
          { class: "c-card__head" },
          h(
            "div",
            { class: "c-card__heading" },
            eyebrow ? h("p", { class: "c-card__eyebrow" }, eyebrow) : null,
            title ? h("h3", { class: "c-card__title", id: tid }, titleNode) : null,
          ),
          actions ? h("div", { class: "c-card__actions" }, ...[].concat(actions)) : null,
        )
      : null,
    h("div", { class: "c-card__body" }, body),
    footer ? h("footer", { class: "c-card__foot" }, footer) : null,
  );
  return root;
};
