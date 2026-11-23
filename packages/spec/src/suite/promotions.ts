import { Schema as S } from "effect";
import { MemberFacts } from "./conditions";
import { PromotionSpec, PromoChannel } from "./nodes";
import { Points, SignedPoints, Timestamp } from "./primitives";

/**
 * Promotion evaluation (CONTRACT.md section 8). `evaluatePromotions` is a pure, total, deterministic function in
 * `@plinth/core` (`packages/core/src/suite/promotions.ts`): no I/O, no clock, integer arithmetic only. The caller
 * loads the candidates, their usage counters, the member's facts and segment membership, then calls it. Checkout
 * calls it inside the order transaction against locked usage rows; `promotions.simulate` and `checkout.quote` call
 * it read-only; the earn path calls it when a member is credited points.
 */

export const PurchaseLine = S.Struct({
  product: S.String,
  category: S.String,
  qty: S.Int.pipe(S.between(1, 10)),
  unit_points: Points,
}).annotations({ identifier: "PurchaseLine" });

export const PromoContext = S.Union(
  S.Struct({
    kind: S.Literal("purchase"),
    channel: S.Literal("store"),
    lines: S.Array(PurchaseLine).pipe(S.minItems(1), S.maxItems(50)),
  }),
  S.Struct({
    kind: S.Literal("earn"),
    channel: PromoChannel,
    base_points: Points,
    earn_type: S.Literal("award", "badge_reward", "automation", "content"),
  }),
).annotations({ identifier: "PromoContext" });
export type PromoContext = typeof PromoContext.Type;

export const PromoUsage = S.Struct({
  cost_points: Points,
  redemptions: S.Int,
  member_redemptions: S.Int,
}).annotations({ identifier: "PromoUsage" });

export const PromoCandidate = S.Struct({
  slug: S.String,
  revision: S.Int,
  spec: PromotionSpec,
  usage: PromoUsage,
  /** Segment ref -> does the member match it (the caller evaluates segments with evalCond). */
  member_in_segments: S.Record({ key: S.String, value: S.Boolean }),
  /** Group ref -> is the member in it. */
  member_in_groups: S.Record({ key: S.String, value: S.Boolean }),
  /** The member holds an unused, unexpired entitlement for this promotion. */
  entitled: S.Boolean,
  /** For free_item effects: product slug -> its current price in points, and whether it is in stock. */
  free_items: S.Record({ key: S.String, value: S.Struct({ unit_points: Points, in_stock: S.Boolean }) }),
}).annotations({ identifier: "PromoCandidate" });
export type PromoCandidate = typeof PromoCandidate.Type;

export const PromoEvalInput = S.Struct({
  now: Timestamp,
  mode: S.Literal("live", "simulate"),
  member: MemberFacts,
  context: PromoContext,
  candidates: S.Array(PromoCandidate),
}).annotations({ identifier: "PromoEvalInput" });
export type PromoEvalInput = typeof PromoEvalInput.Type;

/** Why a candidate did not apply; the first failing check in the order of CONTRACT.md 8.3 step 1. */
export const PROMO_REJECTIONS = [
  "status",
  "window",
  "channel",
  "context",
  "tier",
  "region",
  "segment",
  "group",
  "new_member",
  "filter",
  "entitlement",
  "min_cart",
  "scope",
  "per_member",
  "budget",
  "stacking",
] as const;
export const PromoRejection = S.Literal(...PROMO_REJECTIONS).annotations({ identifier: "PromoRejection" });

export const AppliedEffect = S.Struct({
  type: S.Literal("points_multiplier", "bonus_points", "store_discount", "free_item"),
  /** What the member gains: discount points, bonus points, or the free item's price. */
  benefit_points: Points,
  /** What the programme spends. Equal to benefit_points for every current effect type. */
  cost_points: Points,
  /** Per-line discount allocation for store_discount (line index -> points), or the free line for free_item. */
  lines: S.optional(S.Array(S.Struct({ line: S.Int, points: Points, product: S.String }))),
}).annotations({ identifier: "AppliedEffect" });

export const AppliedPromotion = S.Struct({
  slug: S.String,
  revision: S.Int,
  title: S.String,
  effects: S.Array(AppliedEffect),
  cost_points: Points,
}).annotations({ identifier: "AppliedPromotion" });
export type AppliedPromotion = typeof AppliedPromotion.Type;

export const PromoEvaluation = S.Struct({
  applied: S.Array(AppliedPromotion),
  rejected: S.Array(
    S.Struct({ slug: S.String, reason: PromoRejection, detail: S.String.pipe(S.maxLength(200)) }),
  ),
  /** In simulate mode, statuses that would block a live evaluation are reported here instead of rejecting. */
  advisories: S.Array(S.Struct({ slug: S.String, reason: PromoRejection, detail: S.String })),
  totals: S.Union(
    S.Struct({
      kind: S.Literal("purchase"),
      subtotal_points: Points,
      discount_points: Points,
      total_points: Points,
      bonus_points: Points,
      free_items: S.Array(S.Struct({ product: S.String, unit_points: Points })),
    }),
    S.Struct({
      kind: S.Literal("earn"),
      base_points: Points,
      bonus_points: Points,
      final_points: Points,
    }),
  ),
  /** Sum over applied promotions; what the budget counters will be charged. */
  cost_points: Points,
  /** total - subtotal for purchases, final - base for earn; for display. */
  delta_points: SignedPoints,
}).annotations({ identifier: "PromoEvaluation" });
export type PromoEvaluation = typeof PromoEvaluation.Type;

/** The signature the backend implements in `@plinth/core`. */
export type EvaluatePromotions = (input: PromoEvalInput) => PromoEvaluation;
