import { Schema } from "effect";
import { Kind, NodeRef, Revision, ChangeSeq, Surface } from "./common";
import { Scalar } from "./query-ast";
import { Params, QueryOrRef } from "./query-io";
import { Permission } from "./grant";

/** MCP tool inputs (spec 06 section 4). The JSON Schema served by `tools/list` is derived from these. */

const Cursor = Schema.String.pipe(Schema.maxLength(256));
const IdempotencyKey = Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9:._-]{8,128}$/));
const PreviewToken = Schema.String.pipe(
  Schema.pattern(/^pvt_[A-Za-z0-9_-]{43}$/),
  Schema.annotations({
    description: "The preview_token returned by node.preview (single use, valid 300 s).",
  }),
);

export const SchemaDescribeInput = Schema.Struct({
  kind: Schema.optional(Kind.annotations({ description: "Omit to list every node kind." })),
  include_examples: Schema.optional(Schema.Boolean),
}).annotations({ identifier: "SchemaDescribeInput" });
export type SchemaDescribeInput = typeof SchemaDescribeInput.Type;

export const NodeGetInput = Schema.Struct({
  uri: NodeRef,
  at_revision: Schema.optional(Revision),
  fields: Schema.optional(Schema.Array(Schema.Literal("body", "lineage"))),
  max_bytes: Schema.optional(Schema.Int.pipe(Schema.between(1, 262144))),
}).annotations({ identifier: "NodeGetInput" });
export type NodeGetInput = typeof NodeGetInput.Type;

export const NodeSearchInput = Schema.Struct({
  kind: Schema.optional(Kind),
  text: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  labels: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String.pipe(Schema.maxLength(64)) }),
  ),
  limit: Schema.optional(Schema.Int.pipe(Schema.between(1, 100))),
}).annotations({ identifier: "NodeSearchInput" });
export type NodeSearchInput = typeof NodeSearchInput.Type;

/** RFC 6901 JSON Patch subset used by node.preview. add/replace become `set`, remove becomes `remove`. */
export const PatchOp = Schema.Struct({
  op: Schema.Literal("add", "remove", "replace"),
  path: Schema.String.pipe(Schema.pattern(/^(\/([^/~]|~[01])*)*$/)),
  value: Schema.optional(Schema.Unknown),
}).annotations({ identifier: "PatchOp" });
export type PatchOp = typeof PatchOp.Type;

const LayoutAtFields = {
  x: Schema.Int.pipe(Schema.greaterThanOrEqualTo(0)),
  y: Schema.Int.pipe(Schema.greaterThanOrEqualTo(0)),
  w: Schema.Int.pipe(Schema.greaterThanOrEqualTo(1)),
  h: Schema.Int.pipe(Schema.greaterThanOrEqualTo(1)),
};

export const PlaceInput = Schema.Struct({
  dashboard: NodeRef,
  at: Schema.optional(
    Schema.Struct(LayoutAtFields).annotations({
      description:
        "Grid position {x,y,w,h} on a 12-column grid. Omit to auto-place below the lowest panel at full width, height 6.",
    }),
  ),
}).annotations({ identifier: "PlaceInput" });
export type PlaceInput = typeof PlaceInput.Type;

export const NodePreviewInput = Schema.Struct({
  kind: Kind,
  uri: Schema.optional(NodeRef),
  body: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }).annotations({
      description:
        "Create: the full document {metadata:{slug,title}, spec}. apiVersion and kind default from this call. The spec shape per kind comes from schema.describe(kind), which includes a valid example. A Grant may also be given flat: {principal, actions or action, resource, row_predicate?}.",
    }),
  ),
  patch: Schema.optional(
    Schema.Array(PatchOp).pipe(
      Schema.maxItems(64),
      Schema.annotations({
        description:
          'Update: JSON-patch ops against the body, e.g. [{"op":"replace","path":"/metadata/title","value":"New title"}]. Needs uri and base_revision.',
      }),
    ),
  ),
  base_revision: Schema.optional(Revision),
  delete: Schema.optional(Schema.Boolean),
  undo_of: Schema.optional(
    ChangeSeq.annotations({ description: "Preview the inverse of this change sequence." }),
  ),
  place: Schema.optional(PlaceInput),
}).annotations({ identifier: "NodePreviewInput" });
export type NodePreviewInput = typeof NodePreviewInput.Type;

export const NodeCommitInput = Schema.Struct({
  preview_token: PreviewToken,
  idempotency_key: IdempotencyKey,
  reason: Schema.optional(Schema.String.pipe(Schema.maxLength(280))),
}).annotations({ identifier: "NodeCommitInput" });
export type NodeCommitInput = typeof NodeCommitInput.Type;

