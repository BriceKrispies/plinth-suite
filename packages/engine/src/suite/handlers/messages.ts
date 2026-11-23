import { Effect, Schema as S } from "effect";
import { SuiteMessages } from "@plinth/spec";
import { Authorizer } from "../../authz";
import { newId } from "../ids";
import { emitFrom } from "../domain-events";
import { createNotifications } from "../notify";
import { loadProgram } from "../program";
import type { ActionCtx, ActionHandler, HandlerError, SuiteEnv } from "../types";
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
 * Module `messages` (CONTRACT.md 12.2). Recipients are expanded at send time (groups to members, deduplicated, sender
 * removed); a receipt row exists per recipient and for the sender (read at send); a new message un-archives the thread
 * for recipients; mentions notify as `mention`, muted threads notify only on mention. `messages.thread` never marks read.
 */

type In<K extends keyof typeof SuiteMessages> = (typeof SuiteMessages)[K] extends S.Schema.Any
  ? S.Schema.Type<(typeof SuiteMessages)[K]>
  : never;

interface Rcpt {
  readonly id: string;
  readonly subject: string;
  readonly handle: string | null;
  readonly role: "to" | "cc";
  readonly via: string | null;
}

interface GroupNode {
  readonly slug: string;
  readonly title: string;
  readonly members: ReadonlyArray<string>;
  readonly managers: ReadonlyArray<string>;
  readonly open: boolean;
}

const loadGroup = (ws: string, slug: string): Effect.Effect<GroupNode | undefined, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const rows = yield* q<{
      slug: string;
      body: {
        metadata?: { title?: string };
        spec?: { members?: string[]; managers?: string[]; open_posting?: boolean };
      };
    }>(
      `SELECT slug, body FROM nodes WHERE workspace_id = $1 AND kind = 'Group' AND slug = $2 AND deleted_at IS NULL`,
      [ws, slug],
    );
    const r = rows[0];
    if (!r) return undefined;
    return {
      slug: r.slug,
      title: r.body.metadata?.title ?? r.slug,
      members: r.body.spec?.members ?? [],
      managers: r.body.spec?.managers ?? [],
      open: r.body.spec?.open_posting ?? false,
    };
  });

const mayBroadcast = (ctx: ActionCtx) =>
  Effect.gen(function* () {
    const authz = yield* Authorizer;
    const d = yield* authz.authorize(
      ctx.principal,
      "messages:broadcast",
      `plinth://${ctx.principal.workspaceSlug}/suite/messages`,
    );
    return d.kind === "allow";
  });

/** Expand `to` and `cc` into unique recipients (sender removed) and the group slugs involved. */
const expand = (
  ctx: ActionCtx,
  to: ReadonlyArray<string>,
  cc: ReadonlyArray<string>,
  exclude: ReadonlyArray<string> = [],
): Effect.Effect<
  { recipients: ReadonlyArray<Rcpt>; groups: ReadonlyArray<string> },
  HandlerError,
  SuiteEnv
> =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const out = new Map<string, Rcpt>();
    const groups: string[] = [];
    const entries = [...to.map((r) => ["to", r] as const), ...cc.map((r) => ["cc", r] as const)];
    for (const [role, rec] of entries) {
      if (rec.startsWith("group:")) {
        const slug = rec.slice(6);
        const g = yield* loadGroup(ws, slug);
        if (!g) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/to", `no group '${slug}'`));
        const sender = ctx.principal.subject;
        const isManager =
          g.managers.includes(sender) || (ctx.onBehalfOf && g.managers.includes(ctx.onBehalfOf.subject));
        if (!g.open && !isManager)
          return yield* Effect.fail(
            refusal("RULE_REFUSED", "NOT_ELIGIBLE", `group '${slug}' is closed to posting`, { group: slug }),
          );
        groups.push(slug);
        const rows = yield* q<{
          principal_id: string;
          subject: string;
          handle: string | null;
          disabled: boolean;
        }>(
          `SELECT p.principal_id, p.subject, m.handle, (p.disabled_at IS NOT NULL) AS disabled
           FROM principals p LEFT JOIN members m ON m.member_id = p.principal_id
           WHERE p.workspace_id = $1 AND p.subject = ANY($2::text[]) ORDER BY p.subject`,
          [ws, pgArr(g.members)],
        );
        for (const r of rows)
          if (!r.disabled && !out.has(r.principal_id))
            out.set(r.principal_id, {
              id: r.principal_id,
              subject: r.subject,
              handle: r.handle,
              role,
              via: slug,
            });
        continue;
      }
      const name = rec.slice(rec.indexOf(":") + 1);
      const rows = yield* q<{
        principal_id: string;
        subject: string;
        handle: string | null;
        disabled: boolean;
      }>(
        `SELECT p.principal_id, p.subject, m.handle, (p.disabled_at IS NOT NULL) AS disabled
         FROM principals p LEFT JOIN members m ON m.member_id = p.principal_id
         WHERE p.workspace_id = $1 AND (m.handle = $2 OR p.subject = $3)
         ORDER BY (m.handle = $2) DESC NULLS LAST LIMIT 1`,
        [ws, name, rec],
      );
      const r = rows[0];
      if (!r) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/to", `no recipient '${rec}'`));
      if (r.disabled)
        return yield* Effect.fail(
          refusal("RULE_REFUSED", "MEMBER_DISABLED", `${rec} is disabled`, { recipient: rec }),
        );
      if (!out.has(r.principal_id))
        out.set(r.principal_id, {
          id: r.principal_id,
          subject: r.subject,
          handle: r.handle,
          role,
          via: null,
        });
    }
    out.delete(ctx.principal.id);
    for (const id of exclude) out.delete(id);
    return { recipients: [...out.values()], groups };
  });

