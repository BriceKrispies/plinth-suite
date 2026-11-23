import { Schema as S } from "effect";
import { PromotionStatus } from "../events";
import { PromotionSpec } from "../nodes";
import { PromoContext, PromoEvaluation } from "../promotions";
import { Handle, IconName, NodeLink, Points, PromotionRef, Timestamp, Tone, UserText } from "../primitives";

/** Promotions (CONTRACT.md module M6). Definitions are Promotion nodes edited through POST /changes. */

export const PromotionUsageView = S.Struct({
  redemptions: S.Int,
  cost_points: Points,
  budget_used_pct: S.NullOr(S.Number),
  members_reached: S.Int,
}).annotations({ identifier: "PromotionUsageView" });

export const PromotionSummary = S.Struct({
  node: NodeLink,
  status: PromotionStatus,
  description: S.String,
  starts_at: Timestamp,
  ends_at: Timestamp,
  priority: S.Int,
  stacking: S.Literal("stack", "exclusive"),
  effect_summary: S.String,
  eligibility_summary: S.String,
  owner: S.String,
  usage: PromotionUsageView,
  pending_approval_id: S.NullOr(S.String),
}).annotations({ identifier: "PromotionSummary" });

export const PromotionsListIn = S.Struct({ status: S.optional(S.Array(PromotionStatus)) });
export const PromotionsListOut = S.Struct({
  items: S.Array(PromotionSummary),
  status_counts: S.Record({ key: PromotionStatus, value: S.Int }),
});

export const ActivePromotion = S.Struct({
  slug: S.String,
  title: S.String,
  description: S.String,
  headline: S.NullOr(S.String),
  tone: S.NullOr(Tone),
  icon: S.NullOr(IconName),
  ends_at: Timestamp,
  effect_summary: S.String,
  channels: S.Array(S.String),
}).annotations({ identifier: "ActivePromotion" });
export const ActiveForMeOut = S.Struct({ items: S.Array(ActivePromotion) });

export const SimulateIn = S.Struct({
  /** A saved promotion, or an unsaved spec straight from the editor. */
  promotion: S.Union(PromotionRef, S.Struct({ slug: S.String, title: S.String, spec: PromotionSpec })),
  member: Handle,
  context: PromoContext,
  at: S.optional(Timestamp),
  /** Also evaluate every other active promotion, to show stacking against the live set. */
  include_live: S.optional(S.Boolean),
}).annotations({ identifier: "SimulateIn" });

export const SimulateOut = S.Struct({
  member: S.Struct({ handle: Handle, tier: S.String, region: S.String }),
  at: Timestamp,
  evaluation: PromoEvaluation,
  /** The same context with no promotions, for the before/after display. */
  baseline: PromoEvaluation,
}).annotations({ identifier: "SimulateOut" });

export const PromotionTransitionIn = S.Struct({
  slug: S.String,
  to: S.Literal("scheduled", "active", "paused", "ended", "draft"),
  reason: S.optional(UserText(280)),
  base_revision: S.Int,
}).annotations({ identifier: "PromotionTransitionIn" });

export const AnalyticsIn = S.Struct({ slug: S.String, bucket: S.optional(S.Literal("hour", "day")) });
export const AnalyticsOut = S.Struct({
  slug: S.String,
  status: PromotionStatus,
  usage: PromotionUsageView,
  benefit_points: Points,
  series: S.Array(S.Struct({ bucket: Timestamp, redemptions: S.Int, cost_points: Points })),
  by_tier: S.Record({ key: S.String, value: S.Struct({ redemptions: S.Int, cost_points: Points }) }),
  by_region: S.Record({ key: S.String, value: S.Struct({ redemptions: S.Int, cost_points: Points }) }),
  /**
   * Uplift: store orders per eligible member-day during the promotion versus an equal-length window immediately
   * before starts_at, over members eligible at evaluation time. Null until the promotion has run one full day.
   */
  uplift: S.NullOr(
    S.Struct({
      eligible_members: S.Int,
      window_days: S.Number,
      rate_before: S.Number,
      rate_during: S.Number,
      uplift_pct: S.Number,
    }),
  ),
}).annotations({ identifier: "AnalyticsOut" });
