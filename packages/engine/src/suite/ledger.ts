import { newId } from "./ids";
import { Effect } from "effect";
import { canonicalize, sha256, uuidv5 } from "@plinth/core";
import { DomainError, PLINTH_NS, type ProgramSpec, type Tier, type TxnType } from "@plinth/spec";
import { ControlStore, store } from "../control-store";
import type { StoreError } from "../errors";
import { ensureDomainChain, emitFrom, type EmitCtx, type PrincipalRef } from "./domain-events";
import { createNotifications } from "./notify";
import { addMonths, loadProgram, nextCounter, tierOf } from "./program";

/**
 * The double-entry points ledger (CONTRACT.md section 7). Every posting is ONE function, `postTransaction`, which in
 * the caller's transaction: checks idempotency (L7), locks the touched accounts in ascending id order, refuses a debit
 * past zero with `INSUFFICIENT_POINTS` before any write (L2), allocates `txn_no`, inserts the transaction and its signed
 * entries (the database triggers keep balances, L3, and check that the entries sum to 0 at COMMIT, L1), moves the lots
 * (L5), recomputes tier (L9), and emits one `points.posted` per account touched (L8), plus `tier.changed` and a
 * `tier_changed` notification on a tier move. The typed builders below (`postAward`, `postPurchase`, ...) are the
 * templates of CONTRACT 7.2; wave-2 handlers call those, never `postTransaction` directly.
 */

export const SYSTEM_ACCOUNTS = ["issuance", "promotions", "redemption", "expiry", "adjustments"] as const;
export type SystemAccount = (typeof SYSTEM_ACCOUNTS)[number];

/** `UUIDv5(PLINTH_NS, "account|<ws>|<code>")` (7.1). Codes: `member:<handle>` or `system:<name>`. */
export const accountId = (ws: string, code: string): string => uuidv5(PLINTH_NS, `account|${ws}|${code}`);
export const memberCode = (handle: string): string => `member:${handle}`;
export const systemCode = (name: SystemAccount): string => `system:${name}`;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

const refusal = (
  code: DomainError["code"],
  reason: string,
  message: string,
  details: Record<string, unknown> = {},
) => new DomainError({ code, path: "", message, details: { reason, ...details } });

/** Create the five system accounts if missing (idempotent). */
export const ensureSystemAccounts = (ws: string, now: Date): Effect.Effect<void, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    for (const name of SYSTEM_ACCOUNTS) {
      const code = systemCode(name);
      yield* store(
        sql`INSERT INTO ledger_accounts (account_id, workspace_id, code, kind, created_at)
            VALUES (${accountId(ws, code)}, ${ws}, ${code}, 'system', ${now.toISOString()}::timestamptz)
            ON CONFLICT (account_id) DO NOTHING`,
      );
    }
  });

/** Create the member account (`member:<handle>`, tier bronze, balance 0) if missing (idempotent). */
export const ensureMemberAccount = (
  ws: string,
  member: { readonly id: string; readonly handle: string },
  now: Date,
): Effect.Effect<string, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const code = memberCode(member.handle);
    const id = accountId(ws, code);
    yield* store(
      sql`INSERT INTO ledger_accounts (account_id, workspace_id, code, kind, member_id, tier, created_at)
          VALUES (${id}, ${ws}, ${code}, 'member', ${member.id}, 'bronze', ${now.toISOString()}::timestamptz)
          ON CONFLICT (account_id) DO NOTHING`,
    );
    return id;
  });

// ---- the posting plan -----------------------------------------------------------------------------------

export interface Leg {
  /** Account code. */
  readonly code: string;
  /** Signed: credit positive. */
  readonly amount: number;
}

export type LotOp =
  /** A new lot for a member credit (expires `expiresAt`, default `occurred_at + Program.expiry.months`). */
  | { readonly op: "create"; readonly code: string; readonly amount: number; readonly expiresAt?: Date }
  /** Consume the member's lots in FIFO order. `mirrorTo` creates one lot per consumed lot (same expiry) for a recipient. */
  | { readonly op: "consume"; readonly code: string; readonly amount: number; readonly mirrorTo?: string }
  /** Consume the lots a given transaction created (reversal of a credit). */
  | {
      readonly op: "consume_source";
      readonly code: string;
      readonly amount: number;
      readonly sourceTxnId: string;
    }
  /** Restore the lots a given transaction consumed (refund, reversal of a debit). */
  | { readonly op: "restore"; readonly code: string; readonly fromTxnId: string }
  /** Expire a lot: remaining to 0 and `expired_txn_id` set. */
  | { readonly op: "expire"; readonly lotId: string };

