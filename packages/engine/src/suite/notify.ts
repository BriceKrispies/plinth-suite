import { newId } from "./ids";
import { Effect } from "effect";
import { evalRowPredicate } from "@plinth/query";
import type { NavCounts, NotificationType, NotificationView, ProgramSpec } from "@plinth/spec";
import { Authorizer } from "../authz";
import type { Principal } from "../identity";
import { ControlStore, store } from "../control-store";
import type { StoreError } from "../errors";
import { emitFrom, type EmitCtx, type PrincipalRef } from "./domain-events";
import { personRefOf } from "./people";
import { loadProgram } from "./program";

/**
 * Notifications are created inside the transaction of the write that causes them (CONTRACT.md 12.3). One row per
 * recipient, deduplicated on `(recipient, dedupe_key)`. The recipient's effective channel preferences (their Preference
 * node, else the Program defaults) decide whether a row exists at all, whether it is shown in the app, and whether an
 * email-stub delivery is queued. Each created notification emits `notification.created` to its recipient.
 */

export interface NotifySpec {
  /** Recipient principals (humans). Disabled members and the actor of `skipSelf` are skipped by the caller. */
  readonly recipients: ReadonlyArray<PrincipalRef>;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  /** An app route. */
  readonly link?: string | null;
  readonly actorId?: string | null;
  readonly subject?: { readonly kind: string; readonly id: string } | null;
  readonly sourceEventSeq?: number | null;
  /** `<event seq>:<type>` by convention; automation steps pass their step key. */
  readonly dedupeKey: string;
}

export interface NotifyResult {
  /** Notification rows created (not deduplicated, not suppressed by preference). */
  readonly created: number;
  /** Recipients whose preferences have every channel off. */
  readonly suppressed: number;
  readonly notificationIds: ReadonlyArray<string>;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** The effective channel preferences of a member for a type. */
const channelsFor = (
  prefs: { notifications?: Record<string, { in_app: boolean; email: boolean; digest: boolean }> } | undefined,
  program: ProgramSpec,
  type: NotificationType,
): { in_app: boolean; email: boolean; digest: boolean } =>
  prefs?.notifications?.[type] ??
  (program.notification_defaults as Record<string, { in_app: boolean; email: boolean; digest: boolean }>)[
    type
  ] ?? {
    in_app: true,
    email: false,
    digest: false,
  };

export const createNotifications = (
  ctx: EmitCtx,
  spec: NotifySpec,
): Effect.Effect<NotifyResult, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ctx.principal.workspaceId;
    const program = yield* loadProgram(ws);
    let created = 0;
    let suppressed = 0;
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const r of spec.recipients) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const handle = r.subject.startsWith("user:") ? r.subject.slice(5) : "";
      const prefRows = yield* store(
        sql<{
          body: {
            spec?: { notifications?: Record<string, { in_app: boolean; email: boolean; digest: boolean }> };
          };
        }>`
          SELECT body FROM nodes WHERE workspace_id = ${ws} AND kind = 'Preference' AND slug = ${"prefs." + handle}
            AND deleted_at IS NULL`,
      );
      const ch = channelsFor(prefRows[0]?.body.spec, program, spec.type);
      if (!ch.in_app && !ch.email && !ch.digest) {
        suppressed += 1;
        continue;
      }
      const id = newId();
      const title = clip(spec.title, 140);
      const body = clip(spec.body, 500);
      const inserted = yield* store(
        sql<{ notification_id: string }>`
          INSERT INTO notifications (notification_id, workspace_id, recipient_id, type, title, body, link, actor_id,
                                     subject_kind, subject_id, in_app, created_at, source_event_seq, dedupe_key)
          VALUES (${id}, ${ws}, ${r.id}, ${spec.type}, ${title}, ${body}, ${spec.link ?? null}, ${spec.actorId ?? null},
                  ${spec.subject?.kind ?? null}, ${spec.subject?.id ?? null}, ${ch.in_app}, ${ctx.now.toISOString()}::timestamptz,
                  ${spec.sourceEventSeq ?? null}, ${spec.dedupeKey})
          ON CONFLICT (recipient_id, dedupe_key) DO NOTHING
          RETURNING notification_id`,
      );
      if (inserted.length === 0) continue;
      created += 1;
      ids.push(id);
      if (ch.email)
        yield* store(
          sql`INSERT INTO notification_deliveries (delivery_id, workspace_id, recipient_id, channel, status, subject, body,
                                                    notification_ids, created_at)
              VALUES (${newId()}, ${ws}, ${r.id}, 'email', 'queued', ${title}, ${body}, ARRAY[${id}]::uuid[],
                      ${ctx.now.toISOString()}::timestamptz)`,
        );
      const actor = spec.actorId
        ? yield* personRefOf(ws, spec.actorId).pipe(Effect.orElseSucceed(() => null))
        : null;
      const view: NotificationView = {
        notification_id: id,
        type: spec.type,
        title,
        body,
        link: (spec.link ?? null) as NotificationView["link"],
        actor,
        created_at: ctx.now.toISOString() as NotificationView["created_at"],
        read_at: null,
        subject: (spec.subject ?? null) as NotificationView["subject"],
      };
      yield* emitFrom(ctx, "notification.created", {
        audience: [r.subject],
        payload: { notification: view },
        subject: { kind: "notification", id },
        member: r,
      });
    }
    return { created, suppressed, notificationIds: ids };
  });