const checkLimits = (ctx: ActionCtx, count: number, total: number) =>
  Effect.gen(function* () {
    const program = yield* loadProgram(ctx.principal.workspaceId);
    const { broadcast_min_recipients: minB, max_recipients: maxR } = program.messaging;
    if (count === 0)
      return yield* Effect.fail(
        dom("VALIDATION_FAILED", "/to", "the message has no recipient other than you"),
      );
    if (total > maxR)
      return yield* Effect.fail(
        refusal("RULE_REFUSED", "LIMIT_EXCEEDED", `at most ${maxR} recipients`, {
          limit: "max_recipients",
          value: total,
          max: maxR,
        }),
      );
    const broadcast = total >= minB;
    if (broadcast && !(yield* mayBroadcast(ctx)))
      return yield* Effect.fail(
        refusal("RULE_REFUSED", "LIMIT_EXCEEDED", `${total} recipients needs messages:broadcast`, {
          limit: "broadcast_min_recipients",
          value: total,
          permission: "messages:broadcast",
        }),
      );
    return { broadcast };
  });

// ---- delivery ------------------------------------------------------------------------------------------

/** Events, notifications and receipts for one new message. `recipients` are everyone who should receive it. */
const deliver = (
  ctx: ActionCtx,
  m: {
    readonly threadId: string;
    readonly messageId: string;
    readonly subject: string;
    readonly body: string;
    readonly sentAt: Date;
    readonly attachments?: ReadonlyArray<{
      file_name: string;
      media_type: string;
      size_bytes: number;
      sha256: string;
    }>;
    readonly replyTo?: string | undefined;
    readonly recipients: ReadonlyArray<{ id: string; subject: string; handle: string | null }>;
    readonly recipientCount: number;
  },
): Effect.Effect<void, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const at = m.sentAt.toISOString();
    const handles = mentionHandles(m.body);
    const mentionedIds = m.recipients
      .filter((r) => r.handle !== null && handles.includes(r.handle))
      .map((r) => r.id);
    yield* q(
      `INSERT INTO messages (message_id, thread_id, workspace_id, sender_id, on_behalf_of, body, mentions, reply_to, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8, $9::timestamptz)`,
      [
        m.messageId,
        m.threadId,
        ws,
        ctx.principal.id,
        ctx.onBehalfOf?.id ?? null,
        m.body,
        pgArr(mentionedIds),
        m.replyTo ?? null,
        at,
      ],
    );
    for (const a of m.attachments ?? [])
      yield* q(
        `INSERT INTO message_attachments (attachment_id, message_id, file_name, media_type, size_bytes, sha256)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [newId(), m.messageId, a.file_name, a.media_type, a.size_bytes, a.sha256],
      );
    yield* q(
      `INSERT INTO message_receipts (message_id, principal_id, thread_id, read_at) VALUES ($1, $2, $3, $4::timestamptz)`,
      [m.messageId, ctx.principal.id, m.threadId, at],
    );
    for (const r of m.recipients)
      yield* q(
        `INSERT INTO message_receipts (message_id, principal_id, thread_id, read_at) VALUES ($1, $2, $3, NULL)`,
        [m.messageId, r.id, m.threadId],
      );
    // a new message un-archives the thread for recipients
    if (m.recipients.length > 0)
      yield* q(
        `UPDATE thread_participants SET archived_at = NULL WHERE thread_id = $1 AND principal_id = ANY($2::uuid[])`,
        [m.threadId, pgArr(m.recipients.map((r) => r.id))],
      );
    yield* q(
      `UPDATE message_threads SET last_message_at = $2::timestamptz, message_count = message_count + 1 WHERE thread_id = $1`,
      [m.threadId, at],
    );
    const refs = yield* personRefs(ws, [ctx.principal.id]);
    const from = ref(refs, ctx.principal.id);
    yield* emitFrom(ctx, "message.sent", {
      audience: [ctx.principal.subject],
      subject: { kind: "thread", id: m.threadId },
      member: ctx.principal,
      payload: {
        thread_id: m.threadId,
        message_id: m.messageId,
        subject: clip(m.subject, 140),
        recipient_count: m.recipientCount,
      },
    });
    const muted = yield* q<{ principal_id: string; muted: boolean }>(
      `SELECT principal_id, muted FROM thread_participants WHERE thread_id = $1`,
      [m.threadId],
    );
    const mutedSet = new Set(muted.filter((x) => x.muted).map((x) => x.principal_id));
    for (const r of m.recipients) {
      const mentioned = mentionedIds.includes(r.id);
      const seq = yield* emitFrom(ctx, "message.received", {
        audience: [r.subject],
        subject: { kind: "thread", id: m.threadId },
        member: { id: r.id, subject: r.subject },
        payload: {
          thread_id: m.threadId,
          message_id: m.messageId,
          subject: clip(m.subject, 140),
          preview: clip(m.body, 140),
          from,
          mentioned,
        },
      });
      if (mutedSet.has(r.id) && !mentioned) continue;
      yield* createNotifications(ctx, {
        recipients: [{ id: r.id, subject: r.subject }],
        type: mentioned ? "mention" : "message",
        title: clip(`${from.display_name}: ${m.subject}`, 140),
        body: clip(m.body, 140),
        link: `/messages/t/${m.threadId}`,
        actorId: ctx.principal.id,
        subject: { kind: "thread", id: m.threadId },
        sourceEventSeq: seq,
        dedupeKey: `${seq}:${mentioned ? "mention" : "message"}`,
      });
    }
  });

// ---- send ----------------------------------------------------------------------------------------------

const send: ActionHandler<In<"SendIn">, S.Schema.Type<typeof SuiteMessages.SendOut>> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const { recipients, groups } = yield* expand(ctx, input.to, input.cc ?? []);
      const { broadcast } = yield* checkLimits(ctx, recipients.length, recipients.length);
      return {
        effect: `Send a message to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}${broadcast ? " (broadcast)" : ""}`,
        facts: {
          recipient_count: recipients.length,
          broadcast,
          groups: [...groups],
          attachments: (input.attachments ?? []).length,
        },
      };
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const { recipients, groups } = yield* expand(ctx, input.to, input.cc ?? []);
      const { broadcast } = yield* checkLimits(ctx, recipients.length, recipients.length);
      const kind = ctx.principal.subject.startsWith("service:")
        ? "system"
        : broadcast
          ? "broadcast"
          : groups.length > 0
            ? "group"
            : "direct";
      const threadId = newId();
      const messageId = newId();
      const at = ctx.now.toISOString();
      yield* q(
        `INSERT INTO message_threads (thread_id, workspace_id, subject, kind, created_by, created_at, last_message_at, message_count)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $6::timestamptz, 0)`,
        [threadId, ws, input.subject, kind, ctx.principal.id, at],
      );
      yield* q(
        `INSERT INTO thread_participants (thread_id, principal_id, role, via_group, joined_at) VALUES ($1, $2, 'from', NULL, $3::timestamptz)`,
        [threadId, ctx.principal.id, at],
      );
      for (const r of recipients)
        yield* q(
          `INSERT INTO thread_participants (thread_id, principal_id, role, via_group, joined_at) VALUES ($1, $2, $3, $4, $5::timestamptz)`,
          [threadId, r.id, r.role, r.via, at],
        );
      yield* deliver(ctx, {
        threadId,
        messageId,
        subject: input.subject,
        body: input.body,
        sentAt: ctx.now,
        attachments: input.attachments ?? [],
        recipients,
        recipientCount: recipients.length,
      });
      return {
        thread_id: threadId,
        message_id: messageId,
        recipient_count: recipients.length,
        replayed: false,
      };
    }),
};

// ---- reply ---------------------------------------------------------------------------------------------

const requireParticipant = (ws: string, threadId: string, principalId: string) =>
  Effect.gen(function* () {
    const rows = yield* q<{ subject: string; kind: string; role: string }>(
      `SELECT t.subject, t.kind, tp.role FROM message_threads t
       JOIN thread_participants tp ON tp.thread_id = t.thread_id AND tp.principal_id = $3
       WHERE t.workspace_id = $1 AND t.thread_id = $2`,
      [ws, threadId, principalId],
    );
    if (rows[0]) return rows[0];
    const exists = yield* q<{ n: number }>(
      `SELECT 1 AS n FROM message_threads WHERE workspace_id = $1 AND thread_id = $2`,
      [ws, threadId],
    );
    // a thread the caller is not in is reported the same way whether it exists or not
    void exists;
    return yield* Effect.fail(
      refusal("RULE_REFUSED", "NOT_PARTICIPANT", "you are not a participant of this thread"),
    );
  });

const reply: ActionHandler<In<"ReplyIn">, S.Schema.Type<typeof SuiteMessages.SendOut>> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const t = yield* requireParticipant(ctx.principal.workspaceId, input.thread_id, ctx.principal.id);
      const n = yield* q<{ n: string }>(
        `SELECT count(*)::text AS n FROM thread_participants WHERE thread_id = $1`,
        [input.thread_id],
      );
      return {
        effect: `Reply in a thread with ${Number(n[0]?.n ?? 1) - 1} other participant${Number(n[0]?.n ?? 1) === 2 ? "" : "s"}`,
        facts: { thread_kind: t.kind, added: (input.add_recipients ?? []).length },
      };
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const t = yield* requireParticipant(ws, input.thread_id, ctx.principal.id);
      if (input.reply_to !== undefined) {
        const ok = yield* q<{ n: number }>(
          `SELECT 1 AS n FROM messages WHERE message_id = $1 AND thread_id = $2`,
          [input.reply_to, input.thread_id],
        );
        if (ok.length === 0)
          return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/reply_to", "no such message in this thread"));
      }
      const existing = yield* q<{ principal_id: string; subject: string; handle: string | null }>(
        `SELECT tp.principal_id, p.subject, m.handle FROM thread_participants tp
         JOIN principals p ON p.principal_id = tp.principal_id LEFT JOIN members m ON m.member_id = tp.principal_id
         WHERE tp.thread_id = $1 AND tp.principal_id <> $2 AND p.disabled_at IS NULL ORDER BY tp.joined_at, p.subject`,
        [input.thread_id, ctx.principal.id],
      );
      const have = new Set(existing.map((e) => e.principal_id));
      const added = yield* expand(ctx, input.add_recipients ?? [], [], [...have]);
      const total = existing.length + added.recipients.length;
      let kind = t.kind;
      if (added.recipients.length > 0) {
        const { broadcast } = yield* checkLimits(ctx, total, total);
        if (broadcast) kind = "broadcast";
        else if (added.groups.length > 0 && kind === "direct") kind = "group";
        else if (kind === "direct" && total > 1) kind = "group";
        const at = ctx.now.toISOString();
        for (const r of added.recipients)
          yield* q(
            `INSERT INTO thread_participants (thread_id, principal_id, role, via_group, joined_at) VALUES ($1, $2, 'to', $3, $4::timestamptz)
             ON CONFLICT DO NOTHING`,
            [input.thread_id, r.id, r.via, at],
          );
        if (kind !== t.kind)
          yield* q(`UPDATE message_threads SET kind = $2 WHERE thread_id = $1`, [input.thread_id, kind]);
      }
      const recipients = [
        ...existing,
        ...added.recipients.map((r) => ({ principal_id: r.id, subject: r.subject, handle: r.handle })),
      ];
      const messageId = newId();
      yield* deliver(ctx, {
        threadId: input.thread_id,
        messageId,
        subject: t.subject,
        body: input.body,
        sentAt: ctx.now,
        attachments: input.attachments ?? [],
        replyTo: input.reply_to,
        recipients: recipients.map((r) => ({ id: r.principal_id, subject: r.subject, handle: r.handle })),
        recipientCount: recipients.length,
      });
      return {
        thread_id: input.thread_id,
        message_id: messageId,
        recipient_count: recipients.length,
        replayed: false,
      };
    }),
};

// ---- thread views --------------------------------------------------------------------------------------

type ThreadSummary = S.Schema.Type<typeof SuiteMessages.ThreadSummary>;

/** Summaries of the viewer's threads, in the order of `ids`. */
const summaries = (
  ws: string,
  viewer: string,
  ids: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<ThreadSummary>, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    if (ids.length === 0) return [];
    const arr = pgArr(ids);
    const base = yield* q<{
      thread_id: string;
      subject: string;
      kind: ThreadSummary["kind"];
      last_message_at: string;
      message_count: number;
      starred: boolean;
      archived: boolean;
      muted: boolean;
      joined_at: string;
    }>(
      `SELECT t.thread_id, t.subject, t.kind, ${ISO("t.last_message_at")} AS last_message_at, t.message_count,
              tp.starred, (tp.archived_at IS NOT NULL) AS archived, tp.muted, ${ISO("tp.joined_at")} AS joined_at
       FROM message_threads t JOIN thread_participants tp ON tp.thread_id = t.thread_id AND tp.principal_id = $2
       WHERE t.workspace_id = $1 AND t.thread_id = ANY($3::uuid[])`,
      [ws, viewer, arr],
    );
    const last = yield* q<{ thread_id: string; sender_id: string; body: string }>(
      `SELECT DISTINCT ON (m.thread_id) m.thread_id, m.sender_id, m.body
       FROM messages m JOIN thread_participants tp ON tp.thread_id = m.thread_id AND tp.principal_id = $2
       WHERE m.thread_id = ANY($1::uuid[]) AND m.sent_at >= tp.joined_at
       ORDER BY m.thread_id, m.sent_at DESC, m.recorded_at DESC, m.message_id`,
      [arr, viewer],
    );
    const unread = yield* q<{ thread_id: string; n: string }>(
      `SELECT thread_id, count(*)::text AS n FROM message_receipts WHERE principal_id = $2 AND read_at IS NULL AND thread_id = ANY($1::uuid[]) GROUP BY thread_id`,
      [arr, viewer],
    );
    const parts = yield* q<{ thread_id: string; principal_id: string }>(
      `SELECT thread_id, principal_id FROM thread_participants WHERE thread_id = ANY($1::uuid[])
       ORDER BY (role = 'from') DESC, joined_at, principal_id`,
      [arr],
    );
    const attach = yield* q<{ thread_id: string }>(
      `SELECT DISTINCT m.thread_id FROM message_attachments a JOIN messages m ON m.message_id = a.message_id WHERE m.thread_id = ANY($1::uuid[])`,
      [arr],
    );
    const mentioned = yield* q<{ thread_id: string }>(
      `SELECT DISTINCT thread_id FROM messages WHERE thread_id = ANY($1::uuid[]) AND $2::uuid = ANY(mentions)`,
      [arr, viewer],
    );
    const refs = yield* personRefs(ws, [
      ...parts.map((p) => p.principal_id),
      ...last.map((l) => l.sender_id),
    ]);
    const byId = new Map(base.map((b) => [b.thread_id, b]));
    const out: ThreadSummary[] = [];
    for (const id of ids) {
      const b = byId.get(id);
      if (!b) continue;
      const l = last.find((x) => x.thread_id === id);
      const ps = parts.filter((p) => p.thread_id === id);
      out.push({
        thread_id: id,
        subject: b.subject,
        kind: b.kind,
        last_message_at: b.last_message_at,
        last_sender: ref(refs, l?.sender_id),
        preview: clip(l?.body ?? "", 140),
        message_count: b.message_count,
        unread_count: Number(unread.find((u) => u.thread_id === id)?.n ?? 0),
        participants: ps.slice(0, 5).map((p) => ref(refs, p.principal_id)),
        participant_count: ps.length,
        starred: b.starred,
        archived: b.archived,
        muted: b.muted,
        has_attachments: attach.some((a) => a.thread_id === id),
        mentioned: mentioned.some((m) => m.thread_id === id),
      } as ThreadSummary);
    }
    return out;
  });

const list: ActionHandler<In<"MessagesListIn">, S.Schema.Type<typeof SuiteMessages.MessagesListOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const me = ctx.principal.id;
      const folder = input.folder ?? "inbox";
      const limit = limitOf(input.limit);
      const params: unknown[] = [ws, me];
      const where: string[] = ["t.workspace_id = $1"];
      if (folder === "inbox")
        where.push(
          `tp.archived_at IS NULL AND EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.thread_id AND m.sender_id <> $2 AND m.sent_at >= tp.joined_at)`,
        );
      else if (folder === "sent")
        where.push(`EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.thread_id AND m.sender_id = $2)`);
      else if (folder === "starred") where.push("tp.starred");
      else where.push("tp.archived_at IS NOT NULL");
      if (input.q !== undefined && input.q.trim() !== "") {
        params.push(input.q.trim());
        const p = params.length;
        where.push(
          `(t.subject ILIKE '%' || $${p} || '%' OR EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.thread_id AND m.sent_at >= tp.joined_at
              AND m.search @@ plainto_tsquery('simple', $${p})))`,
        );
      }
      if (input.unread_only === true)
        where.push(
          `EXISTS (SELECT 1 FROM message_receipts r WHERE r.thread_id = t.thread_id AND r.principal_id = $2 AND r.read_at IS NULL)`,
        );
      const cur = decodeCursor(input.cursor);
      if (cur && cur.length === 2) {
        params.push(cur[0], cur[1]);
        where.push(
          `(t.last_message_at, t.thread_id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }
      params.push(limit + 1);
      const rows = yield* q<{ thread_id: string; last_message_at: string }>(
        `SELECT t.thread_id, to_char(t.last_message_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_message_at
         FROM message_threads t JOIN thread_participants tp ON tp.thread_id = t.thread_id AND tp.principal_id = $2
         WHERE ${where.join(" AND ")} ORDER BY t.last_message_at DESC, t.thread_id DESC LIMIT $${params.length}`,
        params,
      );
      const page = rows.slice(0, limit);
      const items = yield* summaries(
        ws,
        me,
        page.map((r) => r.thread_id),
      );
      const lastRow = page[page.length - 1];
      const counts = yield* q<{ inbox_unread: string; starred: string; archived: string }>(
        `SELECT
           count(DISTINCT t.thread_id) FILTER (WHERE tp.archived_at IS NULL AND EXISTS (SELECT 1 FROM message_receipts r WHERE r.thread_id = t.thread_id AND r.principal_id = $2 AND r.read_at IS NULL))::text AS inbox_unread,
           count(*) FILTER (WHERE tp.starred)::text AS starred,
           count(*) FILTER (WHERE tp.archived_at IS NOT NULL)::text AS archived
         FROM message_threads t JOIN thread_participants tp ON tp.thread_id = t.thread_id AND tp.principal_id = $2
         WHERE t.workspace_id = $1`,
        [ws, me],
      );
      return {
        items: [...items],
        next_cursor:
          rows.length > limit && lastRow ? encodeCursor([lastRow.last_message_at, lastRow.thread_id]) : null,
        folder_counts: {
          inbox_unread: Number(counts[0]?.inbox_unread ?? 0),
          starred: Number(counts[0]?.starred ?? 0),
          archived: Number(counts[0]?.archived ?? 0),
        },
      };
    }),
};