export interface Posting {
  readonly type: TxnType;
  /** Workspace-unique idempotency key (L7). */
  readonly key: string;
  readonly memo: string;
  readonly ref?: {
    readonly kind:
      "order" | "promotion" | "badge_award" | "automation_run" | "transfer" | "txn" | "approval" | "seed";
    readonly id: string;
  };
  readonly legs: ReadonlyArray<Leg>;
  readonly lots: ReadonlyArray<LotOp>;
  /** Change of `lifetime_earned` per member account code (floor 0). */
  readonly lifetime?: Readonly<Record<string, number>>;
  readonly reversesTxnId?: string;
  readonly approvalId?: string;
}

export interface PostResult {
  readonly txn_id: string;
  readonly txn_no: number;
  readonly replayed: boolean;
  /** Balance after the posting, by account code. */
  readonly balances: Readonly<Record<string, number>>;
  /** First `domain_events` seq the posting produced. */
  readonly event_seq: number;
  readonly tier_changes: ReadonlyArray<{ readonly member: string; readonly from: Tier; readonly to: Tier }>;
}

interface AccountRow {
  account_id: string;
  code: string;
  kind: "member" | "system";
  member_id: string | null;
  balance: string;
  lifetime_earned: string;
  tier: Tier | null;
}

/** The handle behind a `member:<handle>` code. */
const handleOf = (code: string): string | null => (code.startsWith("member:") ? code.slice(7) : null);

export const requestHashOf = (p: Posting): Buffer =>
  sha256(
    canonicalize({
      type: p.type,
      memo: p.memo,
      ref: p.ref ?? null,
      legs: [...p.legs].sort((a, b) => a.code.localeCompare(b.code)),
      lots: p.lots,
      lifetime: p.lifetime ?? {},
      reverses: p.reversesTxnId ?? null,
    }),
  );

const replayOf = (ws: string, txnId: string, txnNo: number) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ code: string; balance_after: string }>`
        SELECT a.code, e.balance_after::text AS balance_after FROM ledger_entries e
        JOIN ledger_accounts a ON a.account_id = e.account_id WHERE e.txn_id = ${txnId}`,
    );
    const ev = yield* store(
      sql<{
        event_seq: string;
      }>`SELECT event_seq::text AS event_seq FROM ledger_transactions WHERE txn_id = ${txnId}`,
    );
    return {
      txn_id: txnId,
      txn_no: txnNo,
      replayed: true,
      balances: Object.fromEntries(rows.map((r) => [r.code, Number(r.balance_after)])),
      event_seq: Number(ev[0]?.event_seq ?? 0),
      tier_changes: [],
    } satisfies PostResult;
  });

/** FIFO lot consumption: `(expires_at, earned_at, lot_id)`. Returns what was taken from each lot. */
const consumeLots = (
  accountId_: string,
  amount: number,
  txnId: string,
  filter?: { readonly sourceTxnId: string },
) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const lots = filter
      ? yield* store(
          sql<{ lot_id: string; remaining: string; expires_at: Date; earned_at: Date }>`
            SELECT lot_id, remaining::text AS remaining, expires_at, earned_at FROM point_lots
            WHERE account_id = ${accountId_} AND source_txn_id = ${filter.sourceTxnId} AND remaining > 0
            ORDER BY expires_at, earned_at, lot_id FOR UPDATE`,
        )
      : yield* store(
          sql<{ lot_id: string; remaining: string; expires_at: Date; earned_at: Date }>`
            SELECT lot_id, remaining::text AS remaining, expires_at, earned_at FROM point_lots
            WHERE account_id = ${accountId_} AND remaining > 0
            ORDER BY expires_at, earned_at, lot_id FOR UPDATE`,
        );
    let need = amount;
    const taken: Array<{ lot_id: string; take: number; expires_at: Date; earned_at: Date }> = [];
    for (const l of lots) {
      if (need === 0) break;
      const take = Math.min(need, Number(l.remaining));
      taken.push({ lot_id: l.lot_id, take, expires_at: l.expires_at, earned_at: l.earned_at });
      need -= take;
    }
    if (need > 0)
      return yield* Effect.fail(
        refusal("CONFLICT", "INSUFFICIENT_POINTS", "the member's lots do not cover this debit", {
          required: amount,
          balance: amount - need,
        }),
      );
    for (const t of taken) {
      yield* store(sql`UPDATE point_lots SET remaining = remaining - ${t.take} WHERE lot_id = ${t.lot_id}`);
      yield* store(
        sql`INSERT INTO lot_consumptions (txn_id, lot_id, amount) VALUES (${txnId}, ${t.lot_id}, ${t.take})`,
      );
    }
    return taken;
  });

