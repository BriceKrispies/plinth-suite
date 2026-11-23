import { Schema } from "effect";
import { ChangeEvent } from "./change";
import { ErrorCode } from "./errors";
import { Scalar } from "./query-ast";
import { CountsFrame, DomainEventType, DomainEventsFrame } from "./suite/events";

/** Realtime protocol v1 frames (spec 05 section 9.5). `uris` and `last_seq` are accepted as aliases. */

export const HelloFrame = Schema.Struct({
  t: Schema.Literal("hello"),
  protocol: Schema.Literal(1),
  token: Schema.String,
  client_id: Schema.optional(Schema.String),
});

export const SubscribeFrame = Schema.Struct({
  t: Schema.Literal("subscribe"),
  sub: Schema.String,
  nodes: Schema.optional(Schema.Array(Schema.String)),
  uris: Schema.optional(Schema.Array(Schema.String)),
  since_seq: Schema.optional(Schema.Int.pipe(Schema.greaterThanOrEqualTo(0))),
  last_seq: Schema.optional(Schema.Int.pipe(Schema.greaterThanOrEqualTo(0))),
  /** Suite: "changes" (default, the change log) or "domain" (domain events; since_seq is a domain_events seq). */
  stream: Schema.optional(Schema.Literal("changes", "domain")),
  /** Suite, domain stream only: deliver only these event types (default all the principal may see). */
  types: Schema.optional(Schema.Array(DomainEventType).pipe(Schema.maxItems(40))),
});

export const UnsubscribeFrame = Schema.Struct({ t: Schema.Literal("unsubscribe"), sub: Schema.String });

export const ClientFrame = Schema.Union(HelloFrame, SubscribeFrame, UnsubscribeFrame);
export type ClientFrame = typeof ClientFrame.Type;

export const WelcomeFrame = Schema.Struct({
  t: Schema.Literal("welcome"),
  session_id: Schema.String,
  principal: Schema.String,
  head_seq: Schema.Int,
  /** Suite: head of the workspace domain_events chain. */
  domain_head_seq: Schema.optional(Schema.Int),
});
export const SubscribedFrame = Schema.Struct({
  t: Schema.Literal("subscribed"),
  sub: Schema.String,
  mode: Schema.Literal("resume", "snapshot"),
  from_seq: Schema.Int,
  through_seq: Schema.Int,
});
export const EventsFrame = Schema.Struct({
  t: Schema.Literal("events"),
  sub: Schema.String,
  prev_through: Schema.Int,
  through: Schema.Int,
  items: Schema.Array(ChangeEvent),
});
export const ProgressFrame = Schema.Struct({
  t: Schema.Literal("progress"),
  sub: Schema.String,
  through: Schema.Int,
});
export const ErrorFrame = Schema.Struct({
  t: Schema.Literal("error"),
  code: ErrorCode,
  message: Schema.String,
  sub: Schema.optional(Schema.String),
});

/**
 * Suite: `ui.present` reached this socket's principal (CONTRACT 6.3). `node` is a node URI the principal may read,
 * `focus` an optional `{ parameter, value }` to set on the screen, `by` the subject that presented, `at` the gateway
 * clock (ISO 8601). Writes no change; nothing is replayed on reconnect.
 */
export const PresentFrame = Schema.Struct({
  t: Schema.Literal("present"),
  node: Schema.String,
  target: Schema.String,
  focus: Schema.NullOr(Schema.Struct({ parameter: Schema.String, value: Scalar })),
  by: Schema.String,
  at: Schema.String,
});

/**
 * The `plinth_present` NOTIFY payload `ui.present` sends. `owners` are the subjects the presenter's session belongs
 * to (its own and its delegator's); the gateway delivers only to sockets whose principal is one of them.
 */
export const PresentNotice = Schema.Struct({
  ws: Schema.String,
  node: Schema.String,
  target: Schema.String,
  focus: Schema.NullOr(Schema.Struct({ parameter: Schema.String, value: Scalar })),
  by: Schema.String,
  owners: Schema.Array(Schema.String),
});
export type PresentNotice = typeof PresentNotice.Type;

/** Whether a socket whose principal is `subject` is a screen this notice addresses (the node read check is separate). */
export const presentAddresses = (n: PresentNotice, subject: string): boolean => {
  if (!n.owners.includes(subject)) return false;
  if (n.target === "all") return true;
  const who = n.target.slice("principal:".length);
  return subject === who || subject === `principal:${who}` || subject.endsWith(`:${who}`);
};

export const ServerFrame = Schema.Union(
  WelcomeFrame,
  SubscribedFrame,
  EventsFrame,
  ProgressFrame,
  ErrorFrame,
  DomainEventsFrame,
  CountsFrame,
  PresentFrame,
);
export type ServerFrame = typeof ServerFrame.Type;
