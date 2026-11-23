import { Effect, Schema as S } from "effect";
import { DomainError, SuiteWork, type ApprovalType, APPROVAL_TYPES } from "@plinth/spec";
import { Authorizer } from "../../authz";
import type { Decision } from "../../authz-core";
import { ChangeLog } from "../../change-log";
import { closeHeldAction, callAction } from "../dispatcher";
import { emitFrom } from "../domain-events";
import { createNotifications } from "../notify";
import { mayTarget } from "../target";
import type { ActionCtx, ActionHandler, HandlerError, SuiteEnv } from "../types";
import type { HandlerTable } from "./stub";
import {
  ISO,
  clip,
  decodeCursor,
  dom,
  encodeCursor,
  limitOf,
  pgArr,
  personRefs,
  q,
  ref,
  refusal,
} from "./util3";

/**
 * Module `approvals` (CONTRACT.md 12.7): one inbox over four sources, `change` (kernel `change_approvals`), `action`
 * (`action_approvals`), `order` (placed orders needing `store:approve`) and `content_review` (content in review where the
 * viewer is a reviewer). `can_decide` applies separation of duties and the approver permission. `approvals.decide`
 * dispatches to the owner of each source.
 */

type Item = S.Schema.Type<typeof SuiteWork.ApprovalItem>;
type Status = Item["status"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PENDING: Status = "pending_approval";

// ---- the viewer's rights, cached per call -----------------------------------------------------------

const viewer = (ctx: ActionCtx) => {
  const cache = new Map<string, Decision>();
  const slug = ctx.principal.workspaceSlug;
  const decision = (perm: string, module: string) =>
    Effect.gen(function* () {
      const key = `${perm}|${module}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const authz = yield* Authorizer;
      const resource =
        perm === "grant:write" ? `plinth://${slug}/Grant/` : `plinth://${slug}/suite/${module}`;
      const d = yield* authz.authorize(ctx.principal, perm, resource);
      cache.set(key, d);
      return d;
    });
  /** Why the viewer may not decide, or null when they may. */
  const blocked = (
    perm: string,
    module: string,
    who: { requester: string; behalf: string | null },
    facts?: { handle: string; region: string; tier: string; department: string },
  ) =>
    Effect.gen(function* () {
      if (ctx.principal.kind !== "human") return "missing_permission";
      if (who.requester === ctx.principal.id) return "sod_requester";
      if (who.behalf === ctx.principal.id) return "sod_on_behalf_of";
      const decide = yield* decision("approval:decide", "approvals");
      if (decide.kind !== "allow") return "missing_permission";
      const d = yield* decision(perm, module);
      if (d.kind !== "allow") return "missing_permission";
      if (facts && !mayTarget({ allow: d }, facts)) return "missing_permission";
      return null;
    });
  return { decision, blocked };
};
type Viewer = ReturnType<typeof viewer>;

// ---- change items ------------------------------------------------------------------------------------

const RULE_TEXT: Record<string, string> = {
  "R-PROGRAM": "Change the Program policy",
  "R-ROLE": "Change role membership",
  "R-GRANT": "Change access grants",
  "R-PROMO-ACTIVATE": "Activate a promotion",
  "R-PROMO-CONTROL": "Pause, resume or end a promotion",
  "R-PRODUCT-PRICE": "Change a product's price or status",
  "R-BADGE-EDIT": "Edit a badge",
  "R-AUTOMATION-ENABLE": "Enable or edit a running automation",
  "R-AUTOMATION-EXTERNAL": "Enable an automation with a webhook",
  "R-PAGE-SYSTEM": "Edit a system page",
};

interface ChangeRow {
  approval_id: string;
  requester_id: string;
  on_behalf_of: string | null;
  rule_id: string[];
  payload: { changes?: Array<{ target: string; ops?: Array<{ op: string; kind?: string; slug?: string }> }> };
  status: Status;
  approver_permission: string;
  created_at: string;
  expires_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  requester_subject: string;
  requester_kind: "human" | "agent" | "service";
}

const loadChangeItems = (
  ctx: ActionCtx,
  v: Viewer,
  only?: string,
): Effect.Effect<ReadonlyArray<Item>, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const rows = yield* q<ChangeRow>(
      `SELECT a.approval_id, a.requester_id, a.on_behalf_of, a.rule_id, a.payload, a.status, a.approver_permission,
              ${ISO("a.created_at")} AS created_at, ${ISO("a.expires_at")} AS expires_at, a.decided_by,
              ${ISO("a.decided_at")} AS decided_at, a.decision_reason, p.subject AS requester_subject, p.kind AS requester_kind
       FROM change_approvals a JOIN principals p ON p.principal_id = a.requester_id
       WHERE a.workspace_id = $1 ${only ? "AND a.approval_id = $2" : ""} ORDER BY a.created_at DESC, a.approval_id LIMIT 300`,
      only ? [ws, only] : [ws],
    );
    const nodeIds = [
      ...new Set(
        rows
          .flatMap((r) => (r.payload.changes ?? []).map((c) => c.target.split("/").pop() ?? ""))
          .filter((x) => UUID.test(x)),
      ),
    ];
    const nodes = nodeIds.length
      ? yield* q<{ node_id: string; kind: string; slug: string }>(
          `SELECT node_id, kind, slug FROM nodes WHERE workspace_id = $1 AND node_id = ANY($2::uuid[])`,
          [ws, pgArr(nodeIds)],
        )
      : [];
    const refs = yield* personRefs(
      ws,
      rows.flatMap((r) => [
        r.requester_id,
        ...(r.on_behalf_of ? [r.on_behalf_of] : []),
        ...(r.decided_by ? [r.decided_by] : []),
      ]),
    );
    const out: Item[] = [];
    for (const r of rows) {
      const first = r.payload.changes?.[0];
      const op = first?.ops?.[0];
      const n = nodes.find((x) => x.node_id === first?.target.split("/").pop());
      const kind = op?.kind ?? n?.kind ?? "node";
      const slug = op?.slug ?? n?.slug ?? "";
      const rule = r.rule_id[0] ?? "";
      const what = RULE_TEXT[rule] ?? `Change ${kind}`;
      const summary = slug ? `${what}: ${kind} ${slug}` : what;
      const blocked =
        r.status === PENDING
          ? yield* v.blocked(r.approver_permission, "approvals", {
              requester: r.requester_id,
              behalf: r.on_behalf_of,
            })
          : "not_pending";
      out.push({
        type: "change",
        id: r.approval_id,
        title: clip(summary, 140),
        summary,
        status: r.status,
        requested_by: ref(refs, r.requester_id),
        on_behalf_of: r.on_behalf_of ? ref(refs, r.on_behalf_of) : null,
        requested_at: r.created_at,
        expires_at: r.expires_at,
        rule_id: r.rule_id,
        approver_permission: r.approver_permission,
        can_decide: blocked === null,
        blocked_reason: blocked === "not_pending" ? null : blocked,
        decided_by: r.decided_by ? ref(refs, r.decided_by) : null,
        decided_at: r.decided_at,
        decision_reason: r.decision_reason,
        link: "/approvals",
        detail: { changes: r.payload.changes ?? [], rule_ids: r.rule_id },
      } as Item);
    }
    return out;
  });

