import { Schema } from "effect";
import { QueryAst, Scalar } from "./query-ast";
import { NodeRef } from "./common";

export const QueryOrRef = Schema.Union(QueryAst, NodeRef).annotations({
  description: "An inline query AST, or the slug/URI of a Query node.",
});
export const Params = Schema.Record({ key: Schema.String, value: Scalar }).pipe(
  Schema.annotations({
    description: "Values for $name references in the query. Dashboard parameter defaults apply.",
  }),
);

/** Input of `POST /query` and MCP `query.run` (spec 06 section 4.2). */
export const QueryRunInput = Schema.Struct({
  query: QueryOrRef,
  params: Schema.optional(Params),
  dashboard: Schema.optional(
    NodeRef.annotations({
      description:
        "The Dashboard the query runs for. Its grants apply (row predicates, masks) and its parameter defaults.",
    }),
  ),
  as_of: Schema.optional(
    Schema.String.annotations({ description: "RFC 3339 timestamp; defaults to the live watermark." }),
  ),
  limit: Schema.optional(Schema.Int.pipe(Schema.between(1, 1000))),
  dry_run: Schema.optional(Schema.Boolean),
  timeout_ms: Schema.optional(Schema.Int.pipe(Schema.between(100, 30000))),
}).annotations({ identifier: "QueryRunInput" });
export type QueryRunInput = typeof QueryRunInput.Type;

export const ResultColumn = Schema.Struct({ name: Schema.String, type: Schema.String });

export const QueryResult = Schema.Struct({
  columns: Schema.Array(ResultColumn),
  rows: Schema.Array(Schema.Array(Schema.Unknown)),
  row_count: Schema.Int,
  truncated: Schema.Boolean,
  as_of: Schema.String,
  watermarks: Schema.Array(Schema.Struct({ source: Schema.String, watermark: Schema.String })),
  plan_summary: Schema.Struct({
    sources: Schema.Array(Schema.String),
    partitions_read: Schema.Int,
    partitions_pruned: Schema.Int,
  }),
  result_hash: Schema.String,
  policy_hash: Schema.String,
  cache: Schema.Literal("hit", "miss"),
  next_cursor: Schema.NullOr(Schema.String),
}).annotations({ identifier: "QueryResult" });
export type QueryResult = typeof QueryResult.Type;