const thread: ActionHandler<In<"ThreadIn">, S.Schema.Type<typeof SuiteMessages.ThreadOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const me = ctx.principal.id;
      yield* requireParticipant(ws, input.thread_id, me);
      const [summary] = yield* summaries(ws, me, [input.thread_id]);
      const parts = yield* q<{ principal_id: string; role: "from" | "to" | "cc"; via_group: string | null }>(
        `SELECT principal_id, role, via_group FROM thread_participants WHERE thread_id = $1
         ORDER BY (role = 'from') DESC, joined_at, principal_id`,
        [input.thread_id],
      );
      const msgs = yield* q<{
        message_id: string;
        sender_id: string;
        on_behalf_of: string | null;
        body: string;
        mentions: string[];
        sent_at: string;
        reply_to: string | null;
      }>(
        `SELECT m.message_id, m.sender_id, m.on_behalf_of, m.body, m.mentions, ${ISO("m.sent_at")} AS sent_at, m.reply_to
         FROM messages m JOIN thread_participants tp ON tp.thread_id = m.thread_id AND tp.principal_id = $2
         WHERE m.thread_id = $1 AND m.sent_at >= tp.joined_at ORDER BY m.sent_at, m.recorded_at, m.message_id`,
        [input.thread_id, me],
      );
      const ids = msgs.map((m) => m.message_id);
      const atts = ids.length
        ? yield* q<{
            attachment_id: string;
            message_id: string;
            file_name: string;
            media_type: string;
            size_bytes: string;
            sha256: string;
          }>(
            `SELECT attachment_id, message_id, file_name, media_type, size_bytes::text AS size_bytes, sha256 FROM message_attachments WHERE message_id = ANY($1::uuid[]) ORDER BY file_name`,
            [pgArr(ids)],
          )
        : [];
      const receipts = ids.length
        ? yield* q<{ message_id: string; principal_id: string; read_at: string | null }>(
            `SELECT message_id, principal_id, ${ISO("read_at")} AS read_at FROM message_receipts WHERE message_id = ANY($1::uuid[])`,
            [pgArr(ids)],
          )
        : [];
      const refs = yield* personRefs(ws, [
        ...parts.map((p) => p.principal_id),
        ...msgs.flatMap((m) => [m.sender_id, ...(m.on_behalf_of ? [m.on_behalf_of] : []), ...m.mentions]),
      ]);
      return {
        thread: summary as ThreadSummary,
        participants: parts.map((p) => ({
          person: ref(refs, p.principal_id),
          role: p.role,
          via_group: p.via_group,
        })),
        messages: msgs.map((m) => ({
          message_id: m.message_id,
          thread_id: input.thread_id,
          sender: ref(refs, m.sender_id),
          on_behalf_of: m.on_behalf_of ? ref(refs, m.on_behalf_of) : null,
          body: m.body,
          mentions: m.mentions.map((x) => ref(refs, x)),
          sent_at: m.sent_at,
          reply_to: m.reply_to,
          attachments: atts
            .filter((a) => a.message_id === m.message_id)
            .map((a) => ({
              attachment_id: a.attachment_id,
              file_name: a.file_name,
              media_type: a.media_type,
              size_bytes: Number(a.size_bytes),
              sha256: a.sha256,
            })),
          read_by_me:
            receipts.find((r) => r.message_id === m.message_id && r.principal_id === me)?.read_at != null,
          read_by:
            m.sender_id === me
              ? receipts
                  .filter((r) => r.message_id === m.message_id && r.principal_id !== me && r.read_at !== null)
                  .map((r) => ({ person: ref(refs, r.principal_id), read_at: r.read_at as string }))
              : [],
        })),
      } as never;
    }),
};

