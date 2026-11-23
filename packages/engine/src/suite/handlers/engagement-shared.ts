import { Effect } from "effect";
import * as core from "@plinth/core";
import { canonicalize, evalCond, nodeId, sha256Hex } from "@plinth/core";
import {
  DomainError,
  type EvaluatePromotions,
  type MemberFacts,
  type PersonRef,
  type PromoCandidate,
  type PromoEvalInput,
  type PromoEvaluation,
  type ProgramSpec,
  type Tier,
} from "@plinth/spec";
import { Authorizer } from "../../authz";
import { ControlStore, store } from "../../control-store";
import type { StoreError } from "../../errors";
import { emitFrom, type EmitCtx, type PrincipalRef } from "../domain-events";
import { memberByHandle, memberById, roleSubjects, type MemberRow } from "../people";
import { createNotifications } from "../notify";
import { newId } from "../ids";
import { memberFactsFor, type MemberWithFacts } from "../segments";
import { tierOf } from "../program";
import { requireTarget, type TargetFacts } from "../target";
import type { ActionCtx } from "../types";

/**
 * Helpers shared by the engagement handlers (points, ledger, store, badges): who the caller acts as, permission checks
 * with row predicates, batch person references, cursors, tier progress and the promotion evaluation plumbing.
 */

export type Fx<A> = Effect.Effect<A, DomainError | StoreError, ControlStore | Authorizer>;

export const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

/** An ISO string from a driver value (Date or string). */
export const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

export const refuse = (
  code: DomainError["code"],
  reason: string,
  message: string,
  details: Record<string, unknown> = {},
  path = "",
): DomainError => new DomainError({ code, path, message, details: { reason, ...details } });

export const unknownRef = (path: string, message: string): DomainError =>
  new DomainError({ code: "UNKNOWN_REFERENCE", path, message });

export const forbiddenRow = (): DomainError =>
  new DomainError({
    code: "FORBIDDEN",
    path: "",
    message: "this member is outside the scope of your grant",
    details: { reason: "row_predicate" },
    retryable: false,
    fix_hint: "Do not retry. Report the missing scope to a person.",
  });

export const forbiddenPerm = (permission: string): DomainError =>
  new DomainError({
    code: "FORBIDDEN",
    path: "",
    message: `missing permission ${permission}`,
    details: { reason: "no_grant", permission },
    retryable: false,
  });

export const factsOf = (m: MemberRow): TargetFacts => ({
  handle: m.handle,
  region: m.region,
  tier: m.tier,
  department: m.department,
});

/** The member the caller acts as: itself, or for an agent the human it acts for. */
export const selfMember = (
  ctx: ActionCtx,
): Effect.Effect<MemberRow, DomainError | StoreError, ControlStore> => {
  const id =
    ctx.principal.kind === "agent"
      ? (ctx.onBehalfOf?.id ?? ctx.principal.delegatorId ?? ctx.principal.id)
      : ctx.principal.id;
  return memberById(ctx.principal.workspaceId, id);
};

export const moduleResource = (ctx: Pick<ActionCtx, "principal">, module: string): string =>
  `plinth://${ctx.principal.workspaceSlug}/suite/${module}`;

/** The permission decision for the caller (an agent: its ceiling intersected with its delegator). */
export const decide = (ctx: Pick<ActionCtx, "principal">, permission: string, module: string) =>
  Effect.gen(function* () {
    const authz = yield* Authorizer;
    return yield* authz.authorize(ctx.principal, permission, moduleResource(ctx, module));
  });

/** The permission decision for an arbitrary principal (an approver who ran a held action). */
export const decideFor = (
  ctx: Pick<ActionCtx, "principal">,
  who: ActionCtx["principal"],
  permission: string,
  module: string,
) =>
  Effect.gen(function* () {
    const authz = yield* Authorizer;
    return yield* authz.authorize(who, permission, moduleResource(ctx, module));
  });

/**
 * The member a read or an action targets: the caller when `handle` is absent or its own, else a member the caller's
 * `permission` grant reaches (the row predicate applies, and an out-of-scope or unknown handle both answer the same
 * `row_predicate` refusal when the grant is scoped).
 */
