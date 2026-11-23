import { Schema as S } from "effect";
import { TxnType } from "../events";
import { TierProgress } from "./me";
import {
  DateOnly,
  Handle,
  IdempotencyKey,
  PageQuery,
  PersonRef,
  Points,
  PositivePoints,
  SignedPoints,
  Tier,
  Timestamp,
  UserText,
} from "../primitives";

/** Points bank and ledger (CONTRACT.md module M3). Amounts are integers; a credit is positive. */

export const SYSTEM_ACCOUNTS = ["issuance", "promotions", "redemption", "expiry", "adjustments"] as const;
export const SystemAccount = S.Literal(...SYSTEM_ACCOUNTS).annotations({ identifier: "SystemAccount" });

/** `member:<handle>` or `system:<name>`. */
export const AccountCode = S.String.pipe(
  S.pattern(/^(member:[a-z][a-z0-9-]{1,39}|system:(issuance|promotions|redemption|expiry|adjustments))$/),
  S.annotations({ identifier: "AccountCode" }),
);

export const EntryView = S.Struct({
  account: AccountCode,
  member: S.NullOr(PersonRef),
  amount: SignedPoints,
  balance_after: S.Int,
}).annotations({ identifier: "EntryView" });

export const TxnRef = S.Struct({
  kind: S.Literal(
    "order",
    "promotion",
    "badge_award",
    "automation_run",
    "transfer",
    "txn",
    "approval",
    "seed",
  ),
  id: S.String,
  label: S.String,
  link: S.NullOr(S.String),
}).annotations({ identifier: "TxnRef" });

export const StatementLine = S.Struct({
  txn_id: S.UUID,
  txn_no: S.Int,
  txn_type: TxnType,
  occurred_at: Timestamp,
  memo: S.String,
  amount: SignedPoints,
  balance_after: Points,
  counterparty: S.NullOr(S.Union(PersonRef, S.Struct({ system: S.String }))),
  ref: S.NullOr(TxnRef),
  actor: PersonRef,
  reversed_by: S.NullOr(S.UUID),
}).annotations({ identifier: "StatementLine" });
export type StatementLine = typeof StatementLine.Type;

export const ExpiryBucket = S.Struct({ expires_on: DateOnly, points: Points, lots: S.Int }).annotations({
  identifier: "ExpiryBucket",
});

export const MemberQuery = S.Struct({
  /** Omit for yourself. Another member needs points:view-all (a regional predicate applies). */
  member: S.optional(Handle),
});

export const PointsSummaryOut = S.Struct({
  member: PersonRef,
  account: AccountCode,
  balance: Points,
  tier: TierProgress,
  earned_30d: Points,
  redeemed_30d: Points,
  expiring_soon: S.Array(ExpiryBucket),
  recent: S.Array(StatementLine),
  transfer_remaining_today: Points,
}).annotations({ identifier: "PointsSummaryOut" });

export const StatementIn = S.Struct({
  member: S.optional(Handle),
  from: S.optional(Timestamp),
  to: S.optional(Timestamp),
  types: S.optional(S.Array(TxnType)),
  ...PageQuery,
}).annotations({ identifier: "StatementIn" });

export const StatementOut = S.Struct({
  items: S.Array(StatementLine),
  next_cursor: S.NullOr(S.String),
  opening_balance: Points,
  closing_balance: Points,
  credits: Points,
  debits: Points,
}).annotations({ identifier: "StatementOut" });

export const TxnIn = S.Struct({ txn_id: S.UUID });
export const TxnDetailOut = S.Struct({
  txn_id: S.UUID,
  txn_no: S.Int,
  txn_type: TxnType,
  occurred_at: Timestamp,
  recorded_at: Timestamp,
  memo: S.String,
  actor: PersonRef,
  on_behalf_of: S.NullOr(PersonRef),
  surface: S.String,
  entries: S.Array(EntryView),
  lots: S.Array(
    S.Struct({
      lot_id: S.UUID,
      account: AccountCode,
      change: S.Literal("created", "consumed", "restored", "expired"),
      points: Points,
      expires_at: Timestamp,
    }),
  ),
  ref: S.NullOr(TxnRef),
  reverses: S.NullOr(S.UUID),
  reversed_by: S.NullOr(S.UUID),
  idempotency_key: S.NullOr(S.String),
  event_seq: S.Int,
}).annotations({ identifier: "TxnDetailOut" });

