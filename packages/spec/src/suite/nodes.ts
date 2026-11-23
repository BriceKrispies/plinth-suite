import { Schema as S } from "effect";
import { LayoutAt, Metadata } from "../nodes";
import { WidgetInstanceSpec, WidgetSize } from "./widgets";
import { QueryAst, Field } from "../query-ast";
import { CondTree } from "./conditions";
import { ContentStatus, NotificationType, PromotionStatus, Reaction, TriggerableEventType } from "./events";
import {
  Artwork,
  BadgeRef,
  CategoryRef,
  Cents,
  GroupRef,
  IconName,
  PanelRef,
  Points,
  PositivePoints,
  ProductRef,
  PromotionRef,
  Recipient,
  Region,
  SegmentRef,
  Subject,
  SuiteSlug,
  Tier,
  Timestamp,
  Tone,
  UserText,
} from "./primitives";

/**
 * Suite node kinds (CONTRACT.md section 2). Every body is the kernel envelope
 * `{ apiVersion: "plinth/v1", kind, metadata: { slug, title, labels? }, spec }`, validated with
 * `onExcessProperty: "error"` like the kernel kinds, committed through the change log (preview -> commit), with history,
 * undo and approvals. Fields marked "managed" may only be written by the named action handler.
 */

const envelope = <K extends string, Spec extends S.Schema.Any>(kind: K, spec: Spec) =>
  S.Struct({
    apiVersion: S.Literal("plinth/v1"),
    kind: S.Literal(kind),
    metadata: Metadata,
    spec,
  });

// ---- Category -------------------------------------------------------------------------------------

export const CategorySpec = S.Struct({
  description: UserText(500),
  artwork: Artwork,
  sort: S.Int.pipe(S.between(0, 1000)),
  status: S.Literal("active", "hidden"),
}).annotations({ identifier: "CategorySpec" });
export const CategoryNode = envelope("Category", CategorySpec).annotations({ identifier: "Category" });

// ---- Product --------------------------------------------------------------------------------------

export const FULFILMENT_METHODS = ["ship", "pickup", "digital", "donation"] as const;
export const FulfilmentMethod = S.Literal(...FULFILMENT_METHODS).annotations({
  identifier: "FulfilmentMethod",
});

export const ProductSpec = S.Struct({
  category: CategoryRef,
  summary: UserText(280),
  description: UserText(4000),
  price_points: PositivePoints,
  /** Optional cash co-payment, recorded on the order and settled at fulfilment (no payment gateway). */
  cash_price_cents: S.optional(Cents),
  artwork: Artwork,
  attributes: S.optional(
    S.Record({
      key: S.String.pipe(S.pattern(/^[a-z][a-z0-9_]{0,31}$/)),
      value: S.String.pipe(S.maxLength(80)),
    }),
  ),
  tags: S.Array(S.String.pipe(S.pattern(/^[a-z][a-z0-9-]{0,31}$/))).pipe(S.maxItems(12)),
  status: S.Literal("draft", "active", "retired"),
  featured: S.Boolean,
  fulfilment: FulfilmentMethod,
  min_tier: S.optional(Tier),
  limit_per_member: S.optional(S.Int.pipe(S.between(1, 100))),
  /** Stock at or below this is "low" (drives stock.changed and the inventory alert). */
  low_stock_threshold: S.Int.pipe(S.between(0, 10000)),
}).annotations({ identifier: "ProductSpec" });
export type ProductSpec = typeof ProductSpec.Type;
export const ProductNode = envelope("Product", ProductSpec).annotations({ identifier: "Product" });

// ---- Badge ----------------------------------------------------------------------------------------

export const BadgeArtwork = S.Struct({
  shape: S.Literal("circle", "shield", "hexagon", "star", "ribbon"),
  icon: IconName,
  hue: S.Int.pipe(S.between(0, 359)),
  ring: S.optional(Tier),
}).annotations({ identifier: "BadgeArtwork" });

