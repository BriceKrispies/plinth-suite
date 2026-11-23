import { Effect } from "effect";
import {
  BADGE_RARITIES,
  CONTENT_STATUSES,
  ICON_NAMES,
  MEMBER_FACTS,
  NOTIFICATION_TYPES,
  ORDER_STATUSES,
  PROMOTION_STATUSES,
  RUN_STATUSES,
  STEP_TYPES,
  SUITE_SOURCES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TIERS,
  TRIGGERABLE_EVENT_TYPES,
  TXN_TYPES,
  type FactDef,
  type TriggerableEventType,
  SuiteDiscovery,
} from "@plinth/spec";
import type { ActionHandler } from "../types";
import type { HandlerTable } from "./stub";

type Out = (typeof SuiteDiscovery.CatalogOut)["Type"];

const NUM = ["eq", "ne", "lt", "lte", "gt", "gte", "between"] as const;
const ENUM = ["eq", "ne", "in", "not_in"] as const;
const STR = ["eq", "ne", "in", "not_in"] as const;
const BOOL = ["eq", "ne"] as const;
const LIST = ["contains", "not_contains"] as const;
const TS = ["lt", "lte", "gt", "gte", "between"] as const;

const str = (path: string, label: string, description?: string): FactDef => ({
  path,
  label,
  type: "string",
  ops: [...STR],
  ...(description ? { description } : {}),
});
const int = (path: string, label: string, description?: string): FactDef => ({
  path,
  label,
  type: "int",
  ops: [...NUM],
  ...(description ? { description } : {}),
});
const num = (path: string, label: string): FactDef => ({ path, label, type: "float", ops: [...NUM] });
const bool = (path: string, label: string): FactDef => ({ path, label, type: "bool", ops: [...BOOL] });
const ts = (path: string, label: string): FactDef => ({ path, label, type: "timestamp", ops: [...TS] });
const en = (path: string, label: string, values: ReadonlyArray<string>): FactDef => ({
  path,
  label,
  type: "enum",
  values: [...values],
  ops: [...ENUM],
});
const list = (path: string, label: string, description?: string): FactDef => ({
  path,
  label,
  type: "string[]",
  ops: [...LIST],
  ...(description ? { description } : {}),
});

interface EventDef {
  readonly label: string;
  readonly has_member: boolean;
  readonly fields: ReadonlyArray<FactDef>;
}