export const TransferIn = S.Struct({
  to: Handle,
  points: PositivePoints,
  memo: UserText(200).pipe(S.minLength(1)),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "TransferIn" });

export const TxnResult = S.Struct({
  txn_id: S.UUID,
  txn_no: S.Int,
  balance: Points,
  replayed: S.Boolean,
}).annotations({ identifier: "TxnResult" });

export const AWARD_CATEGORIES = ["recognition", "performance", "milestone", "service", "other"] as const;

export const AwardIn = S.Struct({
  to: S.Array(Handle).pipe(S.minItems(1), S.maxItems(50)),
  points: PositivePoints,
  category: S.Literal(...AWARD_CATEGORIES),
  reason: UserText(280).pipe(S.minLength(1)),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "AwardIn" });

export const AwardOut = S.Struct({
  status: S.Literal("committed", "pending_approval"),
  approval_id: S.NullOr(S.UUID),
  /** One transaction per recipient (idempotency key `<key>:<handle>`), with promotion bonuses applied. */
  results: S.Array(
    S.Struct({
      member: Handle,
      txn_id: S.NullOr(S.UUID),
      base_points: Points,
      bonus_points: Points,
      promotions: S.Array(S.String),
    }),
  ),
  replayed: S.Boolean,
}).annotations({ identifier: "AwardOut" });

export const AdjustIn = S.Struct({
  member: Handle,
  points: SignedPoints.pipe(S.filter((n) => n !== 0, { message: () => "points must not be 0" })),
  reason: UserText(280).pipe(S.minLength(1)),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "AdjustIn" });

export const ExpiryOut = S.Struct({
  member: PersonRef,
  buckets: S.Array(ExpiryBucket),
  next_warning: S.NullOr(S.Struct({ on: DateOnly, points: Points })),
}).annotations({ identifier: "ExpiryOut" });

export const TiersOut = S.Struct({
  tiers: S.Array(
    S.Struct({
      tier: Tier,
      min_lifetime_points: Points,
      perks: S.Array(S.String),
      members: S.Int,
    }),
  ),
}).annotations({ identifier: "TiersOut" });

export const AccountView = S.Struct({
  account: AccountCode,
  kind: S.Literal("member", "system"),
  member: S.NullOr(PersonRef),
  balance: S.Int,
  lifetime_earned: Points,
  entries: S.Int,
  last_entry_at: S.NullOr(Timestamp),
}).annotations({ identifier: "AccountView" });

export const AccountsIn = S.Struct({
  kind: S.optional(S.Literal("member", "system")),
  q: S.optional(S.String),
  ...PageQuery,
});
export const AccountsOut = S.Struct({ items: S.Array(AccountView), next_cursor: S.NullOr(S.String) });

export const TrialBalanceOut = S.Struct({
  ok: S.Boolean,
  checked_at: Timestamp,
  system: S.Array(S.Struct({ account: AccountCode, balance: S.Int })),
  member_total: S.Int,
  /** Must be exactly 0. */
  grand_total: S.Int,
  /** Sum of remaining lots; must equal member_total. */
  lots_total: S.Int,
  /** Accounts whose cached balance differs from the sum of their entries. Must be empty. */
  drift: S.Array(S.Struct({ account: AccountCode, cached: S.Int, computed: S.Int })),
  unbalanced_txns: S.Array(S.UUID),
  txn_count: S.Int,
}).annotations({ identifier: "TrialBalanceOut" });

export const ReverseIn = S.Struct({
  txn_id: S.UUID,
  reason: UserText(280).pipe(S.minLength(1)),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "ReverseIn" });
