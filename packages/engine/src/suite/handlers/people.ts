import { Effect, Schema as S } from "effect";
import { nodeId, nodeUri } from "@plinth/core";
import { SuitePeople, type MemberFacts } from "@plinth/spec";
import { Authorizer } from "../../authz";
import { memberByHandle } from "../people";
import { loadProgram, tierOf } from "../program";
import { memberFactsFor } from "../segments";
import { mayTarget, requireTarget } from "../target";
import type { ActionCtx, ActionHandler, HandlerError, SuiteEnv } from "../types";
import type { HandlerTable } from "./stub";
import { PLUMBING, PUBLIC_TYPES, activityOf } from "./activity3";
import {
  ISO,
  decodeCursor,
  dom,
  encodeCursor,
  limitOf,
  pgArr,
  personRefsBySubject,
  q,
  toPersonRef,
} from "./util3";

/**
 * Module `people` (CONTRACT.md 12.5): directory, profiles, activity, member facts and groups. Private fields (email,
 * session counts) go to the member and to `people:view-private`; balances to the member and `points:view-all`.
 */

type In<K extends keyof typeof SuitePeople> = (typeof SuitePeople)[K] extends S.Schema.Any
  ? S.Schema.Type<(typeof SuitePeople)[K]>
  : never;
type Card = S.Schema.Type<typeof SuitePeople.MemberCard>;

interface CardRow {
  member_id: string;
  subject: string;
  display_name: string;
  handle: string;
  avatar_hue: number;
  title: string;
  department: string;
  region: string;
  tier: string;
  last_active_at: string | null;
  disabled: boolean;
  badges_count: string;
}

const CARD_SQL = `
  SELECT m.member_id, p.subject, p.display_name, m.handle, m.avatar_hue, m.title, m.department, m.region,
         coalesce(a.tier, 'bronze') AS tier, ${ISO("m.last_active_at")} AS last_active_at,
         (p.disabled_at IS NOT NULL) AS disabled,
         (SELECT count(*) FROM badge_awards b WHERE b.member_id = m.member_id AND b.revoked_at IS NULL)::text AS badges_count
  FROM members m JOIN principals p ON p.principal_id = m.member_id
  LEFT JOIN ledger_accounts a ON a.member_id = m.member_id`;

const toCard = (r: CardRow): Card =>
  ({
    person: toPersonRef({
      principal_id: r.member_id,
      subject: r.subject,
      kind: "human",
      display_name: r.display_name,
      handle: r.handle,
      avatar_hue: r.avatar_hue,
    }),
    title: r.title,
    department: r.department,
    region: r.region,
    tier: r.tier,
    badges_count: Number(r.badges_count),
    last_active_at: r.last_active_at,
    status: r.disabled ? "disabled" : "active",
  }) as Card;

/** Member cards for principal ids, in the order of `ids`. Exported for the other handlers that list members. */
export const memberCards = (
  ws: string,
  ids: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<Card>, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    if (ids.length === 0) return [];
    const rows = yield* q<CardRow>(
      `${CARD_SQL} WHERE m.workspace_id = $1 AND m.member_id = ANY($2::uuid[])`,
      [ws, pgArr(ids)],
    );
    const byId = new Map(rows.map((r) => [r.member_id, r]));
    return ids.flatMap((id) => {
      const r = byId.get(id);
      return r ? [toCard(r)] : [];
    });
  });

const allowOf = (ctx: ActionCtx, perm: string) =>
  Effect.gen(function* () {
    const authz = yield* Authorizer;
    return yield* authz.authorize(
      ctx.principal,
      perm,
      `plinth://${ctx.principal.workspaceSlug}/suite/people`,
    );
  });

// ---- directory -----------------------------------------------------------------------------------------

