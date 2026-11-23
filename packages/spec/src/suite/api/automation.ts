import { Schema as S } from "effect";
import { RunStatus, TriggerableEventType } from "../events";
import { AutomationSpec } from "../nodes";
import { RunSummary } from "../automation";
import { AutomationRef, Handle, IdempotencyKey, NodeLink, PageQuery, Timestamp } from "../primitives";

/** Automation (CONTRACT.md module M7). Definitions are Automation nodes edited through POST /changes. */

export const AutomationSummary = S.Struct({
  node: NodeLink,
  enabled: S.Boolean,
  description: S.String,
  trigger_summary: S.String,
  trigger_type: S.Literal("event", "schedule", "metric"),
  step_count: S.Int,
  owner: S.String,
  last_run: S.NullOr(RunSummary),
  runs_7d: S.Int,
  failures_7d: S.Int,
  next_fire_at: S.NullOr(Timestamp),
  pending_approval_id: S.NullOr(S.String),
}).annotations({ identifier: "AutomationSummary" });
export const AutomationsListOut = S.Struct({ items: S.Array(AutomationSummary) });

/** A sample trigger event for dry runs and manual runs: the payload fields of the trigger's event type. */
export const SampleEvent = S.Struct({
  type: TriggerableEventType,
  payload: S.Record({ key: S.String, value: S.Unknown }),
  member: S.optional(Handle),
}).annotations({ identifier: "SampleEvent" });

export const DryRunIn = S.Struct({
  automation: S.Union(AutomationRef, S.Struct({ slug: S.String, title: S.String, spec: AutomationSpec })),
  event: S.optional(SampleEvent),
  /** Use a recorded event instead of a sample: its payload and member become the context. */
  event_seq: S.optional(S.Int),
  at: S.optional(Timestamp),
}).annotations({ identifier: "DryRunIn" });

export const SetEnabledIn = S.Struct({ slug: S.String, enabled: S.Boolean, base_revision: S.Int });

export const TriggerIn = S.Struct({
  slug: S.String,
  event: S.optional(SampleEvent),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "TriggerIn" });

export const RunsListIn = S.Struct({
  automation: S.optional(S.String),
  status: S.optional(S.Array(RunStatus)),
  member: S.optional(Handle),
  ...PageQuery,
});
export const RunsListOut = S.Struct({ items: S.Array(RunSummary), next_cursor: S.NullOr(S.String) });

export const RunIn = S.Struct({ run_id: S.UUID });
export const RetryIn = S.Struct({ run_id: S.UUID, idempotency_key: IdempotencyKey });