export const targetMember = (
  ctx: ActionCtx,
  handle: string | undefined,
  permission: string,
  module: string,
): Effect.Effect<MemberRow, DomainError | StoreError, ControlStore | Authorizer> =>
  Effect.gen(function* () {
    const me = yield* selfMember(ctx);
    if (handle === undefined || handle === me.handle) return me;
    const d = yield* decide(ctx, permission, module);
    if (d.kind !== "allow") return yield* Effect.fail(forbiddenPerm(permission));
    const found = yield* Effect.either(memberByHandle(ctx.principal.workspaceId, handle));
    if (found._tag === "Left") {
      if (d.rowPredicate !== null) return yield* Effect.fail(forbiddenRow());
      return yield* Effect.fail(found.left);
    }
    yield* requireTarget({ allow: d }, factsOf(found.right));
    return found.right;
  });

// ---- people --------------------------------------------------------------------------------------------

const initialsOf = (name: string): string => {
  const parts = name.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "?";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : (parts[0]?.[1] ?? "");
  return (a + b).toUpperCase();
};

/** `PersonRef`s of many principals in one query. */
export const personRefs = (
  ws: string,
  ids: ReadonlyArray<string>,
): Effect.Effect<ReadonlyMap<string, PersonRef>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const out = new Map<string, PersonRef>();
    const uniq = [...new Set(ids)];
    if (uniq.length === 0) return out;
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{
        principal_id: string;
        subject: string;
        kind: PersonRef["kind"];
        display_name: string;
        handle: string | null;
        avatar_hue: number | null;
      }>`
        SELECT p.principal_id, p.subject, p.kind, p.display_name, m.handle, m.avatar_hue
        FROM principals p LEFT JOIN members m ON m.member_id = p.principal_id
        WHERE p.workspace_id = ${ws} AND p.principal_id IN ${sql.in(uniq)}`,
    );
    for (const r of rows) {
      const avatar =
        r.kind === "agent"
          ? { initials: "AI", hue: 265 }
          : r.kind === "service"
            ? { initials: (r.subject.split(":")[1] ?? "sv").slice(0, 2).toUpperCase(), hue: 210 }
            : { initials: initialsOf(r.display_name), hue: r.avatar_hue ?? 0 };
      out.set(r.principal_id, {
        subject: r.subject,
        handle: r.handle,
        display_name: r.display_name,
        kind: r.kind,
        avatar,
      } as PersonRef);
    }
    return out;
  });

export const needRef = (m: ReadonlyMap<string, PersonRef>, id: string): PersonRef =>
  m.get(id) ??
  ({
    subject: "service:unknown",
    handle: null,
    display_name: "Unknown",
    kind: "service",
    avatar: { initials: "UN", hue: 210 },
  } as PersonRef);

export const principalRefOf = (m: MemberRow): PrincipalRef => ({ id: m.id, subject: m.subject });

// ---- cursors, dates, tiers -----------------------------------------------------------------------------

export const encodeCursor = (v: unknown): string =>
  Buffer.from(JSON.stringify(v), "utf8").toString("base64url");
export const decodeCursor = <T>(c: string | undefined): T | undefined => {
  if (c === undefined || c === "") return undefined;
  try {
    return JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as T;
  } catch {
    return undefined;
  }
};

export const pageLimit = (n: number | undefined, dflt = 50): number => Math.min(200, Math.max(1, n ?? dflt));

export const DAY_MS = 86_400_000;
export const dayStart = (d: Date): Date => new Date(Math.floor(d.getTime() / DAY_MS) * DAY_MS);
export const dateOnly = (d: Date | string): string => iso(d).slice(0, 10);

export const tierProgress = (program: Pick<ProgramSpec, "tiers">, lifetime: number) => {
  const tiers = [...program.tiers].sort((a, b) => a.min_lifetime_points - b.min_lifetime_points);
  const tier: Tier = tierOf(program, lifetime);
  const cur = tiers.find((t) => t.tier === tier);
  const next = tiers.find((t) => t.min_lifetime_points > lifetime);
  const floor = cur?.min_lifetime_points ?? 0;
  const progress = next
    ? Math.min(1, Math.max(0, (lifetime - floor) / Math.max(1, next.min_lifetime_points - floor)))
    : 1;
  return {
    tier,
    lifetime_points: lifetime,
    next_tier: next ? next.tier : null,
    next_tier_at: next ? next.min_lifetime_points : null,
    progress,
  };
};