/** The payload fields of each triggerable event (CONTRACT.md 6.2), plus the derived facts of 11.4. */
const EVENTS: Readonly<Record<TriggerableEventType, EventDef>> = {
  "message.received": {
    label: "Message received",
    has_member: true,
    fields: [
      str("event.thread_id", "Thread"),
      str("event.message_id", "Message"),
      str("event.subject", "Subject"),
      str("event.preview", "Preview"),
      str("event.from.handle", "Sender handle"),
      bool("event.mentioned", "Mentions the member"),
    ],
  },
  "message.sent": {
    label: "Message sent",
    has_member: true,
    fields: [
      str("event.thread_id", "Thread"),
      str("event.message_id", "Message"),
      str("event.subject", "Subject"),
      int("event.recipient_count", "Recipients"),
    ],
  },
  "points.posted": {
    label: "Points posted",
    has_member: true,
    fields: [
      str("event.txn_id", "Transaction"),
      int("event.txn_no", "Transaction number"),
      en("event.txn_type", "Transaction type", TXN_TYPES),
      str("event.account", "Account"),
      str("event.member", "Member"),
      int("event.delta", "Points change"),
      int("event.balance", "Balance after"),
      int("event.lifetime", "Lifetime after"),
      str("event.memo", "Memo"),
    ],
  },
  "tier.changed": {
    label: "Tier changed",
    has_member: true,
    fields: [
      str("event.member", "Member"),
      en("event.from", "From tier", TIERS),
      en("event.to", "To tier", TIERS),
      int("event.lifetime", "Lifetime points"),
    ],
  },
  "order.placed": {
    label: "Order placed",
    has_member: true,
    fields: [
      str("event.order_id", "Order"),
      str("event.order_no", "Order number"),
      str("event.member.handle", "Member handle"),
      int("event.total_points", "Total points"),
      int("event.item_count", "Items"),
      bool("event.requires_approval", "Needs approval"),
      list("event.categories", "Categories ordered", "Derived: category slugs of the order lines"),
    ],
  },
  "order.status_changed": {
    label: "Order status changed",
    has_member: true,
    fields: [
      str("event.order_id", "Order"),
      str("event.order_no", "Order number"),
      str("event.member", "Member"),
      en("event.from", "From status", ORDER_STATUSES),
      en("event.to", "To status", ORDER_STATUSES),
      str("event.note", "Note"),
    ],
  },
  "stock.changed": {
    label: "Stock changed",
    has_member: false,
    fields: [
      str("event.product", "Product"),
      int("event.on_hand", "On hand"),
      en("event.stock_status", "Stock status", ["in_stock", "low", "out"]),
    ],
  },
  "review.created": {
    label: "Review created",
    has_member: true,
    fields: [
      str("event.review_id", "Review"),
      str("event.product", "Product"),
      int("event.rating", "Rating"),
      num("event.average", "Average rating"),
      int("event.count", "Review count"),
    ],
  },
  "badge.awarded": {
    label: "Badge awarded",
    has_member: true,
    fields: [
      str("event.award_id", "Award"),
      str("event.badge", "Badge"),
      str("event.title", "Badge title"),
      str("event.member.handle", "Member handle"),
      en("event.rarity", "Rarity", BADGE_RARITIES),
      int("event.points_reward", "Points reward"),
    ],
  },
  "promotion.state_changed": {
    label: "Promotion state changed",
    has_member: false,
    fields: [
      str("event.promotion", "Promotion"),
      str("event.title", "Title"),
      en("event.from", "From status", PROMOTION_STATUSES),
      en("event.to", "To status", PROMOTION_STATUSES),
      int("event.revision", "Revision"),
    ],
  },
  "promotion.redeemed": {
    label: "Promotion redeemed",
    has_member: true,
    fields: [
      str("event.promotion", "Promotion"),
      str("event.member", "Member"),
      en("event.context", "Context", ["purchase", "earn"]),
      int("event.cost_points", "Cost points"),
      int("event.benefit_points", "Benefit points"),
    ],
  },
  "promotion.budget_alert": {
    label: "Promotion budget alert",
    has_member: false,
    fields: [
      str("event.promotion", "Promotion"),
      int("event.used_pct", "Budget used percent"),
      int("event.cost_points", "Cost points"),
      int("event.max_cost_points", "Budget points"),
    ],
  },
  "automation.run_updated": {
    label: "Automation run updated",
    has_member: false,
    fields: [
      str("event.run_id", "Run"),
      str("event.automation", "Automation"),
      en("event.status", "Run status", RUN_STATUSES),
      int("event.step_index", "Step index"),
      str("event.step_status", "Step status"),
      str("event.error_code", "Error code"),
    ],
  },
  "content.state_changed": {
    label: "Content state changed",
    has_member: false,
    fields: [
      str("event.content", "Content"),
      str("event.title", "Title"),
      en("event.from", "From status", CONTENT_STATUSES),
      en("event.to", "To status", CONTENT_STATUSES),
      str("event.by", "Changed by"),
      str("event.note", "Note"),
    ],
  },
  "content.published": {
    label: "Content published",
    has_member: false,
    fields: [
      str("event.content", "Content"),
      str("event.title", "Title"),
      en("event.content_type", "Content type", ["page", "article", "announcement"]),
      str("event.summary", "Summary"),
      bool("event.pinned", "Pinned"),
    ],
  },
  "content.engaged": {
    label: "Content engaged",
    has_member: true,
    fields: [
      str("event.content", "Content"),
      str("event.member", "Member"),
      bool("event.viewed", "Viewed"),
      en("event.reaction", "Reaction", ["like", "celebrate", "insightful"]),
      int("event.views", "Views"),
      int("event.reactions", "Reactions"),
      int(
        "event.minutes_since_publish",
        "Minutes since publication",
        "Derived: minutes between publication and the view",
      ),
    ],
  },
  "task.assigned": {
    label: "Task assigned",
    has_member: true,
    fields: [
      str("event.task_id", "Task"),
      int("event.task_no", "Task number"),
      str("event.title", "Title"),
      en("event.priority", "Priority", TASK_PRIORITIES),
      ts("event.due_at", "Due"),
      str("event.assignee", "Assignee"),
    ],
  },
  "task.updated": {
    label: "Task updated",
    has_member: false,
    fields: [
      str("event.task_id", "Task"),
      int("event.task_no", "Task number"),
      en("event.status", "Status", TASK_STATUSES),
      list("event.changed", "Changed fields"),
    ],
  },
  "approval.requested": {
    label: "Approval requested",
    has_member: false,
    fields: [
      en("event.approval_type", "Approval type", ["change", "action", "order", "content_review"]),
      str("event.id", "Approval"),
      str("event.title", "Title"),
      str("event.requested_by", "Requested by"),
    ],
  },
  "approval.decided": {
    label: "Approval decided",
    has_member: false,
    fields: [
      en("event.approval_type", "Approval type", ["change", "action", "order", "content_review"]),
      str("event.id", "Approval"),
      en("event.decision", "Decision", ["approve", "reject", "withdraw"]),
      str("event.by", "Decided by"),
      str("event.status", "Status"),
    ],
  },
};

const STEP_LABELS: Readonly<Record<(typeof STEP_TYPES)[number], { label: string; permission: string }>> = {
  award_points: { label: "Award points", permission: "points:award" },
  notify: { label: "Send a notification", permission: "notifications:send" },
  send_message: { label: "Send a message", permission: "messages:use" },
  apply_promotion: { label: "Grant a promotion entitlement", permission: "promotions:manage" },
  create_task: { label: "Create a task", permission: "tasks:use" },
  webhook: { label: "Record a webhook (stub)", permission: "automation:manage" },
};

const words = (s: string): string => {
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** The static builder catalogue (CONTRACT.md 12.10): everything a builder offers in its pickers. */
export const buildCatalog = (): Out => ({
  member_facts: [...MEMBER_FACTS],
  events: TRIGGERABLE_EVENT_TYPES.map((type) => ({
    type,
    label: EVENTS[type].label,
    fields: [...EVENTS[type].fields],
    has_member: EVENTS[type].has_member,
  })),
  step_types: STEP_TYPES.map((type) => ({ type, ...STEP_LABELS[type] })),
  notification_types: NOTIFICATION_TYPES.map((type) => ({ type, label: words(type) })),
  icons: [...ICON_NAMES],
  sources: SUITE_SOURCES.map((s) => ({
    slug: s.body.metadata.slug,
    title: s.body.metadata.title ?? s.body.metadata.slug,
    time_column: (s.body.spec as { time_column?: string }).time_column ?? "occurred_at",
  })),
});

const get: ActionHandler<unknown, Out> = {
  run: () => Effect.succeed(buildCatalog()),
};

export const catalogHandlers = {
  "catalog.get": get,
} satisfies HandlerTable;