// ---- state ---------------------------------------------------------------------------------------------

interface StateFlags {
  readonly read?: boolean | undefined;
  readonly starred?: boolean | undefined;
  readonly archived?: boolean | undefined;
  readonly muted?: boolean | undefined;
}

const applyState = (
  ctx: ActionCtx,
  threadIds: ReadonlyArray<string>,
  flags: StateFlags,
): Effect.Effect<S.Schema.Type<typeof SuiteMessages.ThreadStateOut>, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const me = ctx.principal.id;
    const ids = [...new Set(threadIds)];
    const mine = yield* q<{ thread_id: string }>(
      `SELECT tp.thread_id FROM thread_participants tp JOIN message_threads t ON t.thread_id = tp.thread_id
       WHERE t.workspace_id = $1 AND tp.principal_id = $2 AND tp.thread_id = ANY($3::uuid[])`,
      [ws, me, pgArr(ids)],
    );
    if (mine.length !== ids.length)
      return yield* Effect.fail(
        refusal("RULE_REFUSED", "NOT_PARTICIPANT", "you are not a participant of one of these threads"),
      );
    const arr = pgArr(ids);
    const at = ctx.now.toISOString();
    if (flags.read === true)
      yield* q(
        `UPDATE message_receipts SET read_at = $3::timestamptz WHERE principal_id = $1 AND thread_id = ANY($2::uuid[]) AND read_at IS NULL`,
        [me, arr, at],
      );
    else if (flags.read === false)
      // mark the newest message from someone else unread, per thread
      yield* q(
        `UPDATE message_receipts r SET read_at = NULL
         WHERE r.principal_id = $1 AND (r.message_id) IN (
           SELECT DISTINCT ON (m.thread_id) m.message_id FROM messages m
           WHERE m.thread_id = ANY($2::uuid[]) AND m.sender_id <> $1 ORDER BY m.thread_id, m.sent_at DESC, m.recorded_at DESC, m.message_id)`,
        [me, arr],
      );
    if (flags.starred !== undefined)
      yield* q(
        `UPDATE thread_participants SET starred = $3 WHERE principal_id = $1 AND thread_id = ANY($2::uuid[])`,
        [me, arr, flags.starred],
      );
    if (flags.archived !== undefined)
      yield* q(
        `UPDATE thread_participants SET archived_at = ${flags.archived ? "$3::timestamptz" : "NULL"} WHERE principal_id = $1 AND thread_id = ANY($2::uuid[])`,
        flags.archived ? [me, arr, at] : [me, arr],
      );
    if (flags.muted !== undefined)
      yield* q(
        `UPDATE thread_participants SET muted = $3 WHERE principal_id = $1 AND thread_id = ANY($2::uuid[])`,
        [me, arr, flags.muted],
      );
    yield* emitFrom(ctx, "message.state_changed", {
      audience: [ctx.principal.subject],
      member: ctx.principal,
      payload: {
        thread_ids: ids,
        ...(flags.read !== undefined ? { read: flags.read } : {}),
        ...(flags.starred !== undefined ? { starred: flags.starred } : {}),
        ...(flags.archived !== undefined ? { archived: flags.archived } : {}),
        ...(flags.muted !== undefined ? { muted: flags.muted } : {}),
      },
    });
    const rows = yield* q<{
      thread_id: string;
      unread: string;
      starred: boolean;
      archived: boolean;
      muted: boolean;
    }>(
      `SELECT tp.thread_id, (SELECT count(*) FROM message_receipts r WHERE r.thread_id = tp.thread_id AND r.principal_id = tp.principal_id AND r.read_at IS NULL)::text AS unread,
              tp.starred, (tp.archived_at IS NOT NULL) AS archived, tp.muted
       FROM thread_participants tp WHERE tp.principal_id = $1 AND tp.thread_id = ANY($2::uuid[])`,
      [me, arr],
    );
    return {
      threads: ids.map((id) => {
        const r = rows.find((x) => x.thread_id === id);
        return {
          thread_id: id,
          unread_count: Number(r?.unread ?? 0),
          starred: r?.starred ?? false,
          archived: r?.archived ?? false,
          muted: r?.muted ?? false,
        };
      }),
    };
  });

