import { Schema as S } from "effect";
import { CondScalar, Handle, Region, Tier, Timestamp } from "./primitives";

/**
 * The condition tree shared by Segments, Promotion eligibility filters, Automation conditions and Badge criteria
 * filters (CONTRACT.md section 4). It is a closed boolean grammar over named facts: no expressions, no functions.
 * The evaluator is the pure function `evalCond(tree, facts) -> boolean` in `@plinth/core` (CONTRACT.md 4.3).
 */

export const COND_OPS = [
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "in",
  "not_in",
  "contains",
  "not_contains",
  "exists",
  "not_exists",
  "between",
] as const;
export const CondOp = S.Literal(...COND_OPS).annotations({ identifier: "CondOp" });
export type CondOp = typeof CondOp.Type;

export const FactPath = S.String.pipe(
  S.maxLength(64),
  S.pattern(/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*){0,3}$/),
  S.annotations({
    identifier: "FactPath",
    description: "A fact name, e.g. tier, member.region, event.points",
  }),
);

export const Condition = S.Struct({
  field: FactPath,
  op: CondOp,
  value: S.optional(S.Union(CondScalar, S.Array(CondScalar).pipe(S.maxItems(100)))),
}).annotations({ identifier: "Condition" });
export type Condition = typeof Condition.Type;

export type CondTree =
  | Condition
  | { readonly all: ReadonlyArray<CondTree> }
  | { readonly any: ReadonlyArray<CondTree> }
  | { readonly not: CondTree };

const sub = S.suspend((): S.Schema<CondTree> => CondTree);
export const CondTree: S.Schema<CondTree> = S.Union(
  Condition,
  S.Struct({ all: S.Array(sub).pipe(S.minItems(1), S.maxItems(20)) }),
  S.Struct({ any: S.Array(sub).pipe(S.minItems(1), S.maxItems(20)) }),
  S.Struct({ not: sub }),
).annotations({ identifier: "CondTree" });

export const FACT_TYPES = ["string", "int", "float", "bool", "timestamp", "enum", "string[]"] as const;

/** One fact a builder can offer: its path, type, allowed values for enums, and the operators that apply. */
export const FactDef = S.Struct({
  path: FactPath,
  label: S.String,
  type: S.Literal(...FACT_TYPES),
  values: S.optional(S.Array(S.String)),
  ops: S.Array(CondOp),
  description: S.optional(S.String),
}).annotations({ identifier: "FactDef" });
export type FactDef = typeof FactDef.Type;

const NUM_OPS = ["eq", "ne", "lt", "lte", "gt", "gte", "between"] as const;
const ENUM_OPS = ["eq", "ne", "in", "not_in"] as const;
const LIST_OPS = ["contains", "not_contains"] as const;

/**
 * Member facts: what a Segment rule, a Promotion eligibility filter and an Automation `member.*` condition can see.
 * Computed by the backend from `members`, `ledger_accounts`, `store_orders`, `badge_awards` and Role/Group nodes.
 */
export const MemberFacts = S.Struct({
  handle: Handle,
  region: Region,
  tier: Tier,
  balance: S.Int,
  lifetime_points: S.Int,
  points_earned_30d: S.Int,
  points_redeemed_30d: S.Int,
  orders_90d: S.Int,
  badges_count: S.Int,
  badges: S.Array(S.String),
  groups: S.Array(S.String),
  roles: S.Array(S.String),
  department: S.String,
  joined_days: S.Int,
  last_active_days: S.Int,
  status: S.Literal("active", "disabled"),
}).annotations({ identifier: "MemberFacts" });
export type MemberFacts = typeof MemberFacts.Type;

export const MEMBER_FACTS: ReadonlyArray<FactDef> = [
  {
    path: "tier",
    label: "Tier",
    type: "enum",
    values: ["bronze", "silver", "gold", "platinum"],
    ops: [...ENUM_OPS],
  },
  {
    path: "region",
    label: "Region",
    type: "enum",
    values: ["NA", "EMEA", "APAC", "LATAM", "ANZ"],
    ops: [...ENUM_OPS],
  },
  { path: "balance", label: "Points balance", type: "int", ops: [...NUM_OPS] },
  { path: "lifetime_points", label: "Lifetime points", type: "int", ops: [...NUM_OPS] },
  { path: "points_earned_30d", label: "Points earned, last 30 days", type: "int", ops: [...NUM_OPS] },
  { path: "points_redeemed_30d", label: "Points redeemed, last 30 days", type: "int", ops: [...NUM_OPS] },
  { path: "orders_90d", label: "Store orders, last 90 days", type: "int", ops: [...NUM_OPS] },
  { path: "badges_count", label: "Badges held", type: "int", ops: [...NUM_OPS] },
  { path: "badges", label: "Holds badge", type: "string[]", ops: [...LIST_OPS], description: "Badge slugs" },
  { path: "groups", label: "In group", type: "string[]", ops: [...LIST_OPS], description: "Group slugs" },
  { path: "roles", label: "Has role", type: "string[]", ops: [...LIST_OPS], description: "Role slugs" },
  {
    path: "department",
    label: "Department",
    type: "enum",
    values: ["operations", "fulfilment", "finance", "marketing", "technology", "people"],
    ops: [...ENUM_OPS],
  },
  { path: "joined_days", label: "Days since joining", type: "int", ops: [...NUM_OPS] },
  { path: "last_active_days", label: "Days since last activity", type: "int", ops: [...NUM_OPS] },
];

export const DEPARTMENTS = [
  "operations",
  "fulfilment",
  "finance",
  "marketing",
  "technology",
  "people",
] as const;
export const Department = S.Literal(...DEPARTMENTS).annotations({ identifier: "Department" });

/** Context facts an Automation condition sees alongside `member.*`: `event.*` (the trigger payload) and `now`. */
export const AutomationFactsNote =
  "Automation conditions address event.<payload field>, member.<member fact> (the event's subject member) and now (Timestamp).";

export const NowFact = S.Struct({ now: Timestamp });
