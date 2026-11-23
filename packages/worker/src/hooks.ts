import type { Effect } from "effect";
import type { HandlerError, StoredDomainEvent, SuiteEnv } from "@plinth/engine";

/**
 * The worker's dispatch points (CONTRACT.md K13). The worker owns the loops, the cursors, the transactions and the
 * virtual-time buckets; the engines own what happens inside a hook. Wave-2 builders fill the files under
 * `./engines/` and touch nothing else in this package.
 *
 * Every hook runs inside ONE SQL transaction that also advances the consumer's cursor or the scheduler tick, so a hook
 * either completed together with its bookkeeping or left no trace. Delivery is at-least-once: hooks must be idempotent
 * (automation run keys `event:<seq>`, `cron:<minute>`; one live badge award per member and badge).
 */

export interface WorkerCtx {
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  /** Virtual time of this batch or tick. */
  readonly now: Date;
}

export type HookError = HandlerError;

/** Receives the next events (oldest first) for one consumer. */
export type EventHook = (
  events: ReadonlyArray<StoredDomainEvent>,
  ctx: WorkerCtx,
) => Effect.Effect<void, HookError, SuiteEnv>;

export interface Tick {
  /** The start of the virtual minute, hour or day this tick covers. */
  readonly bucket: Date;
  /** The previous bucket that ran, or null the first time. A hook that must not miss a window reads `previous`. */
  readonly previous: Date | null;
}

export type TickHook = (tick: Tick, ctx: WorkerCtx) => Effect.Effect<void, HookError, SuiteEnv>;

export interface NamedTickHook {
  readonly name: string;
  readonly run: TickHook;
}

export interface WorkerHooks {
  /** Consumer `automation` of `engine_cursors`: trigger matching on every domain event. */
  readonly automationEvents: EventHook;
  /** Consumer `badges`: badge criteria evaluation on every domain event. */
  readonly badgeEvents: EventHook;
  /** Every virtual minute: promotion schedule transitions, content publish/unpublish, cron and metric automations, approval expiry, email-stub sending. */
  readonly minute: ReadonlyArray<NamedTickHook>;
  /** Every virtual hour: digest building. */
  readonly hourly: ReadonlyArray<NamedTickHook>;
  /** Every virtual day: point expiry and expiry warnings. */
  readonly daily: ReadonlyArray<NamedTickHook>;
}
