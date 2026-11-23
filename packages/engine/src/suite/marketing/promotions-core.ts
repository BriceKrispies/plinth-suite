import { Effect } from "effect";
import { evalCond, evaluatePromotions } from "@plinth/core";
import {
  DomainError,
  type AppliedPromotion,
  type MemberFacts,
  type PromoCandidate,
  type PromoContext,
  type PromoEvaluation,
  type PromotionSpec,
  type SegmentSpec,
} from "@plinth/spec";
import { nodeId } from "@plinth/core";
import { ControlStore, store } from "../../control-store";
import type { StoreError } from "../../errors";
import { emitFrom, type EmitCtx, type PrincipalRef } from "../domain-events";
import { createNotifications } from "../notify";
import { memberFactsFor } from "../segments";
import { principalId } from "@plinth/core";
import { newId } from "../ids";
import { dom, iso, loadNodes, refSlug, type SuiteNode } from "./common";

/**
 * Promotion loading, evaluation and charging shared by the promotions handlers, the automation engine (earn context)
 * and any caller that credits or sells with promotions applied (CONTRACT.md section 8).
 */

export type PromoNode = SuiteNode<PromotionSpec>;

const audienceFor = (member?: string): string[] => [
  "role:marketing-manager",
  "role:finance",
  "role:admin",
  "role:manager",
  ...(member ? [member] : []),
];

// ---- summaries -------------------------------------------------------------------------------------------------

const cap = (s: string) => (s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s);

export const effectSummary = (spec: PromotionSpec): string =>
  spec.effects
    .map((e) => {
      switch (e.type) {
        case "points_multiplier":
          return `${e.factor}x points`;
        case "bonus_points":
          return `+${e.points} points on ${e.on}`;
        case "store_discount": {
          const scope = [...(e.categories ?? []), ...(e.products ?? [])].map(refSlug);
          return `${e.percent}% off ${scope.length > 0 ? scope.join(", ") : "everything"}`;
        }
        case "free_item":
          return `Free ${refSlug(e.product)} over ${e.min_cart_points} points`;
      }
    })
    .join("; ");

export const eligibilitySummary = (spec: PromotionSpec): string => {
  const el = spec.eligibility;
  const parts: string[] = [];
  if (el.tiers) parts.push(el.tiers.map(cap).join(", "));
  if (el.regions) parts.push(el.regions.join(", "));
  if (el.segments) parts.push(`segment ${el.segments.map(refSlug).join(", ")}`);
  if (el.groups) parts.push(`group ${el.groups.map(refSlug).join(", ")}`);
  if (el.channels) parts.push(el.channels.join(", "));
  if (el.new_members_days !== undefined) parts.push(`joined within ${el.new_members_days} days`);
  if (el.min_cart_points !== undefined) parts.push(`cart of ${el.min_cart_points}+ points`);
  if (el.entitlement_only === true) parts.push("entitlement only");
  if (el.filter !== undefined) parts.push("custom filter");
  return parts.length > 0 ? parts.join(" · ") : "Everyone";
};

// ---- usage ----------------------------------------------------------------------------------------------------

export interface UsageRow {
  readonly cost_points: number;
  readonly redemptions: number;
  readonly members_reached: number;
  readonly alerts_sent: ReadonlyArray<number>;
}

