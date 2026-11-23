import { Schema as S } from "effect";
import { Surface } from "../common";
import { Handle, PersonRef, SignedPoints, Subject, Tier, Timestamp } from "./primitives";

/**
 * The domain event catalogue (CONTRACT.md section 6). Every write to a Suite transactional table appends exactly one
 * or more rows to `domain_events` in the same transaction. Those rows are the audit record for high-volume writes, the
 * input of the automation and badge engines, and what `/rt` pushes on the `domain` stream, filtered per principal by
 * the row's audience. Payloads never carry message bodies or other private text beyond a 140-character preview.
 */

export const DOMAIN_EVENT_TYPES = [
  "message.received",
  "message.sent",
  "message.state_changed",
  "notification.created",
  "notification.read",
  "points.posted",
  "points.expiring",
  "tier.changed",
  "order.placed",
  "order.status_changed",
  "stock.changed",
  "cart.updated",
  "wishlist.changed",
  "review.created",
  "badge.awarded",
  "badge.revoked",
  "badge.progress",
  "promotion.state_changed",
  "promotion.redeemed",
  "promotion.budget_alert",
  "automation.run_updated",
  "content.state_changed",
  "content.published",
  "content.engaged",
  "task.assigned",
  "task.updated",
  "task.commented",
  "approval.requested",
  "approval.decided",
  "member.updated",
  "session.revoked",
] as const;
export const DomainEventType = S.Literal(...DOMAIN_EVENT_TYPES).annotations({
  identifier: "DomainEventType",
});
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

/** Event types an Automation trigger or a Badge criterion may name (the rest are UI plumbing). */
export const TRIGGERABLE_EVENT_TYPES = [
  "message.received",
  "message.sent",
  "points.posted",
  "tier.changed",
  "order.placed",
  "order.status_changed",
  "stock.changed",
  "review.created",
  "badge.awarded",
  "promotion.state_changed",
  "promotion.redeemed",
  "promotion.budget_alert",
  "automation.run_updated",
  "content.state_changed",
  "content.published",
  "content.engaged",
  "task.assigned",
  "task.updated",
  "approval.requested",
  "approval.decided",
] as const satisfies ReadonlyArray<DomainEventType>;
export const TriggerableEventType = S.Literal(...TRIGGERABLE_EVENT_TYPES).annotations({
  identifier: "TriggerableEventType",
});
export type TriggerableEventType = (typeof TRIGGERABLE_EVENT_TYPES)[number];

export const SUBJECT_KINDS = [
  "member",
  "thread",
  "notification",
  "txn",
  "order",
  "product",
  "review",
  "badge_award",
  "promotion",
  "automation_run",
  "content",
  "task",
  "approval",
  "session",
] as const;
export const EventSubject = S.Struct({ kind: S.Literal(...SUBJECT_KINDS), id: S.String }).annotations({
  identifier: "EventSubject",
});

/** Set on events produced by an automation step; the engine refuses to trigger on events deeper than 3. */
export const EventCause = S.Struct({
  automation: S.String,
  run_id: S.UUID,
  step_index: S.Int,
  depth: S.Int.pipe(S.between(1, 8)),
}).annotations({ identifier: "EventCause" });

export const TXN_TYPES = [
  "award",
  "purchase",
  "refund",
  "transfer",
  "expiry",
  "adjustment",
  "promotion_bonus",
  "badge_reward",
  "reversal",
] as const;
export const TxnType = S.Literal(...TXN_TYPES).annotations({ identifier: "TxnType" });
export type TxnType = typeof TxnType.Type;

export const ORDER_STATUSES = [
  "placed",
  "approved",
  "fulfilled",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
] as const;
export const OrderStatus = S.Literal(...ORDER_STATUSES).annotations({ identifier: "OrderStatus" });
export type OrderStatus = typeof OrderStatus.Type;

