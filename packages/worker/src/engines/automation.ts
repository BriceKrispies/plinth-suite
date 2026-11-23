import { Effect } from "effect";
import {
  automationEmitCtx,
  automationEvaluateMetrics,
  automationFireSchedules,
  automationMatchEvents,
  automationPrincipal,
  automationResumeDueRuns,
} from "@plinth/engine";
import type { EventHook, TickHook } from "../hooks";

/**
 * Automation engine (CONTRACT.md section 9). Each domain event is matched against the enabled event-triggered
 * Automation nodes (trigger type, filter, loop guard), a run is created with key `event:<seq>` (exactly once per trigger
 * key), and its steps execute as `service:automation` inside the owner's grants with step keys
 * `run:<run_id>:step:<step_id>`. Hooks are idempotent: a replayed event finds its run already there.
 */
export const automationOnEvents: EventHook = (events, ctx) =>
  Effect.gen(function* () {
    const svc = yield* automationPrincipal();
    const ectx = automationEmitCtx(svc, ctx.now);
    yield* automationMatchEvents(ectx, events);
    // runs whose retry delay has passed continue as events flow
    yield* automationResumeDueRuns(ectx, ctx.now);
  });

/**
 * Minute tick: `schedule` triggers (cron over the virtual minute, up to 60 missed minutes caught up from the previous
 * tick), `metric` triggers (query as the owner, hold time, rising edge), and retries that are due.
 */
export const automationOnMinute: TickHook = (tick, ctx) =>
  Effect.gen(function* () {
    const svc = yield* automationPrincipal();
    const ectx = automationEmitCtx(svc, ctx.now);
    yield* automationFireSchedules(ectx, tick);
    yield* automationEvaluateMetrics(ectx, tick.bucket);
    yield* automationResumeDueRuns(ectx, ctx.now);
  });
