import { Effect, Schema as S } from "effect";
import { SuiteWork, TASK_STATUSES } from "@plinth/spec";
import { Authorizer } from "../../authz";
import { emitFrom } from "../domain-events";
import { createNotifications } from "../notify";
import { nextCounter } from "../program";
import { newId } from "../ids";
import type { ActionCtx, HandlerError, SuiteEnv, ActionHandler } from "../types";
import type { HandlerTable } from "./stub";
import {
  ISO,
  clip,
  decodeCursor,
  dom,
  encodeCursor,
  limitOf,
  mentionHandles,
  pgArr,
  personRefs,
  q,
  ref,
  refusal,
} from "./util3";

/**
 * Module `tasks` (CONTRACT.md 12.6). `task_no` from `suite_counters`; anyone with `tasks:use` creates tasks for
 * themselves, assigning someone else needs `tasks:manage`; updates by the assignee, the creator or `tasks:manage` with an
 * optimistic `version`; `done` sets `completed_at`; `done` and `cancelled` are terminal except by `tasks:manage`.
 */

type In<K extends keyof typeof SuiteWork> = (typeof SuiteWork)[K] extends S.Schema.Any
  ? S.Schema.Type<(typeof SuiteWork)[K]>
  : never;
type Detail = S.Schema.Type<typeof SuiteWork.TaskDetailOut>;
type Summary = S.Schema.Type<typeof SuiteWork.TaskSummary>;

const OPEN = ["open", "in_progress", "blocked"];

const mayManage = (ctx: ActionCtx) =>
  Effect.gen(function* () {
    const authz = yield* Authorizer;
    const d = yield* authz.authorize(
      ctx.principal,
      "tasks:manage",
      `plinth://${ctx.principal.workspaceSlug}/suite/tasks`,
    );
    return d.kind === "allow";
  });

interface TaskRow {
  task_id: string;
  task_no: number;
  title: string;
  description: string;
  status: Summary["status"];
  priority: Summary["priority"];
  assignee_id: string | null;
  created_by: string;
  created_at: string;
  due_at: string | null;
  completed_at: string | null;
  link: Summary["link"];
  source: "manual" | "automation";
  run_id: string | null;
  version: number;
  overdue: boolean;
  comment_count: string;
}

const taskSql = (now: string) => `
  SELECT t.task_id, t.task_no, t.title, t.description, t.status, t.priority, t.assignee_id, t.created_by,
         ${ISO("t.created_at")} AS created_at, ${ISO("t.due_at")} AS due_at, ${ISO("t.completed_at")} AS completed_at,
         t.link, t.source, t.run_id, t.version,
         (t.due_at IS NOT NULL AND t.due_at < ${now}::timestamptz AND t.status NOT IN ('done', 'cancelled')) AS overdue,
         (SELECT count(*) FROM task_comments c WHERE c.task_id = t.task_id)::text AS comment_count
  FROM tasks t`;

const summariesOf = (ws: string, rows: ReadonlyArray<TaskRow>) =>
  Effect.gen(function* () {
    const refs = yield* personRefs(ws, [
      ...rows.flatMap((r) => (r.assignee_id ? [r.assignee_id] : [])),
      ...rows.map((r) => r.created_by),
    ]);
    return rows.map(
      (r): Summary =>
        ({
          task_id: r.task_id,
          task_no: r.task_no,
          title: r.title,
          status: r.status,
          priority: r.priority,
          assignee: r.assignee_id ? ref(refs, r.assignee_id) : null,
          created_by: ref(refs, r.created_by),
          created_at: r.created_at,
          due_at: r.due_at,
          overdue: r.overdue,
          link: r.link,
          source: r.source,
          comment_count: Number(r.comment_count),
          version: r.version,
        }) as Summary,
    );
  });

/** May the caller see this task? Assignee, creator or tasks:manage. */
const canSee = (ctx: ActionCtx, r: Pick<TaskRow, "assignee_id" | "created_by">) =>
  Effect.gen(function* () {
    if (r.assignee_id === ctx.principal.id || r.created_by === ctx.principal.id) return true;
    if (ctx.onBehalfOf && (r.assignee_id === ctx.onBehalfOf.id || r.created_by === ctx.onBehalfOf.id))
      return true;
    return yield* mayManage(ctx);
  });

const notFound = () => dom("UNKNOWN_REFERENCE", "/task_id", "no such task");

