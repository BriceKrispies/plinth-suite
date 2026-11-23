import { Effect, type Schema as S } from "effect";
import { SuiteBadges, type BadgeSpec, type PersonRef } from "@plinth/spec";
import { nodeId } from "@plinth/core";
import { ControlStore, store } from "../../control-store";
import { emitFrom } from "../domain-events";
import { memberByHandle } from "../people";
import { newId } from "../ids";
import { createNotifications } from "../notify";
import { accountId, memberCode, postBadgeReward, postReversal } from "../ledger";
import type { ActionCtx, ActionHandler } from "../types";
import {
  clip,
  factsOf,
  forbiddenRow,
  iso,
  needRef,
  nodeBySlug,
  nodesOfKind,
  personRefs,
  principalRefOf,
  refuse,
  selfMember,
  type NodeRow,
} from "./engagement-shared";
import { requireTarget } from "../target";
import type { HandlerTable } from "./stub";

/**
 * Module `badges` (CONTRACT.md 12.4, M5): the catalogue with a member's progress, manual awards and revocation. The badge
 * engine (worker) awards by criteria through its own copy of the grant; both write the same rows and events.
 */

type Out<T extends S.Schema.Any> = S.Schema.Type<T>;
type BadgeNode = NodeRow<BadgeSpec>;
type Card = Out<typeof SuiteBadges.BadgeCard>;

interface AwardRow {
  award_id: string;
  badge_slug: string;
  member_id: string;
  awarded_at: Date;
  awarded_by: string;
  reason: string;
  points_txn_id: string | null;
  revoked_at: Date | null;
}

const AWARD_COLS = `award_id, badge_slug, member_id, awarded_at, awarded_by, reason, points_txn_id, revoked_at`;

const awardViews = (ws: string, rows: ReadonlyArray<AwardRow>, badges: ReadonlyMap<string, BadgeNode>) =>
  Effect.gen(function* () {
    const refs = yield* personRefs(ws, [...rows.map((r) => r.member_id), ...rows.map((r) => r.awarded_by)]);
    return rows.map((r) => {
      const b = badges.get(r.badge_slug);
      return {
        award_id: r.award_id,
        badge: r.badge_slug,
        badge_title: b?.title ?? r.badge_slug,
        artwork: b?.spec.artwork ?? { shape: "circle", icon: "trophy", hue: 40 },
        member: needRef(refs, r.member_id),
        awarded_at: iso(r.awarded_at),
        awarded_by: needRef(refs, r.awarded_by),
        reason: r.reason,
        points_txn_id: r.points_txn_id,
        revoked_at: r.revoked_at ? iso(r.revoked_at) : null,
      } as Out<typeof SuiteBadges.AwardView>;
    });
  });

const badgeMap = (ws: string) =>
  Effect.gen(function* () {
    const nodes = yield* nodesOfKind<BadgeSpec>(ws, "Badge");
    return new Map(nodes.map((n) => [n.slug, n] as const));
  });

/** Everything the catalogue needs about one member. */
const memberBadgeData = (ws: string, memberId: string, handle: string) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const awards = yield* store(
      sql<{ award_id: string; badge_slug: string; awarded_at: Date }>`
        SELECT award_id, badge_slug, awarded_at FROM badge_awards WHERE member_id = ${memberId} AND revoked_at IS NULL`,
    );
    const progress = yield* store(
      sql<{ badge_id: string; current: string; target: string }>`
        SELECT badge_id, current::text AS current, target::text AS target FROM badge_progress WHERE member_id = ${memberId}`,
    );
    const holders = yield* store(
      sql<{ badge_slug: string; n: number }>`
        SELECT badge_slug, count(*)::int AS n FROM badge_awards WHERE workspace_id = ${ws} AND revoked_at IS NULL GROUP BY badge_slug`,
    );
    const acc = yield* store(
      sql<{ lifetime_earned: string }>`
        SELECT lifetime_earned::text AS lifetime_earned FROM ledger_accounts WHERE account_id = ${accountId(ws, memberCode(handle))}`,
    );
    const m = yield* store(
      sql<{ showcase: string[] }>`SELECT showcase FROM members WHERE member_id = ${memberId}`,
    );
    return {
      awards: new Map(awards.map((a) => [a.badge_slug, a] as const)),
      progress: new Map(progress.map((p) => [p.badge_id, p] as const)),
      holders: new Map(holders.map((h) => [h.badge_slug, h.n] as const)),
      lifetime: Number(acc[0]?.lifetime_earned ?? 0),
      showcase: m[0]?.showcase ?? [],
    };
  });