export const BadgeCriteria = S.Union(
  S.Struct({ type: S.Literal("points_threshold"), lifetime_points: PositivePoints }),
  S.Struct({
    type: S.Literal("action_count"),
    event: TriggerableEventType,
    count: S.Int.pipe(S.between(1, 10000)),
    window_days: S.optional(S.Int.pipe(S.between(1, 365))),
    filter: S.optional(CondTree),
  }),
  S.Struct({
    type: S.Literal("streak"),
    event: TriggerableEventType,
    days: S.Int.pipe(S.between(2, 365)),
    filter: S.optional(CondTree),
  }),
  S.Struct({ type: S.Literal("event"), event: TriggerableEventType, filter: S.optional(CondTree) }),
  S.Struct({ type: S.Literal("manual") }),
).annotations({ identifier: "BadgeCriteria" });
export type BadgeCriteria = typeof BadgeCriteria.Type;

export const BADGE_RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;

export const BadgeSpec = S.Struct({
  description: UserText(500),
  artwork: BadgeArtwork,
  criteria: BadgeCriteria,
  points_reward: Points,
  rarity: S.Literal(...BADGE_RARITIES),
  hidden: S.Boolean,
  sort: S.Int.pipe(S.between(0, 1000)),
  status: S.Literal("draft", "active", "retired"),
}).annotations({ identifier: "BadgeSpec" });
export type BadgeSpec = typeof BadgeSpec.Type;
export const BadgeNode = envelope("Badge", BadgeSpec).annotations({ identifier: "Badge" });

// ---- Promotion ------------------------------------------------------------------------------------

export const PROMO_CHANNELS = ["store", "recognition", "automation", "content"] as const;
export const PromoChannel = S.Literal(...PROMO_CHANNELS).annotations({ identifier: "PromoChannel" });

export const PromotionEligibility = S.Struct({
  tiers: S.optional(S.Array(Tier).pipe(S.minItems(1))),
  regions: S.optional(S.Array(Region).pipe(S.minItems(1))),
  segments: S.optional(S.Array(SegmentRef).pipe(S.minItems(1), S.maxItems(8))),
  groups: S.optional(S.Array(GroupRef).pipe(S.minItems(1), S.maxItems(8))),
  channels: S.optional(S.Array(PromoChannel).pipe(S.minItems(1))),
  new_members_days: S.optional(S.Int.pipe(S.between(1, 365))),
  min_cart_points: S.optional(PositivePoints),
  categories: S.optional(S.Array(CategoryRef).pipe(S.minItems(1), S.maxItems(12))),
  products: S.optional(S.Array(ProductRef).pipe(S.minItems(1), S.maxItems(50))),
  /** Only members holding an entitlement (granted by an automation `apply_promotion` step) qualify. */
  entitlement_only: S.optional(S.Boolean),
  /** Extra member-fact filter in the shared condition grammar. */
  filter: S.optional(CondTree),
}).annotations({ identifier: "PromotionEligibility" });

export const PromotionEffect = S.Union(
  S.Struct({
    type: S.Literal("points_multiplier"),
    factor: S.Number.pipe(S.between(1.05, 10)),
  }),
  S.Struct({
    type: S.Literal("bonus_points"),
    points: PositivePoints,
    on: S.Literal("purchase", "earn"),
  }),
  S.Struct({
    type: S.Literal("store_discount"),
    percent: S.Int.pipe(S.between(1, 90)),
    categories: S.optional(S.Array(CategoryRef).pipe(S.minItems(1))),
    products: S.optional(S.Array(ProductRef).pipe(S.minItems(1))),
    max_discount_points: S.optional(PositivePoints),
  }),
  S.Struct({
    type: S.Literal("free_item"),
    product: ProductRef,
    min_cart_points: PositivePoints,
  }),
).annotations({ identifier: "PromotionEffect" });
export type PromotionEffect = typeof PromotionEffect.Type;

