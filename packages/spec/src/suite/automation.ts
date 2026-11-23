import { Schema as S } from "effect";
import { STEP_TYPES } from "./nodes";
import { RunStatus, StepStatus, TriggerableEventType } from "./events";
import { PersonRef, Timestamp } from "./primitives";

/** Automation runtime shapes (CONTRACT.md section 9). */

/** What fired a run. `key` is the run's idempotency key within its automation (UNIQUE in automation_runs). */
export const RunTrigger = S.Union(
  S.Struct({ type: S.Literal("event"), key: S.String, event_seq: S.Int, event_type: TriggerableEventType }),
  S.Struct({ type: S.Literal("schedule"), key: S.String, minute: Timestamp }),
  S.Struct({ type: S.Literal("metric"), key: S.String, value: S.Number, window_start: Timestamp }),
  S.Struct({ type: S.Literal("manual"), key: S.String, by: S.String }),
  S.Struct({ type: S.Literal("retry"), key: S.String, of_run: S.UUID }),
).annotations({ identifier: "RunTrigger" });
export type RunTrigger = typeof RunTrigger.Type;

export const StepError = S.Struct({
  code: S.String,
  message: S.String.pipe(S.maxLength(280)),
  retryable: S.Boolean,
}).annotations({ identifier: "StepError" });

export const RunStep = S.Struct({
  index: S.Int,
  id: S.String,
  type: S.Literal(...STEP_TYPES),
  status: StepStatus,
  attempts: S.Int,
  started_at: S.NullOr(Timestamp),
  finished_at: S.NullOr(Timestamp),
  /** The step input after template substitution. */
  input: S.Unknown,
  /** What the step produced: ids of the txn, notification, message thread, task, entitlement or webhook delivery. */
  output: S.NullOr(S.Record({ key: S.String, value: S.Unknown })),
  error: S.NullOr(StepError),
}).annotations({ identifier: "RunStep" });

export const RunSummary = S.Struct({
  run_id: S.UUID,
  automation: S.String,
  automation_title: S.String,
  automation_revision: S.Int,
  status: RunStatus,
  trigger: RunTrigger,
  member: S.NullOr(PersonRef),
  started_at: S.NullOr(Timestamp),
  finished_at: S.NullOr(Timestamp),
  steps_total: S.Int,
  steps_succeeded: S.Int,
  error: S.NullOr(StepError),
}).annotations({ identifier: "RunSummary" });
export type RunSummary = typeof RunSummary.Type;

export const RunDetail = S.Struct({
  ...RunSummary.fields,
  context: S.Record({ key: S.String, value: S.Unknown }),
  steps: S.Array(RunStep),
  cause_depth: S.Int,
}).annotations({ identifier: "RunDetail" });

/** A dry run never writes: each step reports what it would do, after conditions and templates. */
export const DryRunStep = S.Struct({
  index: S.Int,
  id: S.String,
  type: S.String,
  would_run: S.Boolean,
  skipped_reason: S.NullOr(S.Literal("when_false", "after_stop", "forbidden", "invalid")),
  input: S.Unknown,
  effect: S.String.pipe(S.maxLength(280)),
  error: S.NullOr(StepError),
}).annotations({ identifier: "DryRunStep" });

export const DryRunResult = S.Struct({
  trigger_matched: S.Boolean,
  conditions_passed: S.Boolean,
  limits_ok: S.Boolean,
  context: S.Record({ key: S.String, value: S.Unknown }),
  steps: S.Array(DryRunStep),
  /** For schedule triggers: the next five fire times after `at`. */
  next_fires: S.Array(Timestamp),
}).annotations({ identifier: "DryRunResult" });
export type DryRunResult = typeof DryRunResult.Type;
