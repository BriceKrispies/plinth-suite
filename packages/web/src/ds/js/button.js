import { h } from "./dom.js";
import { icon } from "./icons.js";

const classes = (variant, size, extra = "") => `c-button c-button--${variant} c-button--${size}${extra}`;

const content = (label, ic, iconOnly) => [
  ic ? h("span", { class: "c-button__icon" }, icon(ic)) : null,
  iconOnly ? null : h("span", { class: "c-button__label" }, label),
];

export const button = ({
  label,
  icon: ic,
  variant = "secondary",
  size = "md",
  type = "button",
  disabled,
  busy,
  pressed,
  onClick,
  title,
  iconOnly = false,
} = {}) => {
  const el = h(
    "button",
    {
      class: classes(variant, size, iconOnly ? " c-button--icon" : ""),
      type,
      disabled: disabled ? true : null,
      "aria-busy": busy ? "true" : null,
      "aria-disabled": busy ? "true" : null,
      "aria-pressed": pressed === undefined ? null : String(Boolean(pressed)),
      "aria-label": iconOnly ? label : null,
      title: title ?? (iconOnly ? label : null),
    },
    ...content(label, busy ? "clock" : ic, iconOnly),
  );
  if (onClick) {
    el.addEventListener("click", (e) => {
      if (busy || el.getAttribute("aria-busy") === "true") return;
      onClick(e);
    });
  }
  return el;
};

export const iconButton = ({ icon: ic, label, ...rest }) =>
  button({ ...rest, icon: ic, label, iconOnly: true, variant: rest.variant ?? "ghost" });

export const linkButton = ({ href, label, icon: ic, variant = "secondary", size = "md" }) =>
  h("a", { class: classes(variant, size), href }, ...content(label, ic, false));
