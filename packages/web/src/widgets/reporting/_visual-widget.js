// The shared mini-app behind reporting.table, bar, line, area, heatmap, scatter, kpi and reporting.panel:
// runs one query, shows it as a chart, a table or an inspector, reacts to source changes and to the page bus
// (date.selected, filter.changed) and publishes its own selections.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { popover } from "../../ds/js/popover.js";
import { dateTimeField } from "../../ds/js/field.js";
import { catalogEntry, schemaOf } from "../../core/widgets.js";
import {
  debounce,
  isoToLocalInput,
  keyValues,
  latest,
  localInputToIso,
  region,
  scoped,
  toErrorInfo,
} from "./_common.js";
import { entryFoot, inspectorBody, renderEntry } from "./_panel-body.js";
import { label as colLabel, toMs, utcClock } from "./_format.js";

const VIEW_LABEL = { chart: "Chart", table: "Table", inspector: "Inspect" };
const VIEW_ICON = { chart: "chart", table: "list", inspector: "sliders" };
const ARRIVE_MS = 6000;

const rangeOf = (p) => {
  if (!p || p.from === null || p.from === undefined || p.to === null || p.to === undefined) return null;
  const a = toMs(p.from);
  const b = toMs(p.to);
  return Number.isFinite(a) && Number.isFinite(b) ? [Math.min(a, b), Math.max(a, b)] : null;
};

const cellText = (v) =>
  v === null || v === undefined ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v);

/**
 * Mount the visual mini-app. `source.load(env)` resolves to `{ title?, query, visual, node?, dashboard?, params?,
 * error? }`; `source.watch?(env, reload, offs)` may subscribe to the definition's own node and push its unsubscribe
 * functions into `offs`.
 */
