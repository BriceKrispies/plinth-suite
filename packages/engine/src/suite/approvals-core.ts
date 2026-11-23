import { newId } from "./ids";
import { Effect } from "effect";
import { canonicalize, sha256 } from "@plinth/core";
import { DomainError, type ApprovalType } from "@plinth/spec";
import { Authorizer, subjectOf } from "../authz";
import { authorize as authorizePure, canonicalResource } from "../authz-core";
import { ControlStore, store } from "../control-store";
import type { StoreError } from "../errors";
import { emitFrom, type EmitCtx, type PrincipalRef } from "./domain-events";
import { createNotifications } from "./notify";

/**
 * Held domain actions (`action_approvals`). The kernel's `change_approvals` holds node changes; a held action keeps its
 * own input and approver permission here. `fileActionApproval` is what a handler (or the dispatcher, for agent
 * `approval` actions) calls; the decision itself is `executeHeld` on the handler context, which re-runs the stored
 * input as the original requester with `ctx.approvedBy` set.
 */

export const APPROVAL_TTL_DAYS = 7;

export const inputHashOf = (action: string, input: unknown): Buffer =>
  sha256(canonicalize({ action, input }));

export interface HumanApprover extends PrincipalRef {
  readonly kind: "human";
}

/**
 * The humans who may decide an item: `approval:decide` and the approver permission on the suite module resource,
 * excluding the requester and the person an agent acts for. Computed from one authorizer snapshot.
 */
export const approversFor = (
  ws: string,
  wsSlug: string,
  approverPermission: string,
  exclude: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<PrincipalRef>, StoreError, ControlStore | Authorizer> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const authz = yield* Authorizer;
    const humans = yield* store(
      sql<{ principal_id: string; subject: string }>`
        SELECT principal_id, subject FROM principals
        WHERE workspace_id = ${ws} AND kind = 'human' AND disabled_at IS NULL ORDER BY subject`,
    );
    const snap = yield* authz.snapshot({ workspaceId: ws, workspaceSlug: wsSlug });
    const resource = canonicalResource(snap, `plinth://${wsSlug}/suite/approvals`);
    const grantRes = canonicalResource(snap, `plinth://${wsSlug}/Grant/`);
    const out: PrincipalRef[] = [];
    for (const h of humans) {
      if (exclude.includes(h.principal_id)) continue;
      const subj = subjectOf({
        id: h.principal_id,
        subject: h.subject,
        kind: "human",
        displayName: "",
        workspaceId: ws,
        workspaceSlug: wsSlug,
        delegatorId: null,
        delegatorSubject: null,
      });
      const on = (perm: string, res: string) =>
        authorizePure({ principal: subj, action: perm, resource: res }, snap).kind === "allow";
      const decide = on("approval:decide", resource);
      const perm = on(approverPermission, approverPermission === "grant:write" ? grantRes : resource);
      if (decide && perm) out.push({ id: h.principal_id, subject: h.subject });
    }
    return out;
  });

export interface FiledApproval {
  readonly approvalId: string;
  readonly approverPermission: string;
  readonly approvers: ReadonlyArray<PrincipalRef>;
}

/**
 * File an action in `action_approvals` as `pending_approval`, emit `approval.requested` to its approvers and notify
 * them (`approval_request`). Must run inside the action's transaction.
 */
export const fileActionApproval = (
  ctx: EmitCtx & { readonly principal: { readonly workspaceSlug: string; readonly displayName?: string } },
  a: {
    readonly action: string;
    readonly input: unknown;
    readonly approverPermission: string;
    /** A Plinth-authored sentence that names people by handle and never embeds free text. */
    readonly summary: string;
    readonly idempotencyKey: string;
  },
): Effect.Effect<FiledApproval, DomainError | StoreError, ControlStore | Authorizer> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ctx.principal.workspaceId;
    const approvalId = newId();
    const expires = new Date(ctx.now.getTime() + APPROVAL_TTL_DAYS * 86_400_000);
    yield* store(
      sql`INSERT INTO action_approvals (approval_id, workspace_id, action, input, input_hash, requester_id, on_behalf_of,
                                        approver_permission, summary, status, idempotency_key, created_at, expires_at)
          VALUES (${approvalId}, ${ws}, ${a.action}, ${JSON.stringify(a.input)}::jsonb, ${inputHashOf(a.action, a.input)},
                  ${ctx.principal.id}, ${ctx.onBehalfOf?.id ?? null}, ${a.approverPermission}, ${a.summary.slice(0, 500)},
                  'pending_approval', ${a.idempotencyKey}, ${ctx.now.toISOString()}::timestamptz,
                  ${expires.toISOString()}::timestamptz)`,
    );
    const exclude = [ctx.principal.id, ...(ctx.onBehalfOf ? [ctx.onBehalfOf.id] : [])];
    const approvers = yield* approversFor(ws, ctx.principal.workspaceSlug, a.approverPermission, exclude);
    const type: ApprovalType = "action";
    const seq = yield* emitFrom(ctx, "approval.requested", {
      audience: approvers.length > 0 ? approvers.map((x) => x.subject) : ["role:admin"],
      subject: { kind: "approval", id: approvalId },
      member: ctx.principal,
      payload: {
        approval_type: type,
        id: approvalId,
        title: a.summary.slice(0, 140),
        requested_by: ctx.principal.subject,
      },
    });
    yield* createNotifications(ctx, {
      recipients: approvers,
      type: "approval_request",
      title: "Approval needed",
      body: a.summary.slice(0, 500),
      link: "/approvals",
      actorId: ctx.principal.id,
      subject: { kind: "approval", id: approvalId },
      sourceEventSeq: seq,
      dedupeKey: `${seq}:approval_request`,
    });
    return { approvalId, approverPermission: a.approverPermission, approvers };
  });