export const PromotionSpec = S.Struct({
  /** Managed: changed only by promotions.transition and the scheduler. Create with "draft". */
  status: PromotionStatus,
  description: UserText(500),
  banner: S.optional(S.Struct({ headline: UserText(80), tone: Tone, icon: IconName })),
  eligibility: PromotionEligibility,
  effects: S.Array(PromotionEffect).pipe(S.minItems(1), S.maxItems(4)),
  budget: S.Struct({
    max_cost_points: S.optional(PositivePoints),
    max_redemptions: S.optional(S.Int.pipe(S.between(1, 1_000_000))),
    max_per_member: S.optional(S.Int.pipe(S.between(1, 1000))),
  }),
  schedule: S.Struct({
    starts_at: Timestamp,
    ends_at: Timestamp,
    days_of_week: S.optional(S.Array(S.Int.pipe(S.between(1, 7))).pipe(S.minItems(1), S.maxItems(7))),
    hours_utc: S.optional(S.Struct({ from: S.Int.pipe(S.between(0, 23)), to: S.Int.pipe(S.between(1, 24)) })),
  }),
  priority: S.Int.pipe(S.between(0, 1000)),
  stacking: S.Literal("stack", "exclusive"),
  stack_group: S.optional(SuiteSlug),
  owner: Subject,
}).annotations({ identifier: "PromotionSpec" });
export type PromotionSpec = typeof PromotionSpec.Type;
export const PromotionNode = envelope("Promotion", PromotionSpec).annotations({ identifier: "Promotion" });

// ---- Automation -----------------------------------------------------------------------------------

/** Five-field cron over the virtual clock in UTC: minute hour day-of-month month day-of-week (1-7, Monday = 1). */
export const Cron = S.String.pipe(
  S.pattern(/^(\S+\s+){4}\S+$/),
  S.annotations({ identifier: "Cron", description: "m h dom mon dow, UTC virtual time, e.g. '0 9 * * 1'" }),
);

export const AutomationTrigger = S.Union(
  S.Struct({ type: S.Literal("event"), event: TriggerableEventType, filter: S.optional(CondTree) }),
  S.Struct({ type: S.Literal("schedule"), cron: Cron }),
  S.Struct({
    type: S.Literal("metric"),
    query: QueryAst,
    /** The column of the query's last row compared with the threshold. */
    value_column: Field,
    op: S.Literal("gt", "gte", "lt", "lte"),
    threshold: S.Number,
    /** The condition must hold on consecutive evaluations spanning this many virtual minutes. */
    for_minutes: S.Int.pipe(S.between(0, 1440)),
    every_minutes: S.Int.pipe(S.between(1, 1440)),
  }),
).annotations({ identifier: "AutomationTrigger" });
export type AutomationTrigger = typeof AutomationTrigger.Type;

/**
 * Template strings in step inputs may contain `{{path}}` placeholders over the run context (`event.*`, `member.*`,
 * `run.id`, `now`). Substitution is plain text, never evaluation. A target written `$member` is the event's member.
 */
export const Target = S.Union(Recipient, S.Literal("$member", "$actor", "$owner")).annotations({
  identifier: "AutomationTarget",
});

export const STEP_TYPES = [
  "award_points",
  "notify",
  "send_message",
  "apply_promotion",
  "create_task",
  "webhook",
] as const;

const stepBase = {
  id: S.String.pipe(S.pattern(/^[a-z][a-z0-9-]{0,31}$/)),
  when: S.optional(CondTree),
  on_error: S.Literal("stop", "continue"),
};

export const AutomationStep = S.Union(
  S.Struct({
    ...stepBase,
    type: S.Literal("award_points"),
    to: S.Union(S.Literal("$member", "$actor"), Subject),
    points: PositivePoints,
    memo: S.String.pipe(S.maxLength(200)),
  }),
  S.Struct({
    ...stepBase,
    type: S.Literal("notify"),
    to: S.Array(Target).pipe(S.minItems(1), S.maxItems(20)),
    notification_type: NotificationType,
    title: S.String.pipe(S.maxLength(140)),
    body: S.String.pipe(S.maxLength(500)),
    link: S.optional(S.String.pipe(S.pattern(/^\/[A-Za-z0-9/_.:?=&%{}-]*$/))),
  }),
  S.Struct({
    ...stepBase,
    type: S.Literal("send_message"),
    to: S.Array(Target).pipe(S.minItems(1), S.maxItems(20)),
    subject: S.String.pipe(S.maxLength(140)),
    body: S.String.pipe(S.maxLength(4000)),
  }),
  S.Struct({
    ...stepBase,
    type: S.Literal("apply_promotion"),
    promotion: PromotionRef,
    to: S.Literal("$member", "$actor"),
    expires_in_days: S.Int.pipe(S.between(1, 365)),
  }),
  S.Struct({
    ...stepBase,
    type: S.Literal("create_task"),
    title: S.String.pipe(S.maxLength(140)),
    description: S.optional(S.String.pipe(S.maxLength(2000))),
    assignee: S.Union(Subject, S.Literal("$owner", "$member")),
    priority: S.Literal("low", "normal", "high", "urgent"),
    due_in_days: S.optional(S.Int.pipe(S.between(0, 90))),
  }),
  S.Struct({
    ...stepBase,
    type: S.Literal("webhook"),
    /** A label for the recorded delivery. Webhooks are a stub: the payload is recorded in webhook_deliveries, never sent. */
    target_label: S.String.pipe(S.pattern(/^[a-z][a-z0-9-]{1,40}$/)),
    payload: S.Record({ key: S.String.pipe(S.maxLength(64)), value: S.String.pipe(S.maxLength(500)) }),
  }),
).annotations({ identifier: "AutomationStep" });
export type AutomationStep = typeof AutomationStep.Type;

