// reporting.board: a whole Dashboard (the Meridian board) as one widget: panels on the 12-column grid with their
// charts, a parameter bar, a brushed time window shared through the page bus, an inspector drawer per panel, and
// the trace ribbon of recent changes. Realtime changes update only what they name, and only a realtime change
// is allowed to animate a panel.
import { h, uid } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { menuButton } from "../../ds/js/menu.js";
import { emptyState } from "../../ds/js/states.js";
import { numberField, switchField, textField } from "../../ds/js/field.js";
import { replaceQuery } from "../../ds/js/tabs.js";
import { schemaOf, catalogEntry } from "../../core/widgets.js";
import { attributeCauses, loadBoard, requery, signature, updateBoard } from "./_board-data.js";
import { actorLabel, kindOf, shortId } from "./_events.js";
import { entryFoot, inspectorBody, renderEntry } from "./_panel-body.js";
import { createTrace } from "./_trace.js";
import { toErrorInfo, keyValues, region, scoped } from "./_common.js";
import { toMs, utcClock, label as colLabel } from "./_format.js";

const CAUSE_MS = 6000;
const RETRY_MS = 3000;
const DEFAULT_DEK = "Figures refresh as changes are committed, and each shows who changed it.";

const rangeOf = (p) => {
  if (!p || p.from === null || p.from === undefined || p.to === null || p.to === undefined) return null;
  const a = toMs(p.from);
  const b = toMs(p.to);
  return Number.isFinite(a) && Number.isFinite(b) ? [Math.min(a, b), Math.max(a, b)] : null;
};

const coerce = (decl, raw) => {
  if (decl.type === "int")
    return Number.isNaN(Number.parseInt(raw, 10)) ? undefined : Number.parseInt(raw, 10);
  if (decl.type === "float") return Number.isNaN(Number.parseFloat(raw)) ? undefined : Number.parseFloat(raw);
  if (decl.type === "bool") return raw === "true";
  return raw;
};

const paramValues = (parameters) => {
  const q = new URLSearchParams(location.search);
  const out = {};
  for (const [name, decl] of Object.entries(parameters ?? {})) {
    const raw = q.get(`p.${name}`);
    const v = raw !== null ? coerce(decl, raw) : decl.default;
    if (v !== undefined) out[name] = v;
  }
  return out;
};

const cellText = (v) =>
  v === null || v === undefined ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v);

