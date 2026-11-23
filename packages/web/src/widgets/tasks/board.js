// tasks.board: a kanban by status. Cards move by dragging, by the Move menu, or with Alt plus the left and right
// arrow keys; every move is optimistic and reverts with a toast if the server refuses it. A card opens the task
// view (fields, comments, history) in place of the board.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { menuButton } from "../../ds/js/menu.js";
import { personChip } from "../../ds/js/avatar.js";
import { emptyState } from "../../ds/js/states.js";
import { selectField } from "../../ds/js/field.js";
import { catalogEntry, schemaOf } from "../../core/widgets.js";
import { debounce, latest, region, toErrorInfo, toastError } from "../reporting/_common.js";
import { STATUS_LABEL, dueNode, mountTaskDetail, priorityPill } from "./_task.js";

const MAIN = ["open", "in_progress", "blocked", "done"];

export default {
  id: "tasks.board",
  domain: "tasks",
  title: "Task board",
  configSchema: schemaOf("tasks.board"),
  sizes: catalogEntry("tasks.board")?.sizes ?? [],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const st = {
      scope: config.scope ?? "mine",
      items: [],
      cancelled: false,
      view: "board",
      dragging: null,
      over: null,
    };
    const canAll = ctx.can("tasks:manage");
    const next = latest();
    let alive = true;
    const timers = new Set();

    const stage = region("rp-board-tasks__stage");
    const tools = h("div", { class: "rp-tools" });
    const boardEl = h("div", { class: "rp-kanban", role: "group", "aria-label": "Task board" });
    const boardView = h("div", { class: "rp-app" }, tools, stage.el);
    const detail = mountTaskDetail({
      api,
      ctx,
      nav,
      onChanged: (task) => {
        const at = st.items.findIndex((x) => x.task_id === task.task_id);
        if (at >= 0)
          st.items[at] = {
            ...st.items[at],
            status: task.status,
            priority: task.priority,
            title: task.title,
            assignee: task.assignee,
            due_at: task.due_at,
            overdue: task.overdue,
            version: task.version,
            comment_count: task.comment_count,
          };
      },
    });
    const back = button({
      label: "Back to the board",
      icon: "chevron-left",
      variant: "ghost",
      size: "sm",
      onClick: () => showBoard(),
    });
    const taskView = h("div", { class: "rp-app", hidden: true }, back, detail.el);
    el.append(h("div", { class: `rp-tasks-board rp-tasks-board--${size}` }, boardView, taskView));

    let lastOpener = null;
    function showBoard() {
      st.view = "board";
      taskView.hidden = true;
      boardView.hidden = false;
      paintBoard();
      const again =
        lastOpener && boardEl.querySelector(`[data-key="${CSS.escape(lastOpener)}"] .rp-card__title`);
      (again ?? tools.querySelector("select, button"))?.focus({ preventScroll: true });
    }
    function openTask(t) {
      lastOpener = t.task_id;
      st.view = "task";
      boardView.hidden = true;
      taskView.hidden = false;
      bus.publish("task.selected", { id: t.task_id });
      detail.open(t);
      requestAnimationFrame(() => taskView.querySelector("[data-focus]")?.focus({ preventScroll: true }));
    }

    const paintTools = () => {
      const scopeOptions = [
        { value: "mine", label: "Assigned to me" },
        { value: "created", label: "Created by me" },
        ...(canAll ? [{ value: "all", label: "Everyone" }] : []),
      ];
      tools.replaceChildren(
        selectField({
          name: "scope",
          label: "Show",
          value: st.scope,
          options: scopeOptions,
          onChange: (v) => {
            st.scope = v;
            load({ first: true });
          },
        }),
        button({
          label: "Show cancelled",
          icon: "eye",
          variant: "secondary",
          pressed: st.cancelled,
          onClick: () => {
            st.cancelled = !st.cancelled;
            paintTools();
            paintBoard();
          },
        }),
      );
    };

    // ---- loading ----
    async function load({ first = false, silent = false } = {}) {
      const ok = next();
      if (first) stage.loading({ lines: 5, shape: "card" });
      else if (!silent) stage.busy(true);
      try {
        const out = await api.call("tasks.list", { scope: st.scope, limit: 200 });
        if (!ok() || !alive) return;
        st.items = out.items;
        stage.busy(false);
        ctx.setCount(st.items.filter((t) => t.status !== "done" && t.status !== "cancelled").length);
        paintBoard();
      } catch (e) {
        if (!ok() || !alive) return;
        stage.busy(false);
        if (toErrorInfo(e).code === "FORBIDDEN") ctx.setState("unavailable", { reason: "forbidden" });
        else stage.error(e, () => load({ first: true }));
      }
    }

    // ---- moving ----
    async function move(task, status, { announceMove = true } = {}) {
      if (!status || status === task.status) return;
      const at = st.items.findIndex((x) => x.task_id === task.task_id);
      if (at < 0) return;
      const before = st.items[at];
      st.items[at] = { ...before, status };
      paintBoard(task.task_id);
      try {
        const out = await api.call("tasks.update", {
          task_id: task.task_id,
          status,
          version: before.version,
        });
        st.items[at] = { ...st.items[at], status: out.status, version: out.version, overdue: out.overdue };
        paintBoard(task.task_id);
        if (announceMove) ctx.announce(`Task moved to ${STATUS_LABEL[status]}`);
      } catch (e) {
        st.items[at] = before;
        paintBoard(task.task_id);
        const info = toastError(ctx.toast, e, "That move was not allowed");
        if (info.code === "CONFLICT") load({ silent: true });
      }
    }

    // ---- painting ----
    const columns = () => (st.cancelled ? [...MAIN, "cancelled"] : MAIN);

    const cardNode = (t) => {
      const cols = columns();
      const idx = cols.indexOf(t.status);
      const open = h(
        "button",
        { type: "button", class: "rp-card__title", onclick: () => openTask(t) },
        h("span", { class: "rp-row__no" }, `#${t.task_no} `),
        t.title,
      );
      const menu = menuButton({
        label: `Move task ${t.task_no}`,
        icon: "more",
        iconOnly: true,
        variant: "ghost",
        size: "sm",
        items: columns()
          .filter((s) => s !== t.status)
          .map((s) => ({ label: `Move to ${STATUS_LABEL[s]}`, onSelect: () => move(t, s) })),
      });
      const li = h(
        "li",
        { class: "rp-card", draggable: "true", "data-key": t.task_id },
        h("div", { class: "rp-card__head" }, open, menu),
        h(
          "div",
          { class: "rp-row__meta" },
          priorityPill(t.priority),
          t.assignee ? personChip(t.assignee) : h("span", {}, "Unassigned"),
        ),
        h(
          "div",
          { class: "rp-row__meta" },
          dueNode(t),
          t.comment_count ? h("span", {}, `${t.comment_count} comments`) : null,
        ),
      );
      li.addEventListener("dragstart", (e) => {
        st.dragging = t.task_id;
        e.dataTransfer?.setData("text/plain", t.task_id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        li.classList.add("is-dragging");
      });
      li.addEventListener("dragend", () => {
        st.dragging = null;
        li.classList.remove("is-dragging");
        for (const c of boardEl.querySelectorAll(".is-over")) c.classList.remove("is-over");
      });
      li.addEventListener("keydown", (e) => {
        if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
        e.preventDefault();
        const to = cols[idx + (e.key === "ArrowRight" ? 1 : -1)];
        if (to) move(t, to);
      });
      return li;
    };

    function paintBoard(refocus) {
      if (st.view !== "board") return;
      const active = refocus ?? document.activeElement?.closest?.("[data-key]")?.dataset.key;
      if (st.items.length === 0) {
        stage.show(
          emptyState({
            icon: "task",
            title: "No tasks yet",
            body: "Create one from the New task widget, or wait for an assignment.",
          }),
        );
        return;
      }
      const cols = columns();
      boardEl.replaceChildren(
        ...cols.map((status) => {
          const items = st.items.filter((t) => t.status === status);
          const titleId = `col-${status}-${Math.random().toString(36).slice(2, 7)}`;
          const col = h(
            "section",
            { class: "rp-col", "aria-labelledby": titleId, "data-status": status },
            h(
              "h3",
              { class: "rp-col__title", id: titleId },
              STATUS_LABEL[status],
              h("span", { class: "rp-col__count" }, String(items.length)),
            ),
            h(
              "ul",
              { class: "rp-col__list", "aria-label": `${STATUS_LABEL[status]} tasks` },
              ...items.map(cardNode),
            ),
            items.length === 0
              ? h("p", { class: "rp-col__empty" }, "Nothing here. Drop a card or use its Move menu.")
              : null,
          );
          col.addEventListener("dragover", (e) => {
            if (!st.dragging) return;
            e.preventDefault();
            col.classList.add("is-over");
          });
          col.addEventListener("dragleave", () => col.classList.remove("is-over"));
          col.addEventListener("drop", (e) => {
            e.preventDefault();
            col.classList.remove("is-over");
            const t = st.items.find((x) => x.task_id === st.dragging);
            if (t) move(t, status);
          });
          return col;
        }),
      );
      stage.show(
        boardEl,
        h(
          "p",
          { class: "rp-hint" },
          "Drag a card to change its status, or focus it and press Alt with the left or right arrow.",
        ),
      );
      if (active)
        boardEl
          .querySelector(`[data-key="${CSS.escape(active)}"] .rp-card__title`)
          ?.focus({ preventScroll: true });
    }

    // ---- realtime ----
    const refresh = debounce(() => load({ silent: true }), 500);
    const mark = (id) => {
      const card = boardEl.querySelector(`[data-key="${CSS.escape(id)}"]`);
      if (!card) return;
      card.classList.add("u-arrive");
      const t = setTimeout(() => (timers.delete(t), card.classList.remove("u-arrive")), 6000);
      timers.add(t);
    };
    const offs = [
      rt.on("task.assigned", () => refresh()),
      rt.on("task.updated", (ev) => {
        const at = st.items.findIndex((x) => x.task_id === ev.payload.task_id);
        if (at >= 0 && st.items[at].status !== ev.payload.status) {
          st.items[at] = { ...st.items[at], status: ev.payload.status };
          paintBoard();
          mark(ev.payload.task_id);
        }
        if (detail.taskId === ev.payload.task_id) detail.reload();
        refresh();
      }),
    ];

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