// ---- action items ------------------------------------------------------------------------------------

const loadActionItems = (
  ctx: ActionCtx,
  v: Viewer,
  only?: string,
): Effect.Effect<ReadonlyArray<Item>, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const rows = yield* q<{
      approval_id: string;
      action: string;
      input: unknown;
      requester_id: string;
      on_behalf_of: string | null;
      approver_permission: string;
      summary: string;
      status: Status;
      created_at: string;
      expires_at: string;
      decided_by: string | null;
      decided_at: string | null;
      decision_reason: string | null;
    }>(
      `SELECT approval_id, action, input, requester_id, on_behalf_of, approver_permission, summary, status,
              ${ISO("created_at")} AS created_at, ${ISO("expires_at")} AS expires_at, decided_by,
              ${ISO("decided_at")} AS decided_at, decision_reason
       FROM action_approvals WHERE workspace_id = $1 ${only ? "AND approval_id = $2" : ""}
       ORDER BY created_at DESC, approval_id LIMIT 300`,
      only ? [ws, only] : [ws],
    );
    const refs = yield* personRefs(
      ws,
      rows.flatMap((r) => [
        r.requester_id,
        ...(r.on_behalf_of ? [r.on_behalf_of] : []),
        ...(r.decided_by ? [r.decided_by] : []),
      ]),
    );
    const out: Item[] = [];
    for (const r of rows) {
      const blocked =
        r.status === PENDING
          ? yield* v.blocked(r.approver_permission, "approvals", {
              requester: r.requester_id,
              behalf: r.on_behalf_of,
            })
          : "not_pending";
      out.push({
        type: "action",
        id: r.approval_id,
        title: clip(r.summary, 140),
        summary: r.summary,
        status: r.status,
        requested_by: ref(refs, r.requester_id),
        on_behalf_of: r.on_behalf_of ? ref(refs, r.on_behalf_of) : null,
        requested_at: r.created_at,
        expires_at: r.expires_at,
        rule_id: [],
        approver_permission: r.approver_permission,
        can_decide: blocked === null,
        blocked_reason: blocked === "not_pending" ? null : blocked,
        decided_by: r.decided_by ? ref(refs, r.decided_by) : null,
        decided_at: r.decided_at,
        decision_reason: r.decision_reason,
        link: "/approvals",
        detail: { action: r.action, input: r.input },
      } as Item);
    }
    return out;
  });

