import { Effect, Schema as S } from "effect";
import { SuiteNotifications, type NotificationType } from "@plinth/spec";
import { Authorizer, forbidden } from "../../authz";
import { emitFrom } from "../domain-events";
import { memberByHandle } from "../people";
import { createNotifications } from "../notify";
import { loadProgram } from "../program";
import type { ActionCtx, ActionHandler } from "../types";
import type { HandlerTable } from "./stub";
import { ISO, decodeCursor, dom, encodeCursor, limitOf, pgArr, personRefs, q, ref, refusal } from "./util3";

/**
 * Module `notifications` (CONTRACT.md 12.3). Rows are created by `createNotifications` inside the transaction of the
 * write that causes them; this module reads them, marks them read and sends ad-hoc ones.
 */

type In<K extends keyof typeof SuiteNotifications> = (typeof SuiteNotifications)[K] extends S.Schema.Any
  ? S.Schema.Type<(typeof SuiteNotifications)[K]>
  : never;

const unreadCount = (me: string) =>
  q<{ n: string }>(
    `SELECT count(*)::text AS n FROM notifications WHERE recipient_id = $1 AND in_app AND read_at IS NULL`,
    [me],
  ).pipe(Effect.map((r) => Number(r[0]?.n ?? 0)));

const list: ActionHandler<
  In<"NotificationsListIn">,
  S.Schema.Type<typeof SuiteNotifications.NotificationsListOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const limit = limitOf(input.limit);
      const params: unknown[] = [ws, ctx.principal.id];
      const where = ["workspace_id = $1", "recipient_id = $2", "in_app"];
      if (input.filter === "unread") where.push("read_at IS NULL");
      if (input.types && input.types.length > 0) {
        params.push(pgArr(input.types));
        where.push(`type = ANY($${params.length}::text[])`);
      }
      const cur = decodeCursor(input.cursor);
      if (cur && cur.length === 2) {
        params.push(cur[0], cur[1]);
        where.push(
          `(created_at, notification_id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }
      params.push(limit + 1);
      const rows = yield* q<{
        notification_id: string;
        type: NotificationType;
        title: string;
        body: string;
        link: string | null;
        actor_id: string | null;
        created_at: string;
        cursor_at: string;
        read_at: string | null;
        subject_kind: string | null;
        subject_id: string | null;
      }>(
        `SELECT notification_id, type, title, body, link, actor_id, ${ISO("created_at")} AS created_at,
                to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
                ${ISO("read_at")} AS read_at, subject_kind, subject_id
         FROM notifications WHERE ${where.join(" AND ")} ORDER BY created_at DESC, notification_id DESC LIMIT $${params.length}`,
        params,
      );
      const page = rows.slice(0, limit);
      const refs = yield* personRefs(
        ws,
        page.flatMap((r) => (r.actor_id ? [r.actor_id] : [])),
      );
      const last = page[page.length - 1];
      return {
        items: page.map((r) => ({
          notification_id: r.notification_id,
          type: r.type,
          title: r.title,
          body: r.body,
          link: r.link,
          actor: r.actor_id ? ref(refs, r.actor_id) : null,
          created_at: r.created_at,
          read_at: r.read_at,
          subject: r.subject_kind && r.subject_id ? { kind: r.subject_kind, id: r.subject_id } : null,
        })),
        next_cursor:
          rows.length > limit && last ? encodeCursor([last.cursor_at, last.notification_id]) : null,
        unread_count: yield* unreadCount(ctx.principal.id),
      } as never;
    }),
};

const markRead = (
  ctx: ActionCtx,
  ids: ReadonlyArray<string> | null,
  extra: { before?: string; types?: ReadonlyArray<string> },
) =>
  Effect.gen(function* () {
    const params: unknown[] = [ctx.principal.id];
    const where = ["recipient_id = $1", "in_app", "read_at IS NULL"];
    if (ids !== null) {
      params.push(pgArr(ids));
      where.push(`notification_id = ANY($${params.length}::uuid[])`);
    }
    if (extra.before !== undefined) {
      params.push(extra.before);
      where.push(`created_at <= $${params.length}::timestamptz`);
    }
    if (extra.types && extra.types.length > 0) {
      params.push(pgArr(extra.types));
      where.push(`type = ANY($${params.length}::text[])`);
    }
    params.push(ctx.now.toISOString());
    const done = yield* q<{ notification_id: string }>(
      `UPDATE notifications SET read_at = $${params.length}::timestamptz WHERE ${where.join(" AND ")} RETURNING notification_id`,
      params,
    );
    const unread = yield* unreadCount(ctx.principal.id);
    if (done.length > 0)
      yield* emitFrom(ctx, "notification.read", {
        audience: [ctx.principal.subject],
        member: ctx.principal,
        payload: { ids: ids === null ? null : done.map((d) => d.notification_id), unread_count: unread },
      });
    return { marked: done.length, unread_count: unread };
  });

const read: ActionHandler<In<"MarkReadIn">, S.Schema.Type<typeof SuiteNotifications.MarkReadOut>> = {
  preview: (input) =>
    Effect.succeed({
      effect: `Mark ${input.ids.length} notification(s) read`,
      facts: { count: input.ids.length },
    }),
  run: (input, ctx) => markRead(ctx, input.ids, {}),
};

const readAll: ActionHandler<In<"MarkAllReadIn">, S.Schema.Type<typeof SuiteNotifications.MarkReadOut>> = {
  preview: (input) =>
    Effect.succeed({
      effect: "Mark notifications read",
      facts: { types: input.types ?? "all", before: input.before ?? null },
    }),
  run: (input, ctx) =>
    markRead(ctx, null, {
      ...(input.before ? { before: input.before } : {}),
      ...(input.types ? { types: input.types } : {}),
    }),
};

const expandTargets = (ctx: ActionCtx, to: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const subjects = new Set<string>();
    const handles: string[] = [];
    for (const r of to) {
      if (r.startsWith("group:")) {
        const g = yield* q<{ body: { spec?: { members?: string[] } } }>(
          `SELECT body FROM nodes WHERE workspace_id = $1 AND kind = 'Group' AND slug = $2 AND deleted_at IS NULL`,
          [ws, r.slice(6)],
        );
        if (!g[0]) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/to", `no group '${r.slice(6)}'`));
        for (const s of g[0].body.spec?.members ?? []) subjects.add(s);
      } else handles.push(r.slice(r.indexOf(":") + 1), r);
    }
    const rows = yield* q<{ principal_id: string; subject: string }>(
      `SELECT p.principal_id, p.subject FROM principals p LEFT JOIN members m ON m.member_id = p.principal_id
       WHERE p.workspace_id = $1 AND p.disabled_at IS NULL
         AND (p.subject = ANY($2::text[]) OR m.handle = ANY($3::text[]) OR p.subject = ANY($3::text[]))
       ORDER BY p.subject`,
      [ws, pgArr([...subjects]), pgArr(handles)],
    );
    const program = yield* loadProgram(ws);
    if (rows.length > program.messaging.max_recipients)
      return yield* Effect.fail(
        refusal("RULE_REFUSED", "LIMIT_EXCEEDED", "too many recipients", {
          limit: "max_recipients",
          value: rows.length,
          max: program.messaging.max_recipients,
        }),
      );
    return rows.map((r) => ({ id: r.principal_id, subject: r.subject }));
  });

const send: ActionHandler<In<"NotifySendIn">, S.Schema.Type<typeof SuiteNotifications.NotifySendOut>> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const targets = yield* expandTargets(ctx, input.to);
      return {
        effect: `Send a ${input.type} notification to ${targets.length} people`,
        facts: { recipients: targets.length, type: input.type },
      };
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const targets = yield* expandTargets(ctx, input.to);
      const r = yield* createNotifications(ctx, {
        recipients: targets,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link ?? null,
        actorId: ctx.principal.id,
        dedupeKey: `send:${ctx.idempotencyKey ?? `${ctx.now.getTime()}:${input.title}`}`,
      });
      return { recipients: r.created, suppressed: r.suppressed, replayed: false };
    }),
};

const deliveries: ActionHandler<
  In<"DeliveriesIn">,
  S.Schema.Type<typeof SuiteNotifications.DeliveriesOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      let who = ctx.principal.id;
      if (input.member !== undefined) {
        const m = yield* memberByHandle(ws, input.member);
        if (m.id !== ctx.principal.id) {
          const authz = yield* Authorizer;
          const resource = `plinth://${ctx.principal.workspaceSlug}/suite/people`;
          const d = yield* authz.authorize(ctx.principal, "people:view-private", resource);
          if (d.kind !== "allow") return yield* Effect.fail(forbidden(d, resource));
          who = m.id;
        }
      }
      const limit = limitOf(input.limit);
      const params: unknown[] = [ws, who];
      const where = ["workspace_id = $1", "recipient_id = $2"];
      if (input.channel) {
        params.push(input.channel);
        where.push(`channel = $${params.length}`);
      }
      const cur = decodeCursor(input.cursor);
      if (cur && cur.length === 2) {
        params.push(cur[0], cur[1]);
        where.push(
          `(created_at, delivery_id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }
      params.push(limit + 1);
      const rows = yield* q<{
        delivery_id: string;
        channel: "email" | "digest";
        status: "queued" | "sent" | "suppressed";
        subject: string;
        body: string;
        notification_ids: string[];
        created_at: string;
        cursor_at: string;
        sent_at: string | null;
        suppressed_reason: "preference_off" | "quiet_hours" | "member_disabled" | null;
      }>(
        `SELECT delivery_id, channel, status, subject, body, notification_ids, ${ISO("created_at")} AS created_at,
                to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
                ${ISO("sent_at")} AS sent_at, suppressed_reason
         FROM notification_deliveries WHERE ${where.join(" AND ")} ORDER BY created_at DESC, delivery_id DESC LIMIT $${params.length}`,
        params,
      );
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map(({ cursor_at: _c, ...r }) => r),
        next_cursor: rows.length > limit && last ? encodeCursor([last.cursor_at, last.delivery_id]) : null,
      } as never;
    }),
};

export const notificationsHandlers = {
  "notifications.list": list,
  "notifications.read": read,
  "notifications.read_all": readAll,
  "notifications.send": send,
  "notifications.deliveries": deliveries,
} satisfies HandlerTable;
