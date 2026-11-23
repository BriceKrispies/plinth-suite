import { Schema as S } from "effect";
import { ORDERS_ENUMS } from "../sources";
import { Scalar } from "../query-ast";

/** Shared primitives of the Suite contract (CONTRACT.md section 1). */

/** RFC 3339 UTC timestamp with a `Z` suffix and optional fraction. Suite times are virtual-clock times. */
export const Timestamp = S.String.pipe(
  S.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/),
  S.annotations({ identifier: "Timestamp", description: "RFC 3339 UTC, e.g. 2026-11-20T14:30:00Z" }),
);
export type Timestamp = typeof Timestamp.Type;

export const DateOnly = S.String.pipe(
  S.pattern(/^\d{4}-\d{2}-\d{2}$/),
  S.annotations({ identifier: "DateOnly" }),
);

/** A member handle: the local part of `user:<handle>`. */
export const Handle = S.String.pipe(
  S.pattern(/^[a-z][a-z0-9-]{1,39}$/),
  S.annotations({ identifier: "Handle", description: "Member handle, e.g. maya-ortiz" }),
);
export type Handle = typeof Handle.Type;

export const Subject = S.String.pipe(
  S.pattern(/^(user|agent|service):[a-z0-9][a-z0-9._-]*$/),
  S.annotations({
    identifier: "Subject",
    description: "A principal: user:<handle>, agent:<name>, service:<name>",
  }),
);
export type Subject = typeof Subject.Type;

/** Who a domain event is delivered to: a principal, a role (`role:<slug>`) or everyone in the workspace (`*`). */
export const AudienceEntry = S.String.pipe(
  S.pattern(/^(\*|(user|agent|service):[a-z0-9][a-z0-9._-]*|role:[a-z][a-z0-9-]*)$/),
  S.annotations({ identifier: "AudienceEntry" }),
);

