import { Effect } from "effect";
import type { AutomationSpec } from "@plinth/spec";
import type { SeedStep } from "../seed";

/**
 * Seed step `automations` (CONTRACT.md 11.6, 9): the 10 Automation nodes (`win-back` and `crm-sync-stub` disabled). Their
 * run history is produced by the engines: every command of the activity step is followed by a drain, so each matching
 * event creates its run and executes its steps as `service:automation` inside the owner's grants (see
 * `activityMarketing` for the schedule, manual and failed-then-retried runs).
 *
 * Owners hold the permissions their steps need: Maya (manager: points:award, notifications:send, tasks:manage) owns the
 * automations that award, notify groups or assign tasks to others; Tomas (marketing manager: promotions:manage,
 * notifications:send) owns the marketing ones.
 */

type Seeded = { readonly slug: string; readonly title: string; readonly spec: AutomationSpec };

const MAYA = "user:ops-lead";
const TOMAS = "user:marketing-lead";

export const AUTOMATIONS: ReadonlyArray<Seeded> = [
  {
    slug: "welcome-first-order",
    title: "Thank members for their first order",
    spec: {
      enabled: true,
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
      owner: MAYA,
    },
  },
  {
    slug: "tier-up-congrats",
    title: "Congratulate members on a new tier",
    spec: {
      enabled: true,
      description:
        "When a member reaches a new tier, notify them and send a message from the operations team.",
      trigger: { type: "event", event: "tier.changed" },
      steps: [
        {
          id: "notify",
          type: "notify",
          to: ["$member"],
          notification_type: "tier_changed",
          title: "Welcome to {{event.to}}",
          body: "You moved from {{event.from}} to {{event.to}}. Thank you for everything you do.",
          link: "/points",
          on_error: "continue",
        },
        {
          id: "message",
          type: "send_message",
          to: ["$member"],
          subject: "You reached {{event.to}}",
          body: "Hi {{member.handle}}, congratulations from the operations team on reaching {{event.to}}.",
          on_error: "continue",
        },
      ],
      limits: { cooldown_minutes: 60 },
      owner: MAYA,
    },
  },
  {
    slug: "badge-shoutout",
    title: "Shout out epic and legendary badges",
    spec: {
      enabled: true,
      description: "Tell everyone when a member earns an epic or legendary badge.",
      trigger: {
        type: "event",
        event: "badge.awarded",
        filter: { field: "event.rarity", op: "in", value: ["epic", "legendary"] },
      },
      steps: [
        {
          id: "announce",
          type: "notify",
          to: ["group:all-staff"],
          notification_type: "system",
          title: "{{event.title}} earned",
          body: "{{event.member.display_name}} just earned the {{event.title}} badge ({{event.rarity}}).",
          link: "/badges",
          on_error: "stop",
        },
      ],
      limits: {},
      owner: MAYA,
    },
  },
  {
    slug: "high-value-review",
    title: "Review high-value orders",
    spec: {
      enabled: true,
      description: "Create a task for the operations lead when an order needs approval.",
      trigger: {
        type: "event",
        event: "order.placed",
        filter: { field: "event.requires_approval", op: "eq", value: true },
      },
      steps: [
        {
          id: "task",
          type: "create_task",
          title: "Review high-value order {{event.order_no}}",
          description:
            "Order {{event.order_no}} is {{event.total_points}} points and needs approval before fulfilment.",
          assignee: "$owner",
          priority: "high",
          due_in_days: 2,
          on_error: "stop",
        },
      ],
      limits: {},
      owner: MAYA,
    },
  },
  {
    slug: "low-stock-alert",
    title: "Alert on low stock",
    spec: {
      enabled: true,
      description:
        "When a product runs low, create a restock task for the platform administrator and notify them.",
      trigger: {
        type: "event",
        event: "stock.changed",
        filter: { field: "event.stock_status", op: "eq", value: "low" },
      },
      steps: [
        {
          id: "task",
          type: "create_task",
          title: "Restock {{event.product}}",
          description: "{{event.product}} is down to {{event.on_hand}} units.",
          assignee: "user:it-admin",
          priority: "high",
          due_in_days: 3,
          on_error: "stop",
        },
        {
          id: "notify",
          type: "notify",
          to: ["user:it-admin"],
          notification_type: "automation_alert",
          title: "Low stock: {{event.product}}",
          body: "{{event.product}} has {{event.on_hand}} left. A restock task was created.",
          link: "/store/inventory",
          on_error: "continue",
        },
      ],
      limits: {},
      owner: MAYA,
    },
  },
  {
    slug: "weekly-digest-nudge",
    title: "Weekly rewards nudge",
    spec: {
      enabled: true,
      description: "Every Monday at 09:00 UTC, point everyone at the week's offers and news.",
      trigger: { type: "schedule", cron: "0 9 * * 1" },
      steps: [
        {
          id: "nudge",
          type: "notify",
          to: ["group:all-staff"],
          notification_type: "promotion_started",
          title: "This week's offers",
          body: "New offers and news are live. Open the store and the news feed to see what is on.",
          link: "/store",
          on_error: "stop",
        },
      ],
      limits: {},
      owner: TOMAS,
    },
  },
  {
    slug: "sla-team-bonus",
    title: "Recognise a held fulfilment SLA",
    spec: {
      enabled: true,
      description:
        "When the NA p95 fulfilment latency stays under target for 30 minutes, tell the NA team and create a task to award them.",
      trigger: {
        type: "metric",
        query: {
          from: "source:orders",
          where: [
            { field: "placed_at", op: "gte", value: { expr: "now() - 1h" } },
            { field: "region", op: "eq", value: "NA" },
          ],
          derive: { latency_ms: "ms(fulfilled_at - placed_at)" },
          aggregate: { p95_ms: { fn: "percentile", of: "latency_ms", p: 0.95 } },
        },
        value_column: "p95_ms",
        op: "lt",
        threshold: 900,
        for_minutes: 30,
        every_minutes: 15,
      },
      steps: [
        {
          id: "tell",
          type: "notify",
          to: ["group:na-ops"],
          notification_type: "system",
          title: "SLA held",
          body: "NA fulfilment held its latency target for 30 minutes. Thank you, team.",
          link: "/reports",
          on_error: "continue",
        },
        {
          id: "task",
          type: "create_task",
          title: "Award the NA team",
          description: "The NA fulfilment SLA held. Send recognition to the team.",
          assignee: "$owner",
          priority: "normal",
          due_in_days: 2,
          on_error: "stop",
        },
      ],
      limits: { cooldown_minutes: 1440 },
      owner: MAYA,
    },
  },
  {
    slug: "win-back",
    title: "Win back inactive members",
    spec: {
      enabled: false,
      description: "Every Wednesday, grant at-risk members a re-engagement bonus and send them a message.",
      trigger: { type: "schedule", cron: "0 10 * * 3" },
      conditions: { field: "member.last_active_days", op: "gte", value: 14 },
      steps: [
        {
          id: "grant",
          type: "apply_promotion",
          promotion: "promotion:reengage-at-risk",
          to: "$member",
          expires_in_days: 30,
          on_error: "stop",
        },
        {
          id: "message",
          type: "send_message",
          to: ["$member"],
          subject: "We saved you a bonus",
          body: "Hi {{member.handle}}, we missed you. A 1 000 point bonus waits on your next order.",
          on_error: "continue",
        },
      ],
      limits: { cooldown_minutes: 10080 },
      owner: TOMAS,
    },
  },
  {
    slug: "review-reminder",
    title: "Ask for a review after delivery",
    spec: {
      enabled: true,
      description: "When an order is delivered, nudge the member to review what they received.",
      trigger: {
        type: "event",
        event: "order.status_changed",
        filter: { field: "event.to", op: "eq", value: "delivered" },
      },
      steps: [
        {
          id: "remind",
          type: "notify",
          to: ["$member"],
          notification_type: "system",
          title: "How was order {{event.order_no}}?",
          body: "Your order was delivered. Leave a review to help others choose.",
          link: "/store/orders",
          on_error: "stop",
        },
      ],
      limits: { max_runs_per_member_per_day: 3 },
      owner: TOMAS,
    },
  },
  {
    slug: "crm-sync-stub",
    title: "Sync orders to the CRM (stub)",
    spec: {
      enabled: false,
      description:
        "Record a CRM webhook for every order. A stub: the payload is recorded, never sent. Enabling is held.",
      trigger: { type: "event", event: "order.placed" },
      steps: [
        {
          id: "crm",
          type: "webhook",
          target_label: "crm",
          payload: {
            order: "{{event.order_no}}",
            member: "{{member.handle}}",
            total: "{{event.total_points}}",
          },
          on_error: "stop",
        },
      ],
      limits: {},
      owner: MAYA,
    },
  },
];

export const automationsStep: SeedStep = {
  name: "automations",
  spec: "11.6, 9",
  run: (ctx) =>
    ctx
      .commitNodes(
        AUTOMATIONS.map((a) =>
          ctx.create("Automation", a.slug, {
            apiVersion: "plinth/v1",
            kind: "Automation",
            metadata: { slug: a.slug, title: a.title },
            spec: a.spec,
          }),
        ),
        "seed: automations",
      )
      .pipe(Effect.asVoid),
};