/** Usage by promotion node id. */
export const loadUsage = (
  ws: string,
): Effect.Effect<ReadonlyMap<string, UsageRow>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ promotion_id: string; cost_points: string; redemptions: number; alerts_sent: number[] }>`
        SELECT promotion_id, cost_points::text AS cost_points, redemptions, alerts_sent
        FROM promotion_usage WHERE workspace_id = ${ws}`,
    );
    const reach = yield* store(
      sql<{ promotion_id: string; n: string }>`
        SELECT promotion_id, count(DISTINCT member_id)::text AS n FROM promotion_redemptions
        WHERE workspace_id = ${ws} AND reversed_at IS NULL GROUP BY promotion_id`,
    );
    const reached = new Map(reach.map((r) => [r.promotion_id, Number(r.n)] as const));
    const out = new Map<string, UsageRow>();
    for (const r of rows)
      out.set(r.promotion_id, {
        cost_points: Number(r.cost_points),
        redemptions: r.redemptions,
        members_reached: reached.get(r.promotion_id) ?? 0,
        alerts_sent: r.alerts_sent,
      });
    for (const [id, n] of reached)
      if (!out.has(id)) out.set(id, { cost_points: 0, redemptions: 0, members_reached: n, alerts_sent: [] });
    return out;
  });

// ---- candidates ------------------------------------------------------------------------------------------------

export const loadPromotions = (
  ws: string,
): Effect.Effect<ReadonlyArray<PromoNode>, StoreError, ControlStore> =>
  loadNodes<PromotionSpec>(ws, "Promotion");

/** Candidate records for the given promotions, as seen by one member at `now`. */
export const buildCandidates = (
  ws: string,
  specs: ReadonlyArray<{ slug: string; revision: number; spec: PromotionSpec; id?: string }>,
  member: { readonly id: string; readonly facts: MemberFacts },
  now: Date,
): Effect.Effect<ReadonlyArray<PromoCandidate>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const usage = yield* loadUsage(ws);
    const mine = yield* store(
      sql<{ promotion_id: string; n: string }>`
        SELECT promotion_id, count(DISTINCT ref_kind || ':' || ref_id)::text AS n FROM promotion_redemptions
        WHERE workspace_id = ${ws} AND member_id = ${member.id} AND reversed_at IS NULL GROUP BY promotion_id`,
    );
    const myCount = new Map(mine.map((r) => [r.promotion_id, Number(r.n)] as const));
    const ent = yield* store(
      sql<{ promotion_id: string }>`
        SELECT DISTINCT promotion_id FROM promotion_entitlements
        WHERE workspace_id = ${ws} AND member_id = ${member.id} AND used_at IS NULL
          AND expires_at > ${now.toISOString()}::timestamptz`,
    );
    const entitled = new Set(ent.map((r) => r.promotion_id));

    const segRefs = new Set<string>();
    const prodRefs = new Set<string>();
    for (const n of specs) {
      for (const s of n.spec.eligibility.segments ?? []) segRefs.add(s);
      for (const e of n.spec.effects) if (e.type === "free_item") prodRefs.add(e.product);
    }
    const segNodes = segRefs.size > 0 ? yield* loadNodes<SegmentSpec>(ws, "Segment") : [];
    const inSeg: Record<string, boolean> = {};
    for (const ref of segRefs) {
      const sn = segNodes.find((x) => x.slug === refSlug(ref));
      inSeg[ref] = sn ? evalCond(sn.spec.rule, member.facts as unknown as Record<string, unknown>) : false;
    }
    const freeInfo: Record<string, { unit_points: number; in_stock: boolean }> = {};
    if (prodRefs.size > 0) {
      const prods = yield* loadNodes<{ price_points: number }>(ws, "Product");
      const inv = yield* store(
        sql<{ product_slug: string; on_hand: number }>`
          SELECT product_slug, on_hand FROM product_inventory WHERE workspace_id = ${ws}`,
      );
      const stock = new Map(inv.map((r) => [r.product_slug, r.on_hand] as const));
      for (const ref of prodRefs) {
        const slug = refSlug(ref);
        const pn = prods.find((x) => x.slug === slug);
        freeInfo[ref] = { unit_points: pn?.spec.price_points ?? 0, in_stock: (stock.get(slug) ?? 0) > 0 };
      }
    }

    return specs.map((n): PromoCandidate => {
      const id = "id" in n && n.id ? n.id : nodeId(ws, "Promotion", n.slug);
      const u = usage.get(id);
      const groups: Record<string, boolean> = {};
      for (const g of n.spec.eligibility.groups ?? []) groups[g] = member.facts.groups.includes(refSlug(g));
      const segs: Record<string, boolean> = {};
      for (const s of n.spec.eligibility.segments ?? []) segs[s] = inSeg[s] ?? false;
      const free: Record<string, { unit_points: number; in_stock: boolean }> = {};
      for (const e of n.spec.effects) if (e.type === "free_item") free[e.product] = freeInfo[e.product]!;
      return {
        slug: n.slug,
        revision: n.revision,
        spec: n.spec,
        usage: {
          cost_points: u?.cost_points ?? 0,
          redemptions: u?.redemptions ?? 0,
          member_redemptions: myCount.get(id) ?? 0,
        },
        member_in_segments: segs,
        member_in_groups: groups,
        entitled: entitled.has(id),
        free_items: free,
      };
    });
  });