/**
 * Post one balanced transaction. Prefer the typed builders. Must run inside the action's transaction.
 *
 * Errors: `INSUFFICIENT_POINTS` (CONFLICT, `details.balance`, `details.required`) before any row is written;
 * `IDEMPOTENCY_KEY_REUSED` when the key exists with a different request; `VALIDATION_FAILED` for a malformed plan.
 */
export const postTransaction = (
  ctx: EmitCtx,
  p: Posting,
): Effect.Effect<PostResult, DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ctx.principal.workspaceId;
    const now = ctx.now;
    const nowIso = now.toISOString();

    // shape
    const sum = p.legs.reduce((s, l) => s + l.amount, 0);
    const codes = new Set(p.legs.map((l) => l.code));
    if (
      p.legs.length < 2 ||
      sum !== 0 ||
      codes.size !== p.legs.length ||
      p.legs.some((l) => !Number.isSafeInteger(l.amount) || l.amount === 0)
    )
      return yield* Effect.fail(
        new DomainError({
          code: "VALIDATION_FAILED",
          path: "",
          message: "a ledger transaction needs at least two non-zero legs that sum to 0",
        }),
      );

    // L7: idempotency
    const reqHash = requestHashOf(p);
    const existing = yield* store(
      sql<{ txn_id: string; txn_no: string; request_hash: Buffer }>`
        SELECT txn_id, txn_no::text AS txn_no, request_hash FROM ledger_transactions
        WHERE workspace_id = ${ws} AND idempotency_key = ${p.key}`,
    );
    if (existing[0]) {
      if (Buffer.compare(existing[0].request_hash, reqHash) !== 0)
        return yield* Effect.fail(
          new DomainError({
            code: "IDEMPOTENCY_KEY_REUSED",
            path: "",
            message: "this idempotency key was already used with a different posting",
          }),
        );
      return yield* replayOf(ws, existing[0].txn_id, Number(existing[0].txn_no));
    }

    // lock the accounts in ascending id order (lock order position 3)
    const ids = [...new Set(p.legs.map((l) => accountId(ws, l.code)))].sort();
    const accounts = yield* store(
      sql<AccountRow>`
        SELECT account_id, code, kind, member_id, balance::text AS balance, lifetime_earned::text AS lifetime_earned, tier
        FROM ledger_accounts WHERE workspace_id = ${ws} AND account_id IN ${sql.in(ids)}
        ORDER BY account_id FOR UPDATE`,
    );
    const byCode = new Map(accounts.map((a) => [a.code, a] as const));
    for (const l of p.legs)
      if (!byCode.has(l.code))
        return yield* Effect.fail(
          new DomainError({ code: "UNKNOWN_REFERENCE", path: "", message: `no ledger account '${l.code}'` }),
        );

    // L2 pre-check
    for (const l of p.legs) {
      const a = byCode.get(l.code);
      if (a && a.kind === "member" && l.amount < 0 && Number(a.balance) + l.amount < 0)
        return yield* Effect.fail(
          refusal("CONFLICT", "INSUFFICIENT_POINTS", "the debit would take the balance below zero", {
            balance: Number(a.balance),
            required: -l.amount,
          }),
        );
    }

    const program: ProgramSpec = yield* loadProgram(ws);

    // lifetime and tier (L9)
    const newLifetime = new Map<string, number>();
    const newTier = new Map<string, Tier>();
    for (const l of p.legs) {
      const a = byCode.get(l.code);
      if (!a || a.kind !== "member") continue;
      const delta = p.lifetime?.[l.code] ?? 0;
      const next = Math.max(0, Number(a.lifetime_earned) + delta);
      newLifetime.set(l.code, next);
      newTier.set(l.code, tierOf(program, next));
    }

    // allocate the number and the event position (counters then domain chain, lock order 7 and 8)
    const txnNo = yield* nextCounter(ws, "txn");
    yield* ensureDomainChain(ws);
    const head = yield* store(
      sql<{
        head_seq: string;
      }>`SELECT head_seq::text AS head_seq FROM domain_chain WHERE workspace_id = ${ws} FOR UPDATE`,
    );
    const eventSeq = Number(head[0]?.head_seq ?? 0) + 1;
    const txnId = newId();

    yield* store(
      sql`INSERT INTO ledger_transactions (txn_id, workspace_id, txn_no, txn_type, occurred_at, actor_id, on_behalf_of, surface,
                                           memo, idempotency_key, request_hash, ref_kind, ref_id, reverses_txn_id, approval_id, event_seq)
          VALUES (${txnId}, ${ws}, ${txnNo}, ${p.type}, ${nowIso}::timestamptz, ${ctx.principal.id}, ${ctx.onBehalfOf?.id ?? null},
                  ${ctx.surface}, ${clip(p.memo, 280)}, ${p.key}, ${reqHash}, ${p.ref?.kind ?? null}, ${p.ref?.id ?? null},
                  ${p.reversesTxnId ?? null}, ${p.approvalId ?? null}, ${eventSeq})`,
    );

    // lots (L5)
    const expiresDefault = addMonths(now, program.expiry.months);
    for (const op of p.lots) {
      if (op.op === "create") {
        const a = byCode.get(op.code);
        if (!a) continue;
        yield* store(
          sql`INSERT INTO point_lots (lot_id, workspace_id, account_id, source_txn_id, original, remaining, earned_at, expires_at)
              VALUES (${newId()}, ${ws}, ${a.account_id}, ${txnId}, ${op.amount}, ${op.amount}, ${nowIso}::timestamptz,
                      ${(op.expiresAt ?? expiresDefault).toISOString()}::timestamptz)`,
        );
      } else if (op.op === "consume" || op.op === "consume_source") {
        const a = byCode.get(op.code);
        if (!a) continue;
        const taken = yield* consumeLots(
          a.account_id,
          op.amount,
          txnId,
          op.op === "consume_source" ? { sourceTxnId: op.sourceTxnId } : undefined,
        );
        if (op.op === "consume" && op.mirrorTo !== undefined) {
          const to = byCode.get(op.mirrorTo);
          if (to)
            for (const t of taken)
              yield* store(
                sql`INSERT INTO point_lots (lot_id, workspace_id, account_id, source_txn_id, original, remaining, earned_at, expires_at)
                    VALUES (${newId()}, ${ws}, ${to.account_id}, ${txnId}, ${t.take}, ${t.take}, ${t.earned_at.toISOString()}::timestamptz,
                            ${t.expires_at.toISOString()}::timestamptz)`,
              );
        }
      } else if (op.op === "restore") {
        const a = byCode.get(op.code);
        if (!a) continue;
        const consumed = yield* store(
          sql<{ lot_id: string; amount: string }>`
            SELECT c.lot_id, c.amount::text AS amount FROM lot_consumptions c
            JOIN point_lots l ON l.lot_id = c.lot_id
            WHERE c.txn_id = ${op.fromTxnId} AND l.account_id = ${a.account_id} AND c.amount > 0
            ORDER BY l.expires_at, l.earned_at, l.lot_id FOR UPDATE OF l`,
        );
        for (const c of consumed) {
          // a lot already past its expiry is restored with 30 more days
          yield* store(
            sql`UPDATE point_lots SET remaining = remaining + ${Number(c.amount)},
                       expires_at = CASE WHEN expires_at <= ${nowIso}::timestamptz THEN ${nowIso}::timestamptz + interval '30 days' ELSE expires_at END,
                       expired_txn_id = NULL
                WHERE lot_id = ${c.lot_id}`,
          );
          yield* store(
            sql`INSERT INTO lot_consumptions (txn_id, lot_id, amount) VALUES (${txnId}, ${c.lot_id}, ${-Number(c.amount)})`,
          );
        }
      } else {
        yield* store(
          sql`UPDATE point_lots SET remaining = 0, expired_txn_id = ${txnId} WHERE lot_id = ${op.lotId}`,
        );
      }
    }

    // entries: the trigger moves the balance (L3) and the deferred constraint checks the sum (L1)
    for (const l of [...p.legs].sort((a, b) => accountId(ws, a.code).localeCompare(accountId(ws, b.code)))) {
      const a = byCode.get(l.code);
      if (!a) continue;
      yield* store(
        sql`INSERT INTO ledger_entries (workspace_id, txn_id, account_id, amount, balance_after, tier_after)
            VALUES (${ws}, ${txnId}, ${a.account_id}, ${l.amount}, 0, ${newTier.get(l.code) ?? null})`,
      );
    }
    for (const [code, lifetime] of newLifetime) {
      const a = byCode.get(code);
      if (a)
        yield* store(
          sql`UPDATE ledger_accounts SET lifetime_earned = ${lifetime}, tier = ${newTier.get(code) ?? "bronze"}
              WHERE account_id = ${a.account_id}`,
        );
    }

    const entries = yield* store(
      sql<{ code: string; balance_after: string }>`
        SELECT a.code, e.balance_after::text AS balance_after FROM ledger_entries e
        JOIN ledger_accounts a ON a.account_id = e.account_id WHERE e.txn_id = ${txnId}`,
    );
    const balances = Object.fromEntries(entries.map((e) => [e.code, Number(e.balance_after)]));

    // L8: one points.posted per account touched; members see their own, finance sees all
    const subjects = new Map<string, PrincipalRef>();
    const memberIds = accounts.flatMap((a) => (a.member_id ? [a.member_id] : []));
    if (memberIds.length > 0) {
      const ps = yield* store(
        sql<{ principal_id: string; subject: string }>`
          SELECT principal_id, subject FROM principals WHERE principal_id IN ${sql.in(memberIds)}`,
      );
      for (const r of ps) subjects.set(r.principal_id, { id: r.principal_id, subject: r.subject });
    }
    for (const l of p.legs) {
      const a = byCode.get(l.code);
      if (!a) continue;
      const m = a.member_id ? subjects.get(a.member_id) : undefined;
      yield* emitFrom(ctx, "points.posted", {
        audience: m ? [m.subject, "role:finance"] : ["role:finance"],
        subject: { kind: "txn", id: txnId },
        member: m,
        payload: {
          txn_id: txnId,
          txn_no: txnNo,
          txn_type: p.type,
          account: l.code,
          member: handleOf(l.code),
          delta: l.amount,
          balance: balances[l.code] ?? 0,
          lifetime: newLifetime.get(l.code) ?? Number(a.lifetime_earned),
          memo: clip(p.memo, 280),
        },
      });
    }

    // tier changes
    const tierChanges: Array<{ member: string; from: Tier; to: Tier }> = [];
    for (const [code, to] of newTier) {
      const a = byCode.get(code);
      const from = a?.tier ?? "bronze";
      if (!a || from === to) continue;
      const handle = handleOf(code) ?? "";
      tierChanges.push({ member: handle, from, to });
      const m = a.member_id ? subjects.get(a.member_id) : undefined;
      yield* emitFrom(ctx, "tier.changed", {
        audience: m ? [m.subject, "*"] : ["*"],
        subject: { kind: "member", id: handle },
        member: m,
        payload: { member: handle, from, to, lifetime: newLifetime.get(code) ?? 0 },
      });
      if (m)
        yield* createNotifications(ctx, {
          recipients: [m],
          type: "tier_changed",
          title: `You reached ${to}`,
          body: `Your tier moved from ${from} to ${to}.`,
          link: "/points",
          subject: { kind: "member", id: handle },
          sourceEventSeq: eventSeq,
          dedupeKey: `${txnId}:tier_changed`,
        });
    }

    return {
      txn_id: txnId,
      txn_no: txnNo,
      replayed: false,
      balances,
      event_seq: eventSeq,
      tier_changes: tierChanges,
    };
  });