const loadTask = (ctx: ActionCtx, id: string, lock = false) =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const rows = yield* q<TaskRow>(
      `${taskSql("$3")} WHERE t.workspace_id = $1 AND t.task_id = $2${lock ? " FOR UPDATE OF t" : ""}`,
      [ws, id, ctx.now.toISOString()],
    );
    const r = rows[0];
    if (!r || !(yield* canSee(ctx, r))) return yield* Effect.fail(notFound());
    return r;
  });

const detailOf = (ctx: ActionCtx, id: string, replayed?: boolean) =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const rows = yield* q<TaskRow>(`${taskSql("$3")} WHERE t.workspace_id = $1 AND t.task_id = $2`, [
      ws,
      id,
      ctx.now.toISOString(),
    ]);
    const r = rows[0];
    if (!r) return yield* Effect.fail(notFound());
    const [summary] = yield* summariesOf(ws, [r]);
    const comments = yield* q<{ comment_id: string; author_id: string; body: string; created_at: string }>(
      `SELECT comment_id, author_id, body, ${ISO("created_at")} AS created_at FROM task_comments WHERE task_id = $1 ORDER BY created_at, comment_id`,
      [id],
    );
    const history = yield* q<{ actor_id: string; at: string; changed: string[] }>(
      `SELECT actor_id, ${ISO("at")} AS at, changed FROM task_history WHERE task_id = $1 ORDER BY version`,
      [id],
    );
    const refs = yield* personRefs(ws, [
      ...comments.map((c) => c.author_id),
      ...history.map((h) => h.actor_id),
    ]);
    return {
      ...(summary as Summary),
      description: r.description,
      completed_at: r.completed_at,
      run_id: r.run_id,
      comments: comments.map((c) => ({
        comment_id: c.comment_id,
        author: ref(refs, c.author_id),
        body: c.body,
        created_at: c.created_at,
      })),
      history: history.map((h) => ({ at: h.at, actor: ref(refs, h.actor_id), changed: h.changed })),
      ...(replayed === undefined ? {} : { replayed }),
    } as Detail;
  });

// ---- list / get ----------------------------------------------------------------------------------------

const list: ActionHandler<In<"TasksListIn">, S.Schema.Type<typeof SuiteWork.TasksListOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const me = ctx.principal.id;
      const scope = input.scope ?? "mine";
      if (scope === "all" && !(yield* mayManage(ctx)))
        return yield* Effect.fail(
          dom("FORBIDDEN", "/scope", "scope=all needs tasks:manage", {
            details: { reason: "no_grant", permission: "tasks:manage" },
          }),
        );
      const params: unknown[] = [ws];
      const base = ["t.workspace_id = $1"];
      if (scope === "mine") {
        params.push(me);
        base.push(`t.assignee_id = $${params.length}`);
      } else if (scope === "created") {
        params.push(me);
        base.push(`t.created_by = $${params.length}`);
      }
      const counts = yield* q<{ status: string; n: string }>(
        `SELECT t.status, count(*)::text AS n FROM tasks t WHERE ${base.join(" AND ")} GROUP BY t.status`,
        params,
      );
      params.push(ctx.now.toISOString());
      const nowParam = `$${params.length}`;
      const where = [...base];
      if (input.status && input.status.length > 0) {
        params.push(pgArr(input.status));
        where.push(`t.status = ANY($${params.length}::text[])`);
      }
      if (input.priority && input.priority.length > 0) {
        params.push(pgArr(input.priority));
        where.push(`t.priority = ANY($${params.length}::text[])`);
      }
      if (input.q) {
        params.push(input.q);
        where.push(
          `(t.title ILIKE '%' || $${params.length} || '%' OR t.description ILIKE '%' || $${params.length} || '%')`,
        );
      }
      if (input.due_before) {
        params.push(input.due_before);
        where.push(`t.due_at < $${params.length}::timestamptz`);
      }
      const cur = decodeCursor(input.cursor);
      if (cur && cur.length === 1) {
        params.push(Number(cur[0]));
        where.push(`t.task_no < $${params.length}`);
      }
      const limit = limitOf(input.limit);
      params.push(limit + 1);
      const rows = yield* q<TaskRow>(
        `${taskSql(nowParam)} WHERE ${where.join(" AND ")} ORDER BY t.task_no DESC LIMIT $${params.length}`,
        params,
      );
      const page = rows.slice(0, limit);
      const items = yield* summariesOf(ws, page);
      const status_counts: Record<string, number> = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0]));
      for (const c of counts) status_counts[c.status] = Number(c.n);
      const last = page[page.length - 1];
      return {
        items,
        next_cursor: rows.length > limit && last ? encodeCursor([last.task_no]) : null,
        status_counts,
      } as never;
    }),
};

