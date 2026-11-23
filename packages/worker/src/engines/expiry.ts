import { Effect } from "effect";
import { principalId } from "@plinth/core";
import {
  ControlStore,
  createNotifications,
  emitFrom,
  inTx,
  loadProgram,
  postExpiry,
  store,
  type EmitCtx,
} from "@plinth/engine";
import type { TickHook, WorkerCtx } from "../hooks";

/**
 * Daily expiry (CONTRACT.md 7.2). Expires every `point_lots` row whose `expires_at` has passed with `postExpiry` (key
 * `expiry:<lot_id>`, so a rerun posts nothing new), and for each `Program.expiry.warn_days` emits `points.expiring` and a
 * `points_expiring` notification to the members whose lots expire that many days ahead.
 */

const DAY_MS = 86_400_000;

const schedulerCtx = (ctx: WorkerCtx): EmitCtx => ({
  principal: {
    id: principalId(ctx.workspaceId, "service:scheduler"),
    subject: "service:scheduler",
    workspaceId: ctx.workspaceId,
  },
  surface: "system",
  now: ctx.now,
});

/** Expire every lot that is due at `ctx.now`. Returns the number of lots expired. */
export const expireDueLots = (ctx: WorkerCtx) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const emit = schedulerCtx(ctx);
    const lots = yield* store(
      sql<{ lot_id: string; code: string; remaining: string; expires_at: Date }>`
        SELECT l.lot_id, a.code, l.remaining::text AS remaining, l.expires_at FROM point_lots l
        JOIN ledger_accounts a ON a.account_id = l.account_id
        WHERE l.workspace_id = ${ctx.workspaceId} AND l.remaining > 0 AND a.kind = 'member'
          AND l.expires_at <= ${ctx.now.toISOString()}::timestamptz
        ORDER BY l.expires_at, l.lot_id`,
    );
    let n = 0;
    for (const l of lots) {
      const r = yield* inTx(
        postExpiry(emit, {
          handle: l.code.replace(/^member:/, ""),
          lotId: l.lot_id,
          remaining: Number(l.remaining),
          memo: `Points expired (earned lot of ${new Date(l.expires_at).toISOString().slice(0, 10)})`,
        }),
      );
      if (!r.replayed) n += 1;
    }
    return n;
  });

/** Emit the expiry warnings of one virtual day: lots expiring exactly `warn_days` days after `day`. */
export const warnExpiring = (ctx: WorkerCtx, day: Date) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const program = yield* loadProgram(ctx.workspaceId);
    const emit = schedulerCtx(ctx);
    const dayIso = day.toISOString();
    for (const w of [...program.expiry.warn_days].sort((a, b) => b - a)) {
      const target = new Date(day.getTime() + w * DAY_MS).toISOString().slice(0, 10);
      const rows = yield* store(
        sql<{ member_id: string; subject: string; handle: string; pts: string }>`
          SELECT a.member_id, p.subject, m.handle, sum(l.remaining)::text AS pts FROM point_lots l
          JOIN ledger_accounts a ON a.account_id = l.account_id
          JOIN principals p ON p.principal_id = a.member_id
          JOIN members m ON m.member_id = a.member_id
          WHERE l.workspace_id = ${ctx.workspaceId} AND l.remaining > 0 AND a.kind = 'member'
            AND (l.expires_at AT TIME ZONE 'UTC')::date = ${target}::date
          GROUP BY a.member_id, p.subject, m.handle ORDER BY m.handle`,
      );
      for (const r of rows) {
        const seen = yield* store(
          sql<{ n: number }>`
            SELECT count(*)::int AS n FROM domain_events
            WHERE workspace_id = ${ctx.workspaceId} AND type = 'points.expiring' AND member_id = ${r.member_id}
              AND payload ->> 'expires_on' = ${target} AND occurred_at >= ${dayIso}::timestamptz`,
        );
        if ((seen[0]?.n ?? 0) > 0) continue;
        const points = Number(r.pts);
        const seq = yield* emitFrom(emit, "points.expiring", {
          audience: [r.subject],
          member: { id: r.member_id, subject: r.subject },
          payload: { member: r.handle, points, expires_on: target },
        });
        yield* createNotifications(emit, {
          recipients: [{ id: r.member_id, subject: r.subject }],
          type: "points_expiring",
          title: `${points} points expire on ${target}`,
          body: `Use them in the store before ${target}.`,
          link: "/points",
          subject: { kind: "member", id: r.member_id },
          sourceEventSeq: seq,
          dedupeKey: `expiring:${r.handle}:${target}:${w}`,
        });
      }
    }
  });

export const expiryDaily: TickHook = (tick, ctx) =>
  Effect.gen(function* () {
    yield* expireDueLots(ctx);
    // warn for every day since the previous tick (at most a week back), today included
    const today = new Date(Math.floor(ctx.now.getTime() / DAY_MS) * DAY_MS);
    const from = tick.previous
      ? Math.max(tick.previous.getTime() + DAY_MS, today.getTime() - 6 * DAY_MS)
      : today.getTime();
    for (let t = from; t <= today.getTime(); t += DAY_MS) yield* warnExpiring(ctx, new Date(t));
  });