type MemberData = Effect.Effect.Success<ReturnType<typeof memberBadgeData>>;

const cardOf = (ws: string, b: BadgeNode, d: MemberData): Card => {
  const award = d.awards.get(b.slug);
  const crit = b.spec.criteria;
  const secret = b.spec.hidden && !award;
  let progress: Card["progress"] = null;
  if (award) {
    const target =
      crit.type === "points_threshold"
        ? crit.lifetime_points
        : crit.type === "action_count"
          ? crit.count
          : crit.type === "streak"
            ? crit.days
            : 1;
    progress = { current: target, target, ratio: 1, label: "Earned" };
  } else if (!secret) {
    const stored = d.progress.get(nodeId(ws, "Badge", b.slug));
    if (crit.type === "points_threshold") {
      const current = Math.min(d.lifetime, crit.lifetime_points);
      progress = {
        current,
        target: crit.lifetime_points,
        ratio: current / crit.lifetime_points,
        label: `${current} of ${crit.lifetime_points} lifetime points`,
      };
    } else if (crit.type === "action_count" || crit.type === "streak") {
      const target = crit.type === "action_count" ? crit.count : crit.days;
      const current = Math.min(Number(stored?.current ?? 0), target);
      progress = {
        current,
        target,
        ratio: current / target,
        label: `${current} of ${target} ${crit.type === "action_count" ? "actions" : "days"}`,
      };
    } else if (crit.type === "event") {
      progress = { current: 0, target: 1, ratio: 0, label: "Not yet earned" };
    }
  }
  return {
    slug: b.slug,
    title: secret ? "Secret badge" : b.title,
    description: secret ? "Secret badge" : b.spec.description,
    artwork: b.spec.artwork,
    rarity: b.spec.rarity,
    points_reward: b.spec.points_reward,
    criteria_type: secret ? "hidden" : crit.type,
    holders: d.holders.get(b.slug) ?? 0,
    awarded_at: award ? iso(award.awarded_at) : null,
    award_id: award?.award_id ?? null,
    progress,
    showcased: d.showcase.includes(b.slug),
  };
};

const catalog: ActionHandler<
  Out<typeof SuiteBadges.BadgesCatalogIn>,
  Out<typeof SuiteBadges.BadgesCatalogOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const m = input.member ? yield* memberByHandle(ws, input.member) : yield* selfMember(ctx);
      const d = yield* memberBadgeData(ws, m.id, m.handle);
      const nodes = [...(yield* badgeMap(ws)).values()]
        .filter((b) => b.spec.status === "active")
        .sort((a, b) => a.spec.sort - b.spec.sort || a.slug.localeCompare(b.slug));
      const all = nodes.map((b) => cardOf(ws, b, d));
      const earned = all.filter((c) => c.award_id !== null);
      const filter = input.filter ?? "all";
      const items = all.filter((c) =>
        filter === "all"
          ? true
          : filter === "earned"
            ? c.award_id !== null
            : filter === "in_progress"
              ? c.award_id === null && (c.progress?.current ?? 0) > 0
              : c.award_id === null && (c.progress?.current ?? 0) === 0,
      );
      const nextUp = all
        .filter((c) => c.award_id === null && c.progress !== null && c.criteria_type !== "hidden")
        .sort((a, b) => (b.progress?.ratio ?? 0) - (a.progress?.ratio ?? 0))
        .slice(0, 3);
      return {
        member: needRef(yield* personRefs(ws, [m.id]), m.id),
        items,
        earned: earned.length,
        total: all.length,
        next_up: nextUp,
      } as Out<typeof SuiteBadges.BadgesCatalogOut>;
    }),
};