const get: ActionHandler<In<"TaskIn">, Detail> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      yield* loadTask(ctx, input.task_id);
      return yield* detailOf(ctx, input.task_id);
    }),
};

// ---- assignment ----------------------------------------------------------------------------------------

const resolveAssignee = (ctx: ActionCtx, subject: string) =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const name = subject.slice(subject.indexOf(":") + 1);
    const rows = yield* q<{ principal_id: string; subject: string; disabled: boolean; kind: string }>(
      `SELECT p.principal_id, p.subject, (p.disabled_at IS NOT NULL) AS disabled, p.kind
       FROM principals p LEFT JOIN members m ON m.member_id = p.principal_id
       WHERE p.workspace_id = $1 AND (p.subject = $2 OR m.handle = $3) ORDER BY (p.subject = $2) DESC LIMIT 1`,
      [ws, subject, name],
    );
    const r = rows[0];
    if (!r) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/assignee", `no principal '${subject}'`));
    if (r.disabled)
      return yield* Effect.fail(
        refusal("RULE_REFUSED", "MEMBER_DISABLED", `${subject} is disabled`, { assignee: subject }),
      );
    return { id: r.principal_id, subject: r.subject };
  });

/** Assigning someone other than yourself (or the person you act for) needs tasks:manage. */
const checkMayAssign = (ctx: ActionCtx, assigneeId: string) =>
  Effect.gen(function* () {
    if (assigneeId === ctx.principal.id || assigneeId === ctx.onBehalfOf?.id) return;
    if (yield* mayManage(ctx)) return;
    return yield* Effect.fail(
      dom("FORBIDDEN", "/assignee", "assigning someone else needs tasks:manage", {
        details: { reason: "no_grant", permission: "tasks:manage" },
        retryable: false,
      }),
    );
  });

const announceAssigned = (
  ctx: ActionCtx,
  t: { task_id: string; task_no: number; title: string; priority: string; due_at: string | null },
  assignee: { id: string; subject: string },
) =>
  Effect.gen(function* () {
    const seq = yield* emitFrom(ctx, "task.assigned", {
      audience: [...new Set([assignee.subject, ctx.principal.subject])],
      subject: { kind: "task", id: t.task_id },
      member: assignee,
      payload: {
        task_id: t.task_id,
        task_no: t.task_no,
        title: clip(t.title, 140),
        priority: t.priority as never,
        due_at: t.due_at as never,
        assignee: assignee.subject,
      },
    });
    if (assignee.id !== ctx.principal.id)
      yield* createNotifications(ctx, {
        recipients: [assignee],
        type: "task_assigned",
        title: clip(`Task #${t.task_no} assigned to you`, 140),
        body: clip(t.title, 500),
        link: `/tasks`,
        actorId: ctx.principal.id,
        subject: { kind: "task", id: t.task_id },
        sourceEventSeq: seq,
        dedupeKey: `${seq}:task_assigned`,
      });
  });

// ---- create --------------------------------------------------------------------------------------------

const create: ActionHandler<In<"TaskCreateIn">, Detail> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      if (input.assignee) {
        const a = yield* resolveAssignee(ctx, input.assignee);
        yield* checkMayAssign(ctx, a.id);
      }
      return {
        effect: `Create task "${clip(input.title, 60)}"${input.assignee ? ` for ${input.assignee}` : ""}`,
        facts: {
          priority: input.priority ?? "normal",
          assignee: input.assignee ?? null,
          due_at: input.due_at ?? null,
        },
      };
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      let assignee: { id: string; subject: string } | null = null;
      if (input.assignee) {
        assignee = yield* resolveAssignee(ctx, input.assignee);
        yield* checkMayAssign(ctx, assignee.id);
      } else if (ctx.principal.kind === "human")
        assignee = { id: ctx.principal.id, subject: ctx.principal.subject };
      else if (ctx.onBehalfOf) assignee = { id: ctx.onBehalfOf.id, subject: ctx.onBehalfOf.subject };
      const taskId = newId();
      const no = yield* nextCounter(ws, "task");
      const now = ctx.now.toISOString();
      yield* q(
        `INSERT INTO tasks (task_id, workspace_id, task_no, title, description, status, priority, assignee_id, created_by,
                            created_at, updated_at, due_at, link, source, version)
         VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9::timestamptz, $9::timestamptz, $10::timestamptz, $11::jsonb, 'manual', 1)`,
        [
          taskId,
          ws,
          no,
          input.title,
          input.description ?? "",
          input.priority ?? "normal",
          assignee?.id ?? null,
          ctx.principal.id,
          now,
          input.due_at ?? null,
          input.link ? JSON.stringify(input.link) : null,
        ],
      );
      yield* q(
        `INSERT INTO task_history (task_id, version, actor_id, at, changed) VALUES ($1, 1, $2, $3::timestamptz, $4::text[])`,
        [taskId, ctx.principal.id, now, pgArr(["created"])],
      );
      if (assignee)
        yield* announceAssigned(
          ctx,
          {
            task_id: taskId,
            task_no: no,
            title: input.title,
            priority: input.priority ?? "normal",
            due_at: input.due_at ?? null,
          },
          assignee,
        );
      return yield* detailOf(ctx, taskId);
    }),
};

