import { Effect } from "effect";
import { evalCond, nodeId, principalId } from "@plinth/core";
import type { BadgeSpec, CondTree } from "@plinth/spec";
import {
  ControlStore,
  createNotifications,
  emitFrom,
  memberFactsFor,
  newId,
  personRefOf,
  postBadgeReward,
  store,
  type EmitCtx,
  type StoredDomainEvent,
} from "@plinth/engine";
import type { EventHook, WorkerCtx } from "../hooks";

/**
 * Badge engine (CONTRACT.md 12.4). Consumer `badges` reads every domain event that names a member and, for each active
 * Badge whose criteria concern it, updates `badge_progress` and awards. Hooks run inside the transaction that advances the
 * cursor, so progress counted here is counted exactly once. The grant is idempotent: the partial unique index on
 * `badge_awards (badge_id, member_id) WHERE revoked_at IS NULL` makes a double award impossible.
 */

const DAY_MS = 86_400_000;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

interface BadgeNode {
  readonly slug: string;
  readonly title: string;
  readonly id: string;
  readonly spec: BadgeSpec;
}

const loadActiveBadges = (ws: string) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ slug: string; body: { metadata?: { title?: string }; spec: BadgeSpec } }>`
        SELECT slug, body FROM nodes WHERE workspace_id = ${ws} AND kind = 'Badge' AND deleted_at IS NULL ORDER BY slug`,
    );
    return rows
      .filter((r) => r.body.spec.status === "active")
      .map((r): BadgeNode => ({
        slug: r.slug,
        title: r.body.metadata?.title ?? r.slug,
        id: nodeId(ws, "Badge", r.slug),
        spec: r.body.spec,
      }));
  });

const serviceCtx = (ctx: WorkerCtx): EmitCtx => ({
  principal: {
    id: principalId(ctx.workspaceId, "service:badges"),
    subject: "service:badges",
    workspaceId: ctx.workspaceId,
  },
  surface: "system",
  now: ctx.now,
});

const reasonOf = (b: BadgeNode): string => {
  const c = b.spec.criteria;
  switch (c.type) {
    case "points_threshold":
      return `Reached ${c.lifetime_points} lifetime points`;
    case "action_count":
      return `Reached ${c.count} ${c.event} events`;
    case "streak":
      return `${c.days}-day streak of ${c.event} events`;
    case "event":
      return `First ${c.event} event`;
    default:
      return "Awarded";
  }
};

/**
 * Award a badge to a member as `service:badges` (criteria awards). Returns the award id, or null when the member already
 * holds it or is disabled. Posts the reward (`badge_reward`, key `badge:<award_id>`), appends `badge.awarded` and the
 * `badge_earned` notification.
 */
export const grantBadge = (
  ctx: WorkerCtx,
  b: BadgeNode,
  member: { readonly id: string; readonly subject: string; readonly handle: string },
  sourceSeq: number | null,
) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ctx.workspaceId;
    const emit = serviceCtx(ctx);
    const off = yield* store(
      sql<{
        disabled: boolean;
      }>`SELECT (disabled_at IS NOT NULL) AS disabled FROM principals WHERE principal_id = ${member.id}`,
    );
    if (off[0]?.disabled) return null;
    const awardId = newId();
    const inserted = yield* store(
      sql<{ award_id: string }>`
        INSERT INTO badge_awards (award_id, workspace_id, badge_id, badge_slug, member_id, awarded_at, awarded_by, reason, source_event_seq)
        VALUES (${awardId}, ${ws}, ${b.id}, ${b.slug}, ${member.id}, ${ctx.now.toISOString()}::timestamptz,
                ${emit.principal.id}, ${clip(reasonOf(b), 280)}, ${sourceSeq})
        ON CONFLICT DO NOTHING RETURNING award_id`,
    );
    if (inserted.length === 0) return null;
    let rewardSeq: number | null = null;
    let txnId: string | null = null;
    if (b.spec.points_reward > 0) {
      const r = yield* postBadgeReward(emit, {
        handle: member.handle,
        points: b.spec.points_reward,
        memo: clip(`Badge: ${b.title}`, 280),
        key: `badge:${awardId}`,
        ref: { kind: "badge_award", id: awardId },
      });
      txnId = r.txn_id;
      rewardSeq = r.event_seq;
      yield* store(sql`UPDATE badge_awards SET points_txn_id = ${txnId} WHERE award_id = ${awardId}`);
    }
    const ref = yield* personRefOf(ws, member.id);
    const seq = yield* emitFrom(emit, "badge.awarded", {
      audience: ["*"],
      subject: { kind: "badge_award", id: awardId },
      member: { id: member.id, subject: member.subject },
      payload: {
        award_id: awardId,
        badge: b.slug,
        title: b.title,
        member: ref,
        rarity: b.spec.rarity,
        points_reward: b.spec.points_reward,
      },
    });
    const who = [{ id: member.id, subject: member.subject }];
    yield* createNotifications(emit, {
      recipients: who,
      type: "badge_earned",
      title: `You earned the ${b.title} badge`,
      body: clip(b.spec.description, 500),
      link: "/badges",
      actorId: emit.principal.id,
      subject: { kind: "badge_award", id: awardId },
      sourceEventSeq: seq,
      dedupeKey: `${seq}:badge_earned`,
    });
    if (txnId !== null && rewardSeq !== null)
      yield* createNotifications(emit, {
        recipients: who,
        type: "points_awarded",
        title: `You received ${b.spec.points_reward} points`,
        body: clip(`Badge reward: ${b.title}`, 500),
        link: "/points",
        actorId: emit.principal.id,
        subject: { kind: "txn", id: txnId },
        sourceEventSeq: rewardSeq,
        dedupeKey: `${rewardSeq}:points_awarded:badge`,
      });
    return awardId;
  });