export default {
  id: "reporting.board",
  domain: "reporting",
  title: "Board",
  configSchema: schemaOf("reporting.board"),
  sizes: catalogEntry("reporting.board")?.sizes ?? [],
  mount(el, { config, api, rt, bus, ctx }) {
    const slug = config.dashboard;
    let board;
    let alive = true;
    const panels = new Map();
    const pending = [];
    let inflight = false;
    let again = false;
    let fullNext = false;
    let requeryNext = false;
    let retryTimer = 0;
    const seen = new Map();
    let win = rangeOf(bus.latest?.("date.selected"));
    let filter = null;
    let selected = null;
    let published = null;
    let openInspector = null;

    const titles = () => {
      const m = new Map();
      if (board) {
        m.set(board.dashboard.uri, board.title);
        for (const p of board.panels) if (p.node) m.set(p.node.uri, p.title);
      }
      return m;
    };
    const titleOf = (uri) => titles().get(uri) ?? shortId(uri);
    const trace = createTrace({ titleOf });

    // ---- frame ----
    const dek = h("p", { class: "rp-board__dek" }, DEFAULT_DEK);
    const meta = h("dl", { class: "rp-board__meta" });
    const paramsBar = h("form", {
      class: "rp-board__params",
      "aria-label": "Board parameters and session state",
      hidden: true,
      onsubmit: (e) => e.preventDefault(),
    });
    const grid = h("section", { class: "rp-board__grid", "aria-label": "Panels", "aria-busy": "true" });
    const stage = region("rp-board__stage");
    stage.show(grid);
    const root = h(
      "div",
      { class: "rp-board" },
      h("div", { class: "rp-board__head" }, dek, meta),
      paramsBar,
      stage.el,
      trace.el,
    );
    el.append(root);
    grid.append(
      ...[0, 1, 2, 3].map(() => h("div", { class: "rp-panel rp-panel--skeleton", "aria-hidden": "true" })),
    );

    // ---- shared state through the page bus ----
    const publishWindow = (range) => {
      bus.publish(
        "date.selected",
        range
          ? { from: new Date(range[0]).toISOString(), to: new Date(range[1]).toISOString() }
          : { from: null, to: null },
      );
      trace.session(range ? `brush window ${utcClock(range[0])} to ${utcClock(range[1])}` : "clear window");
    };
    const publishFilter = (payload) => {
      selected = payload.value;
      filter = payload.value === null ? null : payload;
      published = payload;
      bus.publish("filter.changed", payload);
      published = null;
      trace.session(payload.value === null ? "clear filter" : `filter ${payload.key} = ${payload.value}`);
      repaintPanels();
      renderParams();
    };
    const offs = [
      bus.subscribe("date.selected", (p) => {
        win = rangeOf(p);
        repaintPanels();
        renderParams();
      }),
      bus.subscribe("filter.changed", (p) => {
        if (p === published) return;
        selected = null;
        filter = p && p.value !== null && p.value !== undefined ? p : null;
        repaintPanels();
        renderParams();
      }),
    ];

    // ---- one panel ----
    const createPanel = (entry) => {
      const titleId = uid("panel-title");
      const state = { entry, showTable: false, table: { sort: null, page: 0, q: "" }, dispose: () => {} };
      const titleEl = h("h3", { class: "rp-panel__title", id: titleId });
      const indexEl = h("span", { class: "rp-panel__index", "aria-hidden": "true" });
      const causeEl = h("p", { class: "rp-panel__cause", hidden: true });
      const headActions = h("div", { class: "rp-panel__actions" });
      const body = h("div", { class: "rp-panel__body" });
      const foot = h("div", { class: "rp-panel__foot" });
      const elPanel = h(
        "section",
        { class: "rp-panel", "aria-labelledby": titleId, "data-slug": entry.slug },
        causeEl,
        h("header", { class: "rp-panel__head" }, indexEl, titleEl, headActions),
        body,
        foot,
      );
      let causeTimer = 0;

      const openRow = (row) =>
        ctx.openDrawer({
          title: "Row detail",
          width: "sm",
          body: () => keyValues(Object.entries(row).map(([k, v]) => [colLabel(k), cellText(v)])),
        });

      const paint = () => {
        const e = state.entry;
        state.dispose();
        state.dispose = () => {};
        titleEl.textContent = e.title;
        elPanel.dataset.visual = e.visual?.type ?? "none";
        const type = e.visual?.type;
        const built = renderEntry(e, {
          showTable: state.showTable,
          window: win,
          filter,
          tableState: state.table,
          selected,
          onBrush: type === "line" && e.visual.options?.brush !== false ? publishWindow : undefined,
          onSelect: type === "bar" ? publishFilter : undefined,
          onRow: openRow,
        });
        state.dispose = built.dispose;
        elPanel.dataset.state = built.state;
        body.replaceChildren(built.el);
        foot.replaceChildren(entryFoot(e) ?? "");
        if (built.minRem) elPanel.style.setProperty("--w-reporting-need", `${built.minRem}rem`);
        else elPanel.style.removeProperty("--w-reporting-need");

        const items = [
          {
            label: "Inspect",
            icon: "sliders",
            onSelect: () => openInspectorFor(e.slug),
          },
        ];
        const kids = [];
        if (built.chartable) {
          items.push({
            label: state.showTable ? "View as chart" : "View as table",
            icon: state.showTable ? "chart" : "list",
            onSelect: () => {
              state.showTable = !state.showTable;
              paint();
            },
          });
          kids.push(
            button({
              label: `Table view of ${e.title}`,
              icon: "list",
              size: "sm",
              variant: "ghost",
              iconOnly: true,
              pressed: state.showTable,
              onClick: () => {
                state.showTable = !state.showTable;
                paint();
              },
            }),
          );
        }
        kids.push(
          menuButton({
            label: `Actions for ${e.title}`,
            icon: "more",
            iconOnly: true,
            variant: "ghost",
            size: "sm",
            items,
          }),
        );
        headActions.replaceChildren(...kids);
      };

      paint();
      return {
        el: elPanel,
        setIndex: (n) => {
          indexEl.textContent = String(n).padStart(2, "0");
        },
        update(next) {
          state.entry = next;
          paint();
        },
        repaint: paint,
        showCause({ event, isNew }) {
          clearTimeout(causeTimer);
          causeEl.replaceChildren(
            h(
              "span",
              { class: "rp-panel__cause-what" },
              `${isNew ? "Added" : "Changed"} by ${actorLabel(event.actor)}`,
            ),
            ...[event.surface ? h("span", { class: "rp-panel__cause-via" }, event.surface) : null].filter(
              Boolean,
            ),
            h("span", { class: "rp-panel__cause-seq" }, `seq ${event.seq}`),
          );
          causeEl.hidden = false;
          elPanel.classList.add("u-arrive");
          causeTimer = setTimeout(() => this.clearCause(), CAUSE_MS);
        },
        clearCause() {
          causeEl.hidden = true;
          elPanel.classList.remove("u-arrive");
        },
        destroy() {
          clearTimeout(causeTimer);
          state.dispose();
        },
      };
    };

    const repaintPanels = () => {
      for (const p of panels.values()) p.repaint();
    };

    // ---- inspector drawer, kept current while open ----
    function openInspectorFor(panelSlug) {
      const entry = board?.panels.find((p) => p.slug === panelSlug);
      if (!entry) return;
      const holder = h("div", {}, inspectorBody(entry));
      const handle = ctx.openDrawer({
        title: `Inspector: ${entry.title}`,
        width: "md",
        body: scoped("reporting", holder),
        onClose: () => {
          if (openInspector?.holder === holder) openInspector = null;
        },
      });
      openInspector = { slug: panelSlug, holder, handle };
    }
    const refreshInspector = (entry) => {
      if (openInspector?.slug === entry.slug) openInspector.holder.replaceChildren(inspectorBody(entry));
    };

    // ---- header parts ----
    const renderParams = () => {
      const decls = Object.entries(board?.parameters ?? {});
      paramsBar.replaceChildren();
      paramsBar.hidden = decls.length === 0 && !win && !filter;
      const q = new URLSearchParams(location.search);
      for (const [name, decl] of decls) {
        const current = q.get(`p.${name}`) ?? (decl.default === undefined ? "" : String(decl.default));
        const apply = (v) => {
          const text = typeof v === "boolean" ? String(v) : v === null || v === undefined ? "" : String(v);
          replaceQuery(`p.${name}`, text === "" || text === String(decl.default ?? "") ? null : text);
          trace.session(`parameter ${name} = ${text === "" ? "default" : text}`);
          requeryNext = true;
          refresh();
        };
        const common = { name, label: colLabel(name) };
        paramsBar.append(
          h(
            "div",
            { class: "rp-param" },
            decl.type === "bool"
              ? switchField({ ...common, value: current === "true", onChange: apply })
              : decl.type === "int" || decl.type === "float"
                ? numberField({
                    ...common,
                    value: current === "" ? null : Number(current),
                    step: decl.type === "float" ? "any" : 1,
                    onChange: apply,
                  })
                : textField({ ...common, value: current, onChange: apply }),
          ),
        );
      }
      if (win) {
        paramsBar.append(
          h(
            "p",
            { class: "rp-param rp-param--note" },
            h("span", {}, `Window ${utcClock(win[0])} to ${utcClock(win[1])}`),
            button({
              label: "Clear window",
              variant: "secondary",
              size: "sm",
              onClick: () => publishWindow(null),
            }),
          ),
        );
      }
      if (filter) {
        paramsBar.append(
          h(
            "p",
            { class: "rp-param rp-param--note" },
            h("span", {}, `Filter ${colLabel(filter.key)}: ${filter.value}`),
            button({
              label: "Clear filter",
              variant: "secondary",
              size: "sm",
              onClick: () => publishFilter({ key: filter.key, value: null }),
            }),
          ),
        );
      }
    };

    const renderMeta = () => {
      const cell = (t, d) => h("div", {}, h("dt", {}, t), h("dd", {}, d));
      meta.replaceChildren(
        cell("Revision", String(board.dashboard.revision)),
        cell("Panels", String(board.panels.length)),
        cell("Columns", String(board.columns)),
      );
    };

    // ---- reconciling ----
    const place = (entry, panel) => {
      panel.el.style.setProperty("--x", entry.at.x + 1);
      panel.el.style.setProperty("--y", entry.at.y + 1);
      panel.el.style.setProperty("--w", entry.at.w);
      panel.el.style.setProperty("--h", entry.at.h);
    };

    const apply = (nextBoard, events) => {
      const first = board === undefined;
      const causes = attributeCauses(board, nextBoard, events, seen);
      const prevSig = new Map((board?.panels ?? []).map((p) => [p.slug, signature(p)]));
      board = nextBoard;
      if (first) grid.replaceChildren();
      grid.removeAttribute("aria-busy");
      grid.style.setProperty("--w-reporting-cols", nextBoard.columns);
      ctx.setTitle(nextBoard.title);
      ctx.setCount(nextBoard.panels.length);

      const live = new Set(nextBoard.panels.map((p) => p.slug));
      for (const [key, panel] of panels) {
        if (live.has(key)) continue;
        panel.destroy();
        panel.el.remove();
        panels.delete(key);
      }
      for (const entry of nextBoard.panels) {
        let panel = panels.get(entry.slug);
        if (!panel) {
          panel = createPanel(entry);
          panels.set(entry.slug, panel);
          grid.append(panel.el);
        } else if (prevSig.get(entry.slug) !== signature(entry)) {
          panel.update(entry);
          refreshInspector(entry);
        }
        place(entry, panel);
      }
      const wanted = nextBoard.panels.map((p) => panels.get(p.slug).el);
      const current = [...grid.children].filter((n) => n.classList.contains("rp-panel"));
      if (wanted.some((n, i) => current[i] !== n)) grid.append(...wanted);
      nextBoard.panels.forEach((p, i) => panels.get(p.slug).setIndex(i + 1));

      grid.querySelector(".rp-board__empty")?.remove();
      if (nextBoard.panels.length === 0)
        grid.prepend(
          h(
            "div",
            { class: "rp-board__empty" },
            emptyState({
              icon: "board",
              title: "This board has no panels yet",
              body: "An agent can add panels over MCP. They appear here as they are created, each attributed to the change that caused it.",
            }),
          ),
        );

      renderMeta();
      renderParams();
      trace.retitle();

      const notes = [];
      for (const [key, cause] of causes) {
        panels.get(key)?.showCause(cause);
        const p = nextBoard.panels.find((q) => q.slug === key);
        notes.push(
          `${cause.isNew ? "Panel added" : "Panel changed"}: ${p.title}, change ${cause.event.seq}.`,
        );
      }
      if (notes.length > 0) ctx.announce(notes.join(" "));
    };

    // ---- loading ----
    const showFailure = (err) => stage.error(toErrorInfo(err), () => location.reload());

    /** One coalescing loop: events update what they name; a resume, a gap or a failure reloads. */
    async function refresh() {
      if (inflight) {
        again = true;
        return;
      }
      inflight = true;
      try {
        do {
          again = false;
          clearTimeout(retryTimer);
          const events = pending.splice(0);
          let nextBoard;
          if (!board) {
            nextBoard = await loadBoard(api, slug, {});
            if (nextBoard && Object.keys(nextBoard.parameters).length > 0)
              nextBoard = await loadBoard(api, slug, paramValues(nextBoard.parameters));
            if (!nextBoard) {
              ctx.setState("unavailable", { reason: "missing" });
              return;
            }
          } else {
            const values = paramValues(board.parameters);
            if (fullNext) {
              fullNext = false;
              nextBoard = await loadBoard(api, slug, values);
            } else if (events.length > 0) {
              nextBoard = await updateBoard(api, board, events, slug, values);
            } else {
              nextBoard = board;
            }
            if (nextBoard && requeryNext) {
              requeryNext = false;
              nextBoard = await requery(api, nextBoard, slug, values);
            }
            if (!nextBoard) continue;
          }
          if (!alive) return;
          apply(nextBoard, events);
        } while (again && alive);
      } catch (err) {
        if (!board) showFailure(err);
        else {
          fullNext = true;
          retryTimer = setTimeout(refresh, RETRY_MS);
        }
      } finally {
        inflight = false;
      }
    }

    // ---- realtime ----
    offs.push(
      rt.onChange(
        (c) => c.kind !== "present",
        (e) => {
          trace.push([e]);
          seen.set(e.node, e);
          dek.textContent = `Latest change #${e.seq} by ${actorLabel(e.actor)}${e.on_behalf_of ? ` for ${actorLabel(e.on_behalf_of)}` : ""}: ${e.ops_summary}`;
          trace.setHead(e.seq);
          const relevant = board && !(kindOf(e.node) === "Dashboard" && e.node !== board.dashboard.uri);
          if (!relevant) return;
          pending.push(e);
          refresh();
        },
      ),
    );

    // Backfill the trace from the kernel history, flagged so nothing animates.
    api.nodes
      .history({ limit: 8 })
      .then((items) => {
        if (!alive || !Array.isArray(items)) return;
        const rows = items.map((i) => ({
          seq: i.seq,
          node: i.node_uri,
          actor: i.actor,
          on_behalf_of: i.on_behalf_of,
          surface: i.surface,
          rule_id: i.rule_id ?? [],
          ops_summary: i.ops_summary,
        }));
        trace.push(rows, { backfill: true });
        if (rows.length > 0) trace.setHead(Math.max(...rows.map((r) => r.seq)));
        trace.retitle();
      })
      .catch(() => {});

    refresh();
    return () => {
      alive = false;
      clearTimeout(retryTimer);
      for (const p of panels.values()) p.destroy();
      for (const off of offs) off();
    };
  },
};
