/** One panel: a labelled region that owns its chart, menu, table view, states and cause attribution. */
import { mountVisual, buildTable, TYPE_NAMES } from "./charts/index.js";
import { h } from "./dom.js";
import { isoUtc, toMs } from "./format.js";
import { createMenu } from "./menu.js";
import { panelEmpty, panelError, panelLoading } from "./states.js";

/** How long the causing change stays attached to a panel. */
const CAUSE_MS = 6000;

const signatureOf = ({ entry, result, error }) =>
  [entry.node?.revision, result ? (result.result_hash ?? `${result.row_count}:${result.as_of}`) : "", error ? `${error.code}:${error.message}` : ""].join("|");

export const createPanel = ({ slug, onInspect }) => {
  const id = `panel-${slug}`;
  const figure = h("span", { class: "panel__figure" });
  const type = h("span", { class: "panel__kicker-type" });
  const attrib = h("span", { class: "panel__attrib" });
  const stamp = h("span", { class: "panel__stamp" });
  const title = h("h2", { class: "panel__title", id: `${id}-title` });
  const stage = h("div", { class: "panel__stage" });
  const alt = h("div", { class: "panel__alt" });
  const caption = h("footer", { class: "panel__caption" });

  const menu = createMenu({
    label: "Panel actions",
    items: [
      { id: "inspect", label: "Inspect", onSelect: () => onInspect(state, menu.button) },
      { id: "table", label: "View as table", checkbox: true, onSelect: () => setView(el.dataset.view === "table" ? "chart" : "table") },
    ],
  });

  const el = h("section", { class: "panel", "aria-labelledby": `${id}-title`, dataset: { panel: slug, state: "loading", view: "chart" } },
    h("header", { class: "panel__head" },
      h("p", { class: "panel__kicker" }, figure, type, attrib, stamp),
      title,
      menu.el),
    h("div", { class: "panel__body" }, stage, alt),
    caption);

  let state = { entry: null, result: null, error: null };
  let chart = null;
  let signature = "";
  let causeTimer = 0;

  const canTable = () => Boolean(state.result?.rows.length) && state.entry?.visual?.type !== "table";

  const syncMenu = () => {
    menu.update("table", { checked: el.dataset.view === "table", disabled: !canTable() });
  };

  const buildAlt = () => {
    alt.replaceChildren();
    if (el.dataset.view === "table" && canTable()) alt.append(buildTable(state.result, { title: state.entry.title }));
  };

  function setView(view) {
    el.dataset.view = view === "table" && canTable() ? "table" : "chart";
    buildAlt();
    syncMenu();
  }

  const setCaption = () => {
    const { entry, result, error } = state;
    const bits = [];
    const from = entry?.query?.from;
    if (from) bits.push(h("span", { class: "panel__source" }, `Source: ${from.replace(/^source:/, "")}`));
    if (result) {
      bits.push(h("span", null, `${result.row_count} row${result.row_count === 1 ? "" : "s"}`));
      const asOf = toMs(result.as_of);
      if (!Number.isNaN(asOf)) bits.push(h("span", null, `as of ${isoUtc(asOf)} UTC`));
    } else if (error) bits.push(h("span", null, "Query failed"));
    caption.replaceChildren(...bits);
  };

  const render = () => {
    chart?.dispose();
    chart = null;
    stage.replaceChildren();
    const { entry, result, error } = state;
    if (error) { el.dataset.state = "error"; stage.append(panelError(error)); }
    else if (!result) { el.dataset.state = "loading"; stage.append(panelLoading()); }
    else if (result.rows.length === 0) { el.dataset.state = "empty"; stage.append(panelEmpty(entry.query)); }
    else {
      el.dataset.state = "ready";
      try {
        chart = mountVisual(stage, { visual: entry.visual, result, title: entry.title });
      } catch (e) {
        el.dataset.state = "error";
        stage.replaceChildren(panelError({ code: "CHANNEL_MISMATCH", message: e instanceof Error ? e.message : String(e) }));
      }
    }
    if (el.dataset.state !== "ready") el.dataset.view = "chart";
    buildAlt();
    syncMenu();
    setCaption();
  };

  const clearCause = () => {
    el.removeAttribute("data-cause");
    attrib.textContent = "";
    stamp.textContent = "";
  };

  /** Attach the realtime change that caused this panel to appear or change. */
  const markCause = ({ kind, seq, actor }) => {
    clearTimeout(causeTimer);
    clearCause();
    // Re-apply on the next frame so the animation restarts for repeated changes.
    requestAnimationFrame(() => {
      el.dataset.cause = kind;
      attrib.textContent = `${kind === "new" ? "Added" : "Updated"} by ${actor}`;
      stamp.textContent = `#${seq}`;
      causeTimer = setTimeout(clearCause, CAUSE_MS);
    });
  };

  const place = (at) => {
    el.style.setProperty("--x", at.x);
    el.style.setProperty("--y", at.y);
    el.style.setProperty("--w", at.w);
    el.style.setProperty("--h", at.h);
  };

  return {
    el,
    get state() { return state; },
    markCause,
    /** Set the panel definition (title, visual, placement). Result arrives separately. */
    setEntry(entry, { number, cause }) {
      const definitionChanged = !state.entry || state.entry.node?.revision !== entry.node?.revision;
      state = { entry, result: definitionChanged ? null : state.result, error: entry.error ?? (definitionChanged ? null : state.error) };
      place(entry.at);
      title.textContent = entry.title;
      figure.textContent = `Fig. ${number}`;
      type.textContent = ` · ${TYPE_NAMES[entry.visual?.type] ?? "Figure"}`;
      if (cause) markCause(cause);
      if (definitionChanged || entry.error) {
        signature = entry.error ? signatureOf(state) : "";
        render();
      }
    },
    /** Apply a query outcome. Returns "initial" | "changed" | "same". */
    setResult({ result, error }) {
      const hadContent = Boolean(state.result || state.error);
      state = { ...state, result: result ?? null, error: error ?? null };
      const next = signatureOf(state);
      if (next === signature) { setCaption(); return "same"; }
      signature = next;
      render();
      return hadContent ? "changed" : "initial";
    },
    destroy() {
      clearTimeout(causeTimer);
      chart?.dispose();
      menu.close();
      el.remove();
    },
  };
};
