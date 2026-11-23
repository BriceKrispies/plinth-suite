import { Effect, Schedule, Stream } from "effect";
import { workspaceId } from "@plinth/core";
import {
  AppConfig,
  ControlStore,
  DOMAIN_CHANNEL,
  PlinthClock,
  domainEventsAfter,
  readCursor,
  store,
  writeCursor,
  type HandlerError,
  type SuiteEnv,
} from "@plinth/engine";
import type { EventHook, NamedTickHook, WorkerCtx, WorkerHooks } from "./hooks";
import { automationOnEvents, automationOnMinute } from "./engines/automation";
import { badgesOnEvents } from "./engines/badges";
import { contentSchedule } from "./engines/content";
import { digestHourly } from "./engines/digests";
import { expiryDaily } from "./engines/expiry";
import { expireHeldActions, sendQueuedEmails } from "./engines/maintenance";
import { promotionSchedule } from "./engines/promotions";

/** The hooks the worker ships with: one file per engine under `./engines/`. */
export const DEFAULT_HOOKS: WorkerHooks = {
  automationEvents: automationOnEvents,
  badgeEvents: badgesOnEvents,
  minute: [
    { name: "promotion-schedule", run: promotionSchedule },
    { name: "content-schedule", run: contentSchedule },
    { name: "automation-schedule", run: automationOnMinute },
    { name: "held-action-expiry", run: expireHeldActions },
    { name: "email-stub", run: sendQueuedEmails },
  ],
  hourly: [{ name: "digests", run: digestHourly }],
  daily: [{ name: "expiry", run: expiryDaily }],
};

// ---- virtual time buckets ------------------------------------------------------------------------------

export type Unit = "minute" | "hour" | "day";
const UNIT_MS: Record<Unit, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000 };

/** The start of the UTC minute, hour or day containing `d`. Pure. */
export const bucketOf = (d: Date, unit: Unit): Date =>
  new Date(Math.floor(d.getTime() / UNIT_MS[unit]) * UNIT_MS[unit]);

/**
 * The bucket to run now, or null when this bucket already ran. Missed buckets collapse into one run (the clock may
 * jump or the worker may have been down); a hook that must not skip a window reads `tick.previous`. Pure.
 */
export const dueBucket = (last: Date | null, now: Date, unit: Unit): Date | null => {
  const b = bucketOf(now, unit);
  return last === null || b.getTime() > last.getTime() ? b : null;
};

// ---- loops ---------------------------------------------------------------------------------------------

type WorkerEnv = SuiteEnv;

const baseCtx = Effect.gen(function* () {
  const cfg = yield* AppConfig;
  const clock = yield* PlinthClock;
  const { sql } = yield* ControlStore;
  const ws = workspaceId(cfg.workspaceSlug);
  const exists = yield* store(sql<{ n: number }>`SELECT 1 AS n FROM workspaces WHERE workspace_id = ${ws}`);
  if (exists.length === 0) return undefined;
  const now = yield* clock.virtualNow;
  return { workspaceId: ws, workspaceSlug: cfg.workspaceSlug, now } satisfies WorkerCtx;
});

/**
 * Feed one consumer (`automation` or `badges`) the next batch of domain events and advance its cursor in the SAME
 * transaction as the hook's writes. Returns the number of events handled (0 when caught up).
 */
export const drainBatch = (
  consumer: "automation" | "badges",
  hook: EventHook,
  ctx: WorkerCtx,
  limit = 200,
): Effect.Effect<number, HandlerError, WorkerEnv> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    return yield* store(
      sql.withTransaction(
        Effect.gen(function* () {
          const after = yield* readCursor(ctx.workspaceId, consumer);
          const events = yield* domainEventsAfter(ctx.workspaceId, after, limit);
          const last = events[events.length - 1];
          if (!last) return 0;
          yield* hook(events, ctx);
          yield* writeCursor(ctx.workspaceId, consumer, last.seq);
          return events.length;
        }),
      ),
    );
  });

/** Drain a consumer until it is caught up (events appended by the hook itself are picked up on the next pass). */
export const drainConsumer = (
  consumer: "automation" | "badges",
  hook: EventHook,
  ctx: WorkerCtx,
): Effect.Effect<number, HandlerError, WorkerEnv> =>
  Effect.gen(function* () {
    let total = 0;
    for (let i = 0; i < 1000; i++) {
      const n = yield* drainBatch(consumer, hook, ctx);
      if (n === 0) break;
      total += n;
    }
    return total;
  });

