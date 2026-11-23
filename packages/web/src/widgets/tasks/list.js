// tasks.list: tasks with filters, an inline status control and the task view (fields, comments, history) inside
// the widget. List and task views sit side by side when the widget is wide. Realtime keeps rows current.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { pill } from "../../ds/js/pill.js";
import { personChip } from "../../ds/js/avatar.js";
import { emptyState } from "../../ds/js/states.js";
import { pager } from "../../ds/js/table.js";
import { searchField, selectField } from "../../ds/js/field.js";
import { number } from "../../ds/js/format.js";
import { catalogEntry, schemaOf } from "../../core/widgets.js";
import {
  debounce,
  isCompact,
  latest,
  nowIso,
  region,
  toErrorInfo,
  toastError,
} from "../reporting/_common.js";
import { splitPane } from "../reporting/_split.js";
import {
  STATUSES,
  STATUS_LABEL,
  dueNode,
  isTerminal,
  mountTaskDetail,
  priorityOptions,
  priorityPill,
  statusOptions,
} from "./_task.js";
import { statusPill } from "../../ds/js/pill.js";

const SORTS = [
  { value: "server", label: "Default order" },
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "newest", label: "Newest" },
];
const RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

export default {
  id: "tasks.list",
  domain: "tasks",
  title: "Tasks",
  configSchema: schemaOf("tasks.list"),
  sizes: catalogEntry("tasks.list")?.sizes ?? [],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const compact = isCompact(size);
    const canAll = ctx.can("tasks:manage");
    const st = {
      scope: config.scope ?? "mine",
      statuses: new Set(config.status ?? []),
      priority: "any",
      q: "",
      overdue: false,
      sort: "server",
      items: [],
      counts: {},
      cursor: null,
      next: null,
      stack: [],
      selected: null,
      arrived: new Set(),
    };
    const pageSize = config.page_size ?? (compact ? 5 : 25);
    const next = latest();
    let alive = true;
    const timers = new Set();

    const list = region("rp-tasks__list");
    const tools = h("div", { class: "rp-tools" });
    const filters = h("div", { class: "rp-filters", role: "group", "aria-label": "Status filter" });
    const pane = splitPane({
      label: "Tasks",
      placeholder: emptyState({
        icon: "task",
        title: "Select a task",
        body: "Its fields, comments and history appear here.",
      }),
    });
    pane.list.append(list.el);
    const detail = mountTaskDetail({
      api,
      ctx,
      nav,
      onChanged: (task) => {
        const at = st.items.findIndex((x) => x.task_id === task.task_id);
        if (at >= 0) {
          st.items[at] = { ...st.items[at], ...pickSummary(task) };
          paintList();
        }
      },
    });
    pane.detail.append(detail.el);
    pane.clearDetail();
    const root = h(
      "div",
      { class: `rp-app rp-tasks rp-tasks--${size}` },
      compact ? null : tools,
      compact ? null : filters,
      pane.el,
    );
    el.append(root);

    const pickSummary = (t) => ({
      status: t.status,
      priority: t.priority,
      title: t.title,
      assignee: t.assignee,
      due_at: t.due_at,
      overdue: t.overdue,
      comment_count: t.comment_count,
      version: t.version,
    });

    // ---- toolbar ----
    const paintTools = () => {
      if (compact) return;
      const scopeOptions = [
        { value: "mine", label: "Assigned to me" },
        { value: "created", label: "Created by me" },
        ...(canAll ? [{ value: "all", label: "Everyone" }] : []),
      ];
      const search = searchField({
        name: "q",
        label: "Search tasks",
        value: st.q,
        placeholder: "Title",
        onInput: debounce((v) => {
          st.q = v;
          reset();
        }, 300),
      });
      search.classList.add("c-field--grow");
      tools.replaceChildren(
        selectField({
          name: "scope",
          label: "Show",
          value: st.scope,
          options: scopeOptions,
          onChange: (v) => ((st.scope = v), reset()),
        }),
        selectField({
          name: "priority",
          label: "Priority",
          value: st.priority,
          options: [{ value: "any", label: "Any priority" }, ...priorityOptions],
          onChange: (v) => ((st.priority = v), reset()),
        }),
        selectField({
          name: "sort",
          label: "Sort",
          value: st.sort,
          options: SORTS,
          onChange: (v) => ((st.sort = v), paintList()),
        }),
        search,
        button({
          label: "Overdue only",
          icon: "alert",
          variant: "secondary",
          pressed: st.overdue,
          onClick: () => ((st.overdue = !st.overdue), reset()),
        }),
      );
      filters.replaceChildren(
        ...STATUSES.map((s) =>
          button({
            label: `${STATUS_LABEL[s]}${st.counts[s] !== undefined ? ` (${number(st.counts[s])})` : ""}`,
            size: "sm",
            variant: "secondary",
            pressed: st.statuses.has(s),
            onClick: () => {
              if (st.statuses.has(s)) st.statuses.delete(s);
              else st.statuses.add(s);
              reset();
            },
          }),
        ),
      );
    };

    const reset = () => {
      st.cursor = null;
      st.stack = [];
      paintTools();
      load({ first: true });
    };

    // ---- loading ----
    async function load({ first = false, silent = false } = {}) {
      const ok = next();
      if (first) list.loading({ lines: 4 });
      else if (!silent) list.busy(true);
      try {
        const out = await api.call("tasks.list", {
          scope: st.scope,
          status: st.statuses.size ? [...st.statuses] : undefined,
          priority: st.priority === "any" ? undefined : [st.priority],
          q: st.q.trim() || undefined,
          due_before: st.overdue ? nowIso() : undefined,
          cursor: st.cursor ?? undefined,
          limit: pageSize,
        });
        if (!ok() || !alive) return;
        st.items = out.items;
        st.next = out.next_cursor;
        st.counts = out.status_counts ?? {};
        list.busy(false);
        ctx.setCount(
          Object.entries(st.counts)
            .filter(([k]) => !isTerminal(k))
            .reduce((a, [, n]) => a + n, 0) || st.items.length,
        );
        paintTools();
        paintList();
      } catch (e) {
        if (!ok() || !alive) return;
        list.busy(false);
        if (toErrorInfo(e).code === "FORBIDDEN") ctx.setState("unavailable", { reason: "forbidden" });
        else list.error(e, () => load({ first: true }));
      }
    }

    // ---- list ----
    const sorted = () => {
      const rows = [...st.items];
      if (st.sort === "due") rows.sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"));
      else if (st.sort === "priority") rows.sort((a, b) => (RANK[a.priority] ?? 9) - (RANK[b.priority] ?? 9));
      else if (st.sort === "newest") rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return rows;
    };

    const changeStatus = async (task, status, selectEl) => {
      if (status === task.status) return;
      const before = task.status;
      const at = st.items.findIndex((x) => x.task_id === task.task_id);
      st.items[at] = { ...task, status };
      paintList();
      try {
        const out = await api.call("tasks.update", { task_id: task.task_id, status, version: task.version });
        st.items[at] = { ...st.items[at], ...pickSummary(out) };
        paintList();
        if (detail.taskId === task.task_id) detail.reload();
        ctx.announce(`Task moved to ${STATUS_LABEL[status]}`);
      } catch (e) {
        st.items[at] = { ...st.items[at], status: before };
        paintList();
        const info = toastError(ctx.toast, e, "Could not change the status");
        if (info.code === "CONFLICT") load({ silent: true });
      }
    };

    const rowNode = (t) => {
      const sel = h(
        "select",
        {
          class: "c-field__control rp-inline-select",
          "aria-label": `Status of task ${t.task_no}`,
          onchange: (e) => changeStatus(t, e.target.value, e.target),
        },
        ...statusOptions.map((o) =>
          h("option", { value: o.value, selected: o.value === t.status ? true : null }, o.label),
        ),
      );
      const li = h(
        "li",
        {
          class: `rp-row${st.selected === t.task_id ? " is-selected" : ""}${isTerminal(t.status) ? " is-done" : ""}`,
          "data-key": t.task_id,
        },
        h(
          "div",
          { class: "rp-row__main" },
          h(
            "button",
            {
              type: "button",
              class: "rp-row__title",
              "aria-current": st.selected === t.task_id ? "true" : null,
              onclick: () => select(t),
            },
            h("span", { class: "rp-row__no" }, `#${t.task_no}`),
            t.title,
          ),
          h(
            "div",
            { class: "rp-row__meta" },
            priorityPill(t.priority),
            t.assignee ? personChip(t.assignee) : h("span", {}, "Unassigned"),
            dueNode(t),
            t.comment_count
              ? h("span", {}, `${t.comment_count} ${t.comment_count === 1 ? "comment" : "comments"}`)
              : null,
            st.arrived.has(t.task_id) ? pill({ label: "New", tone: "signal" }) : null,
          ),
        ),
        compact
          ? h("div", { class: "rp-row__side" }, statusPill("task", t.status))
          : h("div", { class: "rp-row__side" }, sel),
      );
      return li;
    };

    function paintList() {
      const rows = sorted();
      if (rows.length === 0) {
        const filtered = st.statuses.size || st.q || st.overdue || st.priority !== "any";
        list.show(
          emptyState({
            icon: "task",
            title: filtered ? "No tasks match these filters" : "No tasks here",
            body: filtered
              ? "Loosen a filter to see more."
              : "Tasks assigned to you, and ones you create, appear here.",
            action: filtered
              ? button({
                  label: "Clear filters",
                  variant: "secondary",
                  onClick: () => {
                    st.statuses.clear();
                    st.q = "";
                    st.overdue = false;
                    st.priority = "any";
                    reset();
                  },
                })
              : undefined,
          }),
        );
        return;
      }
      const pg =
        st.next || st.stack.length
          ? pager({
              label: "Task pages",
              nextCursor: st.next,
              onNext: (c) => {
                st.stack.push(st.cursor);
                st.cursor = c;
                load({});
              },
              onPrev: st.stack.length
                ? () => {
                    st.cursor = st.stack.pop();
                    load({});
                  }
                : undefined,
            })
          : null;
      list.show(h("ul", { class: "rp-rows", "aria-label": "Tasks" }, ...rows.map(rowNode)), pg);
    }

    function select(t, publish = true) {
      st.selected = t.task_id;
      st.arrived.delete(t.task_id);
      if (publish) bus.publish("task.selected", { id: t.task_id });
      paintList();
      detail.open(t);
      pane.showDetail();
    }

    // ---- bus and realtime ----
    const offs = [
      bus.subscribe("task.selected", (p) => {
        if (!p?.id || p.id === st.selected) return;
        const known = st.items.find((x) => x.task_id === p.id);
        st.selected = p.id;
        paintList();
        detail.open(known ?? { task_id: p.id });
        pane.showDetail();
      }),
    ];
    const refresh = debounce(() => {
      if (st.cursor === null) load({ silent: true });
    }, 500);
    const mark = (id) => {
      const row = list.el.querySelector(`[data-key="${CSS.escape(id)}"]`);
      if (!row) return;
      row.classList.add("u-arrive");
      const t = setTimeout(() => (timers.delete(t), row.classList.remove("u-arrive")), 6000);
      timers.add(t);
    };
    offs.push(
      rt.on("task.assigned", (ev) => {
        if (!st.items.some((x) => x.task_id === ev.payload.task_id)) st.arrived.add(ev.payload.task_id);
        refresh();
      }),
      rt.on("task.updated", (ev) => {
        const at = st.items.findIndex((x) => x.task_id === ev.payload.task_id);
        if (at >= 0) {
          st.items[at] = { ...st.items[at], status: ev.payload.status };
          paintList();
          mark(ev.payload.task_id);
        }
        if (detail.taskId === ev.payload.task_id) detail.reload();
        refresh();
      }),
      rt.on("task.commented", (ev) => {
        if (detail.taskId === ev.payload.task_id) detail.reload();
        else refresh();
      }),
    );

    paintTools();
    load({ first: true });
    return () => {
      alive = false;
      refresh.cancel();
      detail.destroy();
      for (const t of timers) clearTimeout(t);
      for (const off of offs) off();
    };
  },
};
