import { hydrate, loadStructure } from "./board.js";
import { attributeCauses } from "./causes.js";
import { h, icon } from "./dom.js";
import { plural } from "./format.js";
import { href } from "./identity.js";
import { createPanel } from "./panel.js";

const REFRESH_DELAY = 120;

const byReadingOrder = (a, b) => a.at.y - b.at.y || a.at.x - b.at.x;

/**
 * The dashboard screen. Loads the structure first (panels appear in their loading state), then runs
 * each query. Realtime events trigger one coalesced refetch; panels whose data changed get a cause.
 */
export const createBoardView = ({ root, slug, announce, onTitles, onInspect, setHeading }) => {
  const panels = new Map();
  let structure;
  let entries = [];
  let pending = [];
  let timer = 0;
  let running = false;

  const bar = h("div", { class: "board-bar" });
  const grid = h("div", { class: "grid", "data-grid": "" });
  const empty = h(
    "div",
    { class: "empty-board", hidden: true },
    icon("grid"),
    h("h2", null, "This board has no panels yet"),
    h("p", null, "Panels added by an agent or a teammate appear here the moment they are committed."),
  );
  root.replaceChildren(h("div", { class: "board" }, bar, grid, empty));

  const notFound = () => {
    setHeading("Board not found", null);
    root.replaceChildren(
      h(
        "div",
        { class: "state-page" },
        icon("alert"),
        h("h2", null, "Unknown board"),
        h("p", null, h("code", null, slug), " does not exist, or you do not have access to it."),
        h("a", { class: "btn", href: href() }, "Back to all boards"),
      ),
    );
  };

  const paintBar = () => {
    const params = Object.entries(structure.params);
    bar.replaceChildren(
      h("p", { class: "board-meta" }, h("span", null, h("span", { class: "meta-k" }, "Board"), h("code", null, slug)), h("span", null, h("span", { class: "meta-k" }, "Revision"), `r${structure.dashboard.revision}`), h("span", null, h("span", { class: "meta-k" }, "Panels"), String(structure.panels.length))),
      params.length ? h("p", { class: "board-params" }, params.map(([k, v]) => h("span", { class: "param" }, h("span", { class: "meta-k" }, k), String(v)))) : null,
    );
    empty.hidden = structure.panels.length > 0;
  };

  const order = () => {
    const wanted = [...panels.values()].sort((a, b) => byReadingOrder(a.entry, b.entry)).map((p) => p.el);
    const now = [...grid.children];
    if (wanted.length === now.length && wanted.every((n, i) => n === now[i])) return;
    grid.append(...wanted);
  };

  /** Apply a fresh set of entries. `causes` is empty on first paint, so nothing animates then. */
  const reconcile = (next, causes) => {
    const seen = new Set();
    for (const e of next) {
      seen.add(e.slug);
      const cause = causes.get(e.slug);
      const existing = panels.get(e.slug);
      if (existing) existing.update(e, cause);
      else {
        const p = createPanel(e, { onInspect });
        panels.set(e.slug, p);
        grid.append(p.el);
        if (cause) p.update(e, cause);
      }
    }
    for (const [key, p] of panels)
      if (!seen.has(key)) {
        announce(`Panel ${p.entry.title} removed`);
        p.destroy();
        panels.delete(key);
      }
    order();
  };

  const load = async () => {
    try {
      structure = await loadStructure(slug);
    } catch (e) {
      structure = undefined;
      root.replaceChildren(h("div", { class: "state-page" }, icon("alert"), h("h2", null, "Could not load the board"), h("p", null, String(e.message ?? e))));
      return;
    }
    if (!structure) return notFound();
    setHeading(structure.title, structure.dashboard);
    onTitles(structure.nodes);
    paintBar();
    entries = structure.panels;
    reconcile(entries, new Map());
    // Queries run in parallel; each panel resolves on its own.
    entries = await Promise.all(
      entries.map(async (e) => {
        const done = await hydrate(e, structure.params);
        panels.get(e.slug)?.update(done);
        return done;
      }),
    );
  };

  const refresh = async () => {
    if (running || !structure) return;
    running = true;
    const events = pending;
    pending = [];
    try {
      const fresh = await loadStructure(slug);
      if (!fresh) return notFound();
      const next = await Promise.all(fresh.panels.map((e) => hydrate(e, fresh.params)));
      // Keep the previous result when a refetch fails transiently, rather than flashing an error.
      const merged = next.map((e) => (e.error?.code === "UNREACHABLE" ? entries.find((o) => o.slug === e.slug) ?? e : e));
      const causes = attributeCauses(entries, merged, events);
      structure = fresh;
      setHeading(fresh.title, fresh.dashboard);
      onTitles(fresh.nodes);
      paintBar();
      reconcile(merged, causes);
      for (const [key, cause] of causes) {
        const title = panels.get(key)?.entry.title ?? key;
        announce(`Panel ${title} ${cause.verb} by ${cause.actor}, seq ${cause.seq}. ${plural(fresh.panels.length, "panel")} on the board.`);
      }
      entries = merged;
    } finally {
      running = false;
      if (pending.length) schedule();
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, REFRESH_DELAY);
  };

  return {
    start: load,
    onEvents(events) {
      const relevant = events.filter((e) => !e.backfill && e.kind !== "present");
      if (!relevant.length) return;
      pending.push(...relevant);
      schedule();
    },
    /** After a reconnect the socket resumes; refetch once so nothing is stale. */
    resync: () => structure && schedule(),
  };
};
