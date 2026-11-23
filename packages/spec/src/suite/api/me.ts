import { Schema as S } from "effect";
import { DomainEventType, NavCounts } from "../events";
import { ChannelPrefs, DigestPrefs, PreferenceSpec, UiPrefs } from "../nodes";
import {
  Avatar,
  Handle,
  PageQuery,
  PersonRef,
  Points,
  Region,
  Subject,
  Tier,
  Timestamp,
  UserText,
} from "../primitives";
import { Department } from "../conditions";
import { NotificationType } from "../events";

/** Shell bootstrap, own profile, activity, sessions and preferences (CONTRACT.md module M0). */

export const TierProgress = S.Struct({
  tier: Tier,
  lifetime_points: Points,
  next_tier: S.NullOr(Tier),
  next_tier_at: S.NullOr(Points),
  /** 0..1 progress from the current tier's floor to the next tier's floor; 1 at platinum. */
  progress: S.Number.pipe(S.between(0, 1)),
}).annotations({ identifier: "TierProgress" });
export type TierProgress = typeof TierProgress.Type;

export const MemberCore = S.Struct({
  handle: Handle,
  subject: Subject,
  display_name: S.String,
  avatar: Avatar,
  title: S.String,
  department: Department,
  region: Region,
  location: S.String,
  joined_at: Timestamp,
  status: S.Literal("active", "disabled"),
}).annotations({ identifier: "MemberCore" });
export type MemberCore = typeof MemberCore.Type;

export const MeOut = S.Struct({
  principal: PersonRef,
  /** Null for agents and services: they have no member profile, balance or cart. */
  member: S.NullOr(
    S.Struct({
      ...MemberCore.fields,
      bio: S.String,
      email: S.String,
      showcase: S.Array(S.String),
    }),
  ),
  /** Set when the principal is an agent acting for a human. */
  on_behalf_of: S.NullOr(PersonRef),
  roles: S.Array(
    S.Struct({ role: S.String, title: S.String, scope: S.NullOr(S.Struct({ region: Region })) }),
  ),
  /** Effective Suite and kernel permissions (after ceiling for agents), for showing and hiding UI. Never trusted server-side. */
  permissions: S.Array(S.String),
  balance: S.NullOr(Points),
  tier: S.NullOr(TierProgress),
  counts: NavCounts,
  preferences: S.NullOr(PreferenceSpec),
  program: S.Struct({ name: S.String, currency_label: S.String }),
  virtual_now: Timestamp,
  clock: S.Struct({ speed: S.Number, paused: S.Boolean }),
  session_id: S.NullOr(S.String),
  rt: S.Struct({ head_seq: S.Int, domain_head_seq: S.Int }),
}).annotations({ identifier: "MeOut" });
export type MeOut = typeof MeOut.Type;

export const ActivityItem = S.Struct({
  seq: S.Int,
  type: DomainEventType,
  occurred_at: Timestamp,
  actor: PersonRef,
  /** A Plinth-authored sentence (no user text), e.g. "Awarded 500 points to Ana Silva". */
  summary: S.String,
  icon: S.String,
  link: S.NullOr(S.String),
}).annotations({ identifier: "ActivityItem" });
export type ActivityItem = typeof ActivityItem.Type;

export const ActivityIn = S.Struct({
  ...PageQuery,
  types: S.optional(S.Array(DomainEventType)),
}).annotations({ identifier: "ActivityIn" });

export const SessionView = S.Struct({
  session_id: S.String,
  label: S.String,
  created_at: Timestamp,
  last_seen_at: Timestamp,
  revoked_at: S.NullOr(Timestamp),
  current: S.Boolean,
  surface: S.Literal("ui", "mcp", "api"),
}).annotations({ identifier: "SessionView" });

export const SessionsOut = S.Struct({ items: S.Array(SessionView) });
export const SessionRevokeIn = S.Struct({
  session_id: S.String.pipe(S.pattern(/^ses_[A-Za-z0-9_-]{16,40}$/)),
});
export const SessionRevokeOut = S.Struct({ session_id: S.String, revoked_at: Timestamp });

export const ProfileUpdateIn = S.Struct({
  display_name: S.optional(UserText(80).pipe(S.minLength(1))),
  title: S.optional(UserText(80)),
  bio: S.optional(UserText(500)),
  location: S.optional(UserText(80)),
  avatar_hue: S.optional(S.Int.pipe(S.between(0, 359))),
  /** Up to three badge slugs the member holds, shown on their profile. */
  showcase: S.optional(S.Array(S.String).pipe(S.maxItems(3))),
}).annotations({ identifier: "ProfileUpdateIn" });

export const PreferencesOut = S.Struct({
  preferences: PreferenceSpec,
  revision: S.NullOr(S.Int),
  /** The Program defaults, to show "default" markers in the form. */
  defaults: S.Struct({
    notifications: S.Record({ key: NotificationType, value: ChannelPrefs }),
    digest: DigestPrefs,
  }),
}).annotations({ identifier: "PreferencesOut" });

/** Partial update merged into the member's Preference node (created from Program defaults if missing). */
export const PreferencesUpdateIn = S.Struct({
  notifications: S.optional(S.Record({ key: NotificationType, value: ChannelPrefs })),
  digest: S.optional(DigestPrefs),
  quiet_hours: S.optional(
    S.NullOr(S.Struct({ start_hour: S.Int.pipe(S.between(0, 23)), end_hour: S.Int.pipe(S.between(0, 23)) })),
  ),
  muted_threads: S.optional(S.Array(S.UUID).pipe(S.maxItems(200))),
  ui: S.optional(UiPrefs),
  base_revision: S.optional(S.NullOr(S.Int)),
}).annotations({ identifier: "PreferencesUpdateIn" });

export const PreferencesUpdateOut = S.Struct({
  preferences: PreferenceSpec,
  revision: S.Int,
  change_seq: S.Int,
}).annotations({ identifier: "PreferencesUpdateOut" });

export const DevPrincipal = S.Struct({
  handle: S.NullOr(Handle),
  subject: Subject,
  display_name: S.String,
  avatar: Avatar,
  roles: S.Array(S.String),
  region: S.NullOr(Region),
  /** The dev bearer token for this principal. Served only by the dev identity layer. */
  token: S.String,
  featured: S.Boolean,
}).annotations({ identifier: "DevPrincipal" });
export const DevPrincipalsOut = S.Struct({ items: S.Array(DevPrincipal) });