/** A recipient in compose and notification sends: a principal or a group (`group:<slug>`). */
export const Recipient = S.String.pipe(
  S.pattern(/^((user|agent|service):[a-z0-9][a-z0-9._-]*|group:[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*)$/),
  S.annotations({ identifier: "Recipient", description: "user:<handle> or group:<slug>" }),
);
export type Recipient = typeof Recipient.Type;

export const SuiteSlug = S.String.pipe(
  S.minLength(2),
  S.maxLength(63),
  S.pattern(/^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/),
  S.annotations({ identifier: "SuiteSlug" }),
);

/** Typed node references (`<lowercased kind>:<slug>`). */
const refOf = (prefix: string) =>
  S.String.pipe(
    S.pattern(new RegExp(`^${prefix}:[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$`)),
    S.annotations({ identifier: `Ref.${prefix}`, description: `${prefix}:<slug>` }),
  );
export const ProductRef = refOf("product");
export const CategoryRef = refOf("category");
export const BadgeRef = refOf("badge");
export const PromotionRef = refOf("promotion");
export const AutomationRef = refOf("automation");
export const ContentRef = refOf("content");
export const SegmentRef = refOf("segment");
export const GroupRef = refOf("group");
export const RoleRef = refOf("role");
export const PanelRef = refOf("panel");

export const Points = S.Int.pipe(S.greaterThanOrEqualTo(0), S.annotations({ identifier: "Points" }));
export const PositivePoints = S.Int.pipe(
  S.between(1, 10_000_000),
  S.annotations({ identifier: "PositivePoints" }),
);
export const SignedPoints = S.Int.pipe(S.annotations({ identifier: "SignedPoints" }));
export const Cents = S.Int.pipe(S.greaterThanOrEqualTo(0), S.annotations({ identifier: "Cents" }));

export const Cursor = S.String.pipe(S.maxLength(256), S.annotations({ identifier: "Cursor" }));
export const Limit = S.Int.pipe(
  S.between(1, 200),
  S.annotations({ identifier: "Limit", description: "Default 50" }),
);

export const IdempotencyKey = S.String.pipe(
  S.pattern(/^[A-Za-z0-9:._-]{8,128}$/),
  S.annotations({ identifier: "IdempotencyKey" }),
);

export const PageQuery = { cursor: S.optional(Cursor), limit: S.optional(Limit) } as const;

/** `{ items, next_cursor }`: every list response. */
export const Page = <A, I>(item: S.Schema<A, I>) =>
  S.Struct({ items: S.Array(item), next_cursor: S.NullOr(Cursor) });

export const TIERS = ["bronze", "silver", "gold", "platinum"] as const;
export const Tier = S.Literal(...TIERS).annotations({ identifier: "Tier" });
export type Tier = typeof Tier.Type;

export const REGIONS = ORDERS_ENUMS.region;
export const Region = S.Literal(...REGIONS).annotations({ identifier: "Region" });
export type Region = typeof Region.Type;

export const TONES = ["neutral", "info", "success", "warning", "danger", "signal"] as const;
export const Tone = S.Literal(...TONES).annotations({ identifier: "Tone" });
export type Tone = typeof Tone.Type;

/** The closed icon set the design system ships (DESIGN-SYSTEM.md, icons). Artwork and navigation use these names. */
export const ICON_NAMES = [
  "home",
  "inbox",
  "send",
  "archive",
  "star",
  "bell",
  "search",
  "command",
  "store",
  "cart",
  "bag",
  "tag",
  "gift",
  "coins",
  "wallet",
  "transfer",
  "trophy",
  "medal",
  "award",
  "crown",
  "flame",
  "bolt",
  "target",
  "megaphone",
  "percent",
  "calendar",
  "clock",
  "workflow",
  "play",
  "pause",
  "stop",
  "branch",
  "webhook",
  "document",
  "article",
  "announcement",
  "image",
  "users",
  "user",
  "group",
  "segment",
  "shield",
  "key",
  "lock",
  "chart",
  "board",
  "check",
  "check-circle",
  "x",
  "alert",
  "info",
  "task",
  "list",
  "settings",
  "sliders",
  "history",
  "audit",
  "attachment",
  "reply",
  "mention",
  "heart",
  "sparkle",
  "leaf",
  "globe",
  "truck",
  "box",
  "ticket",
  "coffee",
  "headphones",
  "laptop",
  "shirt",
  "book",
  "plant",
  "mountain",
  "sun",
  "moon",
  "plus",
  "minus",
  "edit",
  "trash",
  "copy",
  "link",
  "external",
  "filter",
  "sort",
  "more",
  "chevron-left",
  "chevron-right",
  "chevron-down",
  "chevron-up",
  "menu",
  "eye",
  "eye-off",
  "logout",
] as const;
export const IconName = S.Literal(...ICON_NAMES).annotations({ identifier: "IconName" });
export type IconName = typeof IconName.Type;

export const ARTWORK_PATTERNS = ["solid", "stripes", "dots", "rings", "grid", "waves"] as const;

/** Generated SVG artwork (no external assets): an icon on a patterned field of one hue. */
export const Artwork = S.Struct({
  icon: IconName,
  hue: S.Int.pipe(S.between(0, 359)),
  pattern: S.Literal(...ARTWORK_PATTERNS),
  glyph: S.optional(
    S.String.pipe(S.maxLength(3), S.annotations({ description: "Up to 3 characters set over the icon" })),
  ),
}).annotations({ identifier: "Artwork" });
export type Artwork = typeof Artwork.Type;

/** Avatar: generated initials on a hue. */
export const Avatar = S.Struct({
  initials: S.String.pipe(S.minLength(1), S.maxLength(2)),
  hue: S.Int.pipe(S.between(0, 359)),
}).annotations({ identifier: "Avatar" });

/** A person as every response names them. `handle` is null for agents and services. */
export const PersonRef = S.Struct({
  subject: Subject,
  handle: S.NullOr(Handle),
  display_name: S.String,
  kind: S.Literal("human", "agent", "service"),
  avatar: Avatar,
}).annotations({ identifier: "PersonRef" });
export type PersonRef = typeof PersonRef.Type;

/** A configuration node as list responses name it. */
export const NodeLink = S.Struct({
  uri: S.String,
  kind: S.String,
  slug: S.String,
  title: S.String,
  revision: S.Int,
}).annotations({ identifier: "NodeLink" });
export type NodeLink = typeof NodeLink.Type;

/**
 * Suite refusal reasons. The kernel error enum stays closed (README ruling 9): a Suite refusal is a kernel code with
 * `details.reason` set to one of these. The kernel code each one maps to is fixed in `SUITE_REASON_CODE`.
 */
export const SUITE_REASONS = [
  "INSUFFICIENT_POINTS",
  "OUT_OF_STOCK",
  "INVALID_TRANSITION",
  "BUDGET_EXHAUSTED",
  "PRICE_CHANGED",
  "ALREADY_EXISTS",
  "STALE_VERSION",
  "NOT_ELIGIBLE",
  "LIMIT_EXCEEDED",
  "SELF_ACTION",
  "NOT_PARTICIPANT",
  "MEMBER_DISABLED",
  "SESSION_REVOKED",
  "CART_EMPTY",
] as const;
export const SuiteReason = S.Literal(...SUITE_REASONS).annotations({ identifier: "SuiteReason" });
export type SuiteReason = typeof SuiteReason.Type;

export const SUITE_REASON_CODE: Record<
  SuiteReason,
  "CONFLICT" | "RULE_REFUSED" | "VALIDATION_FAILED" | "UNAUTHENTICATED"
> = {
  INSUFFICIENT_POINTS: "CONFLICT",
  OUT_OF_STOCK: "CONFLICT",
  INVALID_TRANSITION: "CONFLICT",
  BUDGET_EXHAUSTED: "CONFLICT",
  PRICE_CHANGED: "CONFLICT",
  ALREADY_EXISTS: "CONFLICT",
  STALE_VERSION: "CONFLICT",
  NOT_ELIGIBLE: "RULE_REFUSED",
  LIMIT_EXCEEDED: "RULE_REFUSED",
  SELF_ACTION: "RULE_REFUSED",
  NOT_PARTICIPANT: "RULE_REFUSED",
  MEMBER_DISABLED: "RULE_REFUSED",
  SESSION_REVOKED: "UNAUTHENTICATED",
  CART_EMPTY: "VALIDATION_FAILED",
};

/** Scalars accepted in condition values. */
export const CondScalar = Scalar;

/** Result of an operation that may be held for approval (node transitions and held actions). */
export const HeldResult = S.Struct({
  status: S.Literal("committed", "pending_approval"),
  approval_id: S.optional(S.String),
  change_seq: S.optional(S.Int),
  revision: S.optional(S.Int),
  rule_id: S.Array(S.String),
}).annotations({ identifier: "HeldResult" });
export type HeldResult = typeof HeldResult.Type;

export const Empty = S.Struct({}).annotations({ identifier: "Empty" });

/** Free text written by people. Over MCP it is returned as `{ "untrusted": "..." }` (spec 03 section 12.1). */
export const UserText = (max: number) =>
  S.String.pipe(
    S.maxLength(max),
    S.annotations({ description: `User-authored text (untrusted), at most ${max} chars` }),
  );