const directory: ActionHandler<In<"DirectoryIn">, S.Schema.Type<typeof SuitePeople.DirectoryOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const params: unknown[] = [ws];
      const where = ["m.workspace_id = $1", "p.disabled_at IS NULL"];
      if (input.q && input.q.trim() !== "") {
        params.push(input.q.trim().toLowerCase());
        const n = params.length;
        where.push(
          `(lower(p.display_name) LIKE '%' || $${n} || '%' OR m.handle LIKE '%' || $${n} || '%' OR lower(m.title) LIKE '%' || $${n} || '%')`,
        );
      }
      if (input.region) (params.push(input.region), where.push(`m.region = $${params.length}`));
      if (input.tier) (params.push(input.tier), where.push(`a.tier = $${params.length}`));
      if (input.department) (params.push(input.department), where.push(`m.department = $${params.length}`));
      for (const [kind, slug] of [
        ["Group", input.group],
        ["Role", input.role],
      ] as const) {
        if (!slug) continue;
        params.push(kind, slug);
        const k = params.length - 1;
        where.push(
          kind === "Group"
            ? `p.subject IN (SELECT jsonb_array_elements_text(n.body -> 'spec' -> 'members') FROM nodes n WHERE n.workspace_id = $1 AND n.kind = $${k} AND n.slug = $${k + 1} AND n.deleted_at IS NULL)`
            : `p.subject IN (SELECT e ->> 'subject' FROM nodes n, jsonb_array_elements(n.body -> 'spec' -> 'members') e WHERE n.workspace_id = $1 AND n.kind = $${k} AND n.slug = $${k + 1} AND n.deleted_at IS NULL)`,
        );
      }
      const order =
        input.sort === "tier"
          ? "CASE a.tier WHEN 'platinum' THEN 0 WHEN 'gold' THEN 1 WHEN 'silver' THEN 2 ELSE 3 END, p.display_name, m.handle"
          : input.sort === "recent"
            ? "m.last_active_at DESC NULLS LAST, m.handle"
            : input.sort === "points"
              ? "a.lifetime_earned DESC, m.handle"
              : "lower(p.display_name), m.handle";
      const total = yield* q<{ n: string }>(
        `SELECT count(*)::text AS n FROM members m JOIN principals p ON p.principal_id = m.member_id
         LEFT JOIN ledger_accounts a ON a.member_id = m.member_id WHERE ${where.join(" AND ")}`,
        params,
      );
      const limit = limitOf(input.limit, 24);
      const offset = Number(decodeCursor(input.cursor)?.[0] ?? 0) || 0;
      params.push(limit + 1, offset);
      const rows = yield* q<CardRow>(
        `${CARD_SQL} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        items: rows.slice(0, limit).map(toCard),
        next_cursor: rows.length > limit ? encodeCursor([offset + limit]) : null,
        total: Number(total[0]?.n ?? 0),
      };
    }),
};

// ---- profile -------------------------------------------------------------------------------------------

const profile: ActionHandler<In<"ProfileIn">, S.Schema.Type<typeof SuitePeople.ProfileOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const m = yield* memberByHandle(ws, input.handle);
      const isSelf = m.id === ctx.principal.id || m.id === ctx.onBehalfOf?.id;
      const program = yield* loadProgram(ws);
      const rows = yield* q<{
        email: string;
        title: string;
        location: string;
        bio: string;
        showcase: string[];
        balance: string;
        lifetime: string;
        joined_at: string;
        last_active_at: string | null;
      }>(
        `SELECT m.email, m.title, m.location, m.bio, m.showcase, coalesce(a.balance, 0)::text AS balance,
                coalesce(a.lifetime_earned, 0)::text AS lifetime, ${ISO("m.joined_at")} AS joined_at,
                ${ISO("m.last_active_at")} AS last_active_at
         FROM members m LEFT JOIN ledger_accounts a ON a.member_id = m.member_id WHERE m.member_id = $1`,
        [m.id],
      );
      const r = rows[0];
      if (!r) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/handle", "no such member"));
      const lifetime = Number(r.lifetime);
      const tier = tierOf(program, lifetime);
      const tiers = [...program.tiers].sort((a, b) => a.min_lifetime_points - b.min_lifetime_points);
      const idx = tiers.findIndex((t) => t.tier === tier);
      const next = tiers[idx + 1];
      const floor = tiers[idx]?.min_lifetime_points ?? 0;
      const progress = next
        ? Math.min(1, Math.max(0, (lifetime - floor) / (next.min_lifetime_points - floor)))
        : 1;
      const viewAll = yield* allowOf(ctx, "points:view-all");
      const priv = yield* allowOf(ctx, "people:view-private");
      const facts = { handle: m.handle, region: m.region, tier, department: m.department };
      const canBalance = isSelf || (viewAll.kind === "allow" && mayTarget({ allow: viewAll }, facts));
      const canPrivate = isSelf || (priv.kind === "allow" && mayTarget({ allow: priv }, facts));
      // showcase
      const badgeRows = yield* q<{
        slug: string;
        body: {
          metadata?: { title?: string };
          spec?: {
            description?: string;
            artwork?: unknown;
            rarity?: string;
            points_reward?: number;
            criteria?: { type?: string };
            hidden?: boolean;
          };
        };
        award_id: string | null;
        awarded_at: string | null;
        holders: string;
      }>(
        `SELECT n.slug, n.body, b.award_id, ${ISO("b.awarded_at")} AS awarded_at,
                (SELECT count(*) FROM badge_awards x WHERE x.badge_slug = n.slug AND x.revoked_at IS NULL)::text AS holders
         FROM nodes n JOIN badge_awards b ON b.badge_slug = n.slug AND b.member_id = $2 AND b.revoked_at IS NULL
         WHERE n.workspace_id = $1 AND n.kind = 'Badge' AND n.deleted_at IS NULL AND n.slug = ANY($3::text[])`,
        [ws, m.id, pgArr(r.showcase)],
      );
      const showcase = r.showcase.flatMap((slug) => {
        const b = badgeRows.find((x) => x.slug === slug);
        if (!b) return [];
        return [
          {
            slug,
            title: b.body.metadata?.title ?? slug,
            description: b.body.spec?.description ?? "",
            artwork: b.body.spec?.artwork,
            rarity: b.body.spec?.rarity ?? "common",
            points_reward: b.body.spec?.points_reward ?? 0,
            criteria_type: b.body.spec?.hidden ? "hidden" : (b.body.spec?.criteria?.type ?? "manual"),
            holders: Number(b.holders),
            awarded_at: b.awarded_at,
            award_id: b.award_id,
            progress: { current: 1, target: 1, ratio: 1, label: "Earned" },
            showcased: true,
          },
        ];
      });
      const badgeCount = yield* q<{ n: string }>(
        `SELECT count(*)::text AS n FROM badge_awards WHERE member_id = $1 AND revoked_at IS NULL`,
        [m.id],
      );
      const groupRows = yield* q<{ slug: string; uri_kind: string; title: string; revision: string }>(
        `SELECT slug, kind AS uri_kind, body -> 'metadata' ->> 'title' AS title, revision::text AS revision FROM nodes
         WHERE workspace_id = $1 AND kind = 'Group' AND deleted_at IS NULL AND body -> 'spec' -> 'members' ? $2 ORDER BY slug`,
        [ws, m.subject],
      );
      const roleRows = yield* q<{ slug: string }>(
        `SELECT n.slug FROM nodes n, jsonb_array_elements(n.body -> 'spec' -> 'members') e
         WHERE n.workspace_id = $1 AND n.kind = 'Role' AND n.deleted_at IS NULL AND e ->> 'subject' = $2 ORDER BY n.slug`,
        [ws, m.subject],
      );
      const stats = yield* q<{
        earned: string;
        orders: string;
        reviews: string;
        published: string;
        awards: string;
      }>(
        `SELECT
           coalesce((SELECT sum(e.amount) FROM ledger_entries e JOIN ledger_transactions t ON t.txn_id = e.txn_id
                     JOIN ledger_accounts a ON a.account_id = e.account_id
                     WHERE a.member_id = $2 AND e.amount > 0 AND t.txn_type IN ('award','promotion_bonus','badge_reward','adjustment')
                       AND t.occurred_at > $3::timestamptz - interval '30 days' AND t.occurred_at <= $3::timestamptz), 0)::text AS earned,
           (SELECT count(*) FROM store_orders o WHERE o.member_id = $2 AND o.status <> 'cancelled')::text AS orders,
           (SELECT count(*) FROM product_reviews v WHERE v.member_id = $2)::text AS reviews,
           (SELECT count(*) FROM nodes c WHERE c.workspace_id = $1 AND c.kind = 'Content' AND c.deleted_at IS NULL
              AND c.body -> 'spec' ->> 'author' = $4 AND c.body -> 'spec' ->> 'status' = 'published')::text AS published,
           (SELECT count(*) FROM ledger_transactions t WHERE t.workspace_id = $1 AND t.actor_id = $2 AND t.txn_type = 'award'
              AND t.occurred_at > $3::timestamptz - interval '30 days' AND t.occurred_at <= $3::timestamptz)::text AS awards`,
        [ws, m.id, ctx.now.toISOString(), m.subject],
      );
      const st = stats[0];
      const sessions = canPrivate
        ? yield* q<{ n: string }>(
            `SELECT count(*)::text AS n FROM member_sessions WHERE principal_id = $1 AND revoked_at IS NULL`,
            [m.id],
          )
        : [];
      const refs = yield* personRefsBySubject(ws, [m.subject]);
      const p = refs.get(m.subject);
      return {
        member: {
          handle: m.handle,
          subject: m.subject,
          display_name: m.displayName,
          avatar: p?.avatar ?? { initials: "?", hue: m.avatarHue },
          title: r.title,
          department: m.department,
          region: m.region,
          location: r.location,
          joined_at: r.joined_at,
          status: m.disabled ? "disabled" : "active",
        },
        bio: r.bio,
        tier: {
          tier,
          lifetime_points: lifetime,
          next_tier: next?.tier ?? null,
          next_tier_at: next?.min_lifetime_points ?? null,
          progress,
        },
        balance: canBalance ? Number(r.balance) : null,
        showcase,
        badges_count: Number(badgeCount[0]?.n ?? 0),
        groups: groupRows.map((g) => ({
          uri: nodeUri(ctx.principal.workspaceSlug, "Group", nodeId(ws, "Group", g.slug)),
          kind: "Group",
          slug: g.slug,
          title: g.title ?? g.slug,
          revision: Number(g.revision),
        })),
        roles: roleRows.map((x) => x.slug),
        stats: {
          points_earned_30d: Number(st?.earned ?? 0),
          orders_total: Number(st?.orders ?? 0),
          reviews: Number(st?.reviews ?? 0),
          content_published: Number(st?.published ?? 0),
          awards_given_30d: Number(st?.awards ?? 0),
        },
        private: canPrivate
          ? { email: r.email, sessions_active: Number(sessions[0]?.n ?? 0), last_active_at: r.last_active_at }
          : null,
        is_self: isSelf,
      } as never;
    }),
};

// ---- activity ------------------------------------------------------------------------------------------

const peopleActivity: ActionHandler<
  { handle: string; cursor?: string; limit?: number; types?: ReadonlyArray<string> },
  unknown
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const m = yield* memberByHandle(ws, input.handle);
      const isSelf = m.id === ctx.principal.id || m.id === ctx.onBehalfOf?.id;
      const audit = yield* Effect.gen(function* () {
        const authz = yield* Authorizer;
        const d = yield* authz.authorize(
          ctx.principal,
          "audit:view",
          `plinth://${ctx.principal.workspaceSlug}/suite/audit`,
        );
        return d.kind === "allow";
      });
      const full = isSelf || audit;
      const types = full
        ? input.types
        : input.types && input.types.length > 0
          ? input.types.filter((t) => PUBLIC_TYPES.includes(t as never))
          : [...PUBLIC_TYPES];
      if (!full && types && types.length === 0) return { items: [], next_cursor: null };
      return yield* activityOf(ws, m.id, {
        types,
        excludeTypes: full ? PLUMBING : undefined,
        cursor: input.cursor,
        limit: input.limit,
      });
    }),
};

