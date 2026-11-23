import { Effect } from "effect";
import { nodeId, nodeUri } from "@plinth/core";
import type { NodeChange } from "@plinth/spec";
import {
  ChangeLog,
  ControlStore,
  Identity,
  createNotifications,
  emitFrom,
  store,
  type EmitCtx,
  type Principal,
  type PrincipalRef,
} from "@plinth/engine";
import type { TickHook, WorkerCtx } from "../hooks";

/**
 * Promotion schedule (CONTRACT.md section 8.1, rule R-PROMO-SCHEDULE). At each virtual minute move `scheduled -> active`
 * at `starts_at` and `active | paused -> ended` at `ends_at`, committing the Promotion node as `service:scheduler` on the
 * system surface with `managed: { by: "promotions.transition" }`; emit `promotion.state_changed` and, on activation, a
 * `promotion_started` notification to every active member.
 *
 * The same hook reconciles held activations: when an approver applied a held `promotions.transition` change through the
 * kernel approvals path, the status change is in the change log but no domain event was appended, so the hook emits
 * `promotion.state_changed` for it (once per revision).
 */

interface PromoRow {
  slug: string;
  title: string;
  revision: string;
  status: string;
  starts_at: string;
  ends_at: string;
}

const ectxOf = (svc: Principal, now: Date): EmitCtx => ({ principal: svc, surface: "system", now });

const announce = (
  ctx: EmitCtx,
  ws: string,
  p: { slug: string; title: string },
  from: string,
  to: string,
  revision: number,
) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const seq = yield* emitFrom(ctx, "promotion.state_changed", {
      audience: ["*"],
      subject: { kind: "promotion", id: p.slug },
      payload: {
        promotion: p.slug,
        title: p.title,
        from: from as never,
        to: to as never,
        revision,
      },
    });
    if (to === "active" && from !== "paused") {
      const members = yield* store(
        sql<{ principal_id: string; subject: string }>`
          SELECT p.principal_id, p.subject FROM principals p JOIN members m ON m.member_id = p.principal_id
          WHERE p.workspace_id = ${ws} AND p.disabled_at IS NULL ORDER BY p.subject`,
      );
      const recipients: PrincipalRef[] = members.map((m) => ({ id: m.principal_id, subject: m.subject }));
      yield* createNotifications(ctx, {
        recipients,
        type: "promotion_started",
        title: "New offer",
        body: p.title,
        link: "/store",
        subject: { kind: "promotion", id: p.slug },
        sourceEventSeq: seq,
        dedupeKey: `${seq}:promotion_started`,
      });
    }
  });

const move = (
  svc: Principal,
  ctx: WorkerCtx,
  p: PromoRow,
  from: string,
  to: "active" | "ended",
  revision: number,
) =>
  Effect.gen(function* () {
    const log = yield* ChangeLog;
    const change: NodeChange = {
      target: nodeUri(ctx.workspaceSlug, "Promotion", nodeId(ctx.workspaceId, "Promotion", p.slug)),
      base_revision: revision,
      ops: [{ op: "set", path: "/spec/status", value: to }],
    };
    const res = yield* log.commit({
      actor: { principal: svc, surface: "system" },
      changes: [change],
      reason: to === "active" ? "scheduled start" : "scheduled end",
      managed: { by: "promotions.transition" },
    });
    const rev = res.nodes?.[0]?.result_revision ?? revision + 1;
    yield* announce(ectxOf(svc, ctx.now), ctx.workspaceId, p, from, to, rev);
    return rev;
  });

export const promotionSchedule: TickHook = (_tick, ctx) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const now = ctx.now.toISOString();
    const rows = yield* store(
      sql<PromoRow>`
        SELECT slug, body -> 'metadata' ->> 'title' AS title, revision::text AS revision,
               body -> 'spec' ->> 'status' AS status, body -> 'spec' -> 'schedule' ->> 'starts_at' AS starts_at,
               body -> 'spec' -> 'schedule' ->> 'ends_at' AS ends_at
        FROM nodes WHERE workspace_id = ${ctx.workspaceId} AND kind = 'Promotion' AND deleted_at IS NULL
        ORDER BY slug`,
    );
    const nowMs = ctx.now.getTime();
    const due = rows.filter(
      (r) =>
        (r.status === "scheduled" && Date.parse(r.starts_at) <= nowMs) ||
        ((r.status === "active" || r.status === "paused") && Date.parse(r.ends_at) <= nowMs),
    );
    const identity = yield* Identity;
    const svc = yield* identity.bySubject("service:scheduler");
    for (const p of due) {
      let rev = Number(p.revision);
      let status = p.status;
      if (status === "scheduled" && Date.parse(p.starts_at) <= nowMs) {
        rev = yield* move(svc, ctx, p, "scheduled", "active", rev);
        status = "active";
      }
      if ((status === "active" || status === "paused") && Date.parse(p.ends_at) <= nowMs)
        yield* move(svc, ctx, p, status, "ended", rev);
    }

    // reconcile approver-applied status changes that have no state event yet
    const held = yield* store(
      sql<{
        slug: string;
        title: string;
        result_revision: string;
        ops: Array<{ op: string; path?: string; value?: unknown }>;
        inverse_ops: Array<{ op: string; path?: string; value?: unknown }>;
      }>`
        SELECT n.slug, n.body -> 'metadata' ->> 'title' AS title, c.result_revision::text AS result_revision, c.ops, c.inverse_ops
        FROM changes c JOIN nodes n ON n.workspace_id = c.workspace_id AND n.node_id = c.node_id
        WHERE c.workspace_id = ${ctx.workspaceId} AND n.kind = 'Promotion' AND c.kind = 'change' AND c.approval_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM domain_events e WHERE e.workspace_id = c.workspace_id AND e.type = 'promotion.state_changed'
              AND e.subject_id = n.slug AND (e.payload ->> 'revision')::bigint = c.result_revision)
        ORDER BY c.seq`,
    );
    for (const h of held) {
      const to = h.ops.find((o) => o.op === "set" && o.path === "/spec/status")?.value;
      const from = h.inverse_ops.find((o) => o.op === "set" && o.path === "/spec/status")?.value;
      if (typeof to !== "string" || typeof from !== "string") continue;
      yield* announce(ectxOf(svc, ctx.now), ctx.workspaceId, h, from, to, Number(h.result_revision));
    }
  });
