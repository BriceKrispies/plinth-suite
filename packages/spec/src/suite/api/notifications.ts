import { Schema as S } from "effect";
import { NotificationType, NotificationView } from "../events";
import { Handle, IdempotencyKey, PageQuery, Recipient, Timestamp } from "../primitives";

/** Notifications (CONTRACT.md module M2). */

export const NotificationsListIn = S.Struct({
  filter: S.optional(S.Literal("all", "unread")),
  types: S.optional(S.Array(NotificationType)),
  ...PageQuery,
}).annotations({ identifier: "NotificationsListIn" });

export const NotificationsListOut = S.Struct({
  items: S.Array(NotificationView),
  next_cursor: S.NullOr(S.String),
  unread_count: S.Int,
}).annotations({ identifier: "NotificationsListOut" });

export const MarkReadIn = S.Struct({ ids: S.Array(S.UUID).pipe(S.minItems(1), S.maxItems(200)) });
export const MarkAllReadIn = S.Struct({
  before: S.optional(Timestamp),
  types: S.optional(S.Array(NotificationType)),
});
export const MarkReadOut = S.Struct({ marked: S.Int, unread_count: S.Int }).annotations({
  identifier: "MarkReadOut",
});

export const NotifySendIn = S.Struct({
  to: S.Array(Recipient).pipe(S.minItems(1), S.maxItems(50)),
  type: S.Literal("system", "automation_alert", "promotion_started"),
  title: S.String.pipe(S.minLength(1), S.maxLength(140)),
  body: S.String.pipe(S.maxLength(500)),
  link: S.optional(S.String.pipe(S.pattern(/^\/[A-Za-z0-9/_.:?=&%-]*$/))),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "NotifySendIn" });
export const NotifySendOut = S.Struct({ recipients: S.Int, suppressed: S.Int, replayed: S.Boolean });

export const DeliveriesIn = S.Struct({
  channel: S.optional(S.Literal("email", "digest")),
  /** Admins (people:view-private) may read another member's log. */
  member: S.optional(Handle),
  ...PageQuery,
});
export const DeliveryView = S.Struct({
  delivery_id: S.UUID,
  channel: S.Literal("email", "digest"),
  status: S.Literal("queued", "sent", "suppressed"),
  subject: S.String,
  body: S.String,
  notification_ids: S.Array(S.UUID),
  created_at: Timestamp,
  sent_at: S.NullOr(Timestamp),
  suppressed_reason: S.NullOr(S.Literal("preference_off", "quiet_hours", "member_disabled")),
}).annotations({ identifier: "DeliveryView" });
export const DeliveriesOut = S.Struct({ items: S.Array(DeliveryView), next_cursor: S.NullOr(S.String) });