export const NodeDeleteInput = Schema.Struct({
  preview_token: PreviewToken,
  uri: NodeRef,
  base_revision: Revision,
  reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(280)),
  idempotency_key: Schema.optional(IdempotencyKey),
}).annotations({ identifier: "NodeDeleteInput" });
export type NodeDeleteInput = typeof NodeDeleteInput.Type;

export const NodeUndoInput = Schema.Struct({
  preview_token: PreviewToken,
  change_seq: ChangeSeq,
  base_revision: Revision,
  reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(280)),
  idempotency_key: Schema.optional(IdempotencyKey),
}).annotations({ identifier: "NodeUndoInput" });
export type NodeUndoInput = typeof NodeUndoInput.Type;

export const SourceListInput = Schema.Struct({
  domain: Schema.optional(Schema.String.pipe(Schema.maxLength(64))),
  source: Schema.optional(NodeRef),
  limit: Schema.optional(Schema.Int.pipe(Schema.between(1, 200))),
}).annotations({ identifier: "SourceListInput" });
export type SourceListInput = typeof SourceListInput.Type;

export const QueryExplainInput = Schema.Struct({
  query: QueryOrRef,
  params: Schema.optional(Params),
  dashboard: Schema.optional(NodeRef),
}).annotations({ identifier: "QueryExplainInput" });
export type QueryExplainInput = typeof QueryExplainInput.Type;

export const ChangeHistoryInput = Schema.Struct({
  uri: Schema.optional(NodeRef),
  principal: Schema.optional(Schema.String.pipe(Schema.maxLength(128))),
  since: Schema.optional(Schema.String),
  surface: Schema.optional(Surface),
  idempotency_key: Schema.optional(IdempotencyKey),
  limit: Schema.optional(Schema.Int.pipe(Schema.between(1, 200))),
}).annotations({ identifier: "ChangeHistoryInput" });
export type ChangeHistoryInput = typeof ChangeHistoryInput.Type;

export const DiffInput = Schema.Struct({
  a: Schema.String.pipe(
    Schema.pattern(/^.+@[0-9]+$/),
    Schema.annotations({ description: "<node>@<revision>, where <node> is a URI, kind:slug or slug." }),
  ),
  b: Schema.String.pipe(Schema.pattern(/^.+@[0-9]+$/)),
}).annotations({ identifier: "DiffInput" });
export type DiffInput = typeof DiffInput.Type;

export const GrantCheckInput = Schema.Struct({
  resource: NodeRef,
  action: Permission,
  principal: Schema.optional(Schema.String.pipe(Schema.maxLength(128))),
  with_counts: Schema.optional(Schema.Boolean),
  proposed: Schema.optional(
    Schema.Struct({
      row_predicate: Schema.String.pipe(Schema.maxLength(512)),
      column_mask: Schema.optional(Schema.Array(Schema.String).pipe(Schema.maxItems(64))),
    }),
  ),
}).annotations({ identifier: "GrantCheckInput" });
export type GrantCheckInput = typeof GrantCheckInput.Type;

export const UiPresentInput = Schema.Struct({
  uri: NodeRef,
  target: Schema.optional(Schema.String.pipe(Schema.pattern(/^(all|principal:[a-z0-9:_-]{1,128})$/))),
  focus: Schema.optional(Schema.Struct({ parameter: Schema.String, value: Scalar })),
}).annotations({ identifier: "UiPresentInput" });
export type UiPresentInput = typeof UiPresentInput.Type;

export const ChangeStatusInput = Schema.Struct({
  change_id: Schema.optional(ChangeSeq),
  group_id: Schema.optional(Schema.String.pipe(Schema.maxLength(64))),
  approval_id: Schema.optional(Schema.String.pipe(Schema.maxLength(64))),
}).annotations({
  identifier: "ChangeStatusInput",
  description: "Exactly one of change_id, group_id or approval_id.",
});
export type ChangeStatusInput = typeof ChangeStatusInput.Type;

export const PreviewData = Schema.Struct({
  valid: Schema.Boolean,
  diff: Schema.Array(
    Schema.Struct({
      uri: Schema.String,
      op: Schema.Literal("create", "update", "delete", "undo"),
      path: Schema.optional(Schema.String),
      before_hash: Schema.optional(Schema.String),
      after_hash: Schema.String,
    }),
  ),
  rule_id: Schema.Array(Schema.String),
  decision: Schema.Literal("auto", "approval"),
  change_hash: Schema.String,
  base: Schema.Record({ key: Schema.String, value: Schema.Int }),
  preview_token: Schema.String,
  expires_in_s: Schema.Int,
}).annotations({ identifier: "PreviewData" });
export type PreviewData = typeof PreviewData.Type;
