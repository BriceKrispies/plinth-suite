import { Schema as S } from "effect";
import { ApprovalType, DomainEvent, DomainEventType, TaskPriority, TaskStatus } from "../events";
import {
  Handle,
  IdempotencyKey,
  PageQuery,
  PersonRef,
  Region,
  Subject,
  Timestamp,
  UserText,
} from "../primitives";

/** Tasks, approvals inbox and audit (CONTRACT.md modules M10, M11, M12). */

// ---- tasks ----------------------------------------------------------------------------------------

export const TaskLink = S.Struct({
  kind: S.Literal(
    "order",
    "content",
    "promotion",
    "automation",
    "automation_run",
    "member",
    "approval",
    "product",
    "thread",
  ),
  ref: S.String,
  label: S.String,
  href: S.String.pipe(S.pattern(/^\/[A-Za-z0-9/_.:?=&%-]*$/)),
}).annotations({ identifier: "TaskLink" });

export const TaskSummary = S.Struct({
  task_id: S.UUID,
  task_no: S.Int,
  title: S.String,
  status: TaskStatus,
  priority: TaskPriority,
  assignee: S.NullOr(PersonRef),
  created_by: PersonRef,
  created_at: Timestamp,
  due_at: S.NullOr(Timestamp),
  overdue: S.Boolean,
  link: S.NullOr(TaskLink),
  source: S.Literal("manual", "automation"),
  comment_count: S.Int,
  version: S.Int,
}).annotations({ identifier: "TaskSummary" });
export type TaskSummary = typeof TaskSummary.Type;

export const TasksListIn = S.Struct({
  scope: S.optional(S.Literal("mine", "created", "all")),
  status: S.optional(S.Array(TaskStatus)),
  priority: S.optional(S.Array(TaskPriority)),
  q: S.optional(S.String.pipe(S.maxLength(120))),
  due_before: S.optional(Timestamp),
  ...PageQuery,
}).annotations({ identifier: "TasksListIn" });
export const TasksListOut = S.Struct({
  items: S.Array(TaskSummary),
  next_cursor: S.NullOr(S.String),
  status_counts: S.Record({ key: TaskStatus, value: S.Int }),
});

export const TaskComment = S.Struct({
  comment_id: S.UUID,
  author: PersonRef,
  body: S.String,
  created_at: Timestamp,
}).annotations({ identifier: "TaskComment" });

export const TaskIn = S.Struct({ task_id: S.UUID });
export const TaskDetailOut = S.Struct({
  ...TaskSummary.fields,
  description: S.String,
  completed_at: S.NullOr(Timestamp),
  run_id: S.NullOr(S.UUID),
  comments: S.Array(TaskComment),
  history: S.Array(S.Struct({ at: Timestamp, actor: PersonRef, changed: S.Array(S.String) })),
  replayed: S.optional(S.Boolean),
}).annotations({ identifier: "TaskDetailOut" });

export const TaskCreateIn = S.Struct({
  title: UserText(140).pipe(S.minLength(1)),
  description: S.optional(UserText(4000)),
  assignee: S.optional(Subject),
  priority: S.optional(TaskPriority),
  due_at: S.optional(Timestamp),
  link: S.optional(TaskLink),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "TaskCreateIn" });

export const TaskUpdateIn = S.Struct({
  task_id: S.UUID,
  title: S.optional(UserText(140).pipe(S.minLength(1))),
  description: S.optional(UserText(4000)),
  status: S.optional(TaskStatus),
  priority: S.optional(TaskPriority),
  assignee: S.optional(S.NullOr(Subject)),
  due_at: S.optional(S.NullOr(Timestamp)),
  /** Optimistic concurrency: the version the client last read; STALE_VERSION when it moved. */
  version: S.Int,
}).annotations({ identifier: "TaskUpdateIn" });

export const TaskCommentIn = S.Struct({
  task_id: S.UUID,
  body: UserText(4000).pipe(S.minLength(1)),
  idempotency_key: IdempotencyKey,
});

// ---- approvals ------------------------------------------------------------------------------------