/** Facts of one member handle at `now`. */
export const factsOfMember = (
  ws: string,
  memberId: string,
  now: Date,
): Effect.Effect<MemberFacts | undefined, StoreError, ControlStore> =>
  memberFactsFor(ws, now, [memberId]).pipe(Effect.map((r) => r[0]?.facts));

/** Evaluate every live (`active`) promotion for a member and a context: the earn and purchase paths call this. */
export const evaluateLive = (
  ws: string,
  member: { readonly id: string; readonly facts: MemberFacts },
  context: PromoContext,
  now: Date,
): Effect.Effect<PromoEvaluation, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const promos = (yield* loadPromotions(ws)).filter((p) => p.spec.status === "active");
    const candidates = yield* buildCandidates(ws, promos, member, now);
    const titles = new Map(promos.map((p) => [p.slug, p.title] as const));
    const ev = evaluatePromotions({
      now: iso(now),
      mode: "live",
      member: member.facts,
      context,
      candidates: [...candidates],
    });
    return withTitles(ev, titles);
  });

export const withTitles = (ev: PromoEvaluation, titles: ReadonlyMap<string, string>): PromoEvaluation => ({
  ...ev,
  applied: ev.applied.map((a): AppliedPromotion => ({ ...a, title: titles.get(a.slug) ?? a.title })),
});

// ---- charging --------------------------------------------------------------------------------------------------

const THRESHOLDS = [50, 80, 100] as const;

export interface ChargeResult {
  readonly promotions: ReadonlyArray<string>;
  readonly cost_points: number;
}

/**
 * Charge the promotions an evaluation applied: lock each `promotion_usage` row in ascending id order, recheck the budget,
 * add the cost, record one `promotion_redemptions` row per effect, emit `promotion.redeemed` and any budget alerts.
 * Refuses with BUDGET_EXHAUSTED when the locked counters no longer admit the cost. Call inside the writing transaction.
 */