export const mountVisual = (el, env, source) => {
  const { size, api, rt, bus, ctx } = env;
  const compact = size === "s" || size === "m";
  const st = {
    entry: null,
    view: "chart",
    window: rangeOf(bus.latest?.("date.selected")),
    filter: null,
    selected: null,
    table: { sort: null, page: 0, q: "" },
  };
  const initialFilter = bus.latest?.("filter.changed");
  if (initialFilter && initialFilter.value !== null && initialFilter.value !== undefined)
    st.filter = initialFilter;
  const next = latest();
  let disposeBody = () => {};
  let published = null;
  let arriveTimer = 0;
  let alive = true;
  let hidden = false;

  const stage = region("rp-visual__stage");
  const chips = h("div", { class: "rp-chips", hidden: true });
  const toolbarHost = h("div", { class: "rp-visual__bar" });
  const root = h("div", { class: `rp-visual rp-visual--${size}` }, toolbarHost, chips, stage.el);
  el.append(root);

  const isTableVisual = () => st.entry?.visual?.type === "table";
  const views = () => (isTableVisual() ? ["table", "inspector"] : ["chart", "table", "inspector"]);
  const currentView = () => {
    if (isTableVisual() && st.view === "chart") return "table";
    return views().includes(st.view) ? st.view : views()[0];
  };

  // ---- the page bus ----
  const publishFilter = (payload) => {
    st.selected = payload.value;
    published = payload;
    bus.publish("filter.changed", payload);
    published = null;
    paint();
  };
  const publishWindow = (range) => {
    bus.publish(
      "date.selected",
      range
        ? { from: new Date(range[0]).toISOString(), to: new Date(range[1]).toISOString() }
        : { from: null, to: null },
    );
  };
  const offs = [
    bus.subscribe("date.selected", (p) => {
      st.window = rangeOf(p);
      paint();
    }),
    bus.subscribe("filter.changed", (p) => {
      if (p === published) return;
      st.selected = null;
      st.filter = p && p.value !== null && p.value !== undefined ? p : null;
      paint();
    }),
  ];

  // ---- toolbar ----
  const openWindowPopover = (anchor) => {
    const iso = (ms) => (ms === undefined ? "" : isoToLocalInput(new Date(ms).toISOString()));
    const fromField = dateTimeField({ name: "from", label: "From", value: iso(st.window?.[0]) });
    const toField = dateTimeField({ name: "to", label: "To", value: iso(st.window?.[1]) });
    const error = h("p", { class: "rp-form__error", role: "alert", hidden: true });
    let pop;
    const form = h(
      "form",
      {
        class: "rp-form rp-form--popover",
        "aria-label": "Select a time window",
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          const a = localInputToIso(fromField.querySelector("input").value);
          const b = localInputToIso(toField.querySelector("input").value);
          if (!a || !b || a >= b) {
            error.textContent = "Choose a start that is before the end.";
            error.hidden = false;
            return;
          }
          pop.close();
          publishWindow([Date.parse(a), Date.parse(b)]);
        },
      },
      fromField,
      toField,
      error,
      h(
        "div",
        { class: "rp-form__actions" },
        button({
          label: "Clear",
          variant: "ghost",
          size: "sm",
          onClick: () => {
            pop.close();
            publishWindow(null);
          },
        }),
        button({ label: "Apply window", variant: "primary", size: "sm", type: "submit" }),
      ),
    );
    pop = popover(anchor, form, { placement: "bottom-end", label: "Select a time window" });
  };

  const openInspectorDrawer = () => {
    if (!st.entry) return;
    ctx.openDrawer({
      title: `Inspector: ${st.entry.title}`,
      body: scoped("reporting", () => inspectorBody(st.entry)),
      width: "md",
    });
  };

  const paintToolbar = () => {
    const view = currentView();
    const entry = st.entry;
    const kids = [];
    if (!compact) {
      const group = h("div", { class: "rp-segment", role: "group", "aria-label": "View" });
      for (const v of views())
        group.append(
          button({
            label: VIEW_LABEL[v],
            icon: VIEW_ICON[v],
            size: "sm",
            variant: "secondary",
            pressed: view === v,
            onClick: () => {
              st.view = v;
              paint();
            },
          }),
        );
      kids.push(group);
    } else if (entry && !entry.error) {
      if (!isTableVisual() && entry.result?.rows.length)
        kids.push(
          button({
            label: view === "table" ? "Show chart" : "Show table",
            icon: view === "table" ? "chart" : "list",
            size: "sm",
            variant: "ghost",
            onClick: () => {
              st.view = view === "table" ? "chart" : "table";
              paint();
            },
          }),
        );
      kids.push(
        button({
          label: "Inspect",
          icon: "sliders",
          size: "sm",
          variant: "ghost",
          onClick: openInspectorDrawer,
        }),
      );
    }
    if (entry?.visual?.type === "line" && view === "chart" && !compact) {
      const b = button({ label: "Window", icon: "clock", size: "sm", variant: "secondary" });
      b.setAttribute("aria-haspopup", "dialog");
      b.addEventListener("click", () => openWindowPopover(b));
      kids.push(b);
    }
    toolbarHost.replaceChildren(...kids);
    toolbarHost.hidden = kids.length === 0;
  };

  const paintChips = () => {
    const list = [];
    if (st.window) {
      list.push(
        h(
          "span",
          { class: "rp-chip" },
          `Range ${utcClock(st.window[0])} to ${utcClock(st.window[1])}`,
          button({
            label: "Clear range",
            icon: "x",
            size: "sm",
            variant: "ghost",
            iconOnly: true,
            onClick: () => publishWindow(null),
          }),
        ),
      );
    }
    if (st.filter) {
      list.push(
        h(
          "span",
          { class: "rp-chip" },
          `${colLabel(st.filter.key)}: ${st.filter.value}`,
          button({
            label: "Clear filter",
            icon: "x",
            size: "sm",
            variant: "ghost",
            iconOnly: true,
            onClick: () => {
              const key = st.filter.key;
              st.filter = null;
              st.selected = null;
              published = { key, value: null };
              bus.publish("filter.changed", published);
              published = null;
              paint();
            },
          }),
        ),
      );
    }
    chips.replaceChildren(...list);
    chips.hidden = list.length === 0;
  };

  // ---- painting ----
  function paint() {
    if (!alive) return;
    const entry = st.entry;
    if (!entry) return;
    disposeBody();
    disposeBody = () => {};
    paintToolbar();
    paintChips();
    const view = currentView();
    if (entry.error?.code === "FORBIDDEN" || (entry.error?.code === "UNKNOWN_REFERENCE" && !entry.query)) {
      hidden = true;
      ctx.setState("unavailable", { reason: entry.error.code === "FORBIDDEN" ? "forbidden" : "missing" });
      return;
    }
    if (hidden) {
      hidden = false;
      ctx.setState("ready");
    }
    if (view === "inspector" && !compact) {
      stage.show(inspectorBody(entry));
      return;
    }
    const type = entry.visual?.type;
    const brushable = type === "line" && entry.visual.options?.brush !== false;
    const built = renderEntry(entry, {
      showTable: view === "table",
      window: st.window,
      filter: st.filter,
      tableState: st.table,
      pageSize: size === "s" ? 5 : size === "m" ? 8 : undefined,
      selected: st.selected,
      onBrush: brushable ? (range) => publishWindow(range) : undefined,
      onSelect: type === "bar" ? (payload) => publishFilter(payload) : undefined,
      onRow: (row) =>
        ctx.openDrawer({
          title: "Row detail",
          width: "sm",
          body: () => keyValues(Object.entries(row).map(([k, v]) => [colLabel(k), cellText(v)])),
        }),
    });
    disposeBody = built.dispose;
    const parts = [built.el];
    if (built.state === "error")
      parts.push(
        button({
          label: "Run again",
          icon: "history",
          variant: "secondary",
          size: "sm",
          onClick: () => load({ first: false }),
        }),
      );
    if (!(compact && built.state === "ready")) parts.push(entryFoot(entry));
    stage.show(...parts);
    root.style.setProperty("--w-reporting-need", built.minRem ? `${built.minRem}rem` : "0rem");
    ctx.setCount(entry.result?.row_count ?? 0);
  }

  // ---- loading ----
  async function load({ first = false, live = false } = {}) {
    const ok = next();
    if (first) stage.loading({ lines: 5, shape: "card" });
    else stage.busy(true);
    let def;
    try {
      def = await source.load(env);
    } catch (e) {
      if (!ok()) return;
      st.entry = { title: ctx.instance?.title ?? "Report", query: null, visual: null, error: toErrorInfo(e) };
      stage.busy(false);
      paint();
      return;
    }
    if (!ok()) return;
    if (def.title) ctx.setTitle(def.title);
    let entry;
    if (def.error || !def.query) {
      entry = {
        ...def,
        error: def.error ?? { code: "NO_QUERY", message: "This report has no query to run." },
      };
    } else {
      try {
        const result = await api.query(def.query, { params: def.params, dashboard: def.dashboard });
        entry = { ...def, result };
      } catch (e) {
        entry = { ...def, error: toErrorInfo(e) };
      }
    }
    if (!ok() || !alive) return;
    const before = st.entry?.result?.result_hash;
    st.entry = entry;
    stage.busy(false);
    paint();
    if (live && before && entry.result?.result_hash && before !== entry.result.result_hash) {
      stage.el.classList.add("u-arrive");
      clearTimeout(arriveTimer);
      arriveTimer = setTimeout(() => stage.el.classList.remove("u-arrive"), ARRIVE_MS);
      ctx.announce(`${entry.title} updated`);
    }
  }

  const reload = debounce(() => load({ live: true }), 1200);
  offs.push(
    rt.onChange((c) => {
      const node = String(c.node);
      return node.includes("/Source/") || (ctx.instance?.uri && node === ctx.instance.uri);
    }, reload),
  );
  source.watch?.(env, reload, offs);

  load({ first: true });
  return () => {
    alive = false;
    reload.cancel();
    clearTimeout(arriveTimer);
    disposeBody();
    for (const off of offs) off();
  };
};

/** A catalogue widget module for one of the single-visual widgets. */
export const visualWidget = ({ id, title }) => ({
  id,
  domain: "reporting",
  title,
  configSchema: schemaOf(id),
  sizes: catalogEntry(id)?.sizes ?? [],
  mount(el, env) {
    return mountVisual(el, env, {
      load: ({ config }) =>
        Promise.resolve({
          query: config.query,
          visual: config.visual,
          dashboard: config.dashboard,
          params: config.params,
          title: env.ctx.instance?.title ?? title,
        }),
    });
  },
});