export const AutomationSpec = S.Struct({
  /** Agents create automations disabled; enabling is held for approval (R-AUTOMATION-ENABLE). */
  enabled: S.Boolean,
  description: UserText(500),
  trigger: AutomationTrigger,
  conditions: S.optional(CondTree),
  steps: S.Array(AutomationStep).pipe(S.minItems(1), S.maxItems(10)),
  limits: S.Struct({
    max_runs_per_member_per_day: S.optional(S.Int.pipe(S.between(1, 100))),
    cooldown_minutes: S.optional(S.Int.pipe(S.between(1, 10080))),
  }),
  /** Steps execute as service:automation on behalf of the owner, inside the owner's grants. */
  owner: Subject,
}).annotations({ identifier: "AutomationSpec" });
export type AutomationSpec = typeof AutomationSpec.Type;
export const AutomationNode = envelope("Automation", AutomationSpec).annotations({
  identifier: "Automation",
});

// ---- Content --------------------------------------------------------------------------------------

/** Inline text: plain text with three marks only, `**bold**`, `_emphasis_`, and `@handle` mentions. Never HTML. */
const Inline = (max: number) => UserText(max);

export const ContentBlock = S.Union(
  S.Struct({ type: S.Literal("heading"), level: S.Literal(2, 3), text: Inline(140) }),
  S.Struct({ type: S.Literal("paragraph"), text: Inline(4000) }),
  S.Struct({
    type: S.Literal("list"),
    ordered: S.Boolean,
    items: S.Array(Inline(500)).pipe(S.minItems(1), S.maxItems(30)),
  }),
  S.Struct({ type: S.Literal("quote"), text: Inline(1000), cite: S.optional(Inline(140)) }),
  S.Struct({ type: S.Literal("callout"), tone: Tone, icon: IconName, text: Inline(1000) }),
  S.Struct({
    type: S.Literal("image"),
    artwork: Artwork,
    alt: UserText(200),
    caption: S.optional(UserText(280)),
  }),
  S.Struct({ type: S.Literal("divider") }),
  S.Struct({
    type: S.Literal("cta"),
    label: UserText(60),
    /** An app route (UI-MAP.md), never an external URL. */
    href: S.String.pipe(S.pattern(/^\/[A-Za-z0-9/_.:?=&%-]*$/)),
  }),
  S.Struct({ type: S.Literal("panel"), panel: PanelRef, dashboard: S.optional(S.String) }),
  S.Struct({ type: S.Literal("products"), products: S.Array(ProductRef).pipe(S.minItems(1), S.maxItems(8)) }),
  S.Struct({ type: S.Literal("badge"), badge: BadgeRef }),
).annotations({ identifier: "ContentBlock" });
export type ContentBlock = typeof ContentBlock.Type;

export const ReviewNote = S.Struct({
  by: Subject,
  at: Timestamp,
  decision: S.Literal("submitted", "approved", "changes_requested", "published", "archived", "revised"),
  note: S.optional(UserText(500)),
  revision: S.Int,
});

