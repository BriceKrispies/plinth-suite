import { Schema as S } from "effect";
import { CondTree, MemberFacts } from "../conditions";
import { GroupSpec } from "../nodes";
import { MemberCore, TierProgress } from "./me";
import { BadgeCard } from "./badges";
import {
  Artwork,
  Handle,
  NodeLink,
  PageQuery,
  PersonRef,
  Points,
  Region,
  SegmentRef,
  Tier,
  Timestamp,
} from "../primitives";

/** People, groups and segments (CONTRACT.md module M9). */

export const MemberCard = S.Struct({
  person: PersonRef,
  title: S.String,
  department: S.String,
  region: Region,
  tier: Tier,
  badges_count: S.Int,
  last_active_at: S.NullOr(Timestamp),
  status: S.Literal("active", "disabled"),
}).annotations({ identifier: "MemberCard" });
export type MemberCard = typeof MemberCard.Type;

export const DirectoryIn = S.Struct({
  q: S.optional(S.String.pipe(S.maxLength(80))),
  region: S.optional(Region),
  tier: S.optional(Tier),
  department: S.optional(S.String),
  group: S.optional(S.String),
  role: S.optional(S.String),
  sort: S.optional(S.Literal("name", "tier", "recent", "points")),
  ...PageQuery,
}).annotations({ identifier: "DirectoryIn" });
export const DirectoryOut = S.Struct({
  items: S.Array(MemberCard),
  next_cursor: S.NullOr(S.String),
  total: S.Int,
});

export const ProfileIn = S.Struct({ handle: Handle });
export const ProfileOut = S.Struct({
  member: MemberCore,
  bio: S.String,
  tier: TierProgress,
  /** Balance is shown to the member themself and to points:view-all; null otherwise. */
  balance: S.NullOr(Points),
  showcase: S.Array(BadgeCard),
  badges_count: S.Int,
  groups: S.Array(NodeLink),
  roles: S.Array(S.String),
  stats: S.Struct({
    points_earned_30d: Points,
    orders_total: S.Int,
    reviews: S.Int,
    content_published: S.Int,
    awards_given_30d: S.Int,
  }),
  /** Present only for the member themself and people:view-private. */
  private: S.NullOr(
    S.Struct({ email: S.String, sessions_active: S.Int, last_active_at: S.NullOr(Timestamp) }),
  ),
  is_self: S.Boolean,
}).annotations({ identifier: "ProfileOut" });

export const SegmentPreviewIn = S.Struct({
  rule: S.optional(CondTree),
  segment: S.optional(SegmentRef),
  sample: S.optional(S.Int.pipe(S.between(0, 50))),
}).annotations({ identifier: "SegmentPreviewIn", description: "Exactly one of rule or segment." });

export const SegmentPreviewOut = S.Struct({
  count: S.Int,
  total_members: S.Int,
  sample: S.Array(MemberCard),
  by_tier: S.Record({ key: Tier, value: S.Int }),
  by_region: S.Record({ key: Region, value: S.Int }),
  /** Promotions and content that reference this segment (only when `segment` was given). */
  used_by: S.Array(NodeLink),
}).annotations({ identifier: "SegmentPreviewOut" });

export const SegmentSummary = S.Struct({
  node: NodeLink,
  description: S.String,
  count: S.Int,
  owner: S.String,
  used_by: S.Int,
}).annotations({ identifier: "SegmentSummary" });
export const SegmentsListOut = S.Struct({ items: S.Array(SegmentSummary) });
export const SegmentMembersIn = S.Struct({ slug: S.String, ...PageQuery });
export const SegmentMembersOut = S.Struct({
  items: S.Array(MemberCard),
  next_cursor: S.NullOr(S.String),
  count: S.Int,
});

export const GroupSummary = S.Struct({
  node: NodeLink,
  type: GroupSpec.fields.type,
  description: S.String,
  member_count: S.Int,
  artwork: Artwork,
  is_member: S.Boolean,
  is_manager: S.Boolean,
}).annotations({ identifier: "GroupSummary" });
export const GroupsListOut = S.Struct({ items: S.Array(GroupSummary) });
export const GroupIn = S.Struct({ slug: S.String });
export const GroupOut = S.Struct({
  summary: GroupSummary,
  spec: GroupSpec,
  members: S.Array(MemberCard),
  managers: S.Array(PersonRef),
});

/** Member facts as the backend computes them, for the builders' live preview against one member. */
export const FactsIn = S.Struct({ handle: Handle });
export const FactsOut = S.Struct({ facts: MemberFacts });