export const chargePromotions = (
  ctx: EmitCtx,
  a: {
    readonly member: PrincipalRef & { readonly handle: string };
    readonly context: "purchase" | "earn";
    readonly evaluation: PromoEvaluation;
    readonly ref: { readonly kind: "order" | "txn"; readonly id: string };
    readonly cause?: Parameters<typeof emitFrom>[2]["cause"];
  },
): Effect.Effect<ChargeResult, DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ctx.principal.workspaceId;
    const applied = [...a.evaluation.applied]
      .map((p) => ({ p, id: nodeId(ws, "Promotion", p.slug) }))
      .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    const promos = applied.length > 0 ? yield* loadPromotions(ws) : [];
    let total = 0;
    for (const { p, id } of applied) {
      const node = promos.find((n) => n.slug === p.slug);
      yield* store(
        sql`INSERT INTO promotion_usage (promotion_id, workspace_id) VALUES (${id}, ${ws}) ON CONFLICT DO NOTHING`,
      );
      const rows = yield* store(
        sql<{ cost_points: string; redemptions: number; alerts_sent: number[] }>`
          SELECT cost_points::text AS cost_points, redemptions, alerts_sent FROM promotion_usage
          WHERE promotion_id = ${id} FOR UPDATE`,
      );
      const u = rows[0];
      const cost = Number(u?.cost_points ?? 0);
      const reds = u?.redemptions ?? 0;
      const maxCost = node?.spec.budget.max_cost_points;
      const maxReds = node?.spec.budget.max_redemptions;
      if (
        (maxCost !== undefined && cost + p.cost_points > maxCost) ||
        (maxReds !== undefined && reds + 1 > maxReds)
      )
        return yield* Effect.fail(
          dom("CONFLICT", "", `promotion ${p.slug} has no budget left`, {
            details: { reason: "BUDGET_EXHAUSTED", promotion: p.slug },
          }),
        );
      const newCost = cost + p.cost_points;
      const sent = [...(u?.alerts_sent ?? [])];
      const alerts: number[] = [];
      if (maxCost !== undefined) {
        const pct = (newCost * 100) / maxCost;
        for (const t of THRESHOLDS) if (pct >= t && !sent.includes(t)) alerts.push(t);
      }
      yield* store(
        sql`UPDATE promotion_usage SET cost_points = ${newCost}, redemptions = ${reds + 1},
                   alerts_sent = ${"{" + [...sent, ...alerts].join(",") + "}"}::int[]
            WHERE promotion_id = ${id}`,
      );
      for (const e of p.effects) {
        yield* store(
          sql`INSERT INTO promotion_redemptions (redemption_id, workspace_id, promotion_id, promotion_slug, promotion_revision,
                                                 member_id, context, effect_type, cost_points, benefit_points, ref_kind, ref_id, occurred_at)
              VALUES (${newId()}, ${ws}, ${id}, ${p.slug}, ${p.revision}, ${a.member.id}, ${a.context}, ${e.type},
                      ${e.cost_points}, ${e.benefit_points}, ${a.ref.kind}, ${a.ref.id}, ${ctx.now.toISOString()}::timestamptz)`,
        );
      }
      total += p.cost_points;
      const benefit = p.effects.reduce((s, e) => s + e.benefit_points, 0);
      yield* emitFrom(ctx, "promotion.redeemed", {
        audience: audienceFor(a.member.subject),
        subject: { kind: "promotion", id: p.slug },
        member: a.member,
        ...(a.cause ? { cause: a.cause } : {}),
        payload: {
          promotion: p.slug,
          member: a.member.handle,
          context: a.context,
          cost_points: p.cost_points,
          benefit_points: benefit,
        },
      });
      for (const t of alerts) {
        const seq = yield* emitFrom(ctx, "promotion.budget_alert", {
          audience: audienceFor(),
          subject: { kind: "promotion", id: p.slug },
          payload: {
            promotion: p.slug,
            used_pct: t as 50 | 80 | 100,
            cost_points: newCost,
            max_cost_points: maxCost ?? 0,
          },
        });
        const owner = node?.spec.owner;
        if (owner) {
          const o = yield* store(
            sql<{ principal_id: string; subject: string }>`
              SELECT principal_id, subject FROM principals WHERE workspace_id = ${ws} AND principal_id = ${principalId(ws, owner)}`,
          );
          const rec = o[0];
          if (rec)
            yield* createNotifications(ctx, {
              recipients: [{ id: rec.principal_id, subject: rec.subject }],
              type: "automation_alert",
              title: `Promotion budget ${t}% used`,
              body: `${node?.title ?? p.slug} has used ${t}% of its points budget.`,
              link: "/promotions",
              subject: { kind: "promotion", id: p.slug },
              sourceEventSeq: seq,
              dedupeKey: `${seq}:budget_alert`,
            });
        }
      }
    }
    return { promotions: applied.map((x) => x.p.slug), cost_points: total };
  });