// ---- order items -------------------------------------------------------------------------------------

const ORDER_DECIDED: Record<string, Status> = {
  placed: PENDING,
  approved: "approved",
  fulfilled: "approved",
  shipped: "approved",
  delivered: "approved",
  refunded: "approved",
  cancelled: "rejected",
};

const loadOrderItems = (
  ctx: ActionCtx,
  v: Viewer,
  only?: string,
): Effect.Effect<ReadonlyArray<Item>, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const rows = yield* q<{
      order_id: string;
      order_no: string;
      member_id: string;
      region: string;
      tier: string;
      status: string;
      total_points: string;
      placed_at: string;
      handle: string;
      department: string;
      item_count: string;
      decided_by: string | null;
      decided_at: string | null;
      decision_note: string | null;
    }>(
      `SELECT o.order_id, o.order_no, o.member_id, o.region, o.tier, o.status, o.total_points::text AS total_points,
              ${ISO("o.placed_at")} AS placed_at, m.handle, m.department,
              (SELECT count(*) FROM store_order_items i WHERE i.order_id = o.order_id)::text AS item_count,
              d.actor_id AS decided_by, ${ISO("d.occurred_at")} AS decided_at, d.note AS decision_note
       FROM store_orders o JOIN members m ON m.member_id = o.member_id
       LEFT JOIN LATERAL (SELECT e.actor_id, e.occurred_at, e.note FROM store_order_events e
                          WHERE e.order_id = o.order_id AND e.to_status IN ('approved', 'cancelled') ORDER BY e.seq LIMIT 1) d ON true
       WHERE o.workspace_id = $1 AND o.requires_approval ${only ? "AND o.order_id = $2" : ""}
       ORDER BY o.placed_at DESC, o.order_id LIMIT 300`,
      only ? [ws, only] : [ws],
    );
    const refs = yield* personRefs(
      ws,
      rows.flatMap((r) => [r.member_id, ...(r.decided_by ? [r.decided_by] : [])]),
    );
    const out: Item[] = [];
    for (const r of rows) {
      const status = ORDER_DECIDED[r.status] ?? PENDING;
      const blocked =
        status === PENDING
          ? yield* v.blocked(
              "store:approve",
              "store",
              { requester: r.member_id, behalf: null },
              {
                handle: r.handle,
                region: r.region,
                tier: r.tier,
                department: r.department,
              },
            )
          : "not_pending";
      const summary = `Approve order ${r.order_no} (${Number(r.item_count)} ${Number(r.item_count) === 1 ? "item" : "items"}, ${Number(r.total_points).toLocaleString("en-US")} points) placed by ${r.handle}`;
      out.push({
        type: "order",
        id: r.order_id,
        title: `Order ${r.order_no}`,
        summary,
        status,
        requested_by: ref(refs, r.member_id),
        on_behalf_of: null,
        requested_at: r.placed_at,
        expires_at: null,
        rule_id: [],
        approver_permission: "store:approve",
        can_decide: blocked === null,
        blocked_reason: blocked === "not_pending" ? null : blocked,
        decided_by: r.decided_by ? ref(refs, r.decided_by) : null,
        decided_at: r.decided_at,
        decision_reason: r.decision_note,
        link: `/store/orders/${r.order_id}`,
        detail: {
          order_no: r.order_no,
          member: r.handle,
          total_points: Number(r.total_points),
          items: Number(r.item_count),
          order_status: r.status,
        },
      } as Item);
    }
    return out;
  });