export const ApprovalItem = S.Struct({
  type: ApprovalType,
  /** change: change_approvals id; action: action_approvals id; order: order id; content_review: content slug. */
  id: S.String,
  title: S.String,
  /** A Plinth-authored sentence of what approving does, e.g. "Activate promotion Gold double points (budget 250 000 pts)". */
  summary: S.String,
  status: S.Literal("pending_approval", "approved", "rejected", "withdrawn", "expired", "stale", "failed"),
  requested_by: PersonRef,
  on_behalf_of: S.NullOr(PersonRef),
  requested_at: Timestamp,
  expires_at: S.NullOr(Timestamp),
  rule_id: S.Array(S.String),
  approver_permission: S.String,
  can_decide: S.Boolean,
  /** Why the viewer may not decide: sod_requester, sod_on_behalf_of, missing_permission, not_reviewer. */
  blocked_reason: S.NullOr(S.String),
  decided_by: S.NullOr(PersonRef),
  decided_at: S.NullOr(Timestamp),
  decision_reason: S.NullOr(S.String),
  link: S.String,
  /** Type-specific detail: the node diff for change, the action name and input for action, order lines, content diff. */
  detail: S.Record({ key: S.String, value: S.Unknown }),
}).annotations({ identifier: "ApprovalItem" });
export type ApprovalItem = typeof ApprovalItem.Type;

export const ApprovalsIn = S.Struct({
  scope: S.optional(S.Literal("to_decide", "requested", "all")),
  types: S.optional(S.Array(ApprovalType)),
  status: S.optional(S.Literal("pending_approval", "decided", "all")),
  ...PageQuery,
}).annotations({ identifier: "ApprovalsIn" });
export const ApprovalsOut = S.Struct({
  items: S.Array(ApprovalItem),
  next_cursor: S.NullOr(S.String),
  counts: S.Record({ key: ApprovalType, value: S.Int }),
});

export const DecideIn = S.Struct({
  type: ApprovalType,
  id: S.String,
  decision: S.Literal("approve", "reject"),
  reason: S.optional(UserText(280)),
}).annotations({ identifier: "DecideIn" });
export const WithdrawIn = S.Struct({ type: ApprovalType, id: S.String, reason: S.optional(UserText(280)) });

// ---- audit ----------------------------------------------------------------------------------------

export const AuditEventsIn = S.Struct({
  types: S.optional(S.Array(DomainEventType)),
  actor: S.optional(Subject),
  member: S.optional(Handle),
  subject_kind: S.optional(S.String),
  subject_id: S.optional(S.String),
  from: S.optional(Timestamp),
  to: S.optional(Timestamp),
  ...PageQuery,
}).annotations({ identifier: "AuditEventsIn" });
export const AuditEventsOut = S.Struct({ items: S.Array(DomainEvent), next_cursor: S.NullOr(S.String) });

export const AuditEntry = S.Struct({
  source: S.Literal("change", "event"),
  seq: S.Int,
  at: Timestamp,
  actor: PersonRef,
  on_behalf_of: S.NullOr(PersonRef),
  approved_by: S.NullOr(PersonRef),
  surface: S.String,
  /** change: "Promotion gold-double-points r4"; event: the DomainEvent type. */
  what: S.String,
  summary: S.String,
  rule_id: S.Array(S.String),
  link: S.NullOr(S.String),
  undoable: S.Boolean,
  hash: S.String,
}).annotations({ identifier: "AuditEntry" });

export const AuditTimelineIn = S.Struct({
  sources: S.optional(S.Array(S.Literal("change", "event"))),
  actor: S.optional(Subject),
  q: S.optional(S.String.pipe(S.maxLength(120))),
  from: S.optional(Timestamp),
  to: S.optional(Timestamp),
  region: S.optional(Region),
  ...PageQuery,
}).annotations({ identifier: "AuditTimelineIn" });
export const AuditTimelineOut = S.Struct({ items: S.Array(AuditEntry), next_cursor: S.NullOr(S.String) });

export const ChainVerify = S.Struct({
  ok: S.Boolean,
  checked: S.Int,
  head_seq: S.Int,
  head_hash: S.String,
  error: S.optional(S.Struct({ seq: S.Int, reason: S.String })),
}).annotations({ identifier: "ChainVerify" });
export const AuditVerifyOut = S.Struct({ changes: ChainVerify, domain: ChainVerify, verified_at: Timestamp });
