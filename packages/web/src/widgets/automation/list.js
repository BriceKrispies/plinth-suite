// automation.list: automations with trigger, enabled switch, last run, failures and next fire. The switch is
// optimistic; an enable that a rule holds for approval is put back and reported.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { button, linkButton } from "../../ds/js/button.js";
import { dataTable, pager } from "../../ds/js/table.js";
import { emptyState } from "../../ds/js/states.js";
import { searchField, selectField, switchField } from "../../ds/js/field.js";
import { statusPill, pill } from "../../ds/js/pill.js";
import { toolbar } from "../../ds/js/layout.js";
import { icon } from "../../ds/js/icons.js";
import { number } from "../../ds/js/format.js";
import {
  lifecycle,
  debounce,
  asyncRegion,
  segmented,
  pageOf,
  kv,
  arrive,
  rel,
  when,
  failToast,
  nowIso,
} from "../promotions/_kit.js";
import { TRIGGER_ICON } from "./_auto.js";

const PAGE_SIZE = 12;
const SORTS = {
  name: (a, b) => a.node.title.localeCompare(b.node.title),
  recent: (a, b) => (b.last_run?.started_at ?? "").localeCompare(a.last_run?.started_at ?? ""),
  failures: (a, b) => b.failures_7d - a.failures_7d || a.node.title.localeCompare(b.node.title),
  next: (a, b) => (a.next_fire_at ?? "9999").localeCompare(b.next_fire_at ?? "9999"),
};

