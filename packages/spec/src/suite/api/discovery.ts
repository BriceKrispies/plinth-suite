import { Schema as S } from "effect";
import { FactDef } from "../conditions";
import { DOMAIN_EVENT_PAYLOADS, NavCounts, NotificationType, TriggerableEventType } from "../events";
import { STEP_TYPES } from "../nodes";
import { TierProgress, ActivityItem } from "./me";
import { BadgeCard } from "./badges";
import { FeedItem } from "./content";
import { OrderSummary } from "./store";
import { ActivePromotion } from "./promotions";
import { TaskSummary } from "./work";
import { Artwork, Avatar, IconName, PersonRef, Points, Timestamp, Tone } from "../primitives";

/** Home, global search, calendar and the builder catalogue (CONTRACT.md modules M14, M15, M16, M17). */

// ---- home -----------------------------------------------------------------------------------------

export const HomeOut = S.Struct({
  me: S.NullOr(
    S.Struct({
      person: PersonRef,
      balance: Points,
      tier: TierProgress,
      expiring_30d: Points,
      recent_orders: S.Array(OrderSummary),
      next_badges: S.Array(BadgeCard),
      tasks_due: S.Array(TaskSummary),
    }),
  ),
  counts: NavCounts,
  promotions: S.Array(ActivePromotion),
  feed: S.Array(FeedItem),
  org: S.Struct({
    points_issued_today: Points,
    points_redeemed_today: Points,
    orders_today: S.Int,
    active_members_7d: S.Int,
    members_total: S.Int,
    badges_awarded_7d: S.Int,
    /** Last 14 virtual days, oldest first. */
    series_14d: S.Struct({
      days: S.Array(S.String),
      issued: S.Array(S.Int),
      redeemed: S.Array(S.Int),
      orders: S.Array(S.Int),
    }),
  }),
  activity: S.Array(ActivityItem),
  virtual_now: Timestamp,
}).annotations({ identifier: "HomeOut" });

// ---- search ---------------------------------------------------------------------------------------

export const SEARCH_TYPES = [
  "person",
  "group",
  "product",
  "badge",
  "content",
  "promotion",
  "automation",
  "segment",
  "order",
  "task",
  "thread",
  "dashboard",
] as const;
export const SearchType = S.Literal(...SEARCH_TYPES).annotations({ identifier: "SearchType" });

export const SearchHit = S.Struct({
  type: SearchType,
  id: S.String,
  title: S.String,
  subtitle: S.String,
  href: S.String,
  icon: IconName,
  avatar: S.NullOr(Avatar),
  artwork: S.NullOr(Artwork),
  score: S.Number,
}).annotations({ identifier: "SearchHit" });

export const SearchIn = S.Struct({
  q: S.String.pipe(S.minLength(1), S.maxLength(120)),
  types: S.optional(S.Array(SearchType)),
  limit: S.optional(S.Int.pipe(S.between(1, 20))),
}).annotations({ identifier: "SearchIn", description: "limit is per type (default 5)" });
export const SearchOut = S.Struct({
  q: S.String,
  groups: S.Array(S.Struct({ type: SearchType, total: S.Int, items: S.Array(SearchHit) })),
}).annotations({ identifier: "SearchOut" });

// ---- calendar -------------------------------------------------------------------------------------

export const CALENDAR_TYPES = ["promotion", "content", "automation", "expiry", "task"] as const;
export const CalendarEntry = S.Struct({
  id: S.String,
  type: S.Literal(...CALENDAR_TYPES),
  title: S.String,
  starts_at: Timestamp,
  ends_at: S.NullOr(Timestamp),
  status: S.String,
  tone: Tone,
  icon: IconName,
  href: S.String,
}).annotations({ identifier: "CalendarEntry" });
export const CalendarIn = S.Struct({
  from: Timestamp,
  to: Timestamp,
  types: S.optional(S.Array(S.Literal(...CALENDAR_TYPES))),
}).annotations({ identifier: "CalendarIn", description: "to - from at most 62 days" });
export const CalendarOut = S.Struct({ items: S.Array(CalendarEntry), virtual_now: Timestamp });

// ---- builder catalogue ----------------------------------------------------------------------------

export const CatalogOut = S.Struct({
  member_facts: S.Array(FactDef),
  events: S.Array(
    S.Struct({
      type: TriggerableEventType,
      label: S.String,
      /** Payload facts addressable as event.<path> in filters, conditions and templates. */
      fields: S.Array(FactDef),
      has_member: S.Boolean,
    }),
  ),
  step_types: S.Array(S.Struct({ type: S.Literal(...STEP_TYPES), label: S.String, permission: S.String })),
  notification_types: S.Array(S.Struct({ type: NotificationType, label: S.String })),
  icons: S.Array(IconName),
  sources: S.Array(S.Struct({ slug: S.String, title: S.String, time_column: S.String })),
}).annotations({ identifier: "CatalogOut" });

/** Exposed so the catalogue endpoint and docs can list payload fields per event type. */
export const EVENT_PAYLOAD_SCHEMAS = DOMAIN_EVENT_PAYLOADS;