export const ContentSpec = S.Struct({
  type: S.Literal("page", "article", "announcement"),
  /** Managed by content.transition. Create with "draft". */
  status: ContentStatus,
  summary: UserText(280),
  hero: Artwork,
  blocks: S.Array(ContentBlock).pipe(S.minItems(1), S.maxItems(60)),
  tags: S.Array(S.String.pipe(S.pattern(/^[a-z][a-z0-9-]{0,31}$/))).pipe(S.maxItems(10)),
  audience: S.Struct({
    everyone: S.Boolean,
    segments: S.optional(S.Array(SegmentRef).pipe(S.maxItems(8))),
    groups: S.optional(S.Array(GroupRef).pipe(S.maxItems(8))),
  }),
  author: Subject,
  reviewers: S.Array(Subject).pipe(S.maxItems(5)),
  schedule: S.Struct({ publish_at: S.optional(Timestamp), unpublish_at: S.optional(Timestamp) }),
  pinned: S.Boolean,
  allow_reactions: S.Boolean,
  reactions_enabled: S.optional(S.Array(Reaction)),
  /** Managed: the revision the feed serves. Set by publish; kept while a published page is revised as a draft. */
  published_revision: S.NullOr(S.Int.pipe(S.greaterThanOrEqualTo(1))),
  /** Managed: append-only workflow trail written by content.transition. */
  review_log: S.Array(ReviewNote).pipe(S.maxItems(200)),
}).annotations({ identifier: "ContentSpec" });
export type ContentSpec = typeof ContentSpec.Type;
export const ContentNode = envelope("Content", ContentSpec).annotations({ identifier: "Content" });

// ---- Segment --------------------------------------------------------------------------------------

export const SegmentSpec = S.Struct({
  description: UserText(500),
  /** Over MemberFacts (conditions.ts MEMBER_FACTS). Membership is evaluated live; it is never stored. */
  rule: CondTree,
  owner: Subject,
}).annotations({ identifier: "SegmentSpec" });
export type SegmentSpec = typeof SegmentSpec.Type;
export const SegmentNode = envelope("Segment", SegmentSpec).annotations({ identifier: "Segment" });

// ---- Group ----------------------------------------------------------------------------------------

export const GroupSpec = S.Struct({
  description: UserText(500),
  type: S.Literal("team", "region", "interest", "distribution"),
  members: S.Array(Subject).pipe(S.maxItems(500)),
  managers: S.Array(Subject).pipe(S.maxItems(20)),
  /** When false only managers may address the group in messages. */
  open_posting: S.Boolean,
  artwork: Artwork,
}).annotations({ identifier: "GroupSpec" });
export type GroupSpec = typeof GroupSpec.Type;
export const GroupNode = envelope("Group", GroupSpec).annotations({ identifier: "Group" });

// ---- Role -----------------------------------------------------------------------------------------

export const RoleMember = S.Struct({
  subject: Subject,
  /** Narrows every grant the member inherits from this role: the Authorizer ANDs `region = '<region>'`. */
  scope: S.optional(S.Struct({ region: Region })),
}).annotations({ identifier: "RoleMember" });

export const RoleSpec = S.Struct({
  description: UserText(500),
  members: S.Array(RoleMember).pipe(S.maxItems(1000)),
  /** Seeded roles are system roles: they cannot be deleted (R-ROLE refuses a delete). */
  system: S.Boolean,
}).annotations({ identifier: "RoleSpec" });
export type RoleSpec = typeof RoleSpec.Type;
export const RoleNode = envelope("Role", RoleSpec).annotations({ identifier: "Role" });

// ---- Preference -----------------------------------------------------------------------------------

export const ChannelPrefs = S.Struct({ in_app: S.Boolean, email: S.Boolean, digest: S.Boolean }).annotations({
  identifier: "ChannelPrefs",
});

export const DigestPrefs = S.Struct({
  frequency: S.Literal("off", "daily", "weekly"),
  hour_utc: S.Int.pipe(S.between(0, 23)),
  weekday: S.optional(S.Int.pipe(S.between(1, 7))),
}).annotations({ identifier: "DigestPrefs" });

export const UiPrefs = S.Struct({
  theme: S.Literal("auto", "light", "dark"),
  density: S.Literal("comfortable", "compact"),
  reduced_motion: S.Boolean,
  home_widgets: S.optional(S.Array(S.String.pipe(S.pattern(/^[a-z][a-z0-9-]{1,40}$/))).pipe(S.maxItems(16))),
}).annotations({ identifier: "UiPrefs" });