const get: ActionHandler<Out<typeof SuiteBadges.BadgeIn>, Out<typeof SuiteBadges.BadgeDetailOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const b = yield* nodeBySlug<BadgeSpec>(ws, "Badge", input.slug);
      if (!b || b.spec.status === "draft")
        return yield* Effect.fail(
          refuse("UNKNOWN_REFERENCE", "UNKNOWN_BADGE", `no badge '${input.slug}'`, {}, "/slug"),
        );
      const me = yield* selfMember(ctx);
      const d = yield* memberBadgeData(ws, me.id, me.handle);
      const card = cardOf(ws, b, d);
      const rows = yield* store(
        sql.unsafe<AwardRow>(
          `SELECT ${AWARD_COLS} FROM badge_awards WHERE workspace_id = $1 AND badge_slug = $2 AND revoked_at IS NULL
           ORDER BY awarded_at DESC, award_id LIMIT 10`,
          [ws, input.slug],
        ),
      );
      const regions = yield* store(
        sql<{ region: string; n: number }>`
          SELECT m.region, count(*)::int AS n FROM badge_awards a JOIN members m ON m.member_id = a.member_id
          WHERE a.workspace_id = ${ws} AND a.badge_slug = ${input.slug} AND a.revoked_at IS NULL GROUP BY m.region`,
      );
      const earned = card.award_id !== null;
      return {
        card,
        criteria: card.criteria_type === "hidden" && !earned ? null : b.spec.criteria,
        revision: b.revision,
        recent_awards: yield* awardViews(ws, rows, new Map([[b.slug, b]])),
        holders_by_region: Object.fromEntries(regions.map((r) => [r.region, r.n])),
      } as Out<typeof SuiteBadges.BadgeDetailOut>;
    }),
};

const memberBadges: ActionHandler<
  Out<typeof SuiteBadges.MemberBadgesIn>,
  Out<typeof SuiteBadges.MemberBadgesOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const m = yield* memberByHandle(ws, input.handle);
      const rows = yield* store(
        sql.unsafe<AwardRow>(
          `SELECT ${AWARD_COLS} FROM badge_awards WHERE workspace_id = $1 AND member_id = $2 AND revoked_at IS NULL
           ORDER BY awarded_at DESC, award_id`,
          [ws, m.id],
        ),
      );
      const sc = yield* store(
        sql<{ showcase: string[] }>`SELECT showcase FROM members WHERE member_id = ${m.id}`,
      );
      return {
        member: needRef(yield* personRefs(ws, [m.id]), m.id),
        awards: yield* awardViews(ws, rows, yield* badgeMap(ws)),
        showcase: sc[0]?.showcase ?? [],
      } as Out<typeof SuiteBadges.MemberBadgesOut>;
    }),
};

// ---- award and revoke ------------------------------------------------------------------------------------

const checkAward = (input: Out<typeof SuiteBadges.BadgeAwardIn>, ctx: ActionCtx) =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const b = yield* nodeBySlug<BadgeSpec>(ws, "Badge", input.slug);
    if (!b)
      return yield* Effect.fail(
        refuse("UNKNOWN_REFERENCE", "UNKNOWN_BADGE", `no badge '${input.slug}'`, {}, "/slug"),
      );
    const me = yield* selfMember(ctx);
    if (input.member === me.handle)
      return yield* Effect.fail(
        refuse("RULE_REFUSED", "SELF_ACTION", "you cannot award a badge to yourself", {}, "/member"),
      );
    const found = yield* Effect.either(memberByHandle(ws, input.member));
    if (found._tag === "Left") {
      if (ctx.allow?.rowPredicate) return yield* Effect.fail(forbiddenRow());
      return yield* Effect.fail(found.left);
    }
    yield* requireTarget(ctx, factsOf(found.right));
    if (found.right.disabled)
      return yield* Effect.fail(
        refuse("RULE_REFUSED", "MEMBER_DISABLED", "the member is disabled", {}, "/member"),
      );
    if (b.spec.status !== "active")
      return yield* Effect.fail(
        refuse("RULE_REFUSED", "NOT_ELIGIBLE", "only active badges can be awarded", {}, "/slug"),
      );
    const { sql } = yield* ControlStore;
    const live = yield* store(
      sql<{ award_id: string }>`
        SELECT award_id FROM badge_awards WHERE badge_id = ${nodeId(ws, "Badge", b.slug)} AND member_id = ${found.right.id}
          AND revoked_at IS NULL`,
    );
    if (live[0])
      return yield* Effect.fail(
        refuse("CONFLICT", "ALREADY_EXISTS", "the member already holds this badge", {
          award_id: live[0].award_id,
        }),
      );
    return { badge: b, member: found.right, me };
  });