export interface HeldRow {
  readonly approval_id: string;
  readonly action: string;
  readonly input: unknown;
  readonly requester_id: string;
  readonly on_behalf_of: string | null;
  readonly approver_permission: string;
  readonly summary: string;
  readonly status: string;
  readonly expired: boolean;
}

/** Load a held action row `FOR UPDATE`. */
export const loadHeld = (
  ws: string,
  approvalId: string,
  now: Date,
): Effect.Effect<HeldRow, DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(approvalId))
      return yield* Effect.fail(
        new DomainError({ code: "UNKNOWN_REFERENCE", path: "/approval_id", message: "no such approval" }),
      );
    const rows = yield* store(
      sql<HeldRow>`
        SELECT approval_id, action, input, requester_id, on_behalf_of, approver_permission, summary, status,
               (expires_at < ${now.toISOString()}::timestamptz) AS expired
        FROM action_approvals WHERE workspace_id = ${ws} AND approval_id = ${approvalId} FOR UPDATE`,
    );
    const r = rows[0];
    if (!r)
      return yield* Effect.fail(
        new DomainError({ code: "UNKNOWN_REFERENCE", path: "/approval_id", message: "no such approval" }),
      );
    return r;
  });

/**
 * Announce a decision: `approval.decided` to the requester, the person an agent acted for and the approvers, and an
 * `approval_decision` notification to the requester (and the human on whose behalf an agent asked).
 */
export const announceDecision = (
  ctx: EmitCtx,
  held: HeldRow,
  decision: "approve" | "reject" | "withdraw",
  status: string,
  by: PrincipalRef,
): Effect.Effect<void, StoreError, ControlStore | Authorizer> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ctx.principal.workspaceId;
    const who = yield* store(
      sql<{ principal_id: string; subject: string }>`
        SELECT principal_id, subject FROM principals
        WHERE workspace_id = ${ws} AND principal_id IN (${held.requester_id}, ${held.on_behalf_of ?? held.requester_id})`,
    );
    const requester = who.find((x) => x.principal_id === held.requester_id);
    const behalf = held.on_behalf_of ? who.find((x) => x.principal_id === held.on_behalf_of) : undefined;
    const audience = [
      ...new Set([requester?.subject, behalf?.subject, by.subject].flatMap((x) => (x ? [x] : []))),
    ];
    const seq = yield* emitFrom(ctx, "approval.decided", {
      audience: audience.length > 0 ? audience : [by.subject],
      subject: { kind: "approval", id: held.approval_id },
      member: requester ? { id: requester.principal_id, subject: requester.subject } : undefined,
      payload: { approval_type: "action", id: held.approval_id, decision, by: by.subject, status },
    });
    const recipients = [requester, behalf].flatMap((x) =>
      x ? [{ id: x.principal_id, subject: x.subject }] : [],
    );
    yield* createNotifications(ctx, {
      recipients: recipients.filter((r) => r.id !== by.id),
      type: "approval_decision",
      title: decision === "approve" ? "Approved" : decision === "reject" ? "Rejected" : "Withdrawn",
      body: held.summary.slice(0, 500),
      link: "/approvals",
      actorId: by.id,
      subject: { kind: "approval", id: held.approval_id },
      sourceEventSeq: seq,
      dedupeKey: `${seq}:approval_decision`,
    });
  });

/** Close a held action without running it: `rejected` (by an approver) or `withdrawn` (by the requester). */
export const closeHeld = (
  ctx: EmitCtx,
  held: HeldRow,
  status: "rejected" | "withdrawn",
  by: PrincipalRef,
  reason: string | undefined,
): Effect.Effect<void, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    yield* store(
      sql`UPDATE action_approvals SET status = ${status}, decided_by = ${status === "rejected" ? by.id : null},
                 decided_at = ${ctx.now.toISOString()}::timestamptz, decision_reason = ${reason ?? null}
          WHERE approval_id = ${held.approval_id}`,
    );
  });