// ---- facts ---------------------------------------------------------------------------------------------

const facts: ActionHandler<In<"FactsIn">, S.Schema.Type<typeof SuitePeople.FactsOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const m = yield* memberByHandle(ws, input.handle);
      yield* requireTarget(ctx, {
        handle: m.handle,
        region: m.region,
        tier: m.tier,
        department: m.department,
      });
      const [f] = yield* memberFactsFor(ws, ctx.now, [m.id]);
      if (!f) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/handle", "no such member"));
      return { facts: f.facts as MemberFacts };
    }),
};

// ---- groups --------------------------------------------------------------------------------------------

interface GroupRow {
  slug: string;
  revision: string;
  body: {
    metadata?: { title?: string };
    spec?: {
      description?: string;
      type?: string;
      members?: string[];
      managers?: string[];
      open_posting?: boolean;
      artwork?: unknown;
    };
  };
}

const groupSummary = (ctx: ActionCtx, g: GroupRow) => {
  const members = g.body.spec?.members ?? [];
  return {
    node: {
      uri: nodeUri(ctx.principal.workspaceSlug, "Group", nodeId(ctx.principal.workspaceId, "Group", g.slug)),
      kind: "Group",
      slug: g.slug,
      title: g.body.metadata?.title ?? g.slug,
      revision: Number(g.revision),
    },
    type: g.body.spec?.type ?? "team",
    description: g.body.spec?.description ?? "",
    member_count: members.length,
    artwork: g.body.spec?.artwork,
    is_member:
      members.includes(ctx.principal.subject) ||
      (ctx.onBehalfOf ? members.includes(ctx.onBehalfOf.subject) : false),
    is_manager:
      (g.body.spec?.managers ?? []).includes(ctx.principal.subject) ||
      (ctx.onBehalfOf ? (g.body.spec?.managers ?? []).includes(ctx.onBehalfOf.subject) : false),
  };
};