const award: ActionHandler<Out<typeof SuiteBadges.BadgeAwardIn>, Out<typeof SuiteBadges.AwardView>> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const c = yield* checkAward(input, ctx);
      return {
        effect: `Award the badge ${c.badge.slug} to ${c.member.handle}`,
        facts: { badge: c.badge.slug, member: c.member.handle, points_reward: c.badge.spec.points_reward },
        decision: "approval",
        approverPermission: "badges:award",
      };
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const c = yield* checkAward(input, ctx);
      const awardId = newId();
      const inserted = yield* store(
        sql<{ award_id: string }>`
          INSERT INTO badge_awards (award_id, workspace_id, badge_id, badge_slug, member_id, awarded_at, awarded_by, reason)
          VALUES (${awardId}, ${ws}, ${nodeId(ws, "Badge", c.badge.slug)}, ${c.badge.slug}, ${c.member.id},
                  ${ctx.now.toISOString()}::timestamptz, ${ctx.principal.id}, ${clip(input.reason, 280)})
          ON CONFLICT DO NOTHING RETURNING award_id`,
      );
      if (inserted.length === 0)
        return yield* Effect.fail(
          refuse("CONFLICT", "ALREADY_EXISTS", "the member already holds this badge"),
        );
      let txnId: string | null = null;
      let rewardSeq: number | null = null;
      if (c.badge.spec.points_reward > 0) {
        const r = yield* postBadgeReward(ctx, {
          handle: c.member.handle,
          points: c.badge.spec.points_reward,
          memo: clip(`Badge: ${c.badge.title}`, 280),
          key: `badge:${awardId}`,
          ref: { kind: "badge_award", id: awardId },
        });
        txnId = r.txn_id;
        rewardSeq = r.event_seq;
        yield* store(sql`UPDATE badge_awards SET points_txn_id = ${txnId} WHERE award_id = ${awardId}`);
      }
      const refs = yield* personRefs(ws, [c.member.id]);
      const seq = yield* emitFrom(ctx, "badge.awarded", {
        audience: ["*"],
        subject: { kind: "badge_award", id: awardId },
        member: principalRefOf(c.member),
        payload: {
          award_id: awardId,
          badge: c.badge.slug,
          title: c.badge.title,
          member: needRef(refs, c.member.id) as PersonRef,
          rarity: c.badge.spec.rarity,
          points_reward: c.badge.spec.points_reward,
        },
      });
      yield* createNotifications(ctx, {
        recipients: [principalRefOf(c.member)],
        type: "badge_earned",
        title: `You earned the ${c.badge.title} badge`,
        body: clip(c.badge.spec.description, 500),
        link: "/badges",
        actorId: ctx.principal.id,
        subject: { kind: "badge_award", id: awardId },
        sourceEventSeq: seq,
        dedupeKey: `${seq}:badge_earned`,
      });
      if (txnId !== null && rewardSeq !== null)
        yield* createNotifications(ctx, {
          recipients: [principalRefOf(c.member)],
          type: "points_awarded",
          title: `You received ${c.badge.spec.points_reward} points`,
          body: clip(`Badge reward: ${c.badge.title}`, 500),
          link: "/points",
          actorId: ctx.principal.id,
          subject: { kind: "txn", id: txnId },
          sourceEventSeq: rewardSeq,
          dedupeKey: `${rewardSeq}:points_awarded:badge`,
        });
      const rows = yield* store(
        sql.unsafe<AwardRow>(`SELECT ${AWARD_COLS} FROM badge_awards WHERE award_id = $1`, [awardId]),
      );
      return (yield* awardViews(ws, rows, new Map([[c.badge.slug, c.badge]])))[0] as Out<
        typeof SuiteBadges.AwardView
      >;
    }),
};

