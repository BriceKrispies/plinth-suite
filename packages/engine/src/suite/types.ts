import type { Effect } from "effect";
import type { ActionDef, DomainError, Surface } from "@plinth/spec";
import type { AppConfig } from "../config";
import type { PlinthClock } from "../clock";
import type { ControlStore } from "../control-store";
import type { StoreError } from "../errors";
import type { ChangeLog } from "../change-log";
import type { Authorizer } from "../authz";
import type { Identity, Principal } from "../identity";
import type { Allow } from "../authz-core";

/** The services a handler may use. The dispatcher runs every handler inside one SQL transaction. */
export type SuiteEnv = ControlStore | ChangeLog | Authorizer | PlinthClock | AppConfig | Identity;

/** Handler failures: domain refusals (closed code set plus `details.reason`) and infrastructure errors. */
export type HandlerError = DomainError | StoreError;

/**
 * What the dispatcher hands every handler. Identity, the permission decision (with its row predicate), the virtual
 * time of the command, and the approval context when the handler runs on behalf of an approver.
 */
export interface ActionCtx {
  readonly action: ActionDef;
  /** The calling principal (the actor). For an approved held action: the original requester. */
  readonly principal: Principal;
  /** The human an agent acts for (`principals.delegator_id`), when the principal is an agent. */
  readonly onBehalfOf: Principal | undefined;
  readonly surface: Surface;
  readonly sessionId: string | undefined;
  /** Virtual time of this command (PlinthClock.virtualNow, or the seed's overridden command time). */
  readonly now: Date;
  /** The permission decision on `plinth://<ws>/suite/<module>`; undefined for `authenticated` actions. */
  readonly allow: Allow | undefined;
  /** Set while a held action is executing after approval. */
  readonly approvedBy: Principal | undefined;
  readonly approvalId: string | undefined;
  /** The idempotency key of this call (from the input or the invoke envelope), when there is one. */
  readonly idempotencyKey: string | undefined;
  /** Execute an approved held action (used by `approvals.decide`): runs the stored input as the requester. */
  readonly executeHeld: (
    approvalId: string,
    approver: Principal,
  ) => Effect.Effect<HeldOutcome, HandlerError, SuiteEnv>;
}

/** The outcome of deciding a held action: it ran (`approved`, with its encoded result) or its handler refused (`failed`). */
export interface HeldOutcome {
  readonly status: "approved" | "failed";
  readonly result?: unknown;
  readonly error?: unknown;
}

/** The dry-run answer of an action. `effect` is Plinth-authored from typed facts and never embeds data strings. */
export interface PreviewOutcome {
  readonly effect: string;
  readonly facts: Readonly<Record<string, unknown>>;
  /** `approval` when the commit would be held; default follows the registry's agent policy. */
  readonly decision?: "auto" | "approval";
  /** For held commits: the permission the approver needs besides approval:decide. */
  readonly approverPermission?: string;
}

/** The result a handler may return to say "file this in action_approvals instead of running". */
export interface HeldRequest {
  readonly held: true;
  readonly approverPermission: string;
  readonly summary: string;
}

export const isHeldRequest = (x: unknown): x is HeldRequest =>
  typeof x === "object" && x !== null && (x as { held?: unknown }).held === true;

/**
 * One action's implementation. `run` receives the decoded input (the registry's `input` schema type) and returns the
 * value the registry's `output` schema encodes. A handler that decides to hold the whole action for approval (for
 * example an award above `manager_max_per_award`) returns `fileForApproval(...)`; the dispatcher then writes the
 * `action_approvals` row and returns the pending result.
 */
export interface ActionHandler<I = never, O = unknown> {
  readonly run: (input: I, ctx: ActionCtx) => Effect.Effect<O | HeldRequest, HandlerError, SuiteEnv>;
  /** Dry run for `preview` and `approval` actions. Absent: a generic description from the registry entry. */
  readonly preview?: (input: I, ctx: ActionCtx) => Effect.Effect<PreviewOutcome, HandlerError, SuiteEnv>;
}

export const fileForApproval = (approverPermission: string, summary: string): HeldRequest => ({
  held: true,
  approverPermission,
  summary,
});