/** Slug `prefs.<handle>`. Only the owner writes it (grant `owner_only`, rule R-PREFERENCE). Created from the Program defaults with every type present. */
export const PreferenceSpec = S.Struct({
  owner: Subject,
  notifications: S.Record({ key: NotificationType, value: ChannelPrefs }),
  digest: DigestPrefs,
  quiet_hours: S.optional(
    S.Struct({ start_hour: S.Int.pipe(S.between(0, 23)), end_hour: S.Int.pipe(S.between(0, 23)) }),
  ),
  muted_threads: S.Array(S.UUID).pipe(S.maxItems(200)),
  ui: UiPrefs,
}).annotations({ identifier: "PreferenceSpec" });
export type PreferenceSpec = typeof PreferenceSpec.Type;
export const PreferenceNode = envelope("Preference", PreferenceSpec).annotations({
  identifier: "Preference",
});

// ---- Program --------------------------------------------------------------------------------------

export const TierDef = S.Struct({
  tier: Tier,
  min_lifetime_points: Points,
  perks: S.Array(UserText(120)).pipe(S.maxItems(6)),
  artwork: Artwork,
}).annotations({ identifier: "TierDef" });

/** The singleton loyalty and engagement policy, slug `rewards`. Every change is held for approval (R-PROGRAM). */
export const SITE_LOOKS = ["calm", "meridian", "nocturne", "folio", "lattice", "strata"] as const;
/** Which frontend a viewer who follows the site gets: the classic site or the Township GPU site. Absent means classic. */
export const SITE_EXPERIENCES = ["classic", "town"] as const;
export const SiteAppearance = S.Struct({
  look: S.Literal(...SITE_LOOKS),
  density: S.optional(S.Literal("comfortable", "compact")),
  experience: S.optional(S.Literal(...SITE_EXPERIENCES)),
}).annotations({ identifier: "SiteAppearance" });
export type SiteAppearance = typeof SiteAppearance.Type;

export const ProgramSpec = S.Struct({
  name: UserText(80),
  currency_label: S.String.pipe(S.maxLength(20)),
  tiers: S.Array(TierDef).pipe(S.itemsCount(4)),
  expiry: S.Struct({
    months: S.Int.pipe(S.between(1, 60)),
    warn_days: S.Array(S.Int.pipe(S.between(1, 90))).pipe(S.maxItems(3)),
  }),
  transfer: S.Struct({
    enabled: S.Boolean,
    min_points: PositivePoints,
    max_per_transfer: PositivePoints,
    max_per_day: PositivePoints,
  }),
  awards: S.Struct({
    /** A single manager award above this many points per recipient is held for finance approval. */
    manager_max_per_award: PositivePoints,
    max_recipients: S.Int.pipe(S.between(1, 50)),
  }),
  store: S.Struct({
    /** Orders at or above this total need store:approve before fulfilment. */
    high_value_threshold_points: PositivePoints,
    cancel_window_minutes: S.Int.pipe(S.between(0, 10080)),
    max_cart_lines: S.Int.pipe(S.between(1, 50)),
    max_qty_per_line: S.Int.pipe(S.between(1, 10)),
  }),
  messaging: S.Struct({
    /** Sends whose expanded recipient count reaches this need messages:broadcast. */
    broadcast_min_recipients: S.Int.pipe(S.between(2, 1000)),
    max_recipients: S.Int.pipe(S.between(1, 1000)),
  }),
  notification_defaults: S.Record({ key: NotificationType, value: ChannelPrefs }),
  digest_default: DigestPrefs,
  /** The site's look and density (`site.appearance.set`). Absent means `calm` and `comfortable`. */
  appearance: S.optional(SiteAppearance),
}).annotations({ identifier: "ProgramSpec" });
export type ProgramSpec = typeof ProgramSpec.Type;
export const ProgramNode = envelope("Program", ProgramSpec).annotations({ identifier: "Program" });

// ---- Widget (instance) and Page ------------------------------------------------------------------

/**
 * A configured widget instance (CONTRACT.md section 5A). The kernel Panel generalised: `spec.widget` names a catalogue
 * widget (`store.catalog`, `reporting.bar`, ...) and `spec.config` is checked by that widget's config schema.
 */
