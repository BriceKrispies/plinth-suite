// promotions.list: every promotion by status with window, usage bar and pending approvals; quick view drawer with
// lifecycle actions; selecting a row publishes promotion.selected for the builder, simulator and performance widgets.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { scoped } from "../reporting/_common.js";
import { button, linkButton } from "../../ds/js/button.js";
import { dataTable, pager } from "../../ds/js/table.js";
import { emptyState } from "../../ds/js/states.js";
import { searchField, selectField } from "../../ds/js/field.js";
import { statusPill, pill } from "../../ds/js/pill.js";
import { toolbar } from "../../ds/js/layout.js";
import { icon } from "../../ds/js/icons.js";
import { number, points, date } from "../../ds/js/format.js";
import { lifecycle, debounce, asyncRegion, segmented, pageOf, kv, arrive, enumLabel, when } from "./_kit.js";
import { STATUSES, transitionsFor, runTransition, usageMeter, describeEligibility } from "./_promo.js";

const PAGE_SIZE = 12;
const SORTS = {
  priority: (a, b) => b.priority - a.priority || a.node.title.localeCompare(b.node.title),
  ends: (a, b) => new Date(a.ends_at) - new Date(b.ends_at),
  starts: (a, b) => new Date(b.starts_at) - new Date(a.starts_at),
  title: (a, b) => a.node.title.localeCompare(b.node.title),
  usage: (a, b) => (b.usage.budget_used_pct ?? -1) - (a.usage.budget_used_pct ?? -1),
};