/** The event payload plus the derived facts a badge filter may address (CONTRACT 11.4 note). */
const eventFacts = (e: StoredDomainEvent) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const facts: Record<string, unknown> = { ...e.payload };
    if (e.type === "order.placed" && typeof e.payload["order_id"] === "string") {
      const cats = yield* store(
        sql<{ c: string }>`
          SELECT DISTINCT category_slug AS c FROM store_order_items WHERE order_id = ${e.payload["order_id"] as string} ORDER BY 1`,
      );
      facts["categories"] = cats.map((c) => c.c);
    }
    if (e.type === "content.engaged" && typeof e.payload["content"] === "string") {
      const pub = yield* store(
        sql<{ occurred_at: Date }>`
          SELECT occurred_at FROM domain_events WHERE type = 'content.published' AND payload ->> 'content' = ${e.payload["content"] as string}
            AND seq < ${e.seq} ORDER BY seq DESC LIMIT 1`,
      );
      if (pub[0])
        facts["minutes_since_publish"] = Math.max(
          0,
          Math.floor((e.occurredAt.getTime() - new Date(pub[0].occurred_at).getTime()) / 60_000),
        );
    }
    return facts;
  });

const needsMemberFacts = (filter: CondTree | undefined): boolean =>
  filter !== undefined && JSON.stringify(filter).includes('"member.');

interface Progress {
  current: number;
  streakLast: string | null;
}

const readProgress = (memberId: string, badgeId: string) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ current: string; streak_last_day: string | null }>`
        SELECT current::text AS current, to_char(streak_last_day, 'YYYY-MM-DD') AS streak_last_day
        FROM badge_progress WHERE member_id = ${memberId} AND badge_id = ${badgeId}`,
    );
    return {
      current: Number(rows[0]?.current ?? 0),
      streakLast: rows[0]?.streak_last_day ?? null,
    } satisfies Progress;
  });

const writeProgress = (
  ctx: WorkerCtx,
  b: BadgeNode,
  member: { readonly id: string; readonly subject: string; readonly handle: string },
  current: number,
  target: number,
  streakLast: string | null,
) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    yield* store(
      sql`INSERT INTO badge_progress (member_id, badge_id, workspace_id, current, target, streak_last_day, updated_at)
          VALUES (${member.id}, ${b.id}, ${ctx.workspaceId}, ${current}, ${target}, ${streakLast}::date, ${ctx.now.toISOString()}::timestamptz)
          ON CONFLICT (member_id, badge_id) DO UPDATE SET current = EXCLUDED.current, target = EXCLUDED.target,
            streak_last_day = EXCLUDED.streak_last_day, updated_at = EXCLUDED.updated_at`,
    );
    // at most one badge.progress per member, badge and virtual minute
    const minute = new Date(Math.floor(ctx.now.getTime() / 60_000) * 60_000);
    const seen = yield* store(
      sql<{ n: number }>`
        SELECT count(*)::int AS n FROM domain_events
        WHERE workspace_id = ${ctx.workspaceId} AND type = 'badge.progress' AND member_id = ${member.id}
          AND payload ->> 'badge' = ${b.slug} AND occurred_at >= ${minute.toISOString()}::timestamptz`,
    );
    if ((seen[0]?.n ?? 0) === 0)
      yield* emitFrom(serviceCtx(ctx), "badge.progress", {
        audience: [member.subject],
        subject: { kind: "member", id: member.id },
        member: { id: member.id, subject: member.subject },
        payload: { badge: b.slug, member: member.handle, current, target },
      });
  });

