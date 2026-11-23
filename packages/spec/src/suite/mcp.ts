import { Schema as S } from "effect";
import { IdempotencyKey } from "./primitives";

/**
 * The two MCP tools the Suite adds to the 15 generic verbs (CONTRACT.md section 14), making 17. Configuration is
 * written with the existing node verbs (node.preview/node.commit on the Suite kinds); every domain action, read or
 * write, goes through `action.invoke` against the action registry. The MCP surface stays generic: adding a domain
 * action never adds a tool.
 */

export const ActionListInput = S.Struct({
  module: S.optional(
    S.String.pipe(
      S.maxLength(32),
      S.annotations({ description: "Filter by module, e.g. points, store, messages" }),
    ),
  ),
  name: S.optional(
    S.String.pipe(S.maxLength(64), S.annotations({ description: "One action, with its schemas" })),
  ),
  include_schemas: S.optional(
    S.Boolean.annotations({
      description: "Include input and output JSON Schema (default true when name is given)",
    }),
  ),
}).annotations({ identifier: "ActionListInput" });
export type ActionListInput = typeof ActionListInput.Type;

export const ActionInvokeInput = S.Struct({
  action: S.String.pipe(
    S.pattern(/^[a-z][a-z_]*(\.[a-z_]+)+$/),
    S.annotations({ description: "Registry name from action.list, e.g. points.transfer" }),
  ),
  input: S.optional(
    S.Record({ key: S.String, value: S.Unknown }).annotations({
      description: "The action's input object (its input_schema). Omit when committing with a preview_token.",
    }),
  ),
  dry_run: S.optional(
    S.Boolean.annotations({
      description:
        "Mutating actions: true returns a preview with preview_token and decision; nothing is written.",
    }),
  ),
  preview_token: S.optional(
    S.String.pipe(
      S.pattern(/^pvt_[A-Za-z0-9_-]{43}$/),
      S.annotations({ description: "Commit exactly what the dry run previewed (single use, valid 300 s)." }),
    ),
  ),
  idempotency_key: S.optional(IdempotencyKey),
  reason: S.optional(S.String.pipe(S.maxLength(280))),
}).annotations({
  identifier: "ActionInvokeInput",
  description:
    "Reads: {action, input}. Writes: {action, input, dry_run: true} then {action, preview_token, idempotency_key}.",
});
export type ActionInvokeInput = typeof ActionInvokeInput.Type;