export default {
  id: "automation.list",
  domain: "automation",
  title: "Automations",
  configSchema: schemaOf("automation.list"),
  sizes: ["l", "xl", "full"],
  mount(el, { size, api, rt, bus, nav, ctx }) {
    const life = lifecycle();
    const wide = size !== "l";
    const st = {
      items: [],
      filter: "all",
      trigger: "all",
      q: "",
      sort: "name",
      page: 0,
      selected: null,
      fresh: new Set(),
    };
    const results = h("div", { class: "wa-results" });
    const live = h("p", { class: "sr-only", "aria-live": "polite" });

    const filters = segmented({
      label: "Filter automations",
      value: "all",
      options: [
        { value: "all", label: "All" },
        { value: "enabled", label: "Enabled" },
        { value: "disabled", label: "Disabled" },
        { value: "failing", label: "Failing" },
      ],
      onChange: (v) => {
        st.filter = v;
        st.page = 0;
        paint();
      },
    });
    const search = searchField({
      name: "q",
      label: "Search automations",
      placeholder: "Search automations",
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
    const triggerSel = selectField({
      name: "trigger",
      label: "Trigger",
      value: "all",
      options: [
        { value: "all", label: "Any trigger" },
        { value: "event", label: "Event" },
        { value: "schedule", label: "Schedule" },
        { value: "metric", label: "Metric" },
      ],
      onChange: (v) => {
        st.trigger = v;
        st.page = 0;
        paint();
      },
    });
    const sortSel = selectField({
      name: "sort",
      label: "Sort by",
      value: "name",
      options: [
        { value: "name", label: "Name" },
        { value: "recent", label: "Most recent run" },
        { value: "failures", label: "Most failures" },
        { value: "next", label: "Next fire" },
      ],
      onChange: (v) => {
        st.sort = v;
        paint();
      },
    });
    const bar = toolbar({
      label: "Automation filters",
      children: [
        search,
        triggerSel,
        sortSel,
        button({
          label: "New automation",
          icon: "plus",
          variant: "primary",
          onClick: () => nav.go("/automations/new"),
        }),
      ],
    });
    el.append(h("div", { class: `wa wa-list wa-list--${size}` }, bar, filters, live, results));

    const visible = () =>
      st.items
        .filter((a) => {
          if (st.filter === "enabled" && !a.enabled) return false;
          if (st.filter === "disabled" && a.enabled) return false;
          if (st.filter === "failing" && a.failures_7d === 0) return false;
          if (st.trigger !== "all" && a.trigger_type !== st.trigger) return false;
          return (
            !st.q ||
            `${a.node.title} ${a.description} ${a.trigger_summary} ${a.owner}`.toLowerCase().includes(st.q)
          );
        })
        .sort(SORTS[st.sort]);

    // ---------- enable / disable ----------
    const setEnabled = async (item, enabled, control) => {
      if (enabled) {
        const ok = await ctx.confirm({
          title: `Enable ${item.node.title}?`,
          message:
            "It will start running on its trigger, with real effects such as points, messages and tasks.",
          confirmLabel: "Enable",
        });
        if (!ok) {
          const input = control.querySelector("input");
          input.checked = false;
          const state = control.querySelector(".c-switch__state");
          if (state) state.textContent = "Off";
          return;
        }
      }
      const before = item.enabled;
      item.enabled = enabled; // optimistic
      try {
        const out = await api.call("automation.set_enabled", {
          slug: item.node.slug,
          enabled,
          base_revision: item.node.revision,
        });
        if (life.dead) return;
        if (out.status === "pending_approval") {
          item.enabled = before;
          item.pending_approval_id = out.approval_id ?? "pending";
          ctx.toast({
            title: "Sent for approval",
            body: `${item.node.title} will ${enabled ? "turn on" : "turn off"} once an approver accepts it.`,
            tone: "info",
          });
        } else {
          if (out.revision) item.node.revision = out.revision;
          ctx.announce(`${item.node.title} ${enabled ? "enabled" : "disabled"}`);
        }
      } catch (e) {
        if (life.dead) return;
        item.enabled = before;
        failToast(ctx, e, `Could not ${enabled ? "enable" : "disable"} ${item.node.title}`);
        reload();
      }
      paint();
    };

    const switchCell = (a) => {
      const f = switchField({
        name: `enabled-${a.node.slug}`,
        label: `Enabled: ${a.node.title}`,
        value: a.enabled,
        disabled: Boolean(a.pending_approval_id),
        onChange: (v) => setEnabled(a, v, f),
      });
      f.querySelector(".c-field__label")?.classList.add("sr-only");
      return f;
    };

    // ---------- table ----------
    const columns = [
      {
        key: "title",
        label: "Automation",
        render: (a) =>
          h(
            "span",
            { class: "wk-row__main" },
            h("strong", {}, a.node.title),
            a.pending_approval_id
              ? pill({ label: "Awaiting approval", tone: "warning", icon: "clock" })
              : null,
            st.fresh.has(a.node.slug) ? pill({ label: "New", tone: "signal" }) : null,
          ),
      },
      {
        key: "trigger",
        label: "Trigger",
        render: (a) =>
          h(
            "span",
            { class: "wk-icon-text" },
            icon(TRIGGER_ICON[a.trigger_type] ?? "bolt", { size: 16 }),
            a.trigger_summary,
          ),
      },
      { key: "enabled", label: "Enabled", render: switchCell },
      {
        key: "last",
        label: "Last run",
        render: (a) =>
          a.last_run
            ? h(
                "span",
                { class: "wk-row__main" },
                statusPill("run", a.last_run.status),
                h("span", { class: "u-muted" }, rel(a.last_run.started_at ?? a.last_run.finished_at)),
              )
            : h("span", { class: "u-muted" }, "Never run"),
      },
      ...(wide
        ? [
            {
              key: "week",
              label: "7 days",
              render: (a) =>
                h(
                  "span",
                  { class: "u-tabular" },
                  `${number(a.runs_7d)} runs`,
                  a.failures_7d
                    ? h("span", { class: "wa-fail" }, ` · ${number(a.failures_7d)} failed`)
                    : null,
                ),
            },
            { key: "next", label: "Next fire", render: (a) => (a.next_fire_at ? rel(a.next_fire_at) : "–") },
          ]
        : []),
    ];

    function paint() {
      const rows = visible();
      const { slice, hasNext, hasPrev } = pageOf(rows, st.page, PAGE_SIZE);
      results.replaceChildren();
      ctx.setCount(rows.length);
      if (st.items.length === 0) {
        results.append(
          emptyState({
            icon: "workflow",
            title: "No automations yet",
            body: "Automations react to events, run on a schedule or watch a metric, then award points, notify people or create tasks.",
            action: button({
              label: "Create an automation",
              icon: "plus",
              variant: "primary",
              onClick: () => nav.go("/automations/new"),
            }),
          }),
        );
        return;
      }
      if (rows.length === 0) {
        results.append(
          emptyState({
            icon: "search",
            title: "No automations match",
            body: "Try another filter or search.",
            action: button({
              label: "Clear filters",
              onClick: () => {
                st.q = "";
                st.filter = "all";
                st.trigger = "all";
                filters.setValue("all");
                search.querySelector("input").value = "";
                triggerSel.querySelector("select").value = "all";
                paint();
              },
            }),
          }),
        );
        return;
      }
      const table = dataTable({
        caption: "Automations",
        columns,
        rows: slice,
        rowKey: (a) => a.node.slug,
        onRowClick: (a) => {
          st.selected = a.node.slug;
          bus.publish("automation.selected", { id: a.node.slug });
          openQuick(a);
        },
        density: size === "l" ? "compact" : "default",
      });
      for (const tr of table.querySelectorAll("tbody tr")) {
        tr.tabIndex = 0;
        tr.addEventListener("keydown", (e) => {
          if (e.target === tr && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            tr.click();
          }
        });
        if (tr.dataset.key === st.selected) tr.classList.add("is-selected");
        const strong = tr.querySelector("strong");
        if (strong)
          strong.replaceChildren(
            h("a", { href: `/automations/${tr.dataset.key}`, class: "wk-link" }, strong.textContent),
          );
      }
      results.append(table);
      if (hasNext || hasPrev)
        results.append(
          pager({
            nextCursor: hasNext ? st.page + 1 : null,
            onNext: () => ((st.page += 1), paint()),
            onPrev: hasPrev ? () => ((st.page -= 1), paint()) : undefined,
          }),
        );
      for (const slug of st.fresh)
        arrive(life, results.querySelector(`tr[data-key="${CSS.escape(slug)}"]`), false);
      st.fresh.clear();
    }

    function openQuick(a) {
      const body = h("div", { class: "wp-quick" });
      const draw = () => {
        const item = st.items.find((x) => x.node.slug === a.node.slug) ?? a;
        body.replaceChildren(
          h(
            "div",
            { class: "wp-quick__top" },
            item.enabled
              ? pill({ label: "Enabled", tone: "success", icon: "check-circle" })
              : pill({ label: "Disabled", tone: "neutral" }),
            item.pending_approval_id
              ? pill({ label: "Awaiting approval", tone: "warning", icon: "clock" })
              : null,
          ),
          h("p", {}, item.description),
          kv([
            ["Trigger", item.trigger_summary],
            ["Steps", number(item.step_count)],
            ["Owner", item.owner],
            [
              "Runs in 7 days",
              `${number(item.runs_7d)}${item.failures_7d ? `, ${number(item.failures_7d)} failed` : ""}`,
            ],
            ["Next fire", item.next_fire_at ? when(item.next_fire_at) : null],
            [
              "Last run",
              item.last_run
                ? `${item.last_run.status} ${rel(item.last_run.started_at ?? item.last_run.finished_at)}`
                : "Never",
            ],
          ]),
          h(
            "div",
            { class: "wk-actions" },
            linkButton({
              href: `/automations/${item.node.slug}`,
              label: "Open builder",
              icon: "edit",
              variant: "primary",
            }),
            button({
              label: "Show its runs",
              icon: "history",
              onClick: () => {
                bus.publish("automation.selected", { id: item.node.slug });
                drawer.close();
              },
            }),
          ),
        );
      };
      draw();
      const drawer = ctx.openDrawer({ title: a.node.title, width: "md", body });
    }

    const region = asyncRegion(results, life, {
      skeleton: { shape: "table", lines: 5 },
      load: () => api.call("automation.list", {}),
      render: (_host, data) => {
        st.items = data.items;
        paint();
      },
      onError: () => ctx.setCount(0),
    });
    const reload = () => region.reload();
    const reloadSoon = debounce(life, reload, 500);

    // ---------- realtime ----------
    life.add(
      rt.on("automation.run_updated", (ev) => {
        const p = ev.payload;
        const item = st.items.find((x) => x.node.slug === p.automation);
        if (!item) return reloadSoon();
        const prev = item.last_run;
        item.last_run = {
          ...(prev ?? {}),
          run_id: p.run_id,
          automation: p.automation,
          status: p.status,
          started_at: prev && prev.run_id === p.run_id ? prev.started_at : nowIso(),
          finished_at: prev?.finished_at ?? null,
        };
        st.fresh.add(item.node.slug);
        paint();
        if (p.status === "failed") live.textContent = `${item.node.title} had a failed run`;
        reloadSoon(); // counts and next fire come from the server
      }),
    );
    life.add(rt.on("approval.decided", reloadSoon));
    life.add(rt.onNode("Automation", reloadSoon));

    return () => life.dispose();
  },
};
