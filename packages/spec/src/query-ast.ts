import { Schema } from "effect";

/** Query AST (spec 02 section 3.4, 06 section 3). L1 supports from/where/derive/group/aggregate/select/order/limit. */
export const Field = Schema.String.pipe(
  Schema.maxLength(64),
  Schema.pattern(/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/),
  Schema.annotations({ identifier: "Field" }),
);

export const SourceRef = Schema.String.pipe(
  Schema.pattern(/^(source|query):[a-z][a-z0-9_.]*$/),
  Schema.annotations({ identifier: "SourceRef" }),
);

export const Scalar = Schema.Union(Schema.String, Schema.Number, Schema.Boolean, Schema.Null);

export const PredOp = Schema.Literal(
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "in",
  "not_in",
  "is_null",
  "not_null",
);
export type PredOp = typeof PredOp.Type;

/** `{"expr": "now() - 1h"}`: a value computed by the expression language (relative time, `$param`, arithmetic). */
export const ExprValue = Schema.Struct({
  expr: Schema.String.pipe(Schema.maxLength(200)),
}).annotations({ identifier: "ExprValue" });

export const Predicate = Schema.Struct({
  field: Field,
  op: PredOp,
  value: Schema.optional(
    Schema.Union(Scalar, Schema.Array(Scalar).pipe(Schema.maxItems(100)), ExprValue).annotations({
      description:
        'A JSON literal typed by the field: strings raw (EMEA, not \'EMEA\'), numbers, booleans, timestamps as ISO-8601 strings (2026-11-20T14:00:00Z). Relative time: {"expr":"now() - 1h"}. "in"/"not_in" take an array.',
    }),
  ),
}).annotations({ identifier: "Predicate" });
export type Predicate = typeof Predicate.Type;

export const AGG_FNS = ["count", "count_distinct", "sum", "avg", "min", "max", "percentile"] as const;

/** Object form of an aggregate (spec 02 section 3.4): `{fn, of?, p?}`. */
export const AggObject = Schema.Struct({
  fn: Schema.Literal(...AGG_FNS),
  of: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  p: Schema.optional(Schema.Number),
}).annotations({ identifier: "AggObject" });
export type AggObject = typeof AggObject.Type;

export const Agg = Schema.Union(AggObject, Schema.String.pipe(Schema.maxLength(200))).annotations({
  identifier: "Agg",
});
export type Agg = typeof Agg.Type;

export const OrderItem = Schema.Struct({ field: Field, dir: Schema.Literal("asc", "desc") });

const WHERE_DOC =
  'Conjunction of predicates {field, op, value}. op: eq ne lt lte gt gte in not_in is_null not_null. value is a JSON literal typed by the field: strings raw (EMEA, never \'EMEA\'), numbers, booleans, ISO-8601 timestamps as plain strings. Relative time: {"expr":"now() - 1h"} (the bare string "now() - 1h" is also accepted). Landed sources need a gt/gte lower bound on their time column.';
const DERIVE_DOC =
  'Map of new field name to expression over fields. Operators + - * / = != < <= > >= and or not. Functions: now(), abs(x), ms(duration) -> int ms, round(x, n), coalesce(a, b), date_trunc(1h, ts), bucket(ts, \'1 minute\') (units second/minute/hour/day). timestamp - timestamp yields a duration in MILLISECONDS. Duration literals: 90s 15m 1h 3d. Example: {"latency_ms":"ms(fulfilled_at - placed_at)","minute":"bucket(placed_at, \'1 minute\')"}. Group by a derived name to bucket time.';
const AGG_DOC =
  'Map of output name to aggregate. Object form (canonical): {"fn":"percentile","of":"latency_ms","p":0.95}, {"fn":"count"}, {"fn":"avg","of":"latency_ms"}; fn is count count_distinct sum avg min max percentile. String alias: "percentile(latency_ms, 0.95)", "count()", "sum(order_value_cents)".';

export const QueryAst = Schema.Struct({
  from: SourceRef.annotations({ description: "source:<slug>, for example source:orders" }),
  where: Schema.optional(
    Schema.Array(Predicate).pipe(Schema.maxItems(32), Schema.annotations({ description: WHERE_DOC })),
  ),
  derive: Schema.optional(
    Schema.Record({ key: Field, value: Schema.String.pipe(Schema.maxLength(200)) }).annotations({
      description: DERIVE_DOC,
    }),
  ),
  group: Schema.optional(Schema.Array(Field).pipe(Schema.maxItems(8))),
  aggregate: Schema.optional(Schema.Record({ key: Field, value: Agg }).annotations({ description: AGG_DOC })),
  select: Schema.optional(Schema.Array(Field).pipe(Schema.maxItems(64))),
  order: Schema.optional(Schema.Array(OrderItem).pipe(Schema.maxItems(8))),
  limit: Schema.optional(Schema.Int.pipe(Schema.between(1, 1000))),
}).annotations({ identifier: "QueryAst" });
export type QueryAst = typeof QueryAst.Type;
