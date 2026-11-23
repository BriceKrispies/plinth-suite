import { Schema as S } from "effect";
import { BadgeArtwork, BadgeCriteria, BADGE_RARITIES } from "../nodes";
import { Handle, IdempotencyKey, PersonRef, Points, Timestamp, UserText } from "../primitives";

/** Badges (CONTRACT.md module M5). */

export const BadgeProgress = S.Struct({
  current: S.Int,
  target: S.Int,
  /** 0..1; 1 when awarded. Null for manual badges and for hidden badges not yet earned. */
  ratio: S.NullOr(S.Number.pipe(S.between(0, 1))),
  label: S.String,
}).annotations({ identifier: "BadgeProgress" });

export const BadgeCard = S.Struct({
  slug: S.String,
  title: S.String,
  /** Hidden badges not yet earned show "Secret badge" and no criteria. */
  description: S.String,
  artwork: BadgeArtwork,
  rarity: S.Literal(...BADGE_RARITIES),
  points_reward: Points,
  criteria_type: S.Literal("points_threshold", "action_count", "streak", "event", "manual", "hidden"),
  holders: S.Int,
  awarded_at: S.NullOr(Timestamp),
  award_id: S.NullOr(S.UUID),
  progress: S.NullOr(BadgeProgress),
  showcased: S.Boolean,
}).annotations({ identifier: "BadgeCard" });
export type BadgeCard = typeof BadgeCard.Type;

export const BadgesCatalogIn = S.Struct({
  member: S.optional(Handle),
  filter: S.optional(S.Literal("all", "earned", "in_progress", "locked")),
});
export const BadgesCatalogOut = S.Struct({
  member: PersonRef,
  items: S.Array(BadgeCard),
  earned: S.Int,
  total: S.Int,
  next_up: S.Array(BadgeCard),
}).annotations({ identifier: "BadgesCatalogOut" });

export const BadgeIn = S.Struct({ slug: S.String });
export const AwardView = S.Struct({
  award_id: S.UUID,
  badge: S.String,
  badge_title: S.String,
  artwork: BadgeArtwork,
  member: PersonRef,
  awarded_at: Timestamp,
  awarded_by: PersonRef,
  reason: S.String,
  points_txn_id: S.NullOr(S.UUID),
  revoked_at: S.NullOr(Timestamp),
}).annotations({ identifier: "AwardView" });

export const BadgeDetailOut = S.Struct({
  card: BadgeCard,
  criteria: S.NullOr(BadgeCriteria),
  revision: S.Int,
  recent_awards: S.Array(AwardView),
  holders_by_region: S.Record({ key: S.String, value: S.Int }),
}).annotations({ identifier: "BadgeDetailOut" });

export const MemberBadgesIn = S.Struct({ handle: Handle });
export const MemberBadgesOut = S.Struct({
  member: PersonRef,
  awards: S.Array(AwardView),
  showcase: S.Array(S.String),
});

export const BadgeAwardIn = S.Struct({
  slug: S.String,
  member: Handle,
  reason: UserText(280).pipe(S.minLength(1)),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "BadgeAwardIn" });

export const BadgeRevokeIn = S.Struct({ award_id: S.UUID, reason: UserText(280).pipe(S.minLength(1)) });
