import { h, uid } from "./dom.js";
import { clockSeconds } from "./format.js";
import { panelKey, summarizeQuery } from "./board.js";
import { createMenu } from "./menu.js";
import { KIND_LABEL, mountDataTable, mountVisual } from "./visuals/index.js";

export const CAUSE_MS = 8000;

const stateBlock = (tone, title, ...lines) =>
  h("div", { class: "state", dataset: { tone } },
    h("span", { class: "state__plate", "aria-hidden": "true" }),
    h("p", { class: "state__title" }, title),
    ...lines);

/**
 * One panel: a labelled region with loading, empty, error and ready states, a menu, and a cause badge that
 * appears only when a realtime change event produced it.
 */
export function createPanel({ onInspect, getWindow, onBrush }) {
  const id = uid("panel");
  let entry;
  let key;
  let handle;
  let tableOn = false;
  let causeTimer;

  const title = h("h2", { class: "panel__title", id: `${id}-title` });
  const kind = h("p", { class: "panel__kind" });
  const flag = h("p", { class: "flag", hidden: true });
  const causeSeq = h("span", { class: "cause__seq" });
  const causeText = h("span", { class: "cause__text" });
  const cause = h("p", { class: "cause", hidden: true }, causeSeq, causeText);
  const menu = createMenu({ id, label: "Panel actions" });
  const stage = h("div", { class: "panel__stage" });
  const foot = h("p", { class: "panel__foot" });

  const el = h("section", { class: "panel", "aria-labelledby": `${id}-title`, dataset: { state: "loading" } },
    cause,
    h("header", { class: "panel__head" },
      h("div", { class: "panel__titles" }, kind, title),
      h("div", { class: "panel__tools" }, flag, menu.root)),
    stage,
    foot);

  const inspectItem = menu.addItem("Inspect", () => {
    menu.close(false);
    onInspect(entry, menu.button);
  });
  const tableItem = menu.addItem("View as table", () => {
    tableOn = !tableOn;
    tableItem.setAttribute("aria-pressed", String(tableOn));
    menu.close(true);
    render();
  }, { toggle: true });
  void inspectItem;

  const showError = (code, message, hint) => {
    el.dataset.state = "error";
    stage.replaceChildren(
      stateBlock("bad", "This panel could not be drawn",
        h("p", { class: "state__detail" }, h("code", null, code), " ", message),
        hint ? h("p", { class: "state__hint" }, hint) : null));
    foot.textContent = "";
  };

  const render = () => {
    handle?.destroy();
    handle = undefined;
    flag.hidden = true;
    const { result, error, visual } = entry;
    tableItem.hidden = visual?.type === "table";
    menu.button.setAttribute("aria-label", `Actions for ${entry.title}`);

    if (error) return showError(error.code, error.message, error.fix_hint);
    if (!result) {
      el.dataset.state = "loading";
      stage.replaceChildren(h("div", { class: "skeleton", "aria-hidden": "true" }));
      el.setAttribute("aria-busy", "true");
      return undefined;
    }
    el.removeAttribute("aria-busy");
    if (result.rows.length === 0) {
      el.dataset.state = "empty";
      stage.replaceChildren(stateBlock("dim", "No rows for this query",
        h("p", { class: "state__detail" }, h("code", null, summarizeQuery(entry.query)))));
      foot.textContent = `As of ${clockSeconds(result.as_of)} · 0 rows`;
      return undefined;
    }

    const host = h("div", { class: "panel__view" });
    stage.replaceChildren(host);
    try {
      const mount = tableOn && visual.type !== "table" ? mountDataTable : mountVisual;
      handle = mount(host, { result, visual, win: getWindow(), onBrush, title: entry.title });
    } catch (e) {
      return showError(e.code ?? "ERROR", e.message);
    }
    el.dataset.state = "ready";
    if (handle.breaches > 0 && visual.type !== "kpi" && !tableOn) {
      flag.textContent = `▲ ${handle.breaches} over limit`;
      flag.hidden = false;
    }
    foot.textContent = `As of ${clockSeconds(result.as_of)} · ${result.row_count ?? result.rows.length} rows`;
    return undefined;
  };

  const clearCause = () => {
    clearTimeout(causeTimer);
    el.removeAttribute("data-cause");
    cause.hidden = true;
  };

  return {
    el,
    get slug() {
      return entry?.slug;
    },
    get usesWindow() {
      return entry?.visual?.type === "line";
    },
    /** Apply a new entry. Returns true when the content had to be redrawn. */
    update(next) {
      entry = next;
      el.style.setProperty("--x", next.at.x);
      el.style.setProperty("--y", next.at.y);
      el.style.setProperty("--w", next.at.w);
      el.style.setProperty("--h", next.at.h);
      el.dataset.visual = next.visual?.type ?? "none";
      title.textContent = next.title;
      kind.textContent = KIND_LABEL[next.visual?.type] ?? "Panel";
      const nextKey = panelKey(next);
      if (nextKey === key) return false;
      key = nextKey;
      render();
      return true;
    },
    rerender() {
      if (entry) render();
    },
    /** Attribute this panel's arrival or change to the realtime event that caused it. */
    showCause({ seq, kind: change, who }) {
      clearCause();
      void el.offsetWidth; // restart the one-shot arrival animation for a repeated cause
      el.dataset.cause = change;
      causeSeq.textContent = `#${seq}`;
      causeText.textContent = `${change === "added" ? "Added" : "Updated"} by ${who}`;
      cause.hidden = false;
      causeTimer = setTimeout(clearCause, CAUSE_MS);
    },
    destroy() {
      clearCause();
      handle?.destroy();
      menu.destroy();
      el.remove();
    },
  };
}