export const PROMOTION_STATUSES = ["draft", "scheduled", "active", "paused", "ended"] as const;
export const PromotionStatus = S.Literal(...PROMOTION_STATUSES).annotations({
  identifier: "PromotionStatus",
});
export type PromotionStatus = typeof PromotionStatus.Type;

export const CONTENT_STATUSES = ["draft", "in_review", "approved", "published", "archived"] as const;
export const ContentStatus = S.Literal(...CONTENT_STATUSES).annotations({ identifier: "ContentStatus" });
export type ContentStatus = typeof ContentStatus.Type;

export const RUN_STATUSES = ["queued", "running", "succeeded", "failed", "skipped", "cancelled"] as const;
export const RunStatus = S.Literal(...RUN_STATUSES).annotations({ identifier: "RunStatus" });
export type RunStatus = typeof RunStatus.Type;

export const STEP_STATUSES = ["pending", "running", "succeeded", "failed", "skipped"] as const;
export const StepStatus = S.Literal(...STEP_STATUSES).annotations({ identifier: "StepStatus" });

export const TASK_STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"] as const;
export const TaskStatus = S.Literal(...TASK_STATUSES).annotations({ identifier: "TaskStatus" });
export type TaskStatus = typeof TaskStatus.Type;

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TaskPriority = S.Literal(...TASK_PRIORITIES).annotations({ identifier: "TaskPriority" });

export const APPROVAL_TYPES = ["change", "action", "order", "content_review"] as const;
export const ApprovalType = S.Literal(...APPROVAL_TYPES).annotations({ identifier: "ApprovalType" });
export type ApprovalType = typeof ApprovalType.Type;

export const NOTIFICATION_TYPES = [
  "mention",
  "message",
  "approval_request",
  "approval_decision",
  "points_awarded",
  "points_expiring",
  "badge_earned",
  "tier_changed",
  "order_status",
  "automation_alert",
  "content_review",
  "content_published",
  "task_assigned",
  "promotion_started",
  "system",
] as const;
export const NotificationType = S.Literal(...NOTIFICATION_TYPES).annotations({
  identifier: "NotificationType",
});
export type NotificationType = typeof NotificationType.Type;

export const REACTIONS = ["like", "celebrate", "insightful"] as const;
export const Reaction = S.Literal(...REACTIONS).annotations({ identifier: "Reaction" });

export const StockStatus = S.Literal("in_stock", "low", "out").annotations({ identifier: "StockStatus" });

/** The in-app notification as it is listed and pushed. `link` is an app route (UI-MAP.md), never an external URL. */
export const NotificationView = S.Struct({
  notification_id: S.UUID,
  type: NotificationType,
  title: S.String.pipe(S.maxLength(140)),
  body: S.String.pipe(S.maxLength(500)),
  link: S.NullOr(S.String.pipe(S.pattern(/^\/[A-Za-z0-9/_.:?=&%-]*$/))),
  actor: S.NullOr(PersonRef),
  created_at: Timestamp,
  read_at: S.NullOr(Timestamp),
  subject: S.NullOr(EventSubject),
}).annotations({ identifier: "NotificationView" });
export type NotificationView = typeof NotificationView.Type;

// ---- payloads ---------------------------------------------------------------------------------

