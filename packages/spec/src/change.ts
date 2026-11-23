import { Schema } from "effect";
import { Kind, Uri, Revision, Surface } from "./common";

/**
 * Change ops within one node body (spec 02 section 3.9.8, L1 subset).
 * Paths are RFC 6901 JSON Pointers into the node body. `set` on an array index or `-` inserts.
 */
export const JsonPointer = Schema.String.pipe(
  Schema.pattern(/^(\/([^/~]|~[01])*)*$/),
  Schema.annotations({ identifier: "JsonPointer" }),
);

export const CreateOp = Schema.Struct({
  op: Schema.Literal("create"),
  kind: Kind,
  slug: Schema.String,
  body: Schema.Unknown,
});
export const SetOp = Schema.Struct({ op: Schema.Literal("set"), path: JsonPointer, value: Schema.Unknown });
export const RemoveOp = Schema.Struct({ op: Schema.Literal("remove"), path: JsonPointer });
export const DeleteOp = Schema.Struct({ op: Schema.Literal("delete") });

export const Op = Schema.Union(CreateOp, SetOp, RemoveOp, DeleteOp).annotations({ identifier: "ChangeOp" });
export type Op = typeof Op.Type;

/** The ops for one target node, with the revision they were authored against (null for a create). */
export const NodeChange = Schema.Struct({
  target: Uri,
  base_revision: Schema.NullOr(Revision),
  ops: Schema.Array(Op).pipe(Schema.minItems(1), Schema.maxItems(64)),
}).annotations({ identifier: "NodeChange" });
export type NodeChange = typeof NodeChange.Type;

/** One request: an ordered list of node changes committed in one transaction. */
export const ChangeSet = Schema.Struct({
  changes: Schema.Array(NodeChange).pipe(Schema.minItems(1), Schema.maxItems(16)),
}).annotations({ identifier: "ChangeSet" });
export type ChangeSet = typeof ChangeSet.Type;

/** Body of `POST /changes` (human and UI commits). */
export const CommitRequest = Schema.Struct({
  changes: ChangeSet.fields.changes,
  idempotency_key: Schema.optional(Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9:._-]{8,128}$/))),
  reason: Schema.optional(Schema.String.pipe(Schema.maxLength(280))),
  preview_token: Schema.optional(Schema.String.pipe(Schema.pattern(/^pvt_[A-Za-z0-9_-]{43}$/))),
  surface: Schema.optional(Surface),
}).annotations({ identifier: "CommitRequest" });
export type CommitRequest = typeof CommitRequest.Type;

export const CommittedNode = Schema.Struct({
  uri: Schema.String,
  result_revision: Schema.Int,
  change_seq: Schema.Int,
});
export const CommitResult = Schema.Struct({
  status: Schema.Literal("committed", "pending_approval"),
  replayed: Schema.Boolean,
  commit_id: Schema.String,
  change_seq: Schema.optional(Schema.Int),
  nodes: Schema.optional(Schema.Array(CommittedNode)),
  approval_id: Schema.optional(Schema.String),
  merged_from: Schema.optional(
    Schema.Struct({ base: Schema.Int, head: Schema.Int, rebased_paths: Schema.Array(Schema.String) }),
  ),
}).annotations({ identifier: "CommitResult" });
export type CommitResult = typeof CommitResult.Type;

/** One change row as pushed over `/rt` (spec 05 section 9.5, `events.items`). */
export const ChangeEvent = Schema.Struct({
  seq: Schema.Int,
  kind: Schema.Literal("change", "present", "event"),
  node: Schema.String,
  rev: Schema.NullOr(Schema.Int),
  surface: Surface,
  actor: Schema.String,
  on_behalf_of: Schema.NullOr(Schema.String),
  rule_id: Schema.Array(Schema.String),
  ops_summary: Schema.String,
  contains_untrusted: Schema.Boolean,
});
export type ChangeEvent = typeof ChangeEvent.Type;
