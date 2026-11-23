/** The dashboard view: loads the board, reconciles panels by slug, and attributes live changes. */
import { loadLayout, runPanel } from "./board.js";
import { announce, h } from "./dom.js";
import { localClock } from "./format.js";
import { hrefFor } from "./identity.js";
import { createPanel } from "./panel.js";
import { notice } from "./states.js";

const sortReading = (entries) => [...entries].sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x);

const causeFrom = (events, uris) => {
  const pick = (list) => list.reduce((a, b) => (b.seq > a.seq ? b : a));
  const own = events.filter((e) => uris.includes(e.node));
  const event = pick(own.length ? own : events);
  return { seq: event.seq, actor: event.actor, ops: event.ops_summary };
};

export const mountBoard = ({ root, slug, titles, trace, inspector, masthead }) => {
  const dek = h("p", { class: "page-dek" }, "Figures refresh as changes are committed, and each shows who changed it.");
  const heading = h("h1", { class: "page-title" }, " ");
  const dd = { revision: h("dd", null, "—"), figures: h("dd", null, "—"), latest: h("dd", null, "—") };
  const banner = h("p", { class: "banner", hidden: true }, h("strong", null, "Connection lost."), h("span", null, " Figures may be out of date. Reconnecting and resuming from the last change seen."));
  const grid = h("div", { class: "board" });
  const wrap = h("div", { class: "board-wrap" }, grid);
  const slot = h("div", { class: "board-view__slot" });

  root.replaceChildren(
    h("header", { class: "page-head" },
      h("div", { class: "page-head__main" }, h("p", { class: "eyebrow" }, "Live dashboard"), heading, dek),
      h("dl", { class: "dateline" },
        h("div", null, h("dt", null, "Revision"), dd.revision),
        h("div", null, h("dt", null, "Figures"), dd.figures),
        h("div", null, h("dt", null, "Latest change"), dd.latest))),
    banner, slot, wrap);

  const views = new Map();
  let layout = null;
  let first = true;
  let busy = false;
  let queued = null;
  let disposed = false;

  const showNotice = (spec) => {
    wrap.hidden = true;
    slot.replaceChildren(notice(spec));
  };
  const clearNotice = () => { slot.replaceChildren(); wrap.hidden = false; };

  const onInspect = (view, opener) => inspector.open(view, opener);

  const reconcile = (next, events) => {
    layout = next;
    titles.set(next.dashboard.uri, next.title);
    for (const entry of next.entries) if (entry.node) titles.set(entry.node.uri, entry.title);
    heading.textContent = next.title;
    document.title = `${next.title} · Plinth`;
    masthead.setCrumb([{ label: "Dashboards", href: hrefFor() }, next.title]);
    grid.style.setProperty("--cols", next.columns);
    dd.revision.textContent = String(next.dashboard.revision);
    dd.figures.textContent = String(next.entries.length);

    const ordered = sortReading(next.entries);
    const seen = new Set();
    const announced = [];
    ordered.forEach((entry, i) => {
      let view = views.get(entry.slug);
      const isNew = !view;
      if (isNew) { view = createPanel({ slug: entry.slug, onInspect }); views.set(entry.slug, view); }
      seen.add(entry.slug);
      const changed = isNew || view.state.entry.node?.revision !== entry.node?.revision;
      let cause = null;
      if (!first && events.length && changed) {
        cause = { kind: isNew ? "new" : "updated", ...causeFrom(events, [entry.node?.uri, next.dashboard.uri]) };
        announced.push(`${isNew ? "Panel added" : "Panel changed"}: ${entry.title}, by ${cause.actor}, change ${cause.seq}.`);
        trace.link(cause.seq);
      }
      view.setEntry(entry, { number: i + 1, cause });
    });
    for (const [key, view] of views) {
      if (seen.has(key)) continue;
      view.destroy();
      views.delete(key);
      if (!first) announced.push("A panel was removed.");
    }
    ordered.forEach((entry, i) => {
      const el = views.get(entry.slug).el;
      if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] ?? null);
    });
    if (announced.length) announce(announced.join(" "));

    if (ordered.length === 0) {
      showNotice({ title: "This board has no panels yet", body: "An agent can add panels over MCP. They will appear here the moment they are committed, each attributed to the change that made it." });
    } else clearNotice();
    trace.relabel();
  };

  const refresh = async (events = []) => {
    if (busy) { queued = [...(queued ?? []), ...events]; return; }
    busy = true;
    try {
      let next;
      try {
        next = await loadLayout(slug);
      } catch (e) {
        if (first) {
          showNotice({ title: "The Plinth service cannot be reached", body: `${e.info?.message ?? e.message}. The page will keep trying; you can also retry now.`, action: { label: "Retry", onClick: () => refresh() } });
        }
        return;
      }
      if (disposed) return;
      if (!next) {
        for (const view of views.values()) view.destroy();
        views.clear();
        masthead.setCrumb([{ label: "Dashboards", href: hrefFor() }, slug]);
        heading.textContent = "Unknown dashboard";
        document.title = "Unknown dashboard · Plinth";
        showNotice({ title: `There is no dashboard called “${slug}”`, body: "It may have been renamed or removed, or you may not have access to it with this identity.", action: { label: "See all dashboards", href: hrefFor() } });
        first = false;
        return;
      }
      reconcile(next, events);
      const wasFirst = first;
      first = false;
      await Promise.all(next.entries.map(async (entry) => {
        const view = views.get(entry.slug);
        const outcome = await runPanel(entry, next.params);
        if (disposed || views.get(entry.slug) !== view) return;
        const status = view.setResult(outcome);
        if (status === "changed" && !wasFirst && events.length) {
          const cause = { kind: "updated", ...causeFrom(events, [entry.node?.uri, next.dashboard.uri]) };
          view.markCause(cause);
          trace.link(cause.seq);
          announce(`Panel updated: ${entry.title}, by ${cause.actor}, change ${cause.seq}.`);
        }
      }));
    } finally {
      busy = false;
      if (queued && !disposed) { const q = queued; queued = null; refresh(q); }
    }
  };

  refresh();

  return {
    /** Remember the newest change for the dateline and the dek. */
    noteEvent(event) {
      dd.latest.textContent = `#${event.seq}`;
      dek.textContent = `Latest change #${event.seq} by ${event.actor}: ${event.ops_summary}`;
    },
    onEvents(items, { backfill, gap }) {
      if (backfill) return;
      const pending = items.filter((e) => e.kind !== "present");
      if (!pending.length && !gap) return;
      refresh(pending);
    },
    setConn(state, through) {
      const offline = state === "offline";
      banner.hidden = !offline;
      if (offline) {
        grid.dataset.stale = "";
        banner.querySelector("span").textContent = ` Figures may be out of date. Reconnecting and resuming from change ${through === undefined ? "the last seen" : `#${through}`}.`;
      } else delete grid.dataset.stale;
    },
    dispose() { disposed = true; for (const v of views.values()) v.destroy(); },
  };
};