export default {
  id: "promotions.list",
  domain: "promotions",
  title: "Promotions",
  configSchema: schemaOf("promotions.list"),
  sizes: ["l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = lifecycle();
    const canManage = ctx.can("promotions:manage");
    const st = {
      items: [],
      counts: {},
      status: "all",
      q: "",
      sort: "priority",
      page: 0,
      selected: null,
      arrived: new Set(),
    };
    const wide = size !== "l";

    const results = h("div", { class: "wp-results" });
    const live = h("p", { class: "sr-only", "aria-live": "polite" });

    const filters = segmented({
      label: "Filter by status",
      value: "all",
      options: [{ value: "all", label: "All" }, ...STATUSES.map((s) => ({ value: s, label: enumLabel(s) }))],
      onChange: (v) => {
        st.status = v;
        st.page = 0;
        paint();
      },
    });
    const search = searchField({
      name: "q",
      label: "Search promotions",
      placeholder: "Search promotions",
      onInput: debounce(
        life,
        (v) => {
          st.q = v.trim().toLowerCase();
          st.page = 0;
          paint();
        },
        180,
      ),
    });
    search.classList.add("wk-search");
    const sort = selectField({
      name: "sort",
      label: "Sort by",
      value: st.sort,
      options: [
        { value: "priority", label: "Priority" },
        { value: "ends", label: "Ends soonest" },
        { value: "starts", label: "Newest start" },
        { value: "title", label: "Title" },
        { value: "usage", label: "Budget used" },
      ],
      onChange: (v) => {
        st.sort = v;
        paint();
      },
    });
    const bar = toolbar({
      label: "Promotion filters",
      children: [
        search,
        sort,
        canManage
          ? button({
              label: "New promotion",
              icon: "plus",
              variant: "primary",
              onClick: () => nav.go("/promotions/new"),
            })
          : null,
      ],
    });

    const root = h("div", { class: "wp wp-list" }, bar, filters, live, results);
    el.append(root);

    const visible = () => {
      let rows = st.items;
      if (config.status?.length) rows = rows.filter((r) => config.status.includes(r.status));
      if (st.status !== "all") rows = rows.filter((r) => r.status === st.status);
      if (st.q)
        rows = rows.filter((r) =>
          `${r.node.title} ${r.description} ${r.effect_summary} ${r.owner}`.toLowerCase().includes(st.q),
        );
      return [...rows].sort(SORTS[st.sort]);
    };

    const select = (row) => {
      st.selected = row.node.slug;
      bus.publish("promotion.selected", { id: row.node.slug });
      paint();
      openQuick(row);
    };

    const titleCell = (row) =>
      h(
        "span",
        { class: "wp-title wk-row__main" },
        h("strong", {}, row.node.title),
        row.pending_approval_id ? pill({ label: "Awaiting approval", tone: "warning", icon: "clock" }) : null,
        st.arrived.has(row.node.slug) ? pill({ label: "New", tone: "signal" }) : null,
      );

    const columns = [
      { key: "title", label: "Promotion", render: titleCell },
      { key: "status", label: "Status", render: (r) => statusPill("promotion", r.status) },
      ...(wide ? [{ key: "effect", label: "Effect", render: (r) => r.effect_summary }] : []),
      {
        key: "window",
        label: "Window",
        render: (r) => `${date(r.starts_at)} – ${date(r.ends_at)}`,
      },
      { key: "usage", label: "Usage", render: (r) => usageMeter(r.usage, r.node.title) },
      { key: "priority", label: "Priority", align: "end", render: (r) => number(r.priority) },
    ];

    function paint() {
      const rows = visible();
      const { slice, hasNext, hasPrev } = pageOf(rows, st.page, PAGE_SIZE);
      results.replaceChildren();
      ctx.setCount(rows.length);
      if (st.items.length === 0) {
        results.append(
          emptyState({
            icon: "percent",
            title: "No promotions yet",
            body: "Promotions give members multipliers, discounts and bonus points on a schedule.",
            action: canManage
              ? button({
                  label: "Create a promotion",
                  icon: "plus",
                  variant: "primary",
                  onClick: () => nav.go("/promotions/new"),
                })
              : null,
          }),
        );
        return;
      }
      if (rows.length === 0) {
        results.append(
          emptyState({
            icon: "search",
            title: "No promotions match",
            body: st.q ? `Nothing found for ‘${st.q}’.` : "No promotions have this status.",
            action: button({
              label: "Clear filters",
              onClick: () => {
                st.q = "";
                st.status = "all";
                filters.setValue("all");
                const input = search.querySelector("input");
                if (input) input.value = "";
                paint();
              },
            }),
          }),
        );
        return;
      }
      const table = dataTable({
        caption: "Promotions",
        columns,
        rows: slice,
        rowKey: (r) => r.node.slug,
        onRowClick: select,
        density: size === "l" ? "compact" : "default",
      });
      for (const tr of table.querySelectorAll("tbody tr")) {
        const slug = tr.dataset.key;
        tr.tabIndex = 0;
        if (slug === st.selected) tr.classList.add("is-selected");
        tr.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            select(st.items.find((x) => x.node.slug === slug));
          }
        });
        // titles link to the builder; the row itself opens the quick view
        const strong = tr.querySelector(".wp-title strong");
        if (strong && canManage) {
          const a = h("a", { href: `/promotions/${slug}`, class: "wk-link" }, strong.textContent);
          strong.replaceChildren(a);
        }
      }
      results.append(table);
      if (hasNext || hasPrev)
        results.append(
          pager({
            nextCursor: hasNext ? st.page + 1 : null,
            onNext: () => {
              st.page += 1;
              paint();
            },
            onPrev: hasPrev
              ? () => {
                  st.page -= 1;
                  paint();
                }
              : undefined,
          }),
        );
    }

    // ---- quick view drawer ----
    function openQuick(row) {
      const fresh = () => st.items.find((x) => x.node.slug === row.node.slug) ?? row;
      const body = h("div", { class: "wp-quick" });
      let drawer;
      const draw = () => {
        const r = fresh();
        body.replaceChildren(
          h(
            "div",
            { class: "wp-quick__top" },
            statusPill("promotion", r.status),
            r.pending_approval_id
              ? pill({ label: "Awaiting approval", tone: "warning", icon: "clock" })
              : null,
            r.stacking === "exclusive" ? pill({ label: "Exclusive", tone: "info" }) : null,
          ),
          h("p", {}, r.description),
          kv([
            ["Effect", r.effect_summary],
            ["Who qualifies", r.eligibility_summary || describeEligibility({})],
            ["Window", `${when(r.starts_at)} to ${when(r.ends_at)}`],
            ["Priority", number(r.priority)],
            ["Owner", r.owner],
            ["Redemptions", number(r.usage.redemptions)],
            ["Cost so far", points(r.usage.cost_points)],
            ["Members reached", number(r.usage.members_reached)],
          ]),
          ...[r.usage.budget_used_pct !== null ? usageMeter(r.usage, r.node.title) : null].filter(Boolean),
        );
        const steps = canManage && !r.pending_approval_id ? transitionsFor(r.status, r.starts_at) : [];
        const actions = h(
          "div",
          { class: "wk-actions" },
          canManage
            ? linkButton({
                href: `/promotions/${r.node.slug}`,
                label: "Open builder",
                icon: "edit",
                variant: "primary",
              })
            : null,
          linkButton({ href: `/promotions/${r.node.slug}`, label: "Simulate and analyse", icon: "target" }),
          ...steps.map((step) =>
            button({
              label: step.label,
              icon: step.icon,
              variant: step.danger ? "danger" : (step.variant ?? "secondary"),
              onClick: async () => {
                const out = await runTransition(ctx, api, {
                  slug: r.node.slug,
                  title: r.node.title,
                  revision: r.node.revision,
                  step,
                });
                if (out) {
                  drawer?.close();
                  list.reload();
                }
              },
            }),
          ),
        );
        body.append(
          actions,
          ...[
            r.pending_approval_id
              ? h("p", { class: "u-muted" }, "Changes are held until the pending approval is decided.")
              : null,
          ].filter(Boolean),
        );
      };
      draw();
      drawer = ctx.openDrawer({ title: row.node.title, width: "md", body: scoped("promotions", body) });
    }

    const list = asyncRegion(results, life, {
      skeleton: { shape: "table", lines: 5 },
      load: () => api.call("promotions.list", {}),
      render: (host, data) => {
        st.items = data.items;
        st.counts = data.status_counts ?? {};
        const total = data.items.length;
        filters.setCounts({ all: total, ...st.counts });
        paint();
      },
      onError: () => ctx.setCount(0),
    });

    // ---- realtime ----
    const reload = debounce(life, () => list.reload(), 400);
    life.add(rt.on("promotion.state_changed", reload));
    life.add(rt.on("approval.decided", reload));
    life.add(rt.onNode("Promotion", reload));
    life.add(
      rt.on("promotion.redeemed", (ev) => {
        const p = ev.payload;
        const row = st.items.find((x) => x.node.slug === p.promotion);
        if (!row) return;
        row.usage.redemptions += 1;
        row.usage.cost_points += p.cost_points ?? 0;
        st.arrived.add(row.node.slug);
        paint();
        arrive(life, results.querySelector(`tr[data-key="${CSS.escape(row.node.slug)}"]`), false);
      }),
    );
    life.add(
      rt.on("promotion.budget_alert", (ev) => {
        const p = ev.payload;
        const row = st.items.find((x) => x.node.slug === p.promotion);
        if (!row) return;
        row.usage.budget_used_pct = p.used_pct;
        row.usage.cost_points = p.cost_points;
        paint();
        live.textContent = `${row.node.title} has used ${p.used_pct} percent of its budget`;
      }),
    );

    return () => life.dispose();
  },
};
