/** Reusable loading, empty, error and notice blocks. */
import { h } from "./dom.js";
import { summarizeQuery } from "./format.js";

export const panelLoading = () =>
  h("div", { class: "panel-state", dataset: { kind: "loading" }, role: "status" },
    h("span", { class: "visually-hidden" }, "Loading figure"),
    h("div", { class: "skeleton", "aria-hidden": "true" }),
    h("div", { class: "skeleton", "aria-hidden": "true" }),
    h("div", { class: "skeleton", "aria-hidden": "true" }));

export const panelEmpty = (query) =>
  h("div", { class: "panel-state", dataset: { kind: "empty" } },
    h("p", { class: "panel-state__title" }, "No rows for this query"),
    h("p", { class: "panel-state__query" }, summarizeQuery(query)));

export const panelError = (error) =>
  h("div", { class: "panel-state", dataset: { kind: "error" }, role: "alert" },
    h("p", { class: "panel-state__title" }, "This figure could not be drawn"),
    h("span", { class: "panel-state__code" }, error.code),
    h("p", null, error.message || error.fix_hint || "No further detail was returned."));

/** A full-width editorial notice: a serif headline, a sentence and an optional action. */
export const notice = ({ title, body, action }) =>
  h("section", { class: "notice", "aria-labelledby": "notice-title" },
    h("h2", { class: "notice__title", id: "notice-title", tabindex: "-1" }, title),
    h("p", { class: "notice__body" }, body),
    action?.href ? h("a", { class: "notice__action", href: action.href }, action.label) : null,
    action?.onClick ? h("button", { class: "notice__action", type: "button", onclick: action.onClick }, action.label) : null);
