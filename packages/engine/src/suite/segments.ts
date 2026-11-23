import { Effect } from "effect";
import { evalCond } from "@plinth/core";
import { DomainError, type CondTree, type MemberFacts, type SegmentSpec } from "@plinth/spec";
import { ControlStore, store } from "../control-store";
import type { StoreError } from "../errors";

/**
 * Member facts (CONTRACT.md 4.2) and segment evaluation. Segment membership is computed, never stored: a Segment's
 * rule is a condition tree over the 14 member facts, evaluated live by the pure `evalCond`.
 */

const DAY_MS = 86_400_000;
const EARNING_TYPES = ["award", "promotion_bonus", "badge_reward", "adjustment"] as const;

interface FactRow {
  member_id: string;
  subject: string;
  handle: string;
  region: string;
  department: string;
  disabled: boolean;
  joined_at: string;
  last_active_at: string | null;
  tier: string;
  balance: string;
  lifetime: string;
  earned30: string;
  redeemed30: string;
  orders90: string;
  badges: string[] | null;
}

export interface MemberWithFacts {
  readonly memberId: string;
  readonly subject: string;
  readonly facts: MemberFacts;
}

/**
 * Facts for every member (or only `onlyIds`) as of the virtual instant `now`. Set-based: a handful of queries, no
 * per-member round trips.
 */
export const memberFactsFor = (
  ws: string,
  now: Date,
  onlyIds?: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<MemberWithFacts>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const nowIso = now.toISOString();
    const rows = yield* store(
      sql<FactRow>`
        SELECT m.member_id, p.subject, m.handle, m.region, m.department, (p.disabled_at IS NOT NULL) AS disabled,
               (extract(epoch FROM m.joined_at) * 1000)::bigint::text AS joined_at,
               (extract(epoch FROM m.last_active_at) * 1000)::bigint::text AS last_active_at,
               coalesce(a.tier, 'bronze') AS tier, coalesce(a.balance, 0)::text AS balance,
               coalesce(a.lifetime_earned, 0)::text AS lifetime,
               coalesce((SELECT sum(e.amount) FROM ledger_entries e JOIN ledger_transactions t ON t.txn_id = e.txn_id
                          WHERE e.account_id = a.account_id AND e.amount > 0 AND t.txn_type IN ${sql.in([...EARNING_TYPES])}
                            AND t.occurred_at > ${nowIso}::timestamptz - interval '30 days'
                            AND t.occurred_at <= ${nowIso}::timestamptz), 0)::text AS earned30,
               coalesce((SELECT -sum(e.amount) FROM ledger_entries e JOIN ledger_transactions t ON t.txn_id = e.txn_id
                          WHERE e.account_id = a.account_id AND e.amount < 0 AND t.txn_type = 'purchase'
                            AND t.occurred_at > ${nowIso}::timestamptz - interval '30 days'
                            AND t.occurred_at <= ${nowIso}::timestamptz), 0)::text AS redeemed30,
               (SELECT count(*) FROM store_orders o WHERE o.member_id = m.member_id AND o.status <> 'cancelled'
                  AND o.placed_at > ${nowIso}::timestamptz - interval '90 days')::text AS orders90,
               (SELECT array_agg(b.badge_slug ORDER BY b.badge_slug) FROM badge_awards b
                 WHERE b.member_id = m.member_id AND b.revoked_at IS NULL) AS badges
        FROM members m
        JOIN principals p ON p.principal_id = m.member_id
        LEFT JOIN ledger_accounts a ON a.member_id = m.member_id
        WHERE m.workspace_id = ${ws}
        ORDER BY m.handle`,
    );
    const nodes = yield* store(
      sql<{
        kind: string;
        slug: string;
        body: { spec?: { members?: Array<string | { subject?: string }> } };
      }>`
        SELECT kind, slug, body FROM nodes
        WHERE workspace_id = ${ws} AND kind IN ('Group', 'Role') AND deleted_at IS NULL`,
    );
    const groups = new Map<string, string[]>();
    const roles = new Map<string, string[]>();
    for (const n of nodes) {
      for (const m of n.body.spec?.members ?? []) {
        const subject = typeof m === "string" ? m : m.subject;
        if (!subject) continue;
        const into = n.kind === "Group" ? groups : roles;
        into.set(subject, [...(into.get(subject) ?? []), n.slug]);
      }
    }
    const only = onlyIds === undefined ? undefined : new Set(onlyIds);
    return rows
      .filter((r) => only === undefined || only.has(r.member_id))
      .map((r): MemberWithFacts => {
        const joined = Number(r.joined_at);
        const active = r.last_active_at ? Number(r.last_active_at) : joined;
        const badges = r.badges ?? [];
        return {
          memberId: r.member_id,
          subject: r.subject,
          facts: {
            handle: r.handle,
            region: r.region,
            tier: r.tier,
            balance: Number(r.balance),
            lifetime_points: Number(r.lifetime),
            points_earned_30d: Number(r.earned30),
            points_redeemed_30d: Number(r.redeemed30),
            orders_90d: Number(r.orders90),
            badges_count: badges.length,
            badges,
            groups: groups.get(r.subject) ?? [],
            roles: roles.get(r.subject) ?? [],
            department: r.department,
            joined_days: Math.max(0, Math.floor((now.getTime() - joined) / DAY_MS)),
            last_active_days: Math.max(0, Math.floor((now.getTime() - active) / DAY_MS)),
            status: r.disabled ? "disabled" : "active",
          } as MemberFacts,
        };
      });
  });

