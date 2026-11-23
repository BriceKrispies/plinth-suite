import { Data, Schema } from "effect";

/** The closed, canonical error code enum (spec 06 section 3, README ruling 9). */
export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "UNKNOWN_FIELD",
  "UNKNOWN_REFERENCE",
  "TYPE_MISMATCH",
  "PREVIEW_REQUIRED",
  "PREVIEW_STALE",
  "CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "FORBIDDEN",
  "RULE_REFUSED",
  "RATE_LIMITED",
  "QUERY_TIMEOUT",
  "SOURCE_STALE",
  "LOOP_SUSPECTED",
  "UNAUTHENTICATED",
] as const;
export const ErrorCode = Schema.Literal(...ERROR_CODES);
export type ErrorCode = typeof ErrorCode.Type;

export const ErrorSuggestion = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("replace"), path: Schema.String, value: Schema.Unknown }),
  Schema.Struct({
    kind: Schema.Literal("call"),
    tool: Schema.String,
    arguments: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  }),
);

/** The error object inside the MCP envelope (spec 06 section 3, `Error`). */
export const ErrorBody = Schema.Struct({
  code: ErrorCode,
  path: Schema.String,
  message: Schema.String.pipe(Schema.maxLength(280)),
  expected: Schema.optional(Schema.String),
  allowed: Schema.optional(Schema.Array(Schema.String).pipe(Schema.maxItems(20))),
  did_you_mean: Schema.optional(Schema.Array(Schema.String).pipe(Schema.maxItems(3))),
  suggestion: Schema.optional(ErrorSuggestion),
  fix_hint: Schema.String.pipe(Schema.maxLength(280)),
  retryable: Schema.Boolean,
  retry_after_s: Schema.optional(Schema.Int.pipe(Schema.greaterThanOrEqualTo(1))),
  docs_uri: Schema.optional(Schema.String),
  details: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});
export type ErrorBody = typeof ErrorBody.Type;

/** The one domain failure. Every refusal in the system is this tag with a code from the closed enum. */
export class DomainError extends Data.TaggedError("DomainError")<{
  readonly code: ErrorCode;
  readonly path: string;
  readonly message: string;
  readonly fix_hint?: string;
  readonly retryable?: boolean;
  readonly expected?: string;
  readonly allowed?: ReadonlyArray<string>;
  readonly did_you_mean?: ReadonlyArray<string>;
  readonly suggestion?: typeof ErrorSuggestion.Type;
  readonly details?: Readonly<Record<string, unknown>>;
}> {}

const DEFAULT_HINTS: Record<ErrorCode, string> = {
  VALIDATION_FAILED: "Fix the value at the given path and retry once.",
  UNKNOWN_FIELD: "Use one of the allowed field names.",
  UNKNOWN_REFERENCE: "Choose a reference from the allowed list.",
  TYPE_MISMATCH: "Correct the type at the given path.",
  PREVIEW_REQUIRED: "Call node.preview, then node.commit with the returned token.",
  PREVIEW_STALE: "Preview again against the current head.",
  CONFLICT: "Re-read the node and re-preview the disjoint part only.",
  IDEMPOTENCY_KEY_REUSED: "Use a new idempotency key, or stop.",
  FORBIDDEN: "Do not retry. Report the missing permission.",
  RULE_REFUSED: "Change the operation or stop.",
  RATE_LIMITED: "Wait and retry.",
  QUERY_TIMEOUT: "Narrow the query: add a lower bound on the source time column.",
  SOURCE_STALE: "Retry later, or use an earlier as_of.",
  LOOP_SUSPECTED: "Stop repeating the call. Re-read the schema.",
  UNAUTHENTICATED: "Re-authenticate.",
};
const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "VALIDATION_FAILED",
  "UNKNOWN_FIELD",
  "UNKNOWN_REFERENCE",
  "TYPE_MISMATCH",
  "PREVIEW_REQUIRED",
  "PREVIEW_STALE",
  "CONFLICT",
  "RATE_LIMITED",
  "QUERY_TIMEOUT",
  "SOURCE_STALE",
]);

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 3) + "..." : s);

/** Map the tagged error onto the envelope error body (the edge mapping of ruling 22). */
export const toErrorBody = (e: DomainError): ErrorBody => ({
  code: e.code,
  path: e.path,
  message: clip(e.message, 280),
  ...(e.expected !== undefined ? { expected: e.expected } : {}),
  ...(e.allowed !== undefined ? { allowed: e.allowed.slice(0, 20) } : {}),
  ...(e.did_you_mean !== undefined ? { did_you_mean: e.did_you_mean.slice(0, 3) } : {}),
  ...(e.suggestion !== undefined ? { suggestion: e.suggestion } : {}),
  fix_hint: clip(e.fix_hint ?? DEFAULT_HINTS[e.code], 280),
  retryable: e.retryable ?? RETRYABLE.has(e.code),
  ...(e.details !== undefined ? { details: e.details } : {}),
});

export const httpStatusOf = (code: ErrorCode): number => {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
    case "RULE_REFUSED":
      return 403;
    case "UNKNOWN_REFERENCE":
      return 404;
    case "CONFLICT":
    case "IDEMPOTENCY_KEY_REUSED":
    case "PREVIEW_STALE":
      return 409;
    case "PREVIEW_REQUIRED":
      return 428;
    case "RATE_LIMITED":
      return 429;
    case "QUERY_TIMEOUT":
      return 504;
    case "SOURCE_STALE":
      return 503;
    default:
      return 422;
  }
};

export const domainError = (
  code: ErrorCode,
  path: string,
  message: string,
  extra?: Partial<ConstructorParameters<typeof DomainError>[0]>,
) => new DomainError({ code, path, message, ...extra });

/**
 * Copy of an error with another path. Spreading a DomainError would drop its `message` (an Error's message is not
 * enumerable), so every path rewrite goes through this.
 */
export const withPath = (e: DomainError, path: string): DomainError =>
  new DomainError({
    code: e.code,
    path,
    message: e.message,
    ...(e.fix_hint !== undefined ? { fix_hint: e.fix_hint } : {}),
    ...(e.retryable !== undefined ? { retryable: e.retryable } : {}),
    ...(e.expected !== undefined ? { expected: e.expected } : {}),
    ...(e.allowed !== undefined ? { allowed: e.allowed } : {}),
    ...(e.did_you_mean !== undefined ? { did_you_mean: e.did_you_mean } : {}),
    ...(e.suggestion !== undefined ? { suggestion: e.suggestion } : {}),
    ...(e.details !== undefined ? { details: e.details } : {}),
  });