// ---- content review items ----------------------------------------------------------------------------

const loadContentItems = (
  ctx: ActionCtx,
  v: Viewer,
  only?: string,
): Effect.Effect<ReadonlyArray<Item>, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const rows = yield* q<{
      slug: string;
      revision: string;
      body: {
        metadata?: { title?: string };
        spec?: {
          type?: string;
          author?: string;
          reviewers?: string[];
          review_log?: Array<{ by: string; at: string; decision: string; note?: string; revision: number }>;
        };
      };
    }>(
      `SELECT slug, revision::text AS revision, body FROM nodes WHERE workspace_id = $1 AND kind = 'Content' AND deleted_at IS NULL
         AND body -> 'spec' ->> 'status' = 'in_review' ${only ? "AND slug = $2" : ""} ORDER BY slug LIMIT 300`,
      only ? [ws, only] : [ws],
    );
    const subjects = [
      ...new Set(
        rows
          .flatMap((r) => [r.body.spec?.author ?? "", ...(r.body.spec?.review_log ?? []).map((l) => l.by)])
          .filter(Boolean),
      ),
    ];
    const bySubject = subjects.length
      ? yield* q<{ principal_id: string; subject: string }>(
          `SELECT principal_id, subject FROM principals WHERE workspace_id = $1 AND subject = ANY($2::text[])`,
          [ws, pgArr(subjects)],
        )
      : [];
    const idOf = (s: string | undefined) => bySubject.find((x) => x.subject === s)?.principal_id ?? null;
    const refs = yield* personRefs(
      ws,
      bySubject.map((x) => x.principal_id),
    );
    const out: Item[] = [];
    for (const r of rows) {
      const spec = r.body.spec ?? {};
      const log = spec.review_log ?? [];
      const submitted = [...log].reverse().find((l) => l.decision === "submitted");
      const requesterId = idOf(submitted?.by ?? spec.author) ?? ctx.principal.id;
      const reviewers = spec.reviewers ?? [];
      let blocked: string | null;
      if (ctx.principal.kind !== "human" || !reviewers.includes(ctx.principal.subject))
        blocked = "not_reviewer";
      else if (spec.author === ctx.principal.subject || requesterId === ctx.principal.id)
        blocked = "sod_requester";
      else {
        const d = yield* v.decision("content:review", "content");
        const dd = yield* v.decision("approval:decide", "approvals");
        blocked = d.kind === "allow" && dd.kind === "allow" ? null : "missing_permission";
      }
      const title = r.body.metadata?.title ?? r.slug;
      out.push({
        type: "content_review",
        id: r.slug,
        title: clip(title, 140),
        summary: `Review ${spec.type ?? "content"} ${r.slug}`,
        status: PENDING,
        requested_by: ref(refs, requesterId),
        on_behalf_of: null,
        requested_at: submitted?.at ?? new Date(0).toISOString(),
        expires_at: null,
        rule_id: ["R-CONTENT-STATUS"],
        approver_permission: "content:review",
        can_decide: blocked === null,
        blocked_reason: blocked,
        decided_by: null,
        decided_at: null,
        decision_reason: null,
        link: `/content/${r.slug}`,
        detail: { content: r.slug, revision: Number(r.revision), reviewers, author: spec.author ?? null },
      } as Item);
    }
    return out;
  });