export const WidgetNode = envelope("Widget", WidgetInstanceSpec).annotations({ identifier: "Widget" });

export const PageItem = S.Struct({
  /** `widget:<slug>` (a Widget node) or `panel:<slug>` (a kernel Panel, rendered by reporting.panel). */
  item: S.String.pipe(S.pattern(/^(widget|panel):[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/)),
  at: LayoutAt,
  /** The size variant passed to the widget; defaults from the footprint (the largest variant that fits `at`). */
  size: S.optional(WidgetSize),
}).annotations({ identifier: "PageItem" });

export const PageNav = S.Struct({
  section: S.Literal("personal", "engage", "rewards", "operate", "insight", "admin"),
  label: S.String.pipe(S.maxLength(40)),
  icon: IconName,
  order: S.Int.pipe(S.between(0, 1000)),
  /** NavCounts field that drives this item's count badge. */
  count: S.optional(
    S.Literal(
      "notifications_unread",
      "messages_unread",
      "approvals_pending",
      "tasks_open",
      "cart_items",
      "content_reviews",
      "orders_attention",
    ),
  ),
  permission: S.optional(S.String),
}).annotations({ identifier: "PageNav" });

export const PageSpec = S.Struct({
  kind: S.Literal("module", "home", "profile", "custom", "personal"),
  description: UserText(280),
  /**
   * The app route this page serves, with `:param` segments (`/store/p/:slug`). Custom pages without a route are served
   * at `/p/<slug>`. Unique among non-personal pages.
   */
  route: S.optional(S.String.pipe(S.pattern(/^\/[a-z0-9/:_-]*$/))),
  /** Personal pages only: the member who owns it (owner_only grants). */
  owner: S.optional(Subject),
  /** A personal page records the default it was copied from, for "reset to default". */
  based_on: S.optional(S.String.pipe(S.pattern(/^page:[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/))),
  /** Seeded module pages are system pages: agents' edits are held (R-PAGE-SYSTEM); they cannot be deleted. */
  system: S.Boolean,
  nav: S.optional(PageNav),
  layout: S.Struct({
    columns: S.Literal(12),
    items: S.Array(PageItem).pipe(S.maxItems(40)),
  }),
}).annotations({ identifier: "PageSpec" });
export type PageSpec = typeof PageSpec.Type;
export const PageNode = envelope("Page", PageSpec).annotations({ identifier: "Page" });

// ---- lookup ---------------------------------------------------------------------------------------

export const SUITE_NODE_SCHEMAS = {
  Product: ProductNode,
  Category: CategoryNode,
  Badge: BadgeNode,
  Promotion: PromotionNode,
  Automation: AutomationNode,
  Content: ContentNode,
  Segment: SegmentNode,
  Group: GroupNode,
  Role: RoleNode,
  Preference: PreferenceNode,
  Program: ProgramNode,
  Widget: WidgetNode,
  Page: PageNode,
} as const;

export type ProductBody = typeof ProductNode.Type;
export type CategoryBody = typeof CategoryNode.Type;
export type BadgeBody = typeof BadgeNode.Type;
export type PromotionBody = typeof PromotionNode.Type;
export type AutomationBody = typeof AutomationNode.Type;
export type ContentBody = typeof ContentNode.Type;
export type SegmentBody = typeof SegmentNode.Type;
export type GroupBody = typeof GroupNode.Type;
export type RoleBody = typeof RoleNode.Type;
export type PreferenceBody = typeof PreferenceNode.Type;
export type ProgramBody = typeof ProgramNode.Type;
export type WidgetBody = typeof WidgetNode.Type;
export type PageBody = typeof PageNode.Type;

export type SuiteNodeBody =
  | ProductBody
  | CategoryBody
  | BadgeBody
  | PromotionBody
  | AutomationBody
  | ContentBody
  | SegmentBody
  | GroupBody
  | RoleBody
  | PreferenceBody
  | ProgramBody
  | WidgetBody
  | PageBody;

/** The body schema for a Suite kind, or undefined for a kernel kind. `validate.ts` falls through to this. */
export const suiteBodySchemaFor = (kind: string) =>
  (SUITE_NODE_SCHEMAS as Record<string, S.Schema.AnyNoContext>)[kind];