// ---- nodes ---------------------------------------------------------------------------------------------

export interface NodeRow<Spec = Record<string, unknown>> {
  readonly slug: string;
  readonly title: string;
  readonly revision: number;
  readonly createdSeq: number;
  readonly spec: Spec;
}

interface RawNode {
  slug: string;
  revision: string;
  created_seq: string;
  body: { metadata?: { title?: string }; spec?: Record<string, unknown> };
}

const toNode = <Spec>(r: RawNode): NodeRow<Spec> => ({
  slug: r.slug,
  title: r.body.metadata?.title ?? r.slug,
  revision: Number(r.revision),
  createdSeq: Number(r.created_seq),
  spec: (r.body.spec ?? {}) as Spec,
});

/**
 * The parsed rows of one kind, reused while nothing of that kind changed. Handlers read the whole catalogue (Products,
 * Categories, Badges, Promotions, ...) on nearly every call, and a seed replays thousands of calls. Freshness is
 * checked in SQL with a fingerprint of (slug, revision, created_seq, body hash), so a rolled-back or reset world can
 * never serve stale rows; only the transfer and parse of the bodies is skipped.
 */
const kindCache = new Map<string, { readonly fp: string; readonly rows: ReadonlyArray<NodeRow<never>> }>();

export const nodesOfKind = <Spec>(
  ws: string,
  kind: string,
): Effect.Effect<ReadonlyArray<NodeRow<Spec>>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const fpRows = yield* store(
      sql<{ fp: string }>`
        SELECT count(*)::text || ':' || coalesce(md5(string_agg(
                 slug || ':' || revision::text || ':' || created_seq::text || ':' || encode(body_hash, 'hex'), ',' ORDER BY slug)), '') AS fp
        FROM nodes WHERE workspace_id = ${ws} AND kind = ${kind} AND deleted_at IS NULL`,
    );
    const fp = fpRows[0]?.fp ?? "";
    const key = `${ws}|${kind}`;
    const hit = kindCache.get(key);
    if (hit && hit.fp === fp) return hit.rows as unknown as ReadonlyArray<NodeRow<Spec>>;
    const rows = yield* store(
      sql<RawNode>`
        SELECT slug, revision::text AS revision, created_seq::text AS created_seq, body FROM nodes
        WHERE workspace_id = ${ws} AND kind = ${kind} AND deleted_at IS NULL ORDER BY slug`,
    );
    const parsed = rows.map((r) => toNode<Spec>(r));
    kindCache.set(key, { fp, rows: parsed as unknown as ReadonlyArray<NodeRow<never>> });
    return parsed;
  });

export const nodeBySlug = <Spec>(
  ws: string,
  kind: string,
  slug: string,
): Effect.Effect<NodeRow<Spec> | undefined, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<RawNode>`
        SELECT slug, revision::text AS revision, created_seq::text AS created_seq, body FROM nodes
        WHERE workspace_id = ${ws} AND kind = ${kind} AND slug = ${slug} AND deleted_at IS NULL`,
    );
    return rows[0] ? toNode<Spec>(rows[0]) : undefined;
  });

export const productId = (ws: string, slug: string): string => nodeId(ws, "Product", slug);

// ---- promotions ----------------------------------------------------------------------------------------

type PromoSpecLoose = {
  status: string;
  owner?: string;
  banner?: { headline?: string };
  eligibility: {
    segments?: ReadonlyArray<string>;
    groups?: ReadonlyArray<string>;
    entitlement_only?: boolean;
    categories?: ReadonlyArray<string>;
    products?: ReadonlyArray<string>;
  };
  effects: ReadonlyArray<Record<string, unknown>>;
  budget: { max_cost_points?: number; max_redemptions?: number; max_per_member?: number };
  schedule: { starts_at: string; ends_at: string };
};
export type PromoNode = NodeRow<PromoSpecLoose>;