const revoke: ActionHandler<Out<typeof SuiteBadges.BadgeRevokeIn>, Out<typeof SuiteBadges.AwardView>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const rows = yield* store(
        sql.unsafe<AwardRow>(
          `SELECT ${AWARD_COLS} FROM badge_awards WHERE workspace_id = $1 AND award_id = $2 FOR UPDATE`,
          [ws, input.award_id],
        ),
      );
      const a = rows[0];
      if (!a)
        return yield* Effect.fail(
          refuse("UNKNOWN_REFERENCE", "UNKNOWN_AWARD", `no award '${input.award_id}'`, {}, "/award_id"),
        );
      if (a.revoked_at !== null)
        return yield* Effect.fail(
          refuse("CONFLICT", "INVALID_TRANSITION", "this award is already revoked", {
            from: "revoked",
            to: "revoked",
            allowed: [],
          }),
        );
      const badges = yield* badgeMap(ws);
      const member = yield* store(
        sql<{ handle: string }>`SELECT handle FROM members WHERE member_id = ${a.member_id}`,
      );
      const handle = member[0]?.handle ?? "";
      // reverse the reward only if the member still holds those points
      let note = clip(input.reason, 280);
      if (a.points_txn_id) {
        const held = yield* store(
          sql<{ remaining: string; reward: string; reversed: boolean }>`
            SELECT coalesce((SELECT sum(l.remaining) FROM point_lots l WHERE l.source_txn_id = ${a.points_txn_id}), 0)::text AS remaining,
                   coalesce((SELECT sum(e.amount) FROM ledger_entries e JOIN ledger_accounts x ON x.account_id = e.account_id
                              WHERE e.txn_id = ${a.points_txn_id} AND x.kind = 'member'), 0)::text AS reward,
                   EXISTS (SELECT 1 FROM ledger_transactions r WHERE r.reverses_txn_id = ${a.points_txn_id}) AS reversed`,
        );
        const h = held[0];
        if (h && !h.reversed && Number(h.reward) > 0 && Number(h.remaining) >= Number(h.reward))
          yield* postReversal(ctx, {
            txnId: a.points_txn_id,
            memo: clip(`Badge revoked: ${badges.get(a.badge_slug)?.title ?? a.badge_slug}`, 280),
          });
        else note = clip(`${input.reason} (reward kept: the points were already spent)`, 280);
      }
      yield* store(
        sql`UPDATE badge_awards SET revoked_at = ${ctx.now.toISOString()}::timestamptz, revoked_by = ${ctx.principal.id},
                   revoke_reason = ${note} WHERE award_id = ${a.award_id}`,
      );
      const subject = (yield* store(
        sql<{ subject: string }>`SELECT subject FROM principals WHERE principal_id = ${a.member_id}`,
      ))[0]?.subject;
      yield* emitFrom(ctx, "badge.revoked", {
        audience: [...(subject ? [subject] : []), "role:admin"],
        subject: { kind: "badge_award", id: a.award_id },
        member: subject ? { id: a.member_id, subject } : undefined,
        payload: { award_id: a.award_id, badge: a.badge_slug, member: handle },
      });
      const out = yield* store(
        sql.unsafe<AwardRow>(`SELECT ${AWARD_COLS} FROM badge_awards WHERE award_id = $1`, [a.award_id]),
      );
      return (yield* awardViews(ws, out, badges))[0] as Out<typeof SuiteBadges.AwardView>;
    }),
};

export const badgesHandlers = {
  "badges.catalog": catalog,
  "badges.get": get,
  "badges.member": memberBadges,
  "badges.award": award,
  "badges.revoke": revoke,
} satisfies HandlerTable;