const LOADERS: Record<ApprovalType, typeof loadChangeItems> = {
  change: loadChangeItems,
  action: loadActionItems,
  order: loadOrderItems,
  content_review: loadContentItems,
};

const loadOne = (ctx: ActionCtx, type: ApprovalType, id: string) =>
  Effect.gen(function* () {
    if (type !== "content_review" && !UUID.test(id))
      return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/id", "no such approval item"));
    const items = yield* LOADERS[type](ctx, viewer(ctx), id);
    const it = items[0];
    if (!it) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/id", "no such approval item"));
    return it;
  });

// ---- list ----------------------------------------------------------------------------------------------

const list: ActionHandler<
  S.Schema.Type<typeof SuiteWork.ApprovalsIn>,
  S.Schema.Type<typeof SuiteWork.ApprovalsOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const scope = input.scope ?? "to_decide";
      const statusFilter = input.status ?? (scope === "to_decide" ? "pending_approval" : "all");
      const types = input.types && input.types.length > 0 ? input.types : APPROVAL_TYPES;
      const v = viewer(ctx);
      const me = ctx.principal.subject;
      const picked: Item[] = [];
      for (const t of types) {
        const items = yield* LOADERS[t](ctx, v);
        for (const it of items) {
          const pending = it.status === PENDING;
          const requested = it.requested_by.subject === me || it.on_behalf_of?.subject === me;
          const involved =
            it.decided_by?.subject === me ||
            (pending &&
              (it.can_decide || (it.blocked_reason !== null && it.blocked_reason.startsWith("sod_"))));
          const inScope =
            scope === "to_decide"
              ? pending && it.can_decide
              : scope === "requested"
                ? requested
                : requested || involved;
          const inStatus =
            statusFilter === "all" ? true : statusFilter === "pending_approval" ? pending : !pending;
          if (inScope && inStatus) picked.push(it);
        }
      }
      picked.sort((a, b) =>
        a.requested_at < b.requested_at ? 1 : a.requested_at > b.requested_at ? -1 : a.id < b.id ? 1 : -1,
      );
      const counts: Record<string, number> = Object.fromEntries(APPROVAL_TYPES.map((t) => [t, 0]));
      for (const it of picked) counts[it.type] = (counts[it.type] ?? 0) + 1;
      const limit = limitOf(input.limit, 25);
      const offset = Number(decodeCursor(input.cursor)?.[0] ?? 0) || 0;
      return {
        items: picked.slice(offset, offset + limit),
        next_cursor: offset + limit < picked.length ? encodeCursor([offset + limit]) : null,
        counts,
      } as never;
    }),
};

// ---- decide / withdraw ---------------------------------------------------------------------------------

/** The kernel and the dispatcher speak in `sod_violation`; the Suite contract says SELF_ACTION and INVALID_TRANSITION. */
const mapDecisionError = <A, R>(eff: Effect.Effect<A, HandlerError, R>): Effect.Effect<A, HandlerError, R> =>
  eff.pipe(
    Effect.catchAll((e) => {
      if (e instanceof DomainError) {
        const reason = e.details?.["reason"];
        const policy = e.details?.["policy"];
        if (reason === "sod_violation" && (policy === "sod:requester" || policy === "sod:on_behalf_of"))
          return Effect.fail(
            refusal("RULE_REFUSED", "SELF_ACTION", "you cannot decide your own request", { policy }),
          );
        if (reason === "approval_not_pending")
          return Effect.fail(
            dom("CONFLICT", "/id", e.message, {
              details: { reason: "INVALID_TRANSITION", from: e.details?.["status"], allowed: [] },
            }),
          );
      }
      return Effect.fail(e);
    }),
  );

