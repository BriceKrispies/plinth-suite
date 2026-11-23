// reporting.suite-kpis: a strip of programme figures from home.summary with 14-day sparklines. Each tile opens a
// drawer with the daily values. Re-reads on points.posted, order.placed and badge.awarded; only a figure that
// actually changed is marked as arrived.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { statTile } from "../../ds/js/stat.js";
import { dataTable } from "../../ds/js/table.js";
import { miniBars } from "../../ds/js/chart.js";
import { emptyState } from "../../ds/js/states.js";
import { number, date } from "../../ds/js/format.js";
import { schemaOf, catalogEntry } from "../../core/widgets.js";
import { debounce, latest, region, scoped } from "./_common.js";

const METRICS = {
  points_issued_today: { label: "Points issued today", unit: "pts", series: "issued", good: "up" },
  points_redeemed_today: { label: "Points redeemed today", unit: "pts", series: "redeemed", good: "up" },
  orders_today: { label: "Orders today", series: "orders", good: "up" },
  active_members_7d: { label: "Active members, 7 days", good: "up" },
  badges_awarded_7d: { label: "Badges awarded, 7 days", good: "up" },
  members_total: { label: "Members" },
};

const signed = (d) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${number(Math.abs(d))}`;

export default {
  id: "reporting.suite-kpis",
  domain: "reporting",
  title: "Programme KPIs",
  configSchema: schemaOf("reporting.suite-kpis"),
  sizes: catalogEntry("reporting.suite-kpis")?.sizes ?? [],
  mount(el, { config, size, api, rt, ctx }) {
    const metrics = (config.metrics ?? []).filter((m) => METRICS[m]);
    const stage = region("rp-kpis__stage");
    const root = h("div", { class: `rp-kpis rp-kpis--${size}` }, stage.el);
    el.append(root);
    const next = latest();
    let org = null;
    let alive = true;
    const timers = new Set();

    const valueOf = (m) => org?.[m] ?? 0;
    const seriesOf = (m) => {
      const key = METRICS[m].series;
      return key ? (org?.series_14d?.[key] ?? null) : null;
    };

    const openDetail = (m, opener) => {
      const spec = METRICS[m];
      const values = seriesOf(m);
      ctx.openDrawer({
        title: spec.label,
        width: "sm",
        body: scoped("reporting", () => {
          if (!values || values.length === 0)
            return emptyState({
              icon: "chart",
              title: "No daily history",
              body: "This figure is a rolling window, so it has no per-day series.",
            });
          const days = org.series_14d.days;
          const rows = values.map((v, i) => ({ day: days[i], v, d: i === 0 ? null : v - values[i - 1] }));
          return h(
            "div",
            { class: "rp-kpis__detail" },
            h("p", { class: "u-muted" }, `Last ${values.length} days, oldest first.`),
            miniBars(values, { labels: days.map((d) => date(d)), label: `${spec.label}, daily` }),
            dataTable({
              caption: `${spec.label}, by day`,
              density: "compact",
              rowKey: "day",
              rows: [...rows].reverse(),
              columns: [
                { key: "day", label: "Day", render: (r) => date(r.day) },
                {
                  key: "v",
                  label: spec.unit ? `Total (${spec.unit})` : "Total",
                  align: "end",
                  render: (r) => number(r.v),
                },
                {
                  key: "d",
                  label: "Change",
                  align: "end",
                  render: (r) => (r.d === null ? "–" : signed(r.d)),
                },
              ],
            }),
          );
        }),
        onClose: () => opener?.focus?.(),
      });
    };

    const cells = new Map();
    const paint = (changed = []) => {
      const grid = h("div", { class: "rp-kpis__grid", role: "list", "aria-label": "Programme figures" });
      cells.clear();
      for (const m of metrics) {
        const spec = METRICS[m];
        const s = seriesOf(m);
        const delta = s && s.length > 1 ? s.at(-1) - s.at(-2) : null;
        const tile = statTile({
          label: spec.label,
          value: number(valueOf(m)),
          unit: spec.unit,
          delta: delta === null ? undefined : `${signed(delta)} vs yesterday`,
          good: spec.good,
          spark: s && s.length > 1 ? s : undefined,
        });
        const more = button({
          label: "Daily detail",
          icon: "chevron-right",
          size: "sm",
          variant: "ghost",
          onClick: () => openDetail(m, more),
        });
        more.setAttribute("aria-label", `Daily detail for ${spec.label}`);
        const cell = h("div", { class: "rp-kpis__cell", role: "listitem", "data-metric": m }, tile, more);
        if (changed.includes(m)) cell.classList.add("u-arrive");
        cells.set(m, cell);
        grid.append(cell);
      }
      stage.show(grid);
      if (changed.length > 0) {
        const t = setTimeout(() => {
          timers.delete(t);
          for (const m of changed) cells.get(m)?.classList.remove("u-arrive");
        }, 6000);
        timers.add(t);
      }
    };

    const load = async ({ first, live } = {}) => {
      const ok = next();
      if (first) stage.loading({ lines: 2, shape: "tile" });
      try {
        const out = await api.call("home.summary");
        if (!ok() || !alive) return;
        const previous = org;
        org = out.org;
        const changed = live && previous ? metrics.filter((m) => previous[m] !== org[m]) : [];
        paint(changed);
        if (changed.length > 0) ctx.announce("Programme figures updated");
      } catch (e) {
        if (!ok() || !alive) return;
        if (!org) stage.error(e, () => load({ first: true }));
      }
    };

    const refresh = debounce(() => load({ live: true }), 600);
    const offs = ["points.posted", "order.placed", "badge.awarded"].map((t) => rt.on(t, refresh));
    load({ first: true });
    return () => {
      alive = false;
      refresh.cancel();
      for (const t of timers) clearTimeout(t);
      for (const off of offs) off();
    };
  },
};
