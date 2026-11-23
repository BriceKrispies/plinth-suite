import { Effect } from "effect";
import { nodeId } from "@plinth/core";
import {
  ControlStore,
  automationEmitCtx,
  automationFireSchedules,
  emitFrom,
  inTx,
  store,
  type SuiteEnv,
} from "@plinth/engine";
import type { SeedCtx, SeedError } from "../seed";

/**
 * The marketing and content part of the 90-day activity (CONTRACT.md 11.8), called by the activity step after the
 * commerce and recognition history has been replayed. It writes only what no other module's commands produce:
 *
 *  - the cron history of `weekly-digest-nudge` (the last three Mondays at 09:00 UTC, run by the scheduler code path);
 *  - a manual run of `sla-team-bonus` by the marketing lead (the metric trigger needs the query engine, which the seed
 *    does not run);
 *  - two failed `low-stock-alert` runs (the platform administrator is disabled while two products run low, so assigning
 *    the restock task is refused), one of which is retried successfully through `automation.retry` once the
 *    administrator is back;
 *  - the budget counters of `peak-season-store-15`, brought to 78 % of its points budget (the seeded orders do not
 *    reach that on their own), with the 50 % budget alert the crossing would have produced.
 *
 * Event-triggered automation history, promotion redemptions and content engagement come from the commands of the other
 * steps through the engine drain; this function must run after them.
 */

const DAY = 86_400_000;

export const activityMarketing = (ctx: SeedCtx): Effect.Effect<void, SeedError, SuiteEnv> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ctx.workspaceId;
    const svc = yield* ctx.principal("service:automation");
    const tomas = yield* ctx.principal("user:marketing-lead");

    // 1. cron history: the three most recent Mondays at 09:00 UTC
    const monday = (weeksBack: number): Date => {
      const d = new Date(ctx.demoNow.getTime());
      d.setUTCHours(9, 0, 0, 0);
      const back = (d.getUTCDay() + 6) % 7; // days since Monday
      return new Date(d.getTime() - back * DAY - weeksBack * 7 * DAY);
    };
    for (const w of [2, 1, 0]) {
      const bucket = monday(w);
      if (bucket.getTime() > ctx.demoNow.getTime()) continue;
      yield* inTx(automationFireSchedules(automationEmitCtx(svc, bucket), { bucket, previous: null }));
    }

    // 2. a manual run of sla-team-bonus by the marketing lead, two days before the demo
    yield* ctx
      .act(
        tomas,
        "automation.trigger",
        { slug: "sla-team-bonus", idempotency_key: "seed-run-sla-team-bonus-1" },
        { at: new Date(ctx.demoNow.getTime() - 2 * DAY) },
      )
      .pipe(Effect.ignore);

    // 3. two failed low-stock-alert runs, one retried
    const samir = "user:it-admin";
    const lowStock = (slug: string, daysBefore: number) =>
      Effect.gen(function* () {
        const when = new Date(ctx.demoNow.getTime() - daysBefore * DAY);
        yield* inTx(
          emitFrom(ctx.emitCtx(when), "stock.changed", {
            audience: ["role:admin"],
            subject: { kind: "product", id: slug },
            payload: { product: slug, on_hand: 2, stock_status: "low" },
          }),
        );
        yield* ctx.drain(when);
      });
    yield* store(
      sql`UPDATE principals SET disabled_at = now() WHERE workspace_id = ${ws} AND subject = ${samir}`,
    );
    yield* lowStock("soft-shell-vest", 9).pipe(
      Effect.zipRight(lowStock("weekend-cabin", 7)),
      Effect.ensuring(
        store(
          sql`UPDATE principals SET disabled_at = NULL WHERE workspace_id = ${ws} AND subject = ${samir}`,
        ).pipe(Effect.orDie),
      ),
    );
    const failed = yield* store(
      sql<{ run_id: string }>`
        SELECT run_id FROM automation_runs WHERE workspace_id = ${ws} AND automation_slug = 'low-stock-alert'
          AND status = 'failed' AND trigger_key LIKE 'event:%' ORDER BY created_at, run_id LIMIT 2`,
    );
    const first = failed[0];
    if (first)
      yield* ctx
        .act(
          tomas,
          "automation.retry",
          { run_id: first.run_id, idempotency_key: `seed-retry-${first.run_id.slice(0, 8)}` },
          { at: new Date(ctx.demoNow.getTime() - 6 * DAY) },
        )
        .pipe(Effect.ignore);

    // 4. peak-season-store-15 at 78 % of its 120 000 point budget
    const id = nodeId(ws, "Promotion", "peak-season-store-15");
    const target = Math.round(120_000 * 0.78);
    const cur = (yield* store(
      sql<{ cost_points: string; redemptions: number }>`
        SELECT cost_points::text AS cost_points, redemptions FROM promotion_usage WHERE promotion_id = ${id}`,
    ))[0];
    const used = Number(cur?.cost_points ?? 0);
    if (used < target) {
      const extra = Math.max(1, Math.round((target - used) / 450));
      yield* store(
        sql`INSERT INTO promotion_usage (promotion_id, workspace_id, cost_points, redemptions, alerts_sent)
            VALUES (${id}, ${ws}, ${target}, ${(cur?.redemptions ?? 0) + extra}, ARRAY[50]::int[])
            ON CONFLICT (promotion_id) DO UPDATE SET cost_points = ${target},
              redemptions = promotion_usage.redemptions + ${extra}, alerts_sent = ARRAY[50]::int[]`,
      );
      yield* inTx(
        emitFrom(ctx.emitCtx(new Date(ctx.demoNow.getTime() - 5 * DAY)), "promotion.budget_alert", {
          audience: ["role:marketing-manager", "role:finance", "role:admin", "role:manager"],
          subject: { kind: "promotion", id: "peak-season-store-15" },
          payload: {
            promotion: "peak-season-store-15",
            used_pct: 50,
            cost_points: 60_000,
            max_cost_points: 120_000,
          },
        }),
      );
    }
    yield* ctx.drain();
  });