const announceChange = (
  ctx: ActionCtx,
  id: string,
  decision: "approve" | "reject" | "withdraw",
  status: string,
  requesterId: string,
  behalfId: string | null,
  summary: string,
) =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const rows = yield* q<{ principal_id: string; subject: string }>(
      `SELECT principal_id, subject FROM principals WHERE workspace_id = $1 AND principal_id = ANY($2::uuid[])`,
      [ws, pgArr([requesterId, ...(behalfId ? [behalfId] : [])])],
    );
    const requester = rows.find((r) => r.principal_id === requesterId);
    const behalf = rows.find((r) => r.principal_id === behalfId);
    const audience = [
      ...new Set([requester?.subject, behalf?.subject, ctx.principal.subject].flatMap((x) => (x ? [x] : []))),
    ];
    const seq = yield* emitFrom(ctx, "approval.decided", {
      audience,
      subject: { kind: "approval", id },
      ...(requester ? { member: { id: requester.principal_id, subject: requester.subject } } : {}),
      payload: { approval_type: "change", id, decision, by: ctx.principal.subject, status },
    });
    const recipients = [requester, behalf].flatMap((x) =>
      x && x.principal_id !== ctx.principal.id ? [{ id: x.principal_id, subject: x.subject }] : [],
    );
    if (recipients.length > 0)
      yield* createNotifications(ctx, {
        recipients,
        type: "approval_decision",
        title: decision === "approve" ? "Approved" : decision === "reject" ? "Rejected" : "Withdrawn",
        body: clip(summary, 500),
        link: "/approvals",
        actorId: ctx.principal.id,
        subject: { kind: "approval", id },
        sourceEventSeq: seq,
        dedupeKey: `${seq}:approval_decision`,
      });
  });

const base = (ctx: ActionCtx) => ({ surface: ctx.surface, sessionId: ctx.sessionId, now: ctx.now });

const decide: ActionHandler<S.Schema.Type<typeof SuiteWork.DecideIn>, Item> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const it = yield* loadOne(ctx, input.type, input.id);
      return {
        effect: `${input.decision === "approve" ? "Approve" : "Reject"}: ${it.summary}`,
        facts: { type: input.type, status: it.status, can_decide: it.can_decide },
      };
    }),
  run: (input, ctx) =>
    mapDecisionError(
      Effect.gen(function* () {
        const item = yield* loadOne(ctx, input.type, input.id);
        if (item.status !== PENDING)
          return yield* Effect.fail(
            dom("CONFLICT", "/id", `this item is already ${item.status}`, {
              details: { reason: "INVALID_TRANSITION", from: item.status, allowed: [] },
            }),
          );
        if (item.blocked_reason === "sod_requester" || item.blocked_reason === "sod_on_behalf_of")
          return yield* Effect.fail(
            refusal("RULE_REFUSED", "SELF_ACTION", "you cannot decide your own request", {
              policy: item.blocked_reason,
            }),
          );
        const key = `appr:${input.type}:${input.id}:${input.decision}`.slice(0, 128);
        switch (input.type) {
          case "change": {
            const log = yield* ChangeLog;
            const res = yield* log.decideApproval(ctx.principal, input.id, input.decision, input.reason);
            const row = yield* q<{ requester_id: string; on_behalf_of: string | null }>(
              `SELECT requester_id, on_behalf_of FROM change_approvals WHERE approval_id = $1`,
              [input.id],
            );
            if (row[0])
              yield* announceChange(
                ctx,
                input.id,
                input.decision,
                res.status === "committed" ? "approved" : res.status,
                row[0].requester_id,
                row[0].on_behalf_of,
                item.summary,
              );
            break;
          }
          case "action": {
            if (input.decision === "approve") yield* ctx.executeHeld(input.id, ctx.principal);
            else yield* closeHeldAction(ctx.principal, input.id, "reject", input.reason, base(ctx));
            break;
          }
          case "order":
            yield* callAction(
              ctx.principal,
              "orders.transition",
              {
                order_id: input.id,
                transition: input.decision === "approve" ? "approve" : "cancel",
                ...(input.reason ? { note: input.reason } : {}),
                idempotency_key: key,
              },
              { surface: ctx.surface, at: ctx.now },
            );
            break;
          case "content_review": {
            if (input.decision === "reject" && !input.reason)
              return yield* Effect.fail(
                dom("VALIDATION_FAILED", "/reason", "a reason is required to request changes"),
              );
            const rev = yield* q<{ revision: string }>(
              `SELECT revision::text AS revision FROM nodes WHERE workspace_id = $1 AND kind = 'Content' AND slug = $2`,
              [ctx.principal.workspaceId, input.id],
            );
            yield* callAction(
              ctx.principal,
              "content.transition",
              {
                slug: input.id,
                action: input.decision === "approve" ? "approve" : "request_changes",
                ...(input.reason ? { note: input.reason } : {}),
                base_revision: Number(rev[0]?.revision ?? 1),
              },
              { surface: ctx.surface, at: ctx.now },
            );
            break;
          }
        }
        return yield* loadOne(ctx, input.type, input.id);
      }),
    ),
};

