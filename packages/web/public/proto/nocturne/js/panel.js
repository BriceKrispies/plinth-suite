import { buildTable, buildVisual, VISUAL_LABEL } from "./charts/visuals.js";
import { CAUSE_MS } from "./causes.js";
import { h, icon, uid } from "./dom.js";
import { plural, stamp } from "./format.js";
import { summarizeQuery } from "./board.js";
import { createMenu } from "./menu.js";

const signature = (e) => `${e.state}|${e.node?.revision}|${e.result?.result_hash}|${e.error?.code}|${e.error?.message}`;

/**
 * One panel: a persistent shell (heading, menu, footer) around a body that is rebuilt only when the
 * panel's data, definition or state actually changed. Focus and view mode survive live updates.
 */
export const createPanel = (entry, { onInspect }) => {
  const id = uid("panel");
  const titleId = `${id}-title`;
  let current = entry;
  let mode = "chart"; // "chart" | "table"
  let teardown = null;
  let causeTimer = 0;
  let lastSig = "";

  const title = h("h2", { class: "panel-title", id: titleId }, entry.title);
  const kindTag = h("span", { class: "panel-kind" });
  const viewToggle = h("button", { type: "button", class: "btn btn-quiet btn-sm view-toggle", "aria-pressed": "false", onclick: () => toggleTable() }, icon("table"), h("span", null, "View as table"));
  const menu = createMenu({
    label: `Actions for ${entry.title}`,
    items: () => [
      { icon: "inspect", label: "Inspect", run: () => onInspect(current, menu.button) },
      ...(canToggle() ? [{ icon: mode === "table" ? "chart" : "table", label: mode === "table" ? "View as chart" : "View as table", run: () => toggleTable() }] : []),
    ],
  });
  const body = h("div", { class: "panel-body" });
  const foot = h("p", { class: "panel-foot" });
  const cause = h("p", { class: "cause", "aria-hidden": "true" });
  const el = h(
    "section",
    { class: "panel", "aria-labelledby": titleId, "data-state": "loading", "data-visual": entry.visual?.type ?? "none" },
    h("header", { class: "panel-head" }, h("div", { class: "panel-heading" }, kindTag, title), viewToggle, menu.el),
    body,
    foot,
    cause,
  );

  const canToggle = () => current.state === "ready" && current.visual?.type !== "table" && current.result?.rows.length > 0;

  const place = (at) => {
    el.style.setProperty("--x", at.x);
    el.style.setProperty("--y", at.y);
    el.style.setProperty("--w", at.w);
    el.style.setProperty("--h", at.h);
    el.style.setProperty("--w6", Math.max(2, Math.ceil(at.w / 2)));
  };

  const state = (name) => {
    el.dataset.state = name;
    el.setAttribute("aria-busy", String(name === "loading"));
  };

  const message = (tone, heading, text, detail) =>
    h("div", { class: "state", "data-tone": tone }, icon(tone === "bad" ? "alert" : tone === "empty" ? "inbox" : "pulse"), h("p", { class: "state-title" }, heading), h("p", { class: "state-text" }, text), detail ? h("p", { class: "state-detail" }, detail) : null);

  const paint = () => {
    teardown?.();
    teardown = null;
    body.replaceChildren();
    const e = current;
    state(e.state);
    kindTag.textContent = e.visual ? VISUAL_LABEL[e.visual.type] ?? e.visual.type : "Panel";
    viewToggle.hidden = !canToggle();
    if (e.state === "loading") {
      body.append(h("div", { class: "skeleton", "aria-hidden": "true" }, h("i"), h("i"), h("i")), h("p", { class: "vh" }, "Loading"));
      foot.textContent = "Running query…";
      return;
    }
    if (e.state === "error") {
      body.append(h("div", { class: "state", "data-tone": "bad", role: "group" }, icon("alert"), h("p", { class: "state-title" }, h("code", null, e.error.code)), h("p", { class: "state-text" }, e.error.message), e.error.fix_hint ? h("p", { class: "state-detail" }, e.error.fix_hint) : null));
      foot.textContent = "Query failed";
      return;
    }
    const { result } = e;
    foot.textContent = `As of ${stamp(result.as_of)} · ${plural(result.row_count ?? result.rows.length, "row")}`;
    if (result.rows.length === 0) {
      body.append(message("empty", "No rows for this query", summarizeQuery(e.query)));
      return;
    }
    try {
      const built = mode === "table" ? { el: buildTable({ ...e, titleId }), destroy() {} } : buildVisual({ ...e, titleId });
      teardown = built.destroy;
      body.append(built.el);
    } catch (err) {
      body.append(message("bad", err.code ?? "RENDER_ERROR", err.message));
    }
  };

  const toggleTable = () => {
    mode = mode === "table" ? "chart" : "table";
    viewToggle.setAttribute("aria-pressed", String(mode === "table"));
    viewToggle.lastChild.textContent = mode === "table" ? "View as chart" : "View as table";
    el.dataset.mode = mode;
    paint();
  };

  const showCause = (info) => {
    cause.replaceChildren(icon("pulse"), h("span", null, `${info.verb === "added" ? "Added" : "Updated"} · seq ${info.seq}`), h("span", { class: "cause-actor" }, info.actor));
    el.removeAttribute("data-cause");
    void el.offsetWidth; // restart the keyframes when a second change lands inside the window
    el.dataset.cause = info.verb;
    clearTimeout(causeTimer);
    causeTimer = setTimeout(() => el.removeAttribute("data-cause"), CAUSE_MS);
  };

  const update = (next, causeInfo) => {
    const prevTitle = current.title;
    current = next;
    place(next.at);
    el.dataset.visual = next.visual?.type ?? "none";
    if (next.title !== prevTitle) title.textContent = next.title;
    const sig = signature(next);
    if (sig !== lastSig) {
      lastSig = sig;
      if (mode === "table" && !canToggle()) mode = "chart";
      paint();
    }
    if (causeInfo) showCause(causeInfo);
  };

  update(entry);
  return {
    el,
    slug: entry.slug,
    get entry() {
      return current;
    },
    update,
    destroy() {
      teardown?.();
      clearTimeout(causeTimer);
      el.remove();
    },
  };
};