const P = {
  "message.received": S.Struct({
    thread_id: S.UUID,
    message_id: S.UUID,
    subject: S.String,
    preview: S.String.pipe(S.maxLength(140)),
    from: PersonRef,
    mentioned: S.Boolean,
  }),
  "message.sent": S.Struct({
    thread_id: S.UUID,
    message_id: S.UUID,
    subject: S.String,
    recipient_count: S.Int,
  }),
  "message.state_changed": S.Struct({
    thread_ids: S.Array(S.UUID),
    read: S.optional(S.Boolean),
    starred: S.optional(S.Boolean),
    archived: S.optional(S.Boolean),
    muted: S.optional(S.Boolean),
  }),
  "notification.created": S.Struct({ notification: NotificationView }),
  "notification.read": S.Struct({ ids: S.NullOr(S.Array(S.UUID)), unread_count: S.Int }),
  "points.posted": S.Struct({
    txn_id: S.UUID,
    txn_no: S.Int,
    txn_type: TxnType,
    account: S.String,
    member: S.NullOr(Handle),
    delta: SignedPoints,
    balance: S.Int,
    lifetime: S.Int,
    memo: S.String,
  }),
  "points.expiring": S.Struct({ member: Handle, points: S.Int, expires_on: S.String }),
  "tier.changed": S.Struct({ member: Handle, from: Tier, to: Tier, lifetime: S.Int }),
  "order.placed": S.Struct({
    order_id: S.UUID,
    order_no: S.String,
    member: PersonRef,
    total_points: S.Int,
    item_count: S.Int,
    requires_approval: S.Boolean,
  }),
  "order.status_changed": S.Struct({
    order_id: S.UUID,
    order_no: S.String,
    member: Handle,
    from: OrderStatus,
    to: OrderStatus,
    note: S.NullOr(S.String),
  }),
  "stock.changed": S.Struct({ product: S.String, on_hand: S.Int, stock_status: StockStatus }),
  "cart.updated": S.Struct({ item_count: S.Int, subtotal_points: S.Int }),
  "wishlist.changed": S.Struct({ product: S.String, in_wishlist: S.Boolean }),
  "review.created": S.Struct({
    review_id: S.UUID,
    product: S.String,
    rating: S.Int,
    average: S.Number,
    count: S.Int,
  }),
  "badge.awarded": S.Struct({
    award_id: S.UUID,
    badge: S.String,
    title: S.String,
    member: PersonRef,
    rarity: S.String,
    points_reward: S.Int,
  }),
  "badge.revoked": S.Struct({ award_id: S.UUID, badge: S.String, member: Handle }),
  "badge.progress": S.Struct({ badge: S.String, member: Handle, current: S.Int, target: S.Int }),
  "promotion.state_changed": S.Struct({
    promotion: S.String,
    title: S.String,
    from: PromotionStatus,
    to: PromotionStatus,
    revision: S.Int,
  }),
  "promotion.redeemed": S.Struct({
    promotion: S.String,
    member: Handle,
    context: S.Literal("purchase", "earn"),
    cost_points: S.Int,
    benefit_points: S.Int,
  }),
  "promotion.budget_alert": S.Struct({
    promotion: S.String,
    used_pct: S.Literal(50, 80, 100),
    cost_points: S.Int,
    max_cost_points: S.Int,
  }),
  "automation.run_updated": S.Struct({
    run_id: S.UUID,
    automation: S.String,
    status: RunStatus,
    step_index: S.NullOr(S.Int),
    step_status: S.NullOr(StepStatus),
    error_code: S.NullOr(S.String),
  }),
  "content.state_changed": S.Struct({
    content: S.String,
    title: S.String,
    from: ContentStatus,
    to: ContentStatus,
    by: Subject,
    note: S.NullOr(S.String),
  }),
  "content.published": S.Struct({
    content: S.String,
    title: S.String,
    content_type: S.Literal("page", "article", "announcement"),
    summary: S.String,
    pinned: S.Boolean,
  }),
  "content.engaged": S.Struct({
    content: S.String,
    member: Handle,
    viewed: S.Boolean,
    reaction: S.NullOr(Reaction),
    views: S.Int,
    reactions: S.Int,
  }),
  "task.assigned": S.Struct({
    task_id: S.UUID,
    task_no: S.Int,
    title: S.String,
    priority: TaskPriority,
    due_at: S.NullOr(Timestamp),
    assignee: Subject,
  }),
  "task.updated": S.Struct({
    task_id: S.UUID,
    task_no: S.Int,
    status: TaskStatus,
    changed: S.Array(S.String),
  }),
  "task.commented": S.Struct({ task_id: S.UUID, task_no: S.Int, comment_id: S.UUID, author: Subject }),
  "approval.requested": S.Struct({
    approval_type: ApprovalType,
    id: S.String,
    title: S.String,
    requested_by: Subject,
  }),
  "approval.decided": S.Struct({
    approval_type: ApprovalType,
    id: S.String,
    decision: S.Literal("approve", "reject", "withdraw"),
    by: Subject,
    status: S.String,
  }),
  "member.updated": S.Struct({ member: Handle, fields: S.Array(S.String) }),
  "session.revoked": S.Struct({ session_id: S.String, by: Subject }),
} as const satisfies Record<DomainEventType, S.Schema.AnyNoContext>;