/** Does the core package already export the pure evaluator? (`packages/core/src/suite/promotions.ts`.) */
const coreEvaluate = (core as unknown as { evaluatePromotions?: EvaluatePromotions }).evaluatePromotions;

/** The evaluator: the core function when present; otherwise "no promotion applies" so the money paths still work. */
export const evaluatePromos: EvaluatePromotions = (input: PromoEvalInput): PromoEvaluation => {
  if (coreEvaluate) return coreEvaluate(input);
  const c = input.context;
  if (c.kind === "purchase") {
    const subtotal = c.lines.reduce((s, l) => s + l.qty * l.unit_points, 0);
    return {
      applied: [],
      rejected: [],
      advisories: [],
      totals: {
        kind: "purchase",
        subtotal_points: subtotal,
        discount_points: 0,
        total_points: subtotal,
        bonus_points: 0,
        free_items: [],
      },
      cost_points: 0,
      delta_points: 0,
    };
  }
  return {
    applied: [],
    rejected: [],
    advisories: [],
    totals: { kind: "earn", base_points: c.base_points, bonus_points: 0, final_points: c.base_points },
    cost_points: 0,
    delta_points: 0,
  };
};

/** Ensure a `promotion_usage` row exists for each Promotion node (idempotent). */
const ensureUsage = (ws: string, ids: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    for (const id of ids)
      yield* store(
        sql`INSERT INTO promotion_usage (promotion_id, workspace_id) VALUES (${id}, ${ws}) ON CONFLICT DO NOTHING`,
      );
  });

/**
 * Candidates for the pure evaluator: every Promotion node (`live` evaluates only `active` ones), with its usage counters
 * (locked `FOR UPDATE` in ascending id order when `lock`), the member's segment and group membership, its entitlement
 * and the prices of free items.
 */
