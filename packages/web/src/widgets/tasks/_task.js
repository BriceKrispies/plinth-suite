// Shared by tasks.list and tasks.board: vocabulary, small renderers, and the task detail view (fields, status and
// priority with optimistic updates, due date, assignee, comments, history).
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { icon } from "../../ds/js/icons.js";
import { pill, statusPill } from "../../ds/js/pill.js";
import { personChip } from "../../ds/js/avatar.js";
import { emptyState } from "../../ds/js/states.js";
import { dateTimeField, selectField, textArea, textField } from "../../ds/js/field.js";
import { inlineText } from "../../ds/js/richtext.js";
import { dateTime } from "../../ds/js/format.js";
import {
  PRIORITY_LABEL,
  PRIORITY_TONE,
  isStale,
  isoToLocalInput,
  keyValues,
  localInputToIso,
  region,
  timeNode,
  toErrorInfo,
  toastError,
} from "../reporting/_common.js";

export const STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"];
export const STATUS_LABEL = {
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};
export const PRIORITIES = ["low", "normal", "high", "urgent"];

export const statusOptions = STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] }));
export const priorityOptions = PRIORITIES.map((value) => ({ value, label: PRIORITY_LABEL[value] }));

export const priorityPill = (p) =>
  pill({ label: PRIORITY_LABEL[p] ?? p, tone: PRIORITY_TONE[p] ?? "neutral" });

/** The due date of a task as a short node with an overdue marker (never colour alone). */
export const dueNode = (task) => {
  if (!task.due_at) return h("span", { class: "u-muted" }, "No due date");
  return h(
    "span",
    { class: "rp-due" },
    h("span", {}, "Due "),
    timeNode(task.due_at),
    task.overdue ? pill({ label: "Overdue", tone: "danger", icon: "alert" }) : null,
  );
};

export const isTerminal = (status) => status === "done" || status === "cancelled";

/**
 * The task view. `mountTaskDetail({ api, ctx, nav, onChanged })` returns `{ el, open(summary), reload(), taskId,
 * destroy() }`. `onChanged(task)` is called after each successful change so the caller can update its own rows.
 */