/** Drain both engines (the seed calls this after every command so history is consistent by construction). */
export const drainEngines = (
  hooks: WorkerHooks,
  ctx: WorkerCtx,
): Effect.Effect<{ automation: number; badges: number }, HandlerError, WorkerEnv> =>
  Effect.gen(function* () {
    // alternate until both are quiet: a badge award is an event the automation engine may match, and vice versa
    let automation = 0;
    let badges = 0;
    for (let i = 0; i < 50; i++) {
      const a = yield* drainConsumer("automation", hooks.automationEvents, ctx);
      const b = yield* drainConsumer("badges", hooks.badgeEvents, ctx);
      automation += a;
      badges += b;
      if (a === 0 && b === 0) break;
    }
    return { automation, badges };
  });

/** Run the hooks of one scheduler job when its virtual bucket is due. Returns whether it ran. */
export const runTickJob = (
  job: "minute" | "digest" | "expiry",
  unit: Unit,
  hooks: ReadonlyArray<NamedTickHook>,
  ctx: WorkerCtx,
): Effect.Effect<boolean, HandlerError, WorkerEnv> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    return yield* store(
      sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`INSERT INTO scheduler_ticks (workspace_id, job, last_tick)
                     VALUES (${ctx.workspaceId}, ${job}, '1970-01-01T00:00:00Z'::timestamptz) ON CONFLICT DO NOTHING`;
          const rows = yield* sql<{ last_tick: Date }>`
            SELECT last_tick FROM scheduler_ticks WHERE workspace_id = ${ctx.workspaceId} AND job = ${job} FOR UPDATE`;
          const last = rows[0] ? new Date(rows[0].last_tick) : null;
          const previous = last !== null && last.getTime() > 0 ? last : null;
          const bucket = dueBucket(previous, ctx.now, unit);
          if (bucket === null) return false;
          for (const h of hooks) yield* h.run({ bucket, previous }, ctx);
          yield* sql`UPDATE scheduler_ticks SET last_tick = ${bucket.toISOString()}::timestamptz
                     WHERE workspace_id = ${ctx.workspaceId} AND job = ${job}`;
          return true;
        }),
      ),
    );
  });

/** One pass of the worker: drain both consumers, then run every scheduler job that is due. */
export const workOnce = (
  hooks: WorkerHooks,
): Effect.Effect<
  { automation: number; badges: number; ticks: ReadonlyArray<string> },
  HandlerError,
  WorkerEnv
> =>
  Effect.gen(function* () {
    const ctx = yield* baseCtx;
    if (ctx === undefined) return { automation: 0, badges: 0, ticks: [] };
    const drained = yield* drainEngines(hooks, ctx);
    const ticks: string[] = [];
    if (yield* runTickJob("minute", "minute", hooks.minute, ctx)) ticks.push("minute");
    if (yield* runTickJob("digest", "hour", hooks.hourly, ctx)) ticks.push("digest");
    if (yield* runTickJob("expiry", "day", hooks.daily, ctx)) ticks.push("expiry");
    // events produced by the tick hooks are consumed in the same pass
    const again = ticks.length > 0 ? yield* drainEngines(hooks, ctx) : { automation: 0, badges: 0 };
    return {
      automation: drained.automation + again.automation,
      badges: drained.badges + again.badges,
      ticks,
    };
  });

/**
 * The worker process: wakes on `NOTIFY plinth_domain` and on a one-second poll (nothing in a notification carries
 * authority), and runs `workOnce` serially. A failing pass is logged and retried on the next wake.
 */
export const workerProgram = (hooks: WorkerHooks = DEFAULT_HOOKS) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    yield* Effect.logInfo("plinth worker started: domain events, scheduler minute tick");
    const pass = workOnce(hooks).pipe(
      Effect.catchAll((e) =>
        Effect.logWarning(`worker pass failed: ${(e as { message?: string }).message ?? String(e)}`),
      ),
    );
    yield* Stream.merge(
      sql.listen(DOMAIN_CHANNEL).pipe(
        Stream.catchAll(() => Stream.empty),
        Stream.map(() => 1),
      ),
      Stream.fromSchedule(Schedule.spaced("1 second")).pipe(Stream.map(() => 1)),
    ).pipe(Stream.runForEach(() => pass));
    return yield* Effect.never;
  });