const withdraw: ActionHandler<S.Schema.Type<typeof SuiteWork.WithdrawIn>, Item> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const it = yield* loadOne(ctx, input.type, input.id);
      return { effect: `Withdraw: ${it.summary}`, facts: { type: input.type, status: it.status } };
    }),
  run: (input, ctx) =>
    mapDecisionError(
      Effect.gen(function* () {
        const item = yield* loadOne(ctx, input.type, input.id);
        if (input.type === "order" || input.type === "content_review")
          return yield* Effect.fail(
            dom("CONFLICT", "/type", `${input.type} items cannot be withdrawn here`, {
              details: { reason: "INVALID_TRANSITION", from: item.status, allowed: [] },
            }),
          );
        if (item.status !== PENDING)
          return yield* Effect.fail(
            dom("CONFLICT", "/id", `this item is already ${item.status}`, {
              details: { reason: "INVALID_TRANSITION", from: item.status, allowed: [] },
            }),
          );
        if (input.type === "action") {
          yield* closeHeldAction(ctx.principal, input.id, "withdraw", input.reason, base(ctx));
        } else {
          const rows = yield* q<{ requester_id: string; on_behalf_of: string | null }>(
            `SELECT requester_id, on_behalf_of FROM change_approvals WHERE workspace_id = $1 AND approval_id = $2 FOR UPDATE`,
            [ctx.principal.workspaceId, input.id],
          );
          const r = rows[0];
          if (!r || r.requester_id !== ctx.principal.id)
            return yield* Effect.fail(
              dom("FORBIDDEN", "/id", "only the requester may withdraw", {
                details: { reason: "not_requester" },
              }),
            );
          yield* q(
            `UPDATE change_approvals SET status = 'withdrawn', decided_at = $2::timestamptz, decision_reason = $3
             WHERE approval_id = $1 AND status = 'pending_approval'`,
            [input.id, ctx.now.toISOString(), input.reason ?? null],
          );
          yield* announceChange(
            ctx,
            input.id,
            "withdraw",
            "withdrawn",
            r.requester_id,
            r.on_behalf_of,
            item.summary,
          );
        }
        return yield* loadOne(ctx, input.type, input.id);
      }),
    ),
};

export const approvalsHandlers = {
  "approvals.list": list,
  "approvals.decide": decide,
  "approvals.withdraw": withdraw,
} satisfies HandlerTable;
