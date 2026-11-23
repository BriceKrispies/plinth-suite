// Page header, section, split view and toolbar. DESIGN-SYSTEM 6.22.
import { h, uid } from "./dom.js";
import { linkButton, button } from "./button.js";

export const pageHeader = ({ title, eyebrow, meta, actions, back } = {}) =>
  h(
    "header",
    { class: "c-page-header" },
    back
      ? h(
          "div",
          { class: "c-page-header__back" },
          linkButton({
            href: back.href,
            label: back.label,
            icon: "chevron-left",
            variant: "ghost",
            size: "sm",
          }),
        )
      : null,
    eyebrow ? h("p", { class: "c-page-header__eyebrow" }, eyebrow) : null,
    h("h1", { class: "c-page-header__title" }, title),
    meta?.length
      ? h(
          "div",
          { class: "c-page-header__meta" },
          ...meta.map((m) => h("span", { class: "c-page-header__meta-item" }, m)),
        )
      : null,
    actions?.length ? h("div", { class: "c-page-header__actions" }, ...actions) : null,
  );

export const section = ({ title, actions, body, id } = {}) => {
  const tid = uid("sec");
  return h(
    title ? "section" : "div",
    { class: "c-section", id: id ?? null, "aria-labelledby": title ? tid : null },
    title || actions
      ? h(
          "div",
          { class: "c-section__head" },
          title ? h("h2", { class: "c-section__title", id: tid }, title) : null,
          actions ? h("div", { class: "c-section__actions" }, ...[].concat(actions)) : null,
        )
      : null,
    body,
  );
};

export const splitView = ({ list, detail, label }) => {
  const root = h("div", { class: "c-split", "aria-label": label, role: "group" });
  const back = button({
    label: "Back to list",
    icon: "chevron-left",
    variant: "ghost",
    size: "sm",
    onClick: () => {
      root.dataset.view = "list";
      root.dispatchEvent(new CustomEvent("splitview", { detail: "list" }));
    },
  });
  back.classList.add("c-split__back");
  root.append(
    h("div", { class: "c-split__list" }, list),
    h("div", { class: "c-split__detail" }, back, detail),
  );
  root.dataset.view = "list";
  return root;
};

export const toolbar = ({ label, children }) => {
  const root = h(
    "div",
    { class: "c-toolbar", role: "toolbar", "aria-label": label },
    ...[].concat(children ?? []),
  );
  const items = () =>
    [...root.querySelectorAll("button, select, input")].filter((el) => !el.disabled && !el.hidden);
  const rove = (target) => items().forEach((el) => (el.tabIndex = el === target ? 0 : -1));
  queueMicrotask(() => items().length && rove(items()[0]));
  root.addEventListener("focusin", (e) => {
    if (items().includes(e.target)) rove(e.target);
  });
  root.addEventListener("keydown", (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const el = document.activeElement;
    const textual = el.tagName === "INPUT" && !["checkbox", "radio", "button"].includes(el.type);
    if (textual && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End"))
      return;
    let n = null;
    if (e.key === "ArrowRight") n = (i + 1) % list.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + list.length) % list.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = list.length - 1;
    if (n === null) return;
    e.preventDefault();
    list[n].focus();
  });
  return root;
};