// ---- typed builders (CONTRACT 7.2 templates) ---------------------------------------------------------------

type Ctx = EmitCtx;
const issuance = systemCode("issuance");
const promotions = systemCode("promotions");
const redemption = systemCode("redemption");
const expiry = systemCode("expiry");
const adjustments = systemCode("adjustments");

/** `award`: issuance -base, promotions -bonus (if any), member +(base + bonus); one new lot; lifetime +(base + bonus). */
export const postAward = (
  ctx: Ctx,
  a: {
    handle: string;
    base: number;
    bonus?: number;
    memo: string;
    key: string;
    ref?: Posting["ref"];
    approvalId?: string;
  },
) => {
  const bonus = a.bonus ?? 0;
  const total = a.base + bonus;
  const member = memberCode(a.handle);
  return postTransaction(ctx, {
    type: "award",
    key: a.key,
    memo: a.memo,
    ...(a.ref ? { ref: a.ref } : {}),
    ...(a.approvalId ? { approvalId: a.approvalId } : {}),
    legs: [
      { code: issuance, amount: -a.base },
      ...(bonus > 0 ? [{ code: promotions, amount: -bonus }] : []),
      { code: member, amount: total },
    ],
    lots: [{ op: "create", code: member, amount: total }],
    lifetime: { [member]: total },
  });
};

