// A list and detail pair that shows side by side when the widget is wide and one at a time when it is narrow
// (the switch is a container query in reporting.css). The widget decides what the panes contain.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";

/**
 * `const pane = splitPane({ label, placeholder })`; fill `pane.list` and `pane.detail`.
 * `pane.showDetail()` and `pane.showList()` switch the single-column view and move focus sensibly;
 * `pane.view` is "list" or "detail". `placeholder` (a node) fills the detail while nothing is selected.
 */
export const splitPane = ({ label, placeholder, onBack } = {}) => {
  const list = h("div", { class: "rp-split__list" });
  const detail = h("div", { class: "rp-split__detail" });
  const holder = placeholder ? h("div", { class: "rp-split__placeholder" }, placeholder) : null;
  const root = h("div", { class: "rp-split", role: "group", "aria-label": label, "data-view": "list" });
  const api = {
    el: root,
    list,
    detail,
    get view() {
      return root.dataset.view;
    },
    showDetail(focusTarget) {
      root.dataset.view = "detail";
      holder?.remove();
      requestAnimationFrame(() =>
        (focusTarget ?? detail.querySelector("[data-focus]"))?.focus?.({ preventScroll: true }),
      );
    },
    showList(focusTarget) {
      root.dataset.view = "list";
      if (holder && detail.childElementCount === 0) detail.append(holder);
      requestAnimationFrame(() => focusTarget?.focus?.({ preventScroll: true }));
    },
    /** Empty the detail pane and show the placeholder again (wide layout) or the list (narrow). */
    clearDetail() {
      detail.replaceChildren(...(holder ? [holder] : []));
      root.dataset.view = "list";
    },
  };
  const back = button({
    label: "Back to list",
    icon: "chevron-left",
    variant: "ghost",
    size: "sm",
    onClick: () => (onBack ? onBack() : api.showList()),
  });
  back.classList.add("rp-split__back");
  root.append(list, h("div", { class: "rp-split__detailwrap" }, back, detail));
  if (holder) detail.append(holder);
  return api;
};