// ---- update --------------------------------------------------------------------------------------------

const update: ActionHandler<In<"TaskUpdateIn">, Detail> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const t = yield* loadTask(ctx, input.task_id);
      const changed = Object.keys(input).filter((k) => k !== "task_id" && k !== "version");
      return {
        effect: `Update task #${t.task_no}: ${changed.join(", ") || "no change"}`,
        facts: { task_no: t.task_no, changed, version: t.version },
      };
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const t = yield* loadTask(ctx, input.task_id, true);
      const manage = yield* mayManage(ctx);
      const mine =
        t.assignee_id === ctx.principal.id ||
        t.created_by === ctx.principal.id ||
        t.assignee_id === ctx.onBehalfOf?.id ||
        t.created_by === ctx.onBehalfOf?.id;
      if (!mine && !manage)
        return yield* Effect.fail(
          dom("FORBIDDEN", "", "only the assignee, the creator or tasks:manage may update a task", {
            details: { reason: "no_grant", permission: "tasks:manage" },
          }),
        );
      if (t.version !== input.version)
        return yield* Effect.fail(
          dom("CONFLICT", "/version", "the task changed since you read it", {
            details: { reason: "STALE_VERSION", current_version: t.version },
          }),
        );
      const terminal = t.status === "done" || t.status === "cancelled";
      if (terminal && !manage)
        return yield* Effect.fail(
          dom("CONFLICT", "/status", `a ${t.status} task can only be changed with tasks:manage`, {
            details: {
              reason: "INVALID_TRANSITION",
              from: t.status,
              to: input.status ?? t.status,
              allowed: [],
            },
          }),
        );
      const sets: string[] = [];
      const params: unknown[] = [];
      const changed: string[] = [];
      const add = (col: string, val: unknown, cast = "") => {
        params.push(val);
        sets.push(`${col} = $${params.length}${cast}`);
      };
      if (input.title !== undefined && input.title !== t.title) {
        add("title", input.title);
        changed.push("title");
      }
      if (input.description !== undefined && input.description !== t.description) {
        add("description", input.description);
        changed.push("description");
      }
      if (input.priority !== undefined && input.priority !== t.priority) {
        add("priority", input.priority);
        changed.push("priority");
      }
      if (input.due_at !== undefined) {
        const next = input.due_at;
        if (
          (next ?? null) !== t.due_at &&
          (next === null || new Date(next).getTime() !== new Date(t.due_at ?? 0).getTime())
        ) {
          add("due_at", next, "::timestamptz");
          changed.push("due_at");
        }
      }
      let newAssignee: { id: string; subject: string } | null | undefined;
      if (input.assignee !== undefined) {
        if (input.assignee === null) {
          if (t.assignee_id !== null) {
            if (!manage && !mine)
              return yield* Effect.fail(dom("FORBIDDEN", "/assignee", "unassigning needs tasks:manage"));
            add("assignee_id", null);
            changed.push("assignee");
            newAssignee = null;
          }
        } else {
          const a = yield* resolveAssignee(ctx, input.assignee);
          if (a.id !== t.assignee_id) {
            yield* checkMayAssign(ctx, a.id);
            add("assignee_id", a.id);
            changed.push("assignee");
            newAssignee = a;
          }
        }
      }
      if (input.status !== undefined && input.status !== t.status) {
        add("status", input.status);
        changed.push("status");
        if (input.status === "done") add("completed_at", ctx.now.toISOString(), "::timestamptz");
        else if (t.status === "done") sets.push("completed_at = NULL");
      }
      if (changed.length === 0) return yield* detailOf(ctx, input.task_id);
      const ver = t.version + 1;
      params.push(ctx.now.toISOString());
      sets.push(`updated_at = $${params.length}::timestamptz`);
      sets.push(`version = ${ver}`);
      params.push(input.task_id);
      yield* q(`UPDATE tasks SET ${sets.join(", ")} WHERE task_id = $${params.length}`, params);
      yield* q(
        `INSERT INTO task_history (task_id, version, actor_id, at, changed) VALUES ($1, $2, $3, $4::timestamptz, $5::text[])`,
        [input.task_id, ver, ctx.principal.id, ctx.now.toISOString(), pgArr(changed)],
      );
      const status = input.status ?? t.status;
      const refs = yield* personRefs(ctx.principal.workspaceId, [
        ...(t.assignee_id ? [t.assignee_id] : []),
        t.created_by,
        ...(newAssignee ? [newAssignee.id] : []),
      ]);
      const audience = new Set<string>([ctx.principal.subject]);
      for (const id of [t.assignee_id, t.created_by, newAssignee?.id])
        if (id) audience.add(ref(refs, id).subject);
      yield* emitFrom(ctx, "task.updated", {
        audience: [...audience],
        subject: { kind: "task", id: input.task_id },
        ...(t.assignee_id
          ? { member: { id: t.assignee_id, subject: ref(refs, t.assignee_id).subject } }
          : {}),
        payload: { task_id: input.task_id, task_no: t.task_no, status, changed },
      });
      if (newAssignee)
        yield* announceAssigned(
          ctx,
          {
            task_id: input.task_id,
            task_no: t.task_no,
            title: input.title ?? t.title,
            priority: input.priority ?? t.priority,
            due_at: input.due_at !== undefined ? input.due_at : t.due_at,
          },
          newAssignee,
        );
      return yield* detailOf(ctx, input.task_id);
    }),
};

