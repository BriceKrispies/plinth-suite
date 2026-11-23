import type { SuiteKind } from "./kinds";
import type {
  AutomationBody,
  BadgeBody,
  CategoryBody,
  ContentBody,
  GroupBody,
  PageBody,
  PreferenceBody,
  ProductBody,
  ProgramBody,
  PromotionBody,
  RoleBody,
  SegmentBody,
  WidgetBody,
} from "./nodes";
import type { NotificationType } from "./events";

/**
 * One valid document per Suite kind, served by `schema.describe(kind)` and decoded by the spec tests so an example
 * cannot drift from its schema. They double as seed fixtures (the seed's first item per kind).
 */

export const SUITE_KIND_PURPOSE: Record<SuiteKind, string> = {
  Product:
    "A store reward priced in points (optional cash). Stock lives in the store tables; restock with action store inventory.adjust.",
  Category: "A store category grouping products.",
  Badge:
    "A badge definition: artwork, criteria (points threshold, action count, streak, event, manual) and reward.",
  Promotion:
    "A configurable promotion: eligibility, effects, budget, schedule, stacking. Create as draft; activate with action promotions.transition (held for approval).",
  Automation:
    "A workflow: trigger (event, schedule, metric), conditions and steps. Create disabled; dry-run with automation.dry_run; enabling is held for approval.",
  Content:
    "A CMS page, article or announcement made of blocks. Create as draft; move through review with action content.transition.",
  Segment:
    "A rule over member facts (tier, region, points, activity) used by promotions, content and automations.",
  Group: "A named set of people used as a message recipient and content audience.",
  Role: "A set of members; grants whose principal is role:<slug> apply to every member. Changes are held for approval.",
  Preference: "One member's notification and UI preferences (slug prefs.<handle>). Only the owner writes it.",
  Program:
    "The singleton rewards policy (slug rewards): tiers, expiry, transfer limits, thresholds. Changes are held.",
  Widget:
    "A configured widget instance: spec.widget names a catalogue widget (store.catalog, reporting.bar, messaging.inbox, ...) and spec.config follows that widget's config schema (schema.describe lists them). Place it on a Page.",
  Page: "A page: a 12-column layout of Widget instances (and kernel Panels), optionally serving an app route and appearing in the navigation. Module pages are system pages.",
};

const ALL_ON = { in_app: true, email: false, digest: true };
export const DEFAULT_NOTIFICATION_PREFS: Record<
  NotificationType,
  { in_app: boolean; email: boolean; digest: boolean }
> = {
  mention: { in_app: true, email: true, digest: true },
  message: { in_app: true, email: false, digest: true },
  approval_request: { in_app: true, email: true, digest: true },
  approval_decision: ALL_ON,
  points_awarded: ALL_ON,
  points_expiring: { in_app: true, email: true, digest: true },
  badge_earned: ALL_ON,
  tier_changed: { in_app: true, email: true, digest: true },
  order_status: ALL_ON,
  automation_alert: ALL_ON,
  content_review: { in_app: true, email: true, digest: true },
  content_published: { in_app: true, email: false, digest: true },
  task_assigned: { in_app: true, email: true, digest: true },
  promotion_started: { in_app: true, email: false, digest: true },
  system: ALL_ON,
};

