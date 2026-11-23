import { Effect } from "effect";
import type { DomainError, NodeChange } from "@plinth/spec";
import { Authorizer } from "../../authz";
import { ChangeLog } from "../../change-log";
import { ControlStore, store } from "../../control-store";
import type { StoreError } from "../../errors";
import { approversFor } from "../approvals-core";
import { emitFrom } from "../domain-events";
import { createNotifications } from "../notify";
import type { ActionCtx } from "../types";

/** What a commit needs of its caller: an `ActionCtx`, or the scheduler's own context. */
export type CommitCtx = Pick<ActionCtx, "principal" | "surface"> & {
  readonly sessionId?: string | undefined;
};

/**
 * Commit a node change as the action's caller through the change log (the held discipline of K5: an approval-class rule
 * files the change in `change_approvals` and the approver applies it later). Returns the `HeldResult` fields.
 */
export interface CommittedChange {
  readonly status: "committed" | "pending_approval";
  readonly approval_id?: string;
  readonly change_seq?: number;
  readonly revision?: number;
  readonly rule_id: string[];
  readonly approver_permission?: string;
}

export const commitNodeChange = (
  ctx: CommitCtx,
  change: NodeChange,
  opts: { readonly reason?: string | undefined; readonly managedBy: string },
): Effect.Effect<CommittedChange, DomainError | StoreError, ControlStore | ChangeLog> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const log = yield* ChangeLog;
    const ws = ctx.principal.workspaceId;
    const res = yield* log.commit({
      actor: { principal: ctx.principal, surface: ctx.surface, sessionId: ctx.sessionId },
      changes: [change],
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
      managed: { by: opts.managedBy },
    });
    const revision = res.nodes?.[0]?.result_revision;
    let rule_id: string[] = [];
    let approver: string | undefined;
    if (res.approval_id) {
      const r = yield* store(
        sql<{ rule_id: string[]; approver_permission: string }>`
          SELECT rule_id, approver_permission FROM change_approvals WHERE workspace_id = ${ws} AND approval_id = ${res.approval_id}`,
      );
      rule_id = r[0]?.rule_id ?? [];
      approver = r[0]?.approver_permission;
    } else if (res.change_seq !== undefined) {
      const r = yield* store(
        sql<{
          rule_id: string[];
        }>`SELECT rule_id FROM changes WHERE workspace_id = ${ws} AND seq = ${res.change_seq}`,
      );
      rule_id = r[0]?.rule_id ?? [];
    }
    return {
      status: res.status,
      ...(res.approval_id !== undefined ? { approval_id: res.approval_id } : {}),
      ...(res.change_seq !== undefined ? { change_seq: res.change_seq } : {}),
      ...(revision !== undefined ? { revision } : {}),
      rule_id,
      ...(approver !== undefined ? { approver_permission: approver } : {}),
    };
  });

/** `approval.requested` and `approval_request` notifications for a held node change. */
export const announceHeldChange = (
  ctx: ActionCtx,
  a: { readonly approvalId: string; readonly title: string; readonly approverPermission: string },
): Effect.Effect<void, StoreError, ControlStore | Authorizer> =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const exclude = [ctx.principal.id, ...(ctx.onBehalfOf ? [ctx.onBehalfOf.id] : [])];
    const approvers = yield* approversFor(ws, ctx.principal.workspaceSlug, a.approverPermission, exclude);
    const seq = yield* emitFrom(ctx, "approval.requested", {
      audience: approvers.length > 0 ? approvers.map((x) => x.subject) : ["role:admin"],
      subject: { kind: "approval", id: a.approvalId },
      member: ctx.principal,
      payload: {
        approval_type: "change",
        id: a.approvalId,
        title: a.title.slice(0, 140),
        requested_by: ctx.principal.subject,
      },
    });
    yield* createNotifications(ctx, {
      recipients: approvers,
      type: "approval_request",
      title: "Approval needed",
      body: a.title.slice(0, 500),
      link: "/approvals",
      actorId: ctx.principal.id,
      subject: { kind: "approval", id: a.approvalId },
      sourceEventSeq: seq,
      dedupeKey: `${seq}:approval_request`,
    });
  });