/** Evaluate a condition tree over every active member: the members matching, with their facts. */
export const evaluateCond = (
  ws: string,
  tree: CondTree,
  now: Date,
): Effect.Effect<ReadonlyArray<MemberWithFacts>, StoreError, ControlStore> =>
  memberFactsFor(ws, now).pipe(
    Effect.map((all) =>
      all.filter(
        (m) => m.facts.status === "active" && evalCond(tree, m.facts as unknown as Record<string, unknown>),
      ),
    ),
  );

/** Members of a stored Segment node (slug) at `now`; UNKNOWN_REFERENCE when the segment does not exist. */
export const segmentMembers = (
  ws: string,
  slug: string,
  now: Date,
): Effect.Effect<ReadonlyArray<MemberWithFacts>, DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ body: { spec?: SegmentSpec } }>`
        SELECT body FROM nodes WHERE workspace_id = ${ws} AND kind = 'Segment' AND slug = ${slug} AND deleted_at IS NULL`,
    );
    const spec = rows[0]?.body.spec;
    if (!spec)
      return yield* Effect.fail(
        new DomainError({ code: "UNKNOWN_REFERENCE", path: "", message: `no Segment '${slug}'` }),
      );
    return yield* evaluateCond(ws, spec.rule, now);
  });

/** Is one member in a segment (or group) set? Used for audiences: `segment:<slug>` or `group:<slug>` references. */
export const audienceMemberIds = (
  ws: string,
  audience: {
    readonly everyone: boolean;
    readonly segments?: ReadonlyArray<string> | undefined;
    readonly groups?: ReadonlyArray<string> | undefined;
  },
  now: Date,
): Effect.Effect<ReadonlyArray<string> | "everyone", DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    if (audience.everyone) return "everyone" as const;
    const { sql } = yield* ControlStore;
    const ids = new Set<string>();
    for (const ref of audience.segments ?? []) {
      const members = yield* segmentMembers(ws, ref.replace(/^segment:/, ""), now);
      for (const m of members) ids.add(m.memberId);
    }
    for (const ref of audience.groups ?? []) {
      const slug = ref.replace(/^group:/, "");
      const rows = yield* store(
        sql<{ member_id: string }>`
          SELECT p.principal_id AS member_id FROM nodes n
          JOIN LATERAL jsonb_array_elements_text(n.body -> 'spec' -> 'members') s(subject) ON true
          JOIN principals p ON p.workspace_id = n.workspace_id AND p.subject = s.subject
          WHERE n.workspace_id = ${ws} AND n.kind = 'Group' AND n.slug = ${slug} AND n.deleted_at IS NULL`,
      );
      for (const r of rows) ids.add(r.member_id);
    }
    return [...ids];
  });