/** Evaluate the criteria of every active badge against one event. */
const handleEvent = (
  ctx: WorkerCtx,
  badges: ReadonlyArray<BadgeNode>,
  held: Map<string, Set<string>>,
  e: StoredDomainEvent,
) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const member = e.member;
    if (!member) return;
    const relevant = badges.filter((b) => {
      const c = b.spec.criteria;
      if (c.type === "points_threshold") return e.type === "points.posted";
      if (c.type === "manual") return false;
      return c.event === e.type;
    });
    if (relevant.length === 0) return;
    let mine = held.get(member.id);
    if (!mine) {
      const rows = yield* store(
        sql<{ badge_slug: string }>`
          SELECT badge_slug FROM badge_awards WHERE member_id = ${member.id} AND revoked_at IS NULL`,
      );
      mine = new Set(rows.map((r) => r.badge_slug));
      held.set(member.id, mine);
    }
    let facts: Record<string, unknown> | undefined;
    let memberFacts: unknown;
    const passes = (filter: CondTree | undefined) =>
      Effect.gen(function* () {
        if (filter === undefined) return true;
        facts ??= yield* eventFacts(e);
        if (needsMemberFacts(filter) && memberFacts === undefined) {
          const f = yield* memberFactsFor(ctx.workspaceId, ctx.now, [member.id]);
          memberFacts = f[0]?.facts;
        }
        return evalCond(filter, { event: facts, member: memberFacts, now: ctx.now.toISOString() });
      });
    for (const b of relevant) {
      if (mine.has(b.slug)) continue;
      const c = b.spec.criteria;
      let award = false;
      if (c.type === "points_threshold") {
        if (typeof e.payload["delta"] === "number" && (e.payload["delta"] as number) <= 0) continue;
        const acc = yield* store(
          sql<{ lifetime_earned: string }>`
            SELECT lifetime_earned::text AS lifetime_earned FROM ledger_accounts WHERE member_id = ${member.id}`,
        );
        const lifetime = Number(acc[0]?.lifetime_earned ?? 0);
        const cur = Math.min(lifetime, c.lifetime_points);
        const prev = yield* readProgress(member.id, b.id);
        if (cur !== prev.current) yield* writeProgress(ctx, b, member, cur, c.lifetime_points, null);
        award = lifetime >= c.lifetime_points;
      } else if (c.type === "event") {
        award = yield* passes(c.filter);
      } else if (c.type === "action_count") {
        if (!(yield* passes(c.filter))) continue;
        let current: number;
        if (c.window_days !== undefined) {
          const since = new Date(e.occurredAt.getTime() - c.window_days * DAY_MS).toISOString();
          const rows = yield* store(
            sql<{ payload: Record<string, unknown> }>`
              SELECT payload FROM domain_events WHERE workspace_id = ${ctx.workspaceId} AND type = ${c.event}
                AND member_id = ${member.id} AND occurred_at > ${since}::timestamptz AND seq <= ${e.seq}`,
          );
          current = c.filter
            ? rows.filter((r) =>
                evalCond(c.filter as CondTree, { event: r.payload, now: ctx.now.toISOString() }),
              ).length
            : rows.length;
        } else current = (yield* readProgress(member.id, b.id)).current + 1;
        yield* writeProgress(ctx, b, member, Math.min(current, c.count), c.count, null);
        award = current >= c.count;
      } else if (c.type === "streak") {
        if (!(yield* passes(c.filter))) continue;
        const day = e.occurredAt.toISOString().slice(0, 10);
        const prev = yield* readProgress(member.id, b.id);
        if (prev.streakLast === day) continue;
        if (prev.streakLast !== null && day < prev.streakLast) continue;
        const gap =
          prev.streakLast === null
            ? Infinity
            : Math.round(
                (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${prev.streakLast}T00:00:00Z`)) / DAY_MS,
              );
        const current = gap === 1 ? prev.current + 1 : 1;
        yield* writeProgress(ctx, b, member, Math.min(current, c.days), c.days, day);
        award = current >= c.days;
      }
      if (award) {
        const id = yield* grantBadge(ctx, b, member, e.seq);
        if (id !== null) mine.add(b.slug);
      }
    }
  });

export const badgesOnEvents: EventHook = (events, ctx) =>
  Effect.gen(function* () {
    const badges = yield* loadActiveBadges(ctx.workspaceId);
    if (badges.length === 0) return;
    const held = new Map<string, Set<string>>();
    for (const e of events) yield* handleEvent(ctx, badges, held, e);
  });