// ---- counts --------------------------------------------------------------------------------------------

const ORDER_ATTENTION = ["placed", "approved", "fulfilled"] as const;

/**
 * The numbers behind every badge in the shell (`NavCounts`), computed for one principal. The gateway recomputes this
 * after a delivered batch containing a count-affecting event (CONTRACT.md 6.1); `me.counts` serves the same function.
 */
export const navCounts = (
  principal: Principal,
): Effect.Effect<NavCounts, StoreError, ControlStore | Authorizer> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const authz = yield* Authorizer;
    const ws = principal.workspaceId;
    const pid = principal.id;
    const one = (rows: ReadonlyArray<{ n: string | number }>) => Number(rows[0]?.n ?? 0);

    const notifications = one(
      yield* store(
        sql<{
          n: string;
        }>`SELECT count(*) AS n FROM notifications WHERE recipient_id = ${pid} AND in_app AND read_at IS NULL`,
      ),
    );
    const messages = one(
      yield* store(
        sql<{ n: string }>`
          SELECT count(DISTINCT r.thread_id) AS n
          FROM message_receipts r
          JOIN thread_participants tp ON tp.thread_id = r.thread_id AND tp.principal_id = r.principal_id
          WHERE r.principal_id = ${pid} AND r.read_at IS NULL AND tp.archived_at IS NULL`,
      ),
    );
    const tasks = one(
      yield* store(
        sql<{ n: string }>`
          SELECT count(*) AS n FROM tasks WHERE workspace_id = ${ws} AND assignee_id = ${pid}
            AND status IN ('open', 'in_progress', 'blocked')`,
      ),
    );
    const cart = one(
      yield* store(
        sql<{ n: string }>`
          SELECT coalesce(sum(ci.qty), 0) AS n FROM carts c JOIN cart_items ci ON ci.cart_id = c.cart_id
          WHERE c.member_id = ${pid}`,
      ),
    );
    const reviews = one(
      yield* store(
        sql<{ n: string }>`
          SELECT count(*) AS n FROM nodes
          WHERE workspace_id = ${ws} AND kind = 'Content' AND deleted_at IS NULL
            AND body -> 'spec' ->> 'status' = 'in_review'
            AND body -> 'spec' -> 'reviewers' ? ${principal.subject}`,
      ),
    );

    // approvals: held changes and held actions the principal's grants let it decide, other than its own requests
    const pending = yield* store(
      sql<{ approver_permission: string; requester_id: string; on_behalf_of: string | null }>`
        SELECT approver_permission, requester_id, on_behalf_of FROM change_approvals
          WHERE workspace_id = ${ws} AND status = 'pending_approval'
        UNION ALL
        SELECT approver_permission, requester_id, on_behalf_of FROM action_approvals
          WHERE workspace_id = ${ws} AND status = 'pending_approval'`,
    );
    const resource = `plinth://${principal.workspaceSlug}/suite/approvals`;
    const mayDecide = new Map<string, boolean>();
    let approvals = 0;
    if (principal.kind === "human" && pending.length > 0) {
      const decide = yield* authz.authorize(principal, "approval:decide", resource);
      const decideAny = decide.kind === "allow";
      for (const row of pending) {
        if (row.requester_id === pid || row.on_behalf_of === pid) continue;
        let ok = mayDecide.get(row.approver_permission);
        if (ok === undefined) {
          const isGrant = row.approver_permission === "grant:write";
          const d = isGrant
            ? yield* authz.authorize(principal, "grant:write", `plinth://${principal.workspaceSlug}/Grant/`)
            : yield* authz.authorize(principal, row.approver_permission, resource);
          ok = decideAny && d.kind === "allow";
          mayDecide.set(row.approver_permission, ok);
        }
        if (ok) approvals += 1;
      }
    }

    // orders needing attention: store staff only, restricted by the row predicate of store:orders
    let orders = 0;
    if (principal.kind === "human") {
      const d = yield* authz.authorize(
        principal,
        "store:orders",
        `plinth://${principal.workspaceSlug}/suite/store`,
      );
      if (d.kind === "allow") {
        const rows = yield* store(
          sql<{ handle: string; region: string; tier: string; department: string }>`
            SELECT m.handle, o.region, o.tier, m.department
            FROM store_orders o JOIN members m ON m.member_id = o.member_id
            WHERE o.workspace_id = ${ws} AND o.status IN ${sql.in([...ORDER_ATTENTION])}
              AND (o.status <> 'placed' OR o.requires_approval)`,
        );
        orders = rows.filter((r) => evalRowPredicate(d.rowPredicate, r)).length;
      }
    }

    return {
      notifications_unread: notifications,
      messages_unread: messages,
      approvals_pending: approvals,
      tasks_open: tasks,
      cart_items: cart,
      content_reviews: reviews,
      orders_attention: orders,
    };
  });