/** `promotion_bonus`: promotions -n, member +n; new lot; lifetime +n. Key `order-bonus:<order_id>`. */
export const postPromotionBonus = (
  ctx: Ctx,
  a: { handle: string; points: number; memo: string; key: string; ref?: Posting["ref"] },
) => {
  const member = memberCode(a.handle);
  return postTransaction(ctx, {
    type: "promotion_bonus",
    key: a.key,
    memo: a.memo,
    ...(a.ref ? { ref: a.ref } : {}),
    legs: [
      { code: promotions, amount: -a.points },
      { code: member, amount: a.points },
    ],
    lots: [{ op: "create", code: member, amount: a.points }],
    lifetime: { [member]: a.points },
  });
};

/** `badge_reward`: issuance -n, member +n; new lot; lifetime +n. Key `badge:<award_id>`. */
export const postBadgeReward = (
  ctx: Ctx,
  a: { handle: string; points: number; memo: string; key: string; ref?: Posting["ref"] },
) => {
  const member = memberCode(a.handle);
  return postTransaction(ctx, {
    type: "badge_reward",
    key: a.key,
    memo: a.memo,
    ...(a.ref ? { ref: a.ref } : {}),
    legs: [
      { code: issuance, amount: -a.points },
      { code: member, amount: a.points },
    ],
    lots: [{ op: "create", code: member, amount: a.points }],
    lifetime: { [member]: a.points },
  });
};