const describeState = (f: StateFlags): string =>
  [
    f.read !== undefined ? (f.read ? "mark read" : "mark unread") : "",
    f.starred !== undefined ? (f.starred ? "star" : "unstar") : "",
    f.archived !== undefined ? (f.archived ? "archive" : "unarchive") : "",
    f.muted !== undefined ? (f.muted ? "mute" : "unmute") : "",
  ]
    .filter(Boolean)
    .join(", ") || "no change";

const state: ActionHandler<In<"ThreadStateIn">, S.Schema.Type<typeof SuiteMessages.ThreadStateOut>> = {
  preview: (input) =>
    Effect.succeed({ effect: `Thread state: ${describeState(input)}`, facts: { threads: 1 } }),
  run: (input, ctx) => applyState(ctx, [input.thread_id], input),
};

const bulkState: ActionHandler<In<"BulkStateIn">, S.Schema.Type<typeof SuiteMessages.ThreadStateOut>> = {
  preview: (input) =>
    Effect.succeed({
      effect: `${describeState(input)} on ${input.thread_ids.length} threads`,
      facts: { threads: input.thread_ids.length },
    }),
  run: (input, ctx) => applyState(ctx, input.thread_ids, input),
};

// ---- recipients ----------------------------------------------------------------------------------------

const recipients: ActionHandler<In<"RecipientsIn">, S.Schema.Type<typeof SuiteMessages.RecipientsOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const limit = Math.min(25, input.limit ?? 10);
      const text = input.q.trim().toLowerCase();
      const program = yield* loadProgram(ws);
      const canBroadcast = yield* mayBroadcast(ctx);
      const people = yield* q<{
        handle: string;
        display_name: string;
        title: string;
        department: string;
        avatar_hue: number;
        subject: string;
      }>(
        `SELECT m.handle, p.display_name, m.title, m.department, m.avatar_hue, p.subject
         FROM members m JOIN principals p ON p.principal_id = m.member_id
         WHERE m.workspace_id = $1 AND p.disabled_at IS NULL AND m.member_id <> $2
           AND ($3 = '' OR lower(p.display_name) LIKE '%' || $3 || '%' OR m.handle LIKE '%' || $3 || '%')
         ORDER BY (lower(p.display_name) LIKE $3 || '%' OR m.handle LIKE $3 || '%') DESC, p.display_name LIMIT $4`,
        [ws, ctx.principal.id, text, limit],
      );
      const groupRows = yield* q<{
        slug: string;
        body: {
          metadata?: { title?: string };
          spec?: {
            description?: string;
            members?: string[];
            managers?: string[];
            open_posting?: boolean;
            artwork?: unknown;
          };
        };
      }>(
        `SELECT slug, body FROM nodes WHERE workspace_id = $1 AND kind = 'Group' AND deleted_at IS NULL
           AND ($2 = '' OR lower(body -> 'metadata' ->> 'title') LIKE '%' || $2 || '%' OR slug LIKE '%' || $2 || '%') ORDER BY slug`,
        [ws, text],
      );
      const items: S.Schema.Type<typeof SuiteMessages.RecipientOption>[] = [];
      for (const p of people) {
        const parts = p.display_name.split(/\s+/);
        items.push({
          recipient: `user:${p.handle}`,
          kind: "person",
          label: p.display_name,
          description: p.title,
          avatar: {
            initials: ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase(),
            hue: p.avatar_hue,
          },
          artwork: null,
          member_count: null,
          allowed: true,
        } as never);
      }
      for (const g of groupRows) {
        const n = g.body.spec?.members?.length ?? 0;
        const manager = (g.body.spec?.managers ?? []).includes(ctx.principal.subject);
        const open = g.body.spec?.open_posting ?? false;
        items.push({
          recipient: `group:${g.slug}`,
          kind: "group",
          label: g.body.metadata?.title ?? g.slug,
          description: g.body.spec?.description ?? "",
          avatar: null,
          artwork: (g.body.spec?.artwork ?? null) as never,
          member_count: n,
          allowed: (open || manager) && (n - 1 < program.messaging.broadcast_min_recipients || canBroadcast),
        } as never);
      }
      const rank = (label: string) => (label.toLowerCase().startsWith(text) ? 0 : 1);
      items.sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
      return { items: items.slice(0, limit) };
    }),
};

export const messagesHandlers = {
  "messages.list": list,
  "messages.thread": thread,
  "messages.send": send,
  "messages.reply": reply,
  "messages.state": state,
  "messages.bulk_state": bulkState,
  "messages.recipients": recipients,
} satisfies HandlerTable;