// ---- comment -------------------------------------------------------------------------------------------

const comment: ActionHandler<In<"TaskCommentIn">, S.Schema.Type<typeof SuiteWork.TaskComment>> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const t = yield* loadTask(ctx, input.task_id);
      return {
        effect: `Comment on task #${t.task_no}`,
        facts: { mentions: mentionHandles(input.body).length },
      };
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const t = yield* loadTask(ctx, input.task_id);
      const id = newId();
      const now = ctx.now.toISOString();
      yield* q(
        `INSERT INTO task_comments (comment_id, task_id, author_id, body, created_at) VALUES ($1, $2, $3, $4, $5::timestamptz)`,
        [id, input.task_id, ctx.principal.id, input.body, now],
      );
      const refs = yield* personRefs(ws, [
        ctx.principal.id,
        ...(t.assignee_id ? [t.assignee_id] : []),
        t.created_by,
      ]);
      const audience = new Set<string>([ctx.principal.subject]);
      for (const x of [t.assignee_id, t.created_by]) if (x) audience.add(ref(refs, x).subject);
      const handles = mentionHandles(input.body);
      const mentioned = handles.length
        ? yield* q<{ principal_id: string; subject: string }>(
            `SELECT p.principal_id, p.subject FROM members m JOIN principals p ON p.principal_id = m.member_id
             WHERE m.workspace_id = $1 AND m.handle = ANY($2::text[]) AND p.disabled_at IS NULL`,
            [ws, pgArr(handles)],
          )
        : [];
      for (const m of mentioned) audience.add(m.subject);
      const seq = yield* emitFrom(ctx, "task.commented", {
        audience: [...audience],
        subject: { kind: "task", id: input.task_id },
        member: ctx.principal,
        payload: {
          task_id: input.task_id,
          task_no: t.task_no,
          comment_id: id,
          author: ctx.principal.subject,
        },
      });
      const toNotify = mentioned
        .filter((m) => m.principal_id !== ctx.principal.id)
        .map((m) => ({ id: m.principal_id, subject: m.subject }));
      if (toNotify.length > 0)
        yield* createNotifications(ctx, {
          recipients: toNotify,
          type: "task_assigned",
          title: clip(`${ref(refs, ctx.principal.id).display_name} mentioned you on task #${t.task_no}`, 140),
          body: clip(input.body, 500),
          link: `/tasks`,
          actorId: ctx.principal.id,
          subject: { kind: "task", id: input.task_id },
          sourceEventSeq: seq,
          dedupeKey: `${seq}:task_assigned`,
        });
      return {
        comment_id: id,
        author: ref(refs, ctx.principal.id),
        body: input.body,
        created_at: now,
      } as never;
    }),
};

export const tasksHandlers = {
  "tasks.list": list,
  "tasks.get": get,
  "tasks.create": create,
  "tasks.update": update,
  "tasks.comment": comment,
} satisfies HandlerTable;

export type { HandlerError, SuiteEnv };
export const OPEN_TASK_STATUSES = OPEN;