export const loadPromoCandidates = (
  ws: string,
  member: MemberWithFacts,
  now: Date,
  opts: { readonly lock: boolean },
): Effect.Effect<ReadonlyArray<PromoCandidate>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const all = yield* nodesOfKind<PromoSpecLoose>(ws, "Promotion");
    const nodes = all.filter((n) => n.spec.status === "active");
    if (nodes.length === 0) return [];
    const ids = nodes.map((n) => nodeId(ws, "Promotion", n.slug)).sort();
    yield* ensureUsage(ws, ids);
    const usageRows = opts.lock
      ? yield* store(
          sql<{ promotion_id: string; cost_points: string; redemptions: number }>`
            SELECT promotion_id, cost_points::text AS cost_points, redemptions FROM promotion_usage
            WHERE promotion_id IN ${sql.in(ids)} ORDER BY promotion_id FOR UPDATE`,
        )
      : yield* store(
          sql<{ promotion_id: string; cost_points: string; redemptions: number }>`
            SELECT promotion_id, cost_points::text AS cost_points, redemptions FROM promotion_usage
            WHERE promotion_id IN ${sql.in(ids)}`,
        );
    const usage = new Map(usageRows.map((u) => [u.promotion_id, u] as const));
    const mine = yield* store(
      sql<{ promotion_id: string; n: number }>`
        SELECT promotion_id, count(DISTINCT ref_kind || ':' || ref_id)::int AS n FROM promotion_redemptions
        WHERE member_id = ${member.memberId} AND reversed_at IS NULL AND promotion_id IN ${sql.in(ids)}
        GROUP BY promotion_id`,
    );
    const mineBy = new Map(mine.map((m) => [m.promotion_id, m.n] as const));
    const ent = yield* store(
      sql<{ promotion_id: string }>`
        SELECT DISTINCT promotion_id FROM promotion_entitlements
        WHERE member_id = ${member.memberId} AND used_at IS NULL AND expires_at > ${now.toISOString()}::timestamptz
          AND promotion_id IN ${sql.in(ids)}`,
    );
    const entitled = new Set(ent.map((e) => e.promotion_id));
    const segments = new Map(
      (yield* nodesOfKind<{ rule?: unknown }>(ws, "Segment")).map((s) => [s.slug, s] as const),
    );
    const groups = new Map(
      (yield* nodesOfKind<{ members?: ReadonlyArray<string> }>(ws, "Group")).map((g) => [g.slug, g] as const),
    );
    const products = new Map(
      (yield* nodesOfKind<{ price_points: number }>(ws, "Product")).map((p) => [p.slug, p] as const),
    );
    const stock = yield* store(
      sql<{ product_slug: string; on_hand: number }>`
        SELECT product_slug, on_hand FROM product_inventory WHERE workspace_id = ${ws}`,
    );
    const onHand = new Map(stock.map((s) => [s.product_slug, s.on_hand] as const));
    const out: PromoCandidate[] = [];
    for (const n of nodes) {
      const id = nodeId(ws, "Promotion", n.slug);
      const u = usage.get(id);
      const inSeg: Record<string, boolean> = {};
      for (const ref of n.spec.eligibility.segments ?? []) {
        const rule = segments.get(ref.replace(/^segment:/, ""))?.spec.rule;
        inSeg[ref] = rule
          ? evalCond(rule as never, member.facts as unknown as Record<string, unknown>)
          : false;
      }
      const inGrp: Record<string, boolean> = {};
      for (const ref of n.spec.eligibility.groups ?? [])
        inGrp[ref] = (groups.get(ref.replace(/^group:/, ""))?.spec.members ?? []).includes(member.subject);
      const free: Record<string, { unit_points: number; in_stock: boolean }> = {};
      for (const e of n.spec.effects)
        if (e["type"] === "free_item") {
          const slug = String(e["product"]).replace(/^product:/, "");
          const p = products.get(slug);
          const v = { unit_points: p?.spec.price_points ?? 0, in_stock: (onHand.get(slug) ?? 0) > 0 };
          free[slug] = v;
          free[`product:${slug}`] = v;
        }
      out.push({
        slug: n.slug,
        revision: n.revision,
        spec: n.spec as never,
        usage: {
          cost_points: Number(u?.cost_points ?? 0),
          redemptions: u?.redemptions ?? 0,
          member_redemptions: mineBy.get(id) ?? 0,
        },
        member_in_segments: inSeg,
        member_in_groups: inGrp,
        entitled: entitled.has(id),
        free_items: free,
      });
    }
    return out;
  });

export const memberWithFacts = (
  ws: string,
  memberId: string,
  now: Date,
): Effect.Effect<MemberWithFacts, DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    const rows = yield* memberFactsFor(ws, now, [memberId]);
    const r = rows[0];
    if (!r) return yield* Effect.fail(unknownRef("", "no such member"));
    return r;
  });

export const evaluateEarn = (
  ws: string,
  member: MemberWithFacts,
  now: Date,
  base: number,
  channel: "recognition" | "automation" | "content",
  earnType: "award" | "badge_reward" | "automation" | "content",
  lock: boolean,
) =>
  Effect.gen(function* () {
    const candidates = yield* loadPromoCandidates(ws, member, now, { lock });
    return evaluatePromos({
      now: now.toISOString() as never,
      mode: "live",
      member: member.facts as MemberFacts,
      context: { kind: "earn", channel, base_points: base, earn_type: earnType },
      candidates: [...candidates],
    });
  });