/** `purchase`: member -total, redemption +total; consume FIFO. Key `order:<order_id>`. */
export const postPurchase = (
  ctx: Ctx,
  a: { handle: string; total: number; memo: string; key: string; orderId: string },
) => {
  const member = memberCode(a.handle);
  return postTransaction(ctx, {
    type: "purchase",
    key: a.key,
    memo: a.memo,
    ref: { kind: "order", id: a.orderId },
    legs: [
      { code: member, amount: -a.total },
      { code: redemption, amount: a.total },
    ],
    lots: [{ op: "consume", code: member, amount: a.total }],
  });
};

/** `refund`: redemption -n, member +n; restore the lots the purchase consumed. Key `refund:<order_id>`. */
export const postRefund = (
  ctx: Ctx,
  a: { handle: string; total: number; memo: string; key: string; orderId: string; purchaseTxnId: string },
) => {
  const member = memberCode(a.handle);
  return postTransaction(ctx, {
    type: "refund",
    key: a.key,
    memo: a.memo,
    ref: { kind: "order", id: a.orderId },
    legs: [
      { code: redemption, amount: -a.total },
      { code: member, amount: a.total },
    ],
    lots: [{ op: "restore", code: member, fromTxnId: a.purchaseTxnId }],
  });
};

/** `transfer`: sender -n, recipient +n; consume sender FIFO, one recipient lot per consumed lot (same expiry). */
export const postTransfer = (
  ctx: Ctx,
  a: {
    from: string;
    to: string;
    points: number;
    memo: string;
    key: string;
    ref?: Posting["ref"];
    approvalId?: string;
  },
) => {
  const from = memberCode(a.from);
  const to = memberCode(a.to);
  return postTransaction(ctx, {
    type: "transfer",
    key: a.key,
    memo: a.memo,
    ...(a.ref ? { ref: a.ref } : {}),
    ...(a.approvalId ? { approvalId: a.approvalId } : {}),
    legs: [
      { code: from, amount: -a.points },
      { code: to, amount: a.points },
    ],
    lots: [{ op: "consume", code: from, amount: a.points, mirrorTo: to }],
  });
};

