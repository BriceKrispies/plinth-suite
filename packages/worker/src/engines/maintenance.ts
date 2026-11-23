import { Effect } from "effect";
import {
  ControlStore,
  announceDecision,
  createNotifications,
  emitDomainEvent,
  loadHeld,
  store,
} from "@plinth/engine";
import type { TickHook } from "../hooks";

/** Is `hour` inside the quiet window `[start, end)`, which may wrap midnight? Equal bounds mean no quiet hours. */
export const inQuietHours = (hour: number, start: number, end: number): boolean =>
  start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end;

/**
 * Email stub (CONTRACT.md 12.3): a queued email delivery is marked `sent`, or `suppressed` when the member is disabled
 * or the virtual hour falls in their quiet hours. Nothing is sent anywhere.
 */
export const sendQueuedEmails: TickHook = (_tick, ctx) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const hour = ctx.now.getUTCHours();
    const rows = yield* store(
      sql<{
        delivery_id: string;
        disabled: boolean;
        quiet: { start_hour?: number; end_hour?: number } | null;
      }>`
        SELECT d.delivery_id, (p.disabled_at IS NOT NULL) AS disabled,
               (SELECT n.body -> 'spec' -> 'quiet_hours' FROM nodes n
                 WHERE n.workspace_id = d.workspace_id AND n.kind = 'Preference' AND n.slug = 'prefs.' || m.handle
                   AND n.deleted_at IS NULL) AS quiet
        FROM notification_deliveries d
        JOIN principals p ON p.principal_id = d.recipient_id
        LEFT JOIN members m ON m.member_id = d.recipient_id
        WHERE d.workspace_id = ${ctx.workspaceId} AND d.channel = 'email' AND d.status = 'queued'
        ORDER BY d.created_at LIMIT 500`,
    );
    for (const r of rows) {
      const q = r.quiet;
      const reason = r.disabled
        ? "member_disabled"
        : q?.start_hour !== undefined &&
            q.end_hour !== undefined &&
            inQuietHours(hour, q.start_hour, q.end_hour)
          ? "quiet_hours"
          : null;
      if (reason === null)
        yield* store(
          sql`UPDATE notification_deliveries SET status = 'sent', sent_at = ${ctx.now.toISOString()}::timestamptz
              WHERE delivery_id = ${r.delivery_id}`,
        );
      else
        yield* store(
          sql`UPDATE notification_deliveries SET status = 'suppressed', suppressed_reason = ${reason}
              WHERE delivery_id = ${r.delivery_id}`,
        );
    }
  });

/** Held actions expire 7 virtual days after filing: mark them `expired` and tell the requester. */
const expireActions: TickHook = (_tick, ctx) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const due = yield* store(
      sql<{ approval_id: string }>`
        SELECT approval_id FROM action_approvals
        WHERE workspace_id = ${ctx.workspaceId} AND status = 'pending_approval'
          AND expires_at <= ${ctx.now.toISOString()}::timestamptz
        ORDER BY created_at LIMIT 200`,
    );
    if (due.length === 0) return;
    const sched = yield* store(
      sql<{ principal_id: string; subject: string; workspace_slug: string }>`
        SELECT p.principal_id, p.subject, w.slug AS workspace_slug FROM principals p JOIN workspaces w ON w.workspace_id = p.workspace_id
        WHERE p.workspace_id = ${ctx.workspaceId} AND p.subject = 'service:scheduler'`,
    );
    for (const d of due) {
      const held = yield* loadHeld(ctx.workspaceId, d.approval_id, ctx.now);
      yield* store(sql`UPDATE action_approvals SET status = 'expired' WHERE approval_id = ${d.approval_id}`);
      const s = sched[0];
      if (s)
        yield* announceDecision(
          {
            principal: { id: s.principal_id, subject: s.subject, workspaceId: ctx.workspaceId },
            surface: "system",
            now: ctx.now,
          },
          held,
          "withdraw",
          "expired",
          { id: s.principal_id, subject: s.subject },
        );
    }
  });

/**
 * Held changes (`change_approvals`, the kernel's own table) expire on the same 7-virtual-day clock: status `expired`,
 * `approval.decided` and an `approval_decision` notification to the requester (and the person an agent acted for).
 */
const expireChanges: TickHook = (_tick, ctx) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ctx.workspaceId;
    const due = yield* store(
      sql<{
        approval_id: string;
        requester_id: string;
        on_behalf_of: string | null;
        requester: string;
        behalf: string | null;
      }>`
        SELECT a.approval_id, a.requester_id, a.on_behalf_of, r.subject AS requester, b.subject AS behalf
        FROM change_approvals a JOIN principals r ON r.principal_id = a.requester_id
        LEFT JOIN principals b ON b.principal_id = a.on_behalf_of
        WHERE a.workspace_id = ${ws} AND a.status = 'pending_approval' AND a.expires_at <= ${ctx.now.toISOString()}::timestamptz
        ORDER BY a.created_at, a.approval_id LIMIT 200`,
    );
    if (due.length === 0) return;
    const sched = yield* store(
      sql<{ principal_id: string; subject: string }>`
        SELECT principal_id, subject FROM principals WHERE workspace_id = ${ws} AND subject = 'service:scheduler'`,
    );
    const s = sched[0];
    for (const d of due) {
      yield* store(
        sql`UPDATE change_approvals SET status = 'expired' WHERE approval_id = ${d.approval_id} AND status = 'pending_approval'`,
      );
      if (!s) continue;
      const seq = yield* emitDomainEvent(ws, {
        type: "approval.decided",
        occurredAt: ctx.now,
        actor: { id: s.principal_id, subject: s.subject },
        surface: "system",
        audience: [...new Set([d.requester, ...(d.behalf ? [d.behalf] : [])])],
        subject: { kind: "approval", id: d.approval_id },
        member: { id: d.requester_id, subject: d.requester },
        payload: {
          approval_type: "change",
          id: d.approval_id,
          decision: "withdraw",
          by: s.subject,
          status: "expired",
        },
      });
      yield* createNotifications(
        {
          principal: { id: s.principal_id, subject: s.subject, workspaceId: ws },
          surface: "system",
          now: ctx.now,
        },
        {
          recipients: [
            { id: d.requester_id, subject: d.requester },
            ...(d.on_behalf_of && d.behalf ? [{ id: d.on_behalf_of, subject: d.behalf }] : []),
          ],
          type: "approval_decision",
          title: "Approval expired",
          body: "A held change was not decided within 7 days and has expired.",
          link: "/approvals",
          actorId: s.principal_id,
          subject: { kind: "approval", id: d.approval_id },
          sourceEventSeq: seq,
          dedupeKey: `${seq}:approval_decision`,
        },
      );
    }
  });

/** Every held item (actions and changes) expires 7 virtual days after filing. */
export const expireHeldActions: TickHook = (tick, ctx) =>
  Effect.gen(function* () {
    yield* expireActions(tick, ctx);
    yield* expireChanges(tick, ctx);
  });