export const DOMAIN_EVENT_PAYLOADS = P;

const base = {
  seq: S.Int.pipe(S.greaterThanOrEqualTo(1)),
  occurred_at: Timestamp,
  actor: Subject,
  on_behalf_of: S.NullOr(Subject),
  surface: Surface,
  subject: S.NullOr(EventSubject),
  cause: S.NullOr(EventCause),
};

const ev = <T extends DomainEventType>(type: T) =>
  S.Struct({ ...base, type: S.Literal(type), payload: P[type] as (typeof P)[T] }).annotations({
    identifier: `DomainEvent.${type}`,
  });

/** One domain event as `/rt` delivers it and `GET /suite/audit/events` lists it (audience is never sent). */
export const DomainEvent = S.Union(
  ev("message.received"),
  ev("message.sent"),
  ev("message.state_changed"),
  ev("notification.created"),
  ev("notification.read"),
  ev("points.posted"),
  ev("points.expiring"),
  ev("tier.changed"),
  ev("order.placed"),
  ev("order.status_changed"),
  ev("stock.changed"),
  ev("cart.updated"),
  ev("wishlist.changed"),
  ev("review.created"),
  ev("badge.awarded"),
  ev("badge.revoked"),
  ev("badge.progress"),
  ev("promotion.state_changed"),
  ev("promotion.redeemed"),
  ev("promotion.budget_alert"),
  ev("automation.run_updated"),
  ev("content.state_changed"),
  ev("content.published"),
  ev("content.engaged"),
  ev("task.assigned"),
  ev("task.updated"),
  ev("task.commented"),
  ev("approval.requested"),
  ev("approval.decided"),
  ev("member.updated"),
  ev("session.revoked"),
).annotations({ identifier: "DomainEvent" });
export type DomainEvent = typeof DomainEvent.Type;

/** Event types after which the gateway recomputes and pushes `counts` to the affected connection. */
export const COUNT_AFFECTING_EVENTS: ReadonlyArray<DomainEventType> = [
  "message.received",
  "message.sent",
  "message.state_changed",
  "notification.created",
  "notification.read",
  "cart.updated",
  "order.placed",
  "order.status_changed",
  "task.assigned",
  "task.updated",
  "approval.requested",
  "approval.decided",
  "content.state_changed",
];

/** The numbers behind every badge in the shell (nav items, bell, inbox, cart). Computed per principal. */
export const NavCounts = S.Struct({
  notifications_unread: S.Int,
  messages_unread: S.Int,
  approvals_pending: S.Int,
  tasks_open: S.Int,
  cart_items: S.Int,
  content_reviews: S.Int,
  orders_attention: S.Int,
}).annotations({ identifier: "NavCounts" });
export type NavCounts = typeof NavCounts.Type;

// ---- realtime frames (extend the kernel protocol v1 of spec 05 section 9.5) ----------------------

/** Server frame: a batch of domain events for a `stream: "domain"` subscription. */
export const DomainEventsFrame = S.Struct({
  t: S.Literal("domain"),
  sub: S.String,
  prev_through: S.Int,
  through: S.Int,
  items: S.Array(DomainEvent),
}).annotations({ identifier: "DomainEventsFrame" });

/** Server frame: the principal's shell counts, sent after a domain subscription starts and after count-affecting events. */
export const CountsFrame = S.Struct({ t: S.Literal("counts"), counts: NavCounts }).annotations({
  identifier: "CountsFrame",
});