export const mountTaskDetail = ({ api, ctx, nav, onChanged }) => {
  const stage = region("rp-task");
  let task = null;
  let seed = null;
  let editing = false;
  let busy = false;
  let commentKey = api.idempotencyKey("tc");
  let loadToken = 0;
  const me = () => ctx.me?.principal?.subject;

  const apply = (out) => {
    task = { ...task, ...out };
    onChanged?.(task);
    paint();
  };

  async function patch(fields, optimistic, okMessage) {
    if (busy || !task) return;
    const before = task;
    busy = true;
    if (optimistic) {
      task = { ...task, ...optimistic };
      paint();
    }
    try {
      const out = await api.call("tasks.update", {
        task_id: before.task_id,
        version: before.version,
        ...fields,
      });
      task = { ...before, ...out };
      onChanged?.(task);
      if (okMessage) ctx.announce(okMessage);
    } catch (e) {
      task = before;
      const info = toastError(ctx.toast, e, "Could not update the task");
      if (isStale(info) || info.details?.reason === "INVALID_TRANSITION") await reload(true);
    } finally {
      busy = false;
      paint();
    }
  }

  const fieldRow = (label, node) => [h("dt", {}, label), h("dd", {}, node)];

  function titleBlock() {
    if (!editing)
      return h(
        "header",
        { class: "rp-detail__head" },
        h(
          "h3",
          { class: "rp-detail__heading", tabindex: "-1", "data-focus": "" },
          `#${task.task_no} ${task.title}`,
        ),
        h(
          "div",
          { class: "rp-detail__pills" },
          statusPill("task", task.status),
          priorityPill(task.priority),
          task.source === "automation" ? pill({ label: "From an automation", icon: "workflow" }) : null,
        ),
        task.description
          ? h("p", { class: "rp-prewrap" }, inlineText(task.description))
          : h("p", { class: "u-muted" }, "No description."),
        h(
          "div",
          { class: "rp-detail__actions" },
          button({
            label: "Edit",
            icon: "edit",
            size: "sm",
            variant: "secondary",
            onClick: () => ((editing = true), paint()),
          }),
        ),
      );
    const title = textField({ name: "/title", label: "Title", value: task.title, required: true });
    const desc = textArea({ name: "/description", label: "Description", value: task.description, rows: 5 });
    const error = h("div", { role: "alert" });
    return h(
      "form",
      {
        class: "rp-form",
        "aria-label": "Edit task",
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          const t = title.querySelector("input").value.trim();
          if (!t) {
            error.replaceChildren(h("p", { class: "rp-form__error" }, "A task needs a title."));
            title.querySelector("input").focus();
            return;
          }
          editing = false;
          await patch(
            { title: t, description: desc.querySelector("textarea").value },
            undefined,
            "Task saved",
          );
        },
      },
      title,
      desc,
      error,
      h(
        "div",
        { class: "rp-form__actions" },
        button({ label: "Cancel", variant: "ghost", onClick: () => ((editing = false), paint()) }),
        button({ label: "Save", variant: "primary", type: "submit" }),
      ),
    );
  }

  function fieldsBlock() {
    const status = selectField({
      name: "/status",
      label: "Status",
      value: task.status,
      options: statusOptions,
      onChange: (v) =>
        v !== task.status && patch({ status: v }, { status: v }, `Task moved to ${STATUS_LABEL[v]}`),
    });
    const priority = selectField({
      name: "/priority",
      label: "Priority",
      value: task.priority,
      options: priorityOptions,
      onChange: (v) => v !== task.priority && patch({ priority: v }, { priority: v }),
    });
    const due = dateTimeField({ name: "/due_at", label: "Due", value: isoToLocalInput(task.due_at) });
    const dueInput = due.querySelector("input");
    const saveDue = button({
      label: "Set due date",
      size: "sm",
      variant: "secondary",
      onClick: () => {
        const iso = localInputToIso(dueInput.value);
        if (iso) patch({ due_at: iso }, { due_at: iso });
      },
    });
    const clearDue = task.due_at
      ? button({
          label: "Clear",
          size: "sm",
          variant: "ghost",
          onClick: () => patch({ due_at: null }, { due_at: null }),
        })
      : null;
    const mine = task.assignee?.subject === me();
    return h(
      "div",
      { class: "rp-fields" },
      h("div", { class: "rp-form__row" }, status, priority),
      h("div", { class: "rp-fields__due" }, due, saveDue, clearDue),
      h(
        "dl",
        { class: "rp-kv" },
        ...fieldRow(
          "Assignee",
          task.assignee ? personChip(task.assignee) : h("span", { class: "u-muted" }, "Unassigned"),
        ),
        ...fieldRow("Created by", personChip(task.created_by)),
        ...fieldRow("Created", timeNode(task.created_at)),
        task.completed_at ? fieldRow("Completed", timeNode(task.completed_at)) : [],
        task.link ? fieldRow("Linked to", h("a", { href: task.link.href }, `${task.link.label}`)) : [],
      ),
      h(
        "div",
        { class: "rp-detail__actions" },
        !mine
          ? button({
              label: "Assign to me",
              icon: "user",
              size: "sm",
              variant: "secondary",
              onClick: () => patch({ assignee: me() }, undefined, "Assigned to you"),
            })
          : null,
        task.assignee
          ? button({
              label: "Unassign",
              icon: "x",
              size: "sm",
              variant: "ghost",
              onClick: () => patch({ assignee: null }),
            })
          : null,
      ),
    );
  }

  function commentsBlock() {
    const body = textArea({
      name: "/body",
      label: "Add a comment",
      rows: 3,
      hint: "Use @handle to mention someone.",
    });
    const area = body.querySelector("textarea");
    const error = h("div", { role: "alert" });
    const list = task.comments.length
      ? h(
          "ol",
          { class: "rp-comments", "aria-label": "Comments" },
          ...task.comments.map((c) =>
            h(
              "li",
              { class: "rp-comment" },
              h("div", { class: "rp-comment__meta" }, personChip(c.author), timeNode(c.created_at)),
              h(
                "p",
                { class: "rp-prewrap" },
                inlineText(c.body, { mentions: (hdl) => nav.href(`/people/${hdl}`) }),
              ),
            ),
          ),
        )
      : h("p", { class: "u-muted" }, "No comments yet.");
    const submitBtn = button({
      label: "Comment",
      icon: "send",
      variant: "primary",
      size: "sm",
      type: "submit",
    });
    const form = h(
      "form",
      {
        class: "rp-form",
        "aria-label": "Add a comment",
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          const text = area.value.trim();
          if (!text) {
            error.replaceChildren(h("p", { class: "rp-form__error" }, "Write something first."));
            area.focus();
            return;
          }
          error.replaceChildren();
          submitBtn.setAttribute("aria-busy", "true");
          try {
            const c = await api.call("tasks.comment", {
              task_id: task.task_id,
              body: text,
              idempotency_key: commentKey,
            });
            commentKey = api.idempotencyKey("tc");
            task = { ...task, comments: [...task.comments, c], comment_count: task.comment_count + 1 };
            onChanged?.(task);
            paint();
            ctx.announce("Comment added");
          } catch (err) {
            submitBtn.removeAttribute("aria-busy");
            error.replaceChildren(
              h("p", { class: "rp-form__error" }, toErrorInfo(err).message ?? "Could not add the comment."),
            );
          }
        },
      },
      body,
      error,
      h("div", { class: "rp-form__actions" }, submitBtn),
    );
    return h(
      "section",
      { class: "rp-detail__section" },
      h("h4", { class: "rp-detail__title" }, `Comments (${task.comment_count})`),
      list,
      form,
    );
  }

  function historyBlock() {
    if (!task.history?.length) return null;
    return h(
      "section",
      { class: "rp-detail__section" },
      h("h4", { class: "rp-detail__title" }, "History"),
      h(
        "ol",
        { class: "rp-history", "aria-label": "History" },
        ...task.history.map((e) =>
          h(
            "li",
            {},
            personChip(e.actor),
            h("span", {}, ` changed ${e.changed.join(", ") || "the task"} `),
            h("time", { class: "u-muted", datetime: e.at, title: dateTime(e.at) }, dateTime(e.at)),
          ),
        ),
      ),
    );
  }

  function paint() {
    if (!task) return;
    stage.show(
      h(
        "article",
        { class: "rp-detail", "aria-label": task.title, "aria-busy": busy ? "true" : null },
        titleBlock(),
        fieldsBlock(),
        commentsBlock(),
        historyBlock(),
      ),
    );
  }

  async function reload(silent = false) {
    if (!seed) return;
    const mine = ++loadToken;
    if (!task) stage.loading({ lines: 5 });
    try {
      const out = await api.call("tasks.get", { task_id: seed.task_id });
      if (mine !== loadToken) return;
      task = out;
      onChanged?.(task);
      paint();
    } catch (e) {
      if (mine !== loadToken) return;
      const info = toErrorInfo(e);
      if (info.code === "UNKNOWN_REFERENCE" || info.code === "FORBIDDEN")
        stage.show(emptyState({ icon: "lock", title: "This task is not available", body: info.message }));
      else stage.error(e, () => reload());
    }
  }

  return {
    el: stage.el,
    get taskId() {
      return seed?.task_id ?? null;
    },
    /** Show a task: `summary` (a TaskSummary or `{ task_id }`) paints at once, the detail loads behind it. */
    open(summary) {
      seed = summary;
      editing = false;
      task = summary.comments ? summary : null;
      if (task) paint();
      else if (summary.title) {
        task = {
          comments: [],
          history: [],
          description: "",
          comment_count: summary.comment_count ?? 0,
          ...summary,
        };
        paint();
      }
      return reload(true);
    },
    reload: () => reload(true),
    destroy() {
      loadToken += 1;
    },
  };
};

/** Shared small icon for a task row. */
export const taskIcon = () => icon("task", { size: 16 });

export { keyValues };