/** `expiry`: member -remaining, expiry +remaining; the lot's remaining to 0. Key `expiry:<lot_id>`. */
export const postExpiry = (
  ctx: Ctx,
  a: { handle: string; lotId: string; remaining: number; memo: string },
) => {
  const member = memberCode(a.handle);
  return postTransaction(ctx, {
    type: "expiry",
    key: `expiry:${a.lotId}`,
    memo: a.memo,
    ref: { kind: "txn", id: a.lotId },
    legs: [
      { code: member, amount: -a.remaining },
      { code: expiry, amount: a.remaining },
    ],
    lots: [{ op: "expire", lotId: a.lotId }],
  });
};

/** `adjustment`: positive adds a lot and lifetime; negative consumes FIFO and lowers lifetime (floor 0). */
export const postAdjustment = (
  ctx: Ctx,
  a: { handle: string; delta: number; memo: string; key: string; ref?: Posting["ref"]; approvalId?: string },
) => {
  const member = memberCode(a.handle);
  const credit = a.delta > 0;
  const n = Math.abs(a.delta);
  return postTransaction(ctx, {
    type: "adjustment",
    key: a.key,
    memo: a.memo,
    ...(a.ref ? { ref: a.ref } : {}),
    ...(a.approvalId ? { approvalId: a.approvalId } : {}),
    legs: credit
      ? [
          { code: adjustments, amount: -n },
          { code: member, amount: n },
        ]
      : [
          { code: member, amount: -n },
          { code: adjustments, amount: n },
        ],
    lots: [credit ? { op: "create", code: member, amount: n } : { op: "consume", code: member, amount: n }],
    lifetime: { [member]: credit ? n : -n },
  });
};

/**
 * `reversal`: the mirror of a transaction, at most once (UNIQUE reverses_txn_id; key `reverse:<txn_id>`). Reversing a
 * credit consumes that transaction's own lots (INSUFFICIENT_POINTS if their remaining is short); reversing a debit
 * restores the lots it consumed.
 */
export const postReversal = (
  ctx: Ctx,
  a: { txnId: string; memo: string; approvalId?: string },
): Effect.Effect<PostResult, DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ctx.principal.workspaceId;
    const orig = yield* store(
      sql<{ txn_type: TxnType; reversed: boolean }>`
        SELECT t.txn_type, EXISTS (SELECT 1 FROM ledger_transactions r WHERE r.reverses_txn_id = t.txn_id) AS reversed
        FROM ledger_transactions t WHERE t.workspace_id = ${ws} AND t.txn_id = ${a.txnId}`,
    );
    if (!orig[0])
      return yield* Effect.fail(
        new DomainError({
          code: "UNKNOWN_REFERENCE",
          path: "/txn_id",
          message: `no transaction '${a.txnId}'`,
        }),
      );
    if (orig[0].reversed || orig[0].txn_type === "reversal")
      return yield* Effect.fail(
        refusal(
          "CONFLICT",
          "ALREADY_EXISTS",
          "this transaction was already reversed or is itself a reversal",
        ),
      );
    const legs = yield* store(
      sql<{ code: string; kind: string; amount: string }>`
        SELECT a.code, a.kind, e.amount::text AS amount FROM ledger_entries e
        JOIN ledger_accounts a ON a.account_id = e.account_id WHERE e.txn_id = ${a.txnId}`,
    );
    const lots: LotOp[] = [];
    const lifetime: Record<string, number> = {};
    const earnTypes: ReadonlyArray<TxnType> = ["award", "promotion_bonus", "badge_reward"];
    for (const l of legs) {
      if (l.kind !== "member") continue;
      const amt = Number(l.amount);
      if (amt > 0) lots.push({ op: "consume_source", code: l.code, amount: amt, sourceTxnId: a.txnId });
      else lots.push({ op: "restore", code: l.code, fromTxnId: a.txnId });
      if (earnTypes.includes(orig[0].txn_type) && amt > 0) lifetime[l.code] = -amt;
      if (orig[0].txn_type === "adjustment") lifetime[l.code] = -amt;
    }
    return yield* postTransaction(ctx, {
      type: "reversal",
      key: `reverse:${a.txnId}`,
      memo: a.memo,
      ref: { kind: "txn", id: a.txnId },
      reversesTxnId: a.txnId,
      ...(a.approvalId ? { approvalId: a.approvalId } : {}),
      legs: legs.map((l) => ({ code: l.code, amount: -Number(l.amount) })),
      lots,
      lifetime,
    });
  });

