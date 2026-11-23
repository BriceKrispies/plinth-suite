// promotions.performance: redemptions, cost, budget, by tier and region, uplift; one promotion or all active.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { statTile } from "../../ds/js/stat.js";
import { donut, miniBars } from "../../ds/js/chart.js";
import { selectField } from "../../ds/js/field.js";
import { progressBar } from "../../ds/js/progress.js";
import { emptyState, skeleton, errorState } from "../../ds/js/states.js";
import { number, points, percent } from "../../ds/js/format.js";

import { dataTable } from "../../ds/js/table.js";
import { lifecycle, debounce, segmented, enumLabel, when } from "./_kit.js";

const mergeBreakdown = (acc, add) => {
  for (const [k, v] of Object.entries(add ?? {})) {
    const cur = acc[k] ?? { redemptions: 0, cost_points: 0 };
    acc[k] = { redemptions: cur.redemptions + v.redemptions, cost_points: cur.cost_points + v.cost_points };
  }
};

/** Combine several analytics results into one (all active promotions). */
const aggregate = (results) => {
  const out = {
    slug: null,
    usage: { redemptions: 0, cost_points: 0, budget_used_pct: null, members_reached: 0 },
    benefit_points: 0,
    series: [],
    by_tier: {},
    by_region: {},
    uplift: null,
    count: results.length,
  };
  const buckets = new Map();
  let capCost = 0;
  let capUsed = 0;
  for (const r of results) {
    out.usage.redemptions += r.usage.redemptions;
    out.usage.cost_points += r.usage.cost_points;
    out.usage.members_reached += r.usage.members_reached;
    out.benefit_points += r.benefit_points;
    if (r.usage.budget_used_pct !== null) {
      // weight by used cost: pct = used / cap, so cap = used / pct
      const cap = r.usage.budget_used_pct > 0 ? (r.usage.cost_points * 100) / r.usage.budget_used_pct : 0;
      capCost += cap;
      capUsed += r.usage.cost_points;
    }
    for (const s of r.series) {
      const cur = buckets.get(s.bucket) ?? { bucket: s.bucket, redemptions: 0, cost_points: 0 };
      cur.redemptions += s.redemptions;
      cur.cost_points += s.cost_points;
      buckets.set(s.bucket, cur);
    }
    mergeBreakdown(out.by_tier, r.by_tier);
    mergeBreakdown(out.by_region, r.by_region);
  }
  if (capCost > 0) out.usage.budget_used_pct = (capUsed / capCost) * 100;
  out.series = [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
  const ups = results.map((r) => r.uplift).filter(Boolean);
  if (ups.length)
    out.uplift = {
      uplift_pct: ups.reduce((a, u) => a + u.uplift_pct, 0) / ups.length,
      average_of: ups.length,
    };
  return out;
};

export default {
  id: "promotions.performance",
  domain: "promotions",
  title: "Promotion performance",
  configSchema: schemaOf("promotions.performance"),
  sizes: ["m", "l", "xl"],
  mount(el, { config, size, api, rt, bus, ctx }) {
    const life = lifecycle();
    const st = {
      promotion: config.promotion ?? null,
      bucket: config.bucket ?? "day",
      view: "summary",
      list: [],
      data: null,
    };
    const compact = size === "m";
    const root = h("div", { class: `wp wp-perf wp-perf--${size}` });
    const controls = h("div", { class: "wp-perf__controls" });
    const body = h("div", { class: "wp-perf__body", "aria-live": "off" });
    const liveNote = h("p", { class: "sr-only", "aria-live": "polite" });
    root.append(controls, body, liveNote);
    el.append(root);

    let seq = 0;
    let first = true;

    const pickerFor = () => {
      const opts = [
        { value: "", label: "All active promotions" },
        ...st.list.map((p) => ({ value: p.node.slug, label: `${p.node.title} (${p.status})` })),
      ];
      return selectField({
        name: "promotion",
        label: "Promotion",
        value: st.promotion ?? "",
        options: opts,
        onChange: (v) => {
          st.promotion = v || null;
          load();
        },
      });
    };

    const drawControls = () => {
      controls.replaceChildren();
      if (!compact || !config.promotion) controls.append(pickerFor());
      if (!compact) {
        controls.append(
          segmented({
            label: "Series interval",
            value: st.bucket,
            options: [
              { value: "hour", label: "Hourly" },
              { value: "day", label: "Daily" },
            ],
            onChange: (v) => {
              st.bucket = v;
              load();
            },
          }),
          segmented({
            label: "View",
            value: st.view,
            options: [
              { value: "summary", label: "Summary" },
              { value: "series", label: "Series" },
            ],
            onChange: (v) => {
              st.view = v;
              paint();
            },
          }),
        );
      }
    };

    const breakdown = (title, data) => {
      const entries = Object.entries(data ?? {}).sort((a, b) => b[1].redemptions - a[1].redemptions);
      if (entries.length === 0) return h("p", { class: "u-muted" }, `No ${title.toLowerCase()} data yet.`);
      return h(
        "div",
        { class: "wp-perf__breakdown" },
        donut(
          entries.map(([k, v]) => ({ label: enumLabel(k), value: v.redemptions })),
          { label: `Redemptions ${title.toLowerCase()}` },
        ),
      );
    };

    function paint() {
      const d = st.data;
      body.replaceChildren();
      if (!d) return;
      const u = d.usage;
      ctx.setCount(u.redemptions);
      if (u.redemptions === 0 && d.series.length === 0) {
        body.append(
          emptyState({
            icon: "chart",
            title: "No redemptions yet",
            body: st.promotion
              ? "Once members use this promotion its numbers appear here."
              : "No active promotion has been redeemed yet.",
          }),
        );
        return;
      }
      const tiles = h(
        "div",
        { class: "wp-perf__tiles" },
        statTile({
          label: "Redemptions",
          value: number(u.redemptions),
          hint: st.promotion ? null : `${d.count} promotions`,
        }),
        statTile({ label: "Programme cost", value: points(u.cost_points) }),
        statTile({ label: "Member benefit", value: points(d.benefit_points) }),
        compact ? null : statTile({ label: "Members reached", value: number(u.members_reached) }),
        !compact && d.uplift
          ? statTile({
              label: "Uplift in orders",
              value: `${d.uplift.uplift_pct >= 0 ? "+" : ""}${number(d.uplift.uplift_pct)} %`,
              hint: d.uplift.eligible_members
                ? `${number(d.uplift.eligible_members)} eligible members`
                : "Average of promotions",
              good: "up",
              delta: `${d.uplift.uplift_pct >= 0 ? "+" : "−"}${number(Math.abs(d.uplift.uplift_pct))} %`,
            })
          : null,
      );
      const budget =
        u.budget_used_pct !== null
          ? h(
              "div",
              { class: "wp-perf__budget" },
              h("p", { class: "wk-caps" }, "Budget used"),
              progressBar({
                value: Math.min(100, u.budget_used_pct),
                max: 100,
                label: "Budget used",
                tone: u.budget_used_pct >= 80 ? "warning" : "info",
              }),
            )
          : null;
      if (compact) {
        body.append(tiles, budget);
        return;
      }
      if (st.view === "summary") {
        body.append(
          tiles,
          budget,
          h(
            "div",
            { class: "wp-perf__split" },
            h(
              "section",
              { "aria-label": "By tier" },
              h("h3", { class: "wk-caps" }, "By tier"),
              breakdown("By tier", d.by_tier),
            ),
            h(
              "section",
              { "aria-label": "By region" },
              h("h3", { class: "wk-caps" }, "By region"),
              breakdown("By region", d.by_region),
            ),
          ),
        );
      } else {
        const vals = d.series.map((s) => s.redemptions);
        const costs = d.series.map((s) => s.cost_points);
        const labels = d.series.map((s) => when(s.bucket));
        body.append(
          h(
            "section",
            { "aria-label": "Redemptions over time" },
            h("h3", { class: "wk-caps" }, `Redemptions per ${st.bucket}`),
            vals.length
              ? miniBars(vals, { labels, label: "Redemptions over time" })
              : h("p", { class: "u-muted" }, "No series data yet."),
          ),
          h(
            "section",
            { "aria-label": "Cost over time" },
            h("h3", { class: "wk-caps" }, `Cost per ${st.bucket}`),
            costs.length ? miniBars(costs, { labels, label: "Cost over time" }) : null,
          ),
          dataTable({
            caption: "Series",
            density: "compact",
            columns: [
              { key: "bucket", label: "Interval", render: (r) => when(r.bucket) },
              {
                key: "redemptions",
                label: "Redemptions",
                align: "end",
                render: (r) => number(r.redemptions),
              },
              { key: "cost_points", label: "Cost", align: "end", render: (r) => points(r.cost_points) },
            ],
            rows: [...d.series].reverse().slice(0, 12),
            rowKey: "bucket",
          }),
        );
      }
    }

    const load = async () => {
      const mine = ++seq;
      if (first) body.replaceChildren(skeleton({ shape: "card", lines: 3 }));
      else body.setAttribute("aria-busy", "true");
      try {
        if (st.list.length === 0) st.list = (await api.call("promotions.list", {})).items;
        let data;
        if (st.promotion) {
          data = await api.call("promotions.analytics", { slug: st.promotion, bucket: st.bucket });
          data.count = 1;
        } else {
          const active = st.list.filter((p) => p.status === "active").slice(0, 10);
          const results = await Promise.all(
            active.map((p) => api.call("promotions.analytics", { slug: p.node.slug, bucket: st.bucket })),
          );
          data = aggregate(results);
        }
        if (life.dead || mine !== seq) return;
        st.data = data;
        first = false;
        body.removeAttribute("aria-busy");
        drawControls();
        paint();
      } catch (e) {
        if (life.dead || mine !== seq) return;
        body.removeAttribute("aria-busy");
        body.replaceChildren(errorState({ error: e, retry: load }));
      }
    };
    load();

    const refresh = debounce(life, load, 1500);
    life.add(
      rt.on("promotion.redeemed", (ev) => {
        const p = ev.payload;
        if (st.promotion && p.promotion !== st.promotion) return;
        if (st.data) {
          st.data.usage.redemptions += 1;
          st.data.usage.cost_points += p.cost_points ?? 0;
          st.data.benefit_points += p.benefit_points ?? 0;
          paint();
          body.querySelector(".c-stat")?.classList.add("u-arrive");
          life.timeout(() => body.querySelector(".u-arrive")?.classList.remove("u-arrive"), 6000);
        }
        refresh();
      }),
    );
    life.add(
      rt.on("promotion.budget_alert", (ev) => {
        const p = ev.payload;
        if (st.promotion && p.promotion !== st.promotion) return;
        liveNote.textContent = `Budget alert: ${p.used_pct} percent used`;
        refresh();
      }),
    );
    life.add(
      bus.subscribe("promotion.selected", ({ id }) => {
        if (config.promotion || !id) return;
        st.promotion = id;
        load();
      }),
    );

    return () => life.dispose();
  },
};