const groupsList: ActionHandler<unknown, S.Schema.Type<typeof SuitePeople.GroupsListOut>> = {
  run: (_i, ctx) =>
    Effect.gen(function* () {
      const rows = yield* q<GroupRow>(
        `SELECT slug, revision::text AS revision, body FROM nodes WHERE workspace_id = $1 AND kind = 'Group' AND deleted_at IS NULL ORDER BY slug`,
        [ctx.principal.workspaceId],
      );
      return { items: rows.map((g) => groupSummary(ctx, g)) } as never;
    }),
};

const groupsGet: ActionHandler<In<"GroupIn">, S.Schema.Type<typeof SuitePeople.GroupOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const rows = yield* q<GroupRow>(
        `SELECT slug, revision::text AS revision, body FROM nodes WHERE workspace_id = $1 AND kind = 'Group' AND slug = $2 AND deleted_at IS NULL`,
        [ws, input.slug],
      );
      const g = rows[0];
      if (!g) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/slug", `no group '${input.slug}'`));
      const subjects = g.body.spec?.members ?? [];
      const ids = yield* q<{ member_id: string }>(
        `SELECT m.member_id FROM members m JOIN principals p ON p.principal_id = m.member_id
         WHERE m.workspace_id = $1 AND p.subject = ANY($2::text[]) ORDER BY lower(p.display_name), m.handle`,
        [ws, pgArr(subjects)],
      );
      const members = yield* memberCards(
        ws,
        ids.map((x) => x.member_id),
      );
      const refs = yield* personRefsBySubject(ws, g.body.spec?.managers ?? []);
      return {
        summary: groupSummary(ctx, g),
        spec: g.body.spec,
        members: [...members],
        managers: (g.body.spec?.managers ?? []).flatMap((s) => {
          const r = refs.get(s);
          if (!r) return [];
          const { id: _id, ...rest } = r;
          return [rest];
        }),
      } as never;
    }),
};

export const peopleHandlers = {
  "people.directory": directory,
  "people.profile": profile,
  "people.activity": peopleActivity,
  "people.facts": facts,
  "groups.list": groupsList,
  "groups.get": groupsGet,
} satisfies HandlerTable;