// ---- trial balance ---------------------------------------------------------------------------------------

export interface TrialViolation {
  readonly invariant: "L1" | "L3" | "L4" | "L5" | "L9";
  readonly subject: string;
  readonly detail: string;
}

/** Recompute L1, L3, L4, L5 and L9 over the whole ledger; `ok` when no violation is listed. */
export const trialBalance = (
  ws: string,
): Effect.Effect<
  { ok: boolean; violations: ReadonlyArray<TrialViolation>; accounts: number; transactions: number },
  StoreError,
  ControlStore
> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const program = yield* loadProgram(ws);
    const violations: TrialViolation[] = [];
    const l1 = yield* store(
      sql<{ txn_id: string; s: string; n: string }>`
        SELECT t.txn_id, coalesce(sum(e.amount), 0)::text AS s, count(e.entry_id)::text AS n
        FROM ledger_transactions t LEFT JOIN ledger_entries e ON e.txn_id = t.txn_id
        WHERE t.workspace_id = ${ws} GROUP BY t.txn_id HAVING coalesce(sum(e.amount), 0) <> 0 OR count(e.entry_id) < 2`,
    );
    for (const r of l1)
      violations.push({ invariant: "L1", subject: r.txn_id, detail: `sum ${r.s}, entries ${r.n}` });
    const l3 = yield* store(
      sql<{ code: string; balance: string; s: string }>`
        SELECT a.code, a.balance::text AS balance, coalesce(sum(e.amount), 0)::text AS s
        FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.account_id
        WHERE a.workspace_id = ${ws} GROUP BY a.account_id HAVING a.balance <> coalesce(sum(e.amount), 0)`,
    );
    for (const r of l3)
      violations.push({
        invariant: "L3",
        subject: r.code,
        detail: `balance ${r.balance}, entries sum ${r.s}`,
      });
    const l4 = yield* store(
      sql<{
        s: string;
      }>`SELECT coalesce(sum(balance), 0)::text AS s FROM ledger_accounts WHERE workspace_id = ${ws}`,
    );
    if (Number(l4[0]?.s ?? 0) !== 0)
      violations.push({ invariant: "L4", subject: "ledger", detail: `balances sum to ${l4[0]?.s}` });
    const l5 = yield* store(
      sql<{ code: string; balance: string; lots: string }>`
        SELECT a.code, a.balance::text AS balance, coalesce(sum(l.remaining), 0)::text AS lots
        FROM ledger_accounts a LEFT JOIN point_lots l ON l.account_id = a.account_id
        WHERE a.workspace_id = ${ws} AND a.kind = 'member' GROUP BY a.account_id
        HAVING a.balance <> coalesce(sum(l.remaining), 0)`,
    );
    for (const r of l5)
      violations.push({
        invariant: "L5",
        subject: r.code,
        detail: `balance ${r.balance}, lots remaining ${r.lots}`,
      });
    const l9 = yield* store(
      sql<{ code: string; tier: string; lifetime_earned: string }>`
        SELECT code, tier, lifetime_earned::text AS lifetime_earned FROM ledger_accounts
        WHERE workspace_id = ${ws} AND kind = 'member'`,
    );
    for (const r of l9) {
      const want = tierOf(program, Number(r.lifetime_earned));
      if (want !== r.tier)
        violations.push({
          invariant: "L9",
          subject: r.code,
          detail: `tier ${r.tier}, lifetime says ${want}`,
        });
    }
    const counts = yield* store(
      sql<{ a: string; t: string }>`
        SELECT (SELECT count(*) FROM ledger_accounts WHERE workspace_id = ${ws})::text AS a,
               (SELECT count(*) FROM ledger_transactions WHERE workspace_id = ${ws})::text AS t`,
    );
    return {
      ok: violations.length === 0,
      violations,
      accounts: Number(counts[0]?.a ?? 0),
      transactions: Number(counts[0]?.t ?? 0),
    };
  });

/**
 * Run an effect in one SQL transaction. A posting must be atomic (the deferred constraints of L1 fire at COMMIT), so
 * callers outside the dispatcher, such as the seed, wrap their postings in this. The dispatcher already does.
 */
export const inTx = <A, E, R>(
  eff: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, never> | StoreError, R | ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    return yield* store(sql.withTransaction(eff));
  }) as never;
