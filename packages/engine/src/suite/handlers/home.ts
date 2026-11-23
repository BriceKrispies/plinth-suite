import { Effect } from "effect";
import { SuiteDiscovery, TIERS, type Tier } from "@plinth/spec";
import { ControlStore, store } from "../../control-store";
import { callAction } from "../dispatcher";
import { navCounts } from "../notify";
import { personRefOf } from "../people";
import { loadProgram, tierOf } from "../program";
import { DAY_MS } from "../marketing/common";
import type { ActionCtx, ActionHandler } from "../types";
import type { HandlerTable } from "./stub";
import { promotionsHandlers } from "./promotions";

type Out = (typeof SuiteDiscovery.HomeOut)["Type"];

const EARNING = ["award", "promotion_bonus", "badge_reward", "adjustment"] as const;

/** Run another module's read as the viewer. A module that is not available, or refuses, contributes its fallback. */
const sub = <A>(ctx: ActionCtx, name: string, input: Record<string, unknown>, fallback: A) =>
  callAction(ctx.principal, name, input, { surface: ctx.surface, at: ctx.now }).pipe(
    Effect.map((x) => x as A),
    Effect.catchAll(() => Effect.succeed(fallback)),
  );

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

/** Everything the home screen's widgets need in one read (CONTRACT.md 12.10). */
const summary: ActionHandler<unknown, Out> = {
  run: (_input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const now = ctx.now;
      const memberRow =
        ctx.principal.kind === "human"
          ? (yield* store(
              sql<{ member_id: string; balance: string; lifetime: string }>`
              SELECT m.member_id, coalesce(a.balance, 0)::text AS balance, coalesce(a.lifetime_earned, 0)::text AS lifetime
              FROM members m LEFT JOIN ledger_accounts a ON a.member_id = m.member_id
              WHERE m.workspace_id = ${ws} AND m.member_id = ${ctx.principal.id}`,
            ))[0]
          : undefined;

      let me: Out["me"] = null;
      if (memberRow) {
        const program = yield* loadProgram(ws);
        const lifetime = Number(memberRow.lifetime);
        const tier = tierOf(program, lifetime);
        const idx = TIERS.indexOf(tier);
        const next: Tier | null = idx < TIERS.length - 1 ? (TIERS[idx + 1] as Tier) : null;
        const floor = program.tiers.find((t) => t.tier === tier)?.min_lifetime_points ?? 0;
        const nextAt = next
          ? (program.tiers.find((t) => t.tier === next)?.min_lifetime_points ?? null)
          : null;
        const progress =
          nextAt === null ? 1 : Math.max(0, Math.min(1, (lifetime - floor) / Math.max(1, nextAt - floor)));
        const expiring = yield* store(
          sql<{ n: string }>`
            SELECT coalesce(sum(l.remaining), 0)::text AS n FROM point_lots l JOIN ledger_accounts a ON a.account_id = l.account_id
            WHERE a.member_id = ${memberRow.member_id} AND l.remaining > 0
              AND l.expires_at > ${now.toISOString()}::timestamptz
              AND l.expires_at <= ${new Date(now.getTime() + 30 * DAY_MS).toISOString()}::timestamptz`,
        );
        const orders = yield* sub<{
          items: Out["me"] extends infer M ? (M extends { recent_orders: infer R } ? R : never) : never;
        }>(ctx, "orders.list", { scope: "mine", limit: 3 }, { items: [] as never });
        const badges = yield* sub<{ next_up: NonNullable<Out["me"]>["next_badges"] }>(
          ctx,
          "badges.catalog",
          {},
          { next_up: [] },
        );
        const tasks = yield* sub<{ items: NonNullable<Out["me"]>["tasks_due"] }>(
          ctx,
          "tasks.list",
          { scope: "mine", status: ["open", "in_progress", "blocked"], limit: 5 },
          { items: [] },
        );
        me = {
          person: yield* personRefOf(ws, memberRow.member_id),
          balance: Number(memberRow.balance),
          tier: { tier, lifetime_points: lifetime, next_tier: next, next_tier_at: nextAt, progress },
          expiring_30d: Number(expiring[0]?.n ?? 0),
          recent_orders: orders.items.slice(0, 3),
          next_badges: badges.next_up.slice(0, 3),
          tasks_due: tasks.items.slice(0, 5),
        };
      }

      const counts = yield* navCounts(ctx.principal);
      const promoOut = (yield* promotionsHandlers["promotions.active"].run({}, ctx)) as {
        items: Out["promotions"];
      };
      const feed = yield* sub<{ items: Out["feed"] }>(ctx, "content.feed", { limit: 5 }, { items: [] });
      const activity = yield* sub<{ items: Out["activity"] }>(
        ctx,
        "me.activity",
        { limit: 10 },
        { items: [] },
      );

      // org figures: today and the last 14 virtual days
      const dayStart = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
      const days: string[] = [];
      for (let i = 13; i >= 0; i--) days.push(dayKey(new Date(dayStart.getTime() - i * DAY_MS)));
      const from14 = new Date(dayStart.getTime() - 13 * DAY_MS);
      const flows = yield* store(
        sql<{ day: string; issued: string; redeemed: string }>`
          SELECT to_char(t.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                 coalesce(sum(e.amount) FILTER (WHERE e.amount > 0 AND t.txn_type IN ${sql.in([...EARNING])}), 0)::text AS issued,
                 coalesce(-sum(e.amount) FILTER (WHERE e.amount < 0 AND t.txn_type = 'purchase'), 0)::text AS redeemed
          FROM ledger_entries e JOIN ledger_transactions t ON t.txn_id = e.txn_id
          JOIN ledger_accounts a ON a.account_id = e.account_id AND a.kind = 'member'
          WHERE t.workspace_id = ${ws} AND t.occurred_at >= ${from14.toISOString()}::timestamptz
            AND t.occurred_at <= ${now.toISOString()}::timestamptz GROUP BY 1`,
      );
      const ord = yield* store(
        sql<{ day: string; n: string }>`
          SELECT to_char(placed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::text AS n FROM store_orders
          WHERE workspace_id = ${ws} AND status <> 'cancelled' AND placed_at >= ${from14.toISOString()}::timestamptz
            AND placed_at <= ${now.toISOString()}::timestamptz GROUP BY 1`,
      );
      const fBy = new Map(flows.map((r) => [r.day, r] as const));
      const oBy = new Map(ord.map((r) => [r.day, Number(r.n)] as const));
      const totals = yield* store(
        sql<{ members_total: string; active_7d: string; badges_7d: string }>`
          SELECT (SELECT count(*) FROM members m JOIN principals p ON p.principal_id = m.member_id
                   WHERE m.workspace_id = ${ws} AND p.disabled_at IS NULL)::text AS members_total,
                 (SELECT count(*) FROM members m JOIN principals p ON p.principal_id = m.member_id
                   WHERE m.workspace_id = ${ws} AND p.disabled_at IS NULL
                     AND m.last_active_at > ${new Date(now.getTime() - 7 * DAY_MS).toISOString()}::timestamptz)::text AS active_7d,
                 (SELECT count(*) FROM badge_awards WHERE workspace_id = ${ws} AND revoked_at IS NULL
                     AND awarded_at > ${new Date(now.getTime() - 7 * DAY_MS).toISOString()}::timestamptz)::text AS badges_7d`,
      );
      const today = dayKey(now);
      const issued = days.map((d) => Number(fBy.get(d)?.issued ?? 0));
      const redeemed = days.map((d) => Number(fBy.get(d)?.redeemed ?? 0));
      const orders = days.map((d) => oBy.get(d) ?? 0);
      const ti = days.indexOf(today);
      return {
        me,
        counts,
        promotions: promoOut.items,
        feed: feed.items,
        org: {
          points_issued_today: ti >= 0 ? (issued[ti] ?? 0) : 0,
          points_redeemed_today: ti >= 0 ? (redeemed[ti] ?? 0) : 0,
          orders_today: ti >= 0 ? (orders[ti] ?? 0) : 0,
          active_members_7d: Number(totals[0]?.active_7d ?? 0),
          members_total: Number(totals[0]?.members_total ?? 0),
          badges_awarded_7d: Number(totals[0]?.badges_7d ?? 0),
          series_14d: { days, issued, redeemed, orders },
        },
        activity: activity.items,
        virtual_now: now.toISOString(),
      };
    }),
};

export const homeHandlers = {
  "home.summary": summary,
} satisfies HandlerTable;