/** The slug of an applied promotion's effect cost record, for charging. */
export const chargePromotions = (
  ctx: EmitCtx,
  a: {
    readonly member: MemberRow;
    readonly evaluation: PromoEvaluation;
    readonly context: "purchase" | "earn";
    readonly ref: { readonly kind: "order" | "txn"; readonly id: string };
  },
): Effect.Effect<void, StoreError, ControlStore | Authorizer> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ctx.principal.workspaceId;
    const nowIso = ctx.now.toISOString();
    for (const p of a.evaluation.applied) {
      const pid = nodeId(ws, "Promotion", p.slug);
      for (const e of p.effects)
        yield* store(
          sql`INSERT INTO promotion_redemptions (redemption_id, workspace_id, promotion_id, promotion_slug, promotion_revision,
                                                  member_id, context, effect_type, cost_points, benefit_points, ref_kind, ref_id, occurred_at)
              VALUES (${newId()}, ${ws}, ${pid}, ${p.slug}, ${p.revision}, ${a.member.id}, ${a.context}, ${e.type},
                      ${e.cost_points}, ${e.benefit_points}, ${a.ref.kind}, ${a.ref.id}, ${nowIso}::timestamptz)`,
        );
      yield* ensureUsage(ws, [pid]);
      const upd = yield* store(
        sql<{ cost_points: string; alerts_sent: number[] }>`
          UPDATE promotion_usage SET cost_points = cost_points + ${p.cost_points}, redemptions = redemptions + 1
          WHERE promotion_id = ${pid} RETURNING cost_points::text AS cost_points, alerts_sent`,
      );
      const node = yield* nodeBySlug<PromoSpecLoose>(ws, "Promotion", p.slug);
      const max = node?.spec.budget.max_cost_points;
      const cost = Number(upd[0]?.cost_points ?? 0);
      yield* emitFrom(ctx, "promotion.redeemed", {
        audience: [a.member.subject, "role:marketing-manager"],
        subject: { kind: "promotion", id: p.slug },
        member: principalRefOf(a.member),
        payload: {
          promotion: p.slug,
          member: a.member.handle,
          context: a.context,
          cost_points: p.cost_points,
          benefit_points: p.effects.reduce((s, e) => s + e.benefit_points, 0),
        },
      });
      if (max && max > 0) {
        const sent = upd[0]?.alerts_sent ?? [];
        const pct = Math.floor((cost * 100) / max);
        const crossed = [50, 80, 100].filter((t) => pct >= t && !sent.includes(t));
        if (crossed.length > 0) {
          yield* store(
            sql`UPDATE promotion_usage SET alerts_sent = alerts_sent || ${`{${crossed.join(",")}}`}::int[]
                WHERE promotion_id = ${pid}`,
          );
          const owner = node?.spec.owner;
          const finance = (yield* roleSubjects(ws, "finance")).map((s) => s);
          const audience = ["role:marketing-manager", "role:finance", ...(owner ? [owner] : [])];
          for (const t of crossed) {
            const seq = yield* emitFrom(ctx, "promotion.budget_alert", {
              audience,
              subject: { kind: "promotion", id: p.slug },
              payload: {
                promotion: p.slug,
                used_pct: t as 50 | 80 | 100,
                cost_points: cost,
                max_cost_points: max,
              },
            });
            const names = [...new Set([...(owner ? [owner] : []), ...finance])];
            if (names.length > 0) {
              const ppl = yield* store(
                sql<{ principal_id: string; subject: string }>`
                  SELECT principal_id, subject FROM principals
                  WHERE workspace_id = ${ws} AND subject IN ${sql.in(names)} AND kind = 'human' AND disabled_at IS NULL`,
              );
              yield* createNotifications(ctx, {
                recipients: ppl.map((x) => ({ id: x.principal_id, subject: x.subject })),
                type: "automation_alert",
                title: `Promotion budget ${t}% used`,
                body: `Promotion ${p.slug} has used ${t}% of its budget.`,
                link: "/promotions",
                subject: { kind: "promotion", id: p.slug },
                sourceEventSeq: seq,
                dedupeKey: `${seq}:automation_alert`,
              });
            }
          }
        }
      }
    }
  });

/** The hash of a quote (CONTRACT 7.5). */
export const quoteHashOf = (q: {
  readonly lines: ReadonlyArray<{
    product: string;
    qty: number;
    unit_points: number;
    discount_points: number;
    free_item: boolean;
  }>;
  readonly total_points: number;
  readonly cash_cents: number;
  readonly applied: ReadonlyArray<{ slug: string; revision: number }>;
}): string =>
  sha256Hex(
    canonicalize({
      lines: q.lines.map((l) => ({
        product: l.product,
        qty: l.qty,
        unit_points: l.unit_points,
        discount_points: l.discount_points,
        free_item: l.free_item,
      })),
      total_points: q.total_points,
      cash_cents: q.cash_cents,
      applied: q.applied.map((a) => ({ slug: a.slug, revision: a.revision })),
    }),
  );

export { newId };
