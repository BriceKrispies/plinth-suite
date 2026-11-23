import { Schema } from "effect";
import { ErrorBody } from "./errors";

/** The MCP response envelope (spec 06 section 2). Every tool response is exactly one of these. */
export const WARNING_CODES = [
  "IDEMPOTENT_REPLAY",
  "SOURCE_LAGGING",
  "FIELDS_PAGED",
  "TRUNCATED",
  "REPLAY_META_IGNORED",
] as const;

export const Warning = Schema.Struct({
  code: Schema.Literal(...WARNING_CODES),
  message: Schema.String.pipe(Schema.maxLength(280)),
  path: Schema.optional(Schema.String),
});
export type Warning = typeof Warning.Type;

export const NextHint = Schema.Struct({
  tool: Schema.String,
  arguments: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  why: Schema.String.pipe(Schema.maxLength(140)),
});
export type NextHint = typeof NextHint.Type;

export const Budget = Schema.Struct({
  bytes: Schema.Int.pipe(Schema.greaterThanOrEqualTo(0)),
  truncated: Schema.Boolean,
  next_cursor: Schema.NullOr(Schema.String),
  cost: Schema.Struct({ units: Schema.Int, burst_remaining: Schema.Int, reset_ms: Schema.Int }),
});
export type Budget = typeof Budget.Type;

export const Envelope = Schema.Struct({
  ok: Schema.Boolean,
  trace_id: Schema.String.pipe(Schema.pattern(/^[0-9a-f]{32}$/)),
  call_id: Schema.String.pipe(Schema.pattern(/^c_[0-9A-HJKMNP-TV-Z]{26}$/)),
  data: Schema.optional(Schema.Unknown),
  error: Schema.optional(ErrorBody),
  next: Schema.Array(NextHint).pipe(Schema.maxItems(3)),
  warnings: Schema.Array(Warning),
  budget: Budget,
}).annotations({ identifier: "Envelope" });
export type Envelope = typeof Envelope.Type;