export const SUITE_EXAMPLES = {
  Category: {
    apiVersion: "plinth/v1",
    kind: "Category",
    metadata: { slug: "apparel", title: "Apparel" },
    spec: {
      description: "Northwind-branded clothing and accessories.",
      artwork: { icon: "shirt", hue: 212, pattern: "stripes" },
      sort: 10,
      status: "active",
    },
  } satisfies CategoryBody,
  Product: {
    apiVersion: "plinth/v1",
    kind: "Product",
    metadata: { slug: "fleece-quarter-zip", title: "Fleece quarter-zip" },
    spec: {
      category: "category:apparel",
      summary: "Midweight recycled fleece with the Northwind mark.",
      description: "Recycled polyester fleece, quarter zip, embroidered chest mark. Sizes XS to XXL.",
      price_points: 4200,
      artwork: { icon: "shirt", hue: 212, pattern: "dots", glyph: "NW" },
      attributes: { material: "recycled fleece", sizes: "XS-XXL" },
      tags: ["warm", "bestseller"],
      status: "active",
      featured: true,
      fulfilment: "ship",
      low_stock_threshold: 5,
    },
  } satisfies ProductBody,
  Badge: {
    apiVersion: "plinth/v1",
    kind: "Badge",
    metadata: { slug: "first-redemption", title: "First redemption" },
    spec: {
      description: "Placed a first order in the rewards store.",
      artwork: { shape: "circle", icon: "bag", hue: 150 },
      criteria: { type: "event", event: "order.placed" },
      points_reward: 100,
      rarity: "common",
      hidden: false,
      sort: 20,
      status: "active",
    },
  } satisfies BadgeBody,
  Promotion: {
    apiVersion: "plinth/v1",
    kind: "Promotion",
    metadata: { slug: "gold-double-points", title: "Double points for Gold and Platinum" },
    spec: {
      status: "draft",
      description: "Recognition awards earn double points for Gold and Platinum members during peak season.",
      banner: { headline: "Double points this week", tone: "signal", icon: "bolt" },
      eligibility: { tiers: ["gold", "platinum"], channels: ["recognition"] },
      effects: [{ type: "points_multiplier", factor: 2 }],
      budget: { max_cost_points: 250000, max_per_member: 10 },
      schedule: { starts_at: "2026-11-23T00:00:00Z", ends_at: "2026-11-30T00:00:00Z" },
      priority: 500,
      stacking: "exclusive",
      owner: "user:marketing-lead",
    },
  } satisfies PromotionBody,
  Automation: {
    apiVersion: "plinth/v1",
    kind: "Automation",
    metadata: { slug: "welcome-first-order", title: "Thank members for their first order" },
    spec: {
      enabled: false,
      description:
        "When a member places their first store order, award 150 points and send a thank-you message.",
      trigger: { type: "event", event: "order.placed" },
      conditions: { field: "member.orders_90d", op: "eq", value: 1 },
      steps: [
        {
          id: "award",
          type: "award_points",
          to: "$member",
          points: 150,
          memo: "First order bonus",
          on_error: "stop",
        },
        {
          id: "thank",
          type: "send_message",
          to: ["$member"],
          subject: "Thanks for your first order",
          body: "Hi {{member.handle}}, order {{event.order_no}} is on its way. Here are 150 points on us.",
          on_error: "continue",
        },
      ],
      limits: { max_runs_per_member_per_day: 1 },
      owner: "user:marketing-lead",
    },
  } satisfies AutomationBody,
  Content: {
    apiVersion: "plinth/v1",
    kind: "Content",
    metadata: { slug: "peak-season-kickoff", title: "Peak season kickoff" },
    spec: {
      type: "announcement",
      status: "draft",
      summary: "What peak season means for every region, and how recognition works this year.",
      hero: { icon: "megaphone", hue: 18, pattern: "waves" },
      blocks: [
        { type: "heading", level: 2, text: "Peak starts Monday" },
        { type: "paragraph", text: "Every region moves to **extended shifts**. Thank you, all of you." },
        {
          type: "callout",
          tone: "info",
          icon: "bolt",
          text: "Recognition awards earn double points for Gold members.",
        },
        { type: "cta", label: "Open the rewards store", href: "/store" },
      ],
      tags: ["peak", "operations"],
      audience: { everyone: true },
      author: "user:content-editor",
      reviewers: ["user:marketing-lead"],
      schedule: {},
      pinned: false,
      allow_reactions: true,
      published_revision: null,
      review_log: [],
    },
  } satisfies ContentBody,
  Segment: {
    apiVersion: "plinth/v1",
    kind: "Segment",
    metadata: { slug: "emea-gold-plus", title: "EMEA Gold and above" },
    spec: {
      description: "Gold and Platinum members in EMEA.",
      rule: {
        all: [
          { field: "region", op: "eq", value: "EMEA" },
          { field: "tier", op: "in", value: ["gold", "platinum"] },
        ],
      },
      owner: "user:marketing-lead",
    },
  } satisfies SegmentBody,
  Group: {
    apiVersion: "plinth/v1",
    kind: "Group",
    metadata: { slug: "emea-ops", title: "EMEA operations" },
    spec: {
      description: "Operations staff in the EMEA region.",
      type: "region",
      members: ["user:emea-lead"],
      managers: ["user:emea-lead"],
      open_posting: true,
      artwork: { icon: "globe", hue: 260, pattern: "grid" },
    },
  } satisfies GroupBody,
  Role: {
    apiVersion: "plinth/v1",
    kind: "Role",
    metadata: { slug: "manager", title: "Manager" },
    spec: {
      description: "Awards points, approves high-value orders, manages tasks and reads reports.",
      members: [{ subject: "user:ops-lead" }, { subject: "user:emea-lead", scope: { region: "EMEA" } }],
      system: true,
    },
  } satisfies RoleBody,
  Preference: {
    apiVersion: "plinth/v1",
    kind: "Preference",
    metadata: { slug: "prefs.maya-ortiz", title: "Preferences: Maya Ortiz" },
    spec: {
      owner: "user:ops-lead",
      notifications: DEFAULT_NOTIFICATION_PREFS,
      digest: { frequency: "daily", hour_utc: 8 },
      muted_threads: [],
      ui: { theme: "auto", density: "comfortable", reduced_motion: false },
    },
  } satisfies PreferenceBody,
  Program: {
    apiVersion: "plinth/v1",
    kind: "Program",
    metadata: { slug: "rewards", title: "Northwind Rewards" },
    spec: {
      name: "Northwind Rewards",
      currency_label: "points",
      tiers: [
        {
          tier: "bronze",
          min_lifetime_points: 0,
          perks: ["Store access"],
          artwork: { icon: "medal", hue: 28, pattern: "solid" },
        },
        {
          tier: "silver",
          min_lifetime_points: 5000,
          perks: ["Early access to drops"],
          artwork: { icon: "medal", hue: 220, pattern: "rings" },
        },
        {
          tier: "gold",
          min_lifetime_points: 20000,
          perks: ["Gold-only rewards", "Priority fulfilment"],
          artwork: { icon: "crown", hue: 45, pattern: "rings" },
        },
        {
          tier: "platinum",
          min_lifetime_points: 50000,
          perks: ["Experiences catalogue", "Annual gift"],
          artwork: { icon: "crown", hue: 265, pattern: "waves" },
        },
      ],
      expiry: { months: 12, warn_days: [30, 7] },
      transfer: { enabled: true, min_points: 50, max_per_transfer: 5000, max_per_day: 10000 },
      awards: { manager_max_per_award: 2500, max_recipients: 25 },
      store: {
        high_value_threshold_points: 15000,
        cancel_window_minutes: 60,
        max_cart_lines: 20,
        max_qty_per_line: 5,
      },
      messaging: { broadcast_min_recipients: 10, max_recipients: 200 },
      notification_defaults: DEFAULT_NOTIFICATION_PREFS,
      digest_default: { frequency: "daily", hour_utc: 8 },
    },
  } satisfies ProgramBody,
  Widget: {
    apiVersion: "plinth/v1",
    kind: "Widget",
    metadata: { slug: "store-apparel-catalog", title: "Apparel catalogue" },
    spec: {
      widget: "store.catalog",
      config: { category: { param: "category" }, sort: "featured", show_filters: true, page_size: 24 },
    },
  } satisfies WidgetBody,
  Page: {
    apiVersion: "plinth/v1",
    kind: "Page",
    metadata: { slug: "store-category", title: "Store category" },
    spec: {
      kind: "module",
      description: "One store category: offers and the filtered catalogue.",
      route: "/store/c/:category",
      system: true,
      layout: {
        columns: 12,
        items: [
          { item: "widget:store-offers", at: { x: 0, y: 0, w: 12, h: 3 }, size: "full" },
          { item: "widget:store-apparel-catalog", at: { x: 0, y: 3, w: 12, h: 12 }, size: "full" },
        ],
      },
    },
  } satisfies PageBody,
} as const;
