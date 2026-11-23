import { Effect, type Schema as S } from "effect";
import { SuitePoints, type TxnType } from "@plinth/spec";
import { ControlStore, store } from "../../control-store";
import { memberByHandle } from "../people";
import { accountId, memberCode, postAdjustment, postAward, postTransfer } from "../ledger";
import { createNotifications } from "../notify";
import { loadProgram } from "../program";
import { fileForApproval, type ActionCtx, type ActionHandler } from "../types";
import {
  chargePromotions,
  clip,
  dateOnly,
  DAY_MS,
  dayStart,
  decodeCursor,
  encodeCursor,
  evaluateEarn,
  factsOf,
  forbiddenRow,
  iso,
  memberWithFacts,
  needRef,
  pageLimit,
  personRefs,
  principalRefOf,
  refuse,
  selfMember,
  targetMember,
  tierProgress,
} from "./engagement-shared";
import { memberFactsFor } from "../segments";
import { requireTarget } from "../target";
import { decide } from "./engagement-shared";
import type { HandlerTable } from "./stub";

/**
 * Module `points` (CONTRACT.md 7, M3): the member's balance, statement, transfers, manager awards and finance
 * adjustments, all through the single posting function of ../ledger.
 */

type Out<T extends S.Schema.Any> = S.Schema.Type<T>;

const EARN_TYPES = ["award", "promotion_bonus", "badge_reward", "adjustment"] as const;

// ---- statement lines ------------------------------------------------------------------------------------

interface EntryRow {
  entry_id: string;
  txn_id: string;
  amount: string;
  balance_after: string;
  txn_no: string;
  txn_type: TxnType;
  occurred_at: Date;
  memo: string;
  actor_id: string;
  ref_kind: string | null;
  ref_id: string | null;
}

interface EntryFilter {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly types?: ReadonlyArray<string> | undefined;
  readonly beforeEntry?: string | undefined;
}

const entryWhere = (accId: string, f: EntryFilter): { where: string; params: unknown[] } => {
  const params: unknown[] = [accId];
  let where = "e.account_id = $1";
  if (f.from) {
    params.push(f.from);
    where += ` AND t.occurred_at >= $${params.length}::timestamptz`;
  }
  if (f.to) {
    params.push(f.to);
    where += ` AND t.occurred_at <= $${params.length}::timestamptz`;
  }
  if (f.types && f.types.length > 0) {
    params.push([...f.types]);
    where += ` AND t.txn_type = ANY($${params.length}::text[])`;
  }
  if (f.beforeEntry !== undefined) {
    params.push(f.beforeEntry);
    where += ` AND e.entry_id < $${params.length}::bigint`;
  }
  return { where, params };
};

const refView = (
  kind: string | null,
  id: string | null,
  orderNos: ReadonlyMap<string, string>,
  badgeSlugs: ReadonlyMap<string, string>,
): Out<typeof SuitePoints.TxnRef> | null => {
  if (kind === null || id === null) return null;
  const k = kind as Out<typeof SuitePoints.TxnRef>["kind"];
  switch (kind) {
    case "order":
      return { kind: k, id, label: orderNos.get(id) ?? "Order", link: `/store/orders/${id}` };
    case "badge_award":
      return { kind: k, id, label: `Badge ${badgeSlugs.get(id) ?? ""}`.trim(), link: "/badges" };
    case "promotion":
      return { kind: k, id, label: `Promotion ${id}`, link: "/promotions" };
    case "automation_run":
      return { kind: k, id, label: "Automation run", link: `/automation/runs/${id}` };
    case "transfer":
      return { kind: k, id, label: "Transfer", link: null };
    case "txn":
      return { kind: k, id, label: "Transaction", link: `/points/transactions/${id}` };
    case "approval":
      return { kind: k, id, label: "Approval", link: `/approvals/${id}` };
    default:
      return { kind: k, id, label: "Opening history", link: null };
  }
};

/** Statement lines of one account, newest first (the cursor is the last entry id). */
const statementLines = (ws: string, accId: string, f: EntryFilter, limit: number) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const { where, params } = entryWhere(accId, f);
    const rows = yield* store(
      sql.unsafe<EntryRow>(
        `SELECT e.entry_id::text AS entry_id, e.txn_id, e.amount::text AS amount, e.balance_after::text AS balance_after,
                t.txn_no::text AS txn_no, t.txn_type, t.occurred_at, t.memo, t.actor_id, t.ref_kind, t.ref_id
         FROM ledger_entries e JOIN ledger_transactions t ON t.txn_id = e.txn_id
         WHERE ${where} ORDER BY e.entry_id DESC LIMIT ${Math.floor(limit)}`,
        params,
      ),
    );
    if (rows.length === 0) return { rows, lines: [] as Array<Out<typeof SuitePoints.StatementLine>> };
    const txnIds = rows.map((r) => r.txn_id);
    const others = yield* store(
      sql<{ txn_id: string; code: string; kind: string; member_id: string | null; amount: string }>`
        SELECT e.txn_id, a.code, a.kind, a.member_id, e.amount::text AS amount FROM ledger_entries e
        JOIN ledger_accounts a ON a.account_id = e.account_id
        WHERE e.txn_id IN ${sql.in(txnIds)} AND e.account_id <> ${accId}`,
    );
    const rev = yield* store(
      sql<{ txn_id: string; reverses_txn_id: string }>`
        SELECT txn_id, reverses_txn_id FROM ledger_transactions WHERE reverses_txn_id IN ${sql.in(txnIds)}`,
    );
    const orderIds = rows.filter((r) => r.ref_kind === "order" && r.ref_id).map((r) => r.ref_id as string);
    const orderNos = new Map<string, string>();
    if (orderIds.length > 0) {
      const o = yield* store(
        sql<{ order_id: string; order_no: string }>`
          SELECT order_id::text AS order_id, order_no FROM store_orders WHERE order_id::text IN ${sql.in(orderIds)}`,
      );
      for (const r of o) orderNos.set(r.order_id, r.order_no);
    }
    const awardIds = rows
      .filter((r) => r.ref_kind === "badge_award" && r.ref_id)
      .map((r) => r.ref_id as string);
    const badgeSlugs = new Map<string, string>();
    if (awardIds.length > 0) {
      const b = yield* store(
        sql<{ award_id: string; badge_slug: string }>`
          SELECT award_id::text AS award_id, badge_slug FROM badge_awards WHERE award_id::text IN ${sql.in(awardIds)}`,
      );
      for (const r of b) badgeSlugs.set(r.award_id, r.badge_slug);
    }
    const refs = yield* personRefs(ws, [
      ...rows.map((r) => r.actor_id),
      ...others.flatMap((o) => (o.member_id ? [o.member_id] : [])),
    ]);
    const lines = rows.map((r) => {
      const os = others.filter((o) => o.txn_id === r.txn_id);
      const mem = os.find((o) => o.kind === "member" && o.member_id);
      const sys = [...os].sort((a, b) => Math.abs(Number(b.amount)) - Math.abs(Number(a.amount)))[0];
      const counterparty = mem?.member_id
        ? needRef(refs, mem.member_id)
        : sys
          ? { system: sys.code.replace(/^system:/, "") }
          : null;
      return {
        txn_id: r.txn_id,
        txn_no: Number(r.txn_no),
        txn_type: r.txn_type,
        occurred_at: iso(r.occurred_at),
        memo: r.memo,
        amount: Number(r.amount),
        balance_after: Number(r.balance_after),
        counterparty,
        ref: refView(r.ref_kind, r.ref_id, orderNos, badgeSlugs),
        actor: needRef(refs, r.actor_id),
        reversed_by: rev.find((x) => x.reverses_txn_id === r.txn_id)?.txn_id ?? null,
      } as Out<typeof SuitePoints.StatementLine>;
    });
    return { rows, lines };
  });

const expiryBuckets = (accId: string, until?: Date) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const params: unknown[] = [accId];
    let extra = "";
    if (until) {
      params.push(until.toISOString());
      extra = " AND l.expires_at <= $2::timestamptz";
    }
    const rows = yield* store(
      sql.unsafe<{ d: string; pts: string; lots: number }>(
        `SELECT to_char(l.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, sum(l.remaining)::text AS pts, count(*)::int AS lots
         FROM point_lots l WHERE l.account_id = $1 AND l.remaining > 0${extra} GROUP BY 1 ORDER BY 1`,
        params,
      ),
    );
    return rows.map((r) => ({ expires_on: r.d, points: Number(r.pts), lots: r.lots }));
  });

/** Points the member has already transferred out on the current virtual UTC day. */
const sentToday = (accId: string, now: Date) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const start = dayStart(now);
    const rows = yield* store(
      sql<{ s: string }>`
        SELECT coalesce(sum(-e.amount), 0)::text AS s FROM ledger_entries e
        JOIN ledger_transactions t ON t.txn_id = e.txn_id
        WHERE e.account_id = ${accId} AND t.txn_type = 'transfer' AND e.amount < 0
          AND t.occurred_at >= ${start.toISOString()}::timestamptz
          AND t.occurred_at < ${new Date(start.getTime() + DAY_MS).toISOString()}::timestamptz`,
    );
    return Number(rows[0]?.s ?? 0);
  });

const account = (ws: string, handle: string) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const id = accountId(ws, memberCode(handle));
    const rows = yield* store(
      sql<{ balance: string; lifetime_earned: string; tier: string }>`
        SELECT balance::text AS balance, lifetime_earned::text AS lifetime_earned, tier FROM ledger_accounts
        WHERE account_id = ${id}`,
    );
    return {
      id,
      balance: Number(rows[0]?.balance ?? 0),
      lifetime: Number(rows[0]?.lifetime_earned ?? 0),
      tier: rows[0]?.tier ?? "bronze",
    };
  });

// ---- reads -----------------------------------------------------------------------------------------------

const summary: ActionHandler<
  Out<typeof SuitePoints.MemberQuery>,
  Out<typeof SuitePoints.PointsSummaryOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const m = yield* targetMember(ctx, input.member, "points:view-all", "points");
      const program = yield* loadProgram(ws);
      const acc = yield* account(ws, m.handle);
      const from30 = new Date(ctx.now.getTime() - 30 * DAY_MS).toISOString();
      const flows = yield* store(
        sql<{ earned: string; redeemed: string }>`
          SELECT coalesce(sum(e.amount) FILTER (WHERE e.amount > 0 AND t.txn_type IN ${sql.in([...EARN_TYPES])}), 0)::text AS earned,
                 coalesce(-sum(e.amount) FILTER (WHERE e.amount < 0 AND t.txn_type = 'purchase'), 0)::text AS redeemed
          FROM ledger_entries e JOIN ledger_transactions t ON t.txn_id = e.txn_id
          WHERE e.account_id = ${acc.id} AND t.occurred_at > ${from30}::timestamptz
            AND t.occurred_at <= ${ctx.now.toISOString()}::timestamptz`,
      );
      const soon = yield* expiryBuckets(acc.id, new Date(ctx.now.getTime() + 30 * DAY_MS));
      const recent = yield* statementLines(ws, acc.id, {}, 5);
      const sent = yield* sentToday(acc.id, ctx.now);
      const remaining = program.transfer.enabled ? Math.max(0, program.transfer.max_per_day - sent) : 0;
      return {
        member: needRef(yield* personRefs(ws, [m.id]), m.id),
        account: memberCode(m.handle),
        balance: acc.balance,
        tier: tierProgress(program, acc.lifetime),
        earned_30d: Number(flows[0]?.earned ?? 0),
        redeemed_30d: Number(flows[0]?.redeemed ?? 0),
        expiring_soon: soon,
        recent: recent.lines,
        transfer_remaining_today: remaining,
      } as Out<typeof SuitePoints.PointsSummaryOut>;
    }),
};

const statement: ActionHandler<Out<typeof SuitePoints.StatementIn>, Out<typeof SuitePoints.StatementOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const m = yield* targetMember(ctx, input.member, "points:view-all", "points");
      const acc = yield* account(ws, m.handle);
      const limit = pageLimit(input.limit);
      const cur = decodeCursor<{ e: string }>(input.cursor);
      const base: EntryFilter = { from: input.from, to: input.to, types: input.types };
      const page = yield* statementLines(ws, acc.id, { ...base, beforeEntry: cur?.e }, limit + 1);
      const more = page.rows.length > limit;
      const items = page.lines.slice(0, limit);
      const lastRow = page.rows[limit - 1];
      // the totals of the whole filtered period, not just this page
      const { where, params } = entryWhere(acc.id, base);
      const totals = yield* store(
        sql.unsafe<{ credits: string; debits: string }>(
          `SELECT coalesce(sum(e.amount) FILTER (WHERE e.amount > 0), 0)::text AS credits,
                  coalesce(-sum(e.amount) FILTER (WHERE e.amount < 0), 0)::text AS debits
           FROM ledger_entries e JOIN ledger_transactions t ON t.txn_id = e.txn_id WHERE ${where}`,
          params,
        ),
      );
      const opening = input.from
        ? yield* store(
            sql<{ b: string }>`
              SELECT e.balance_after::text AS b FROM ledger_entries e JOIN ledger_transactions t ON t.txn_id = e.txn_id
              WHERE e.account_id = ${acc.id} AND t.occurred_at < ${input.from}::timestamptz
              ORDER BY e.entry_id DESC LIMIT 1`,
          )
        : [];
      const closing = input.to
        ? yield* store(
            sql<{ b: string }>`
              SELECT e.balance_after::text AS b FROM ledger_entries e JOIN ledger_transactions t ON t.txn_id = e.txn_id
              WHERE e.account_id = ${acc.id} AND t.occurred_at <= ${input.to}::timestamptz
              ORDER BY e.entry_id DESC LIMIT 1`,
          )
        : [];
      return {
        items,
        next_cursor: more && lastRow ? encodeCursor({ e: lastRow.entry_id }) : null,
        opening_balance: input.from ? Number(opening[0]?.b ?? 0) : 0,
        closing_balance: input.to ? Number(closing[0]?.b ?? 0) : acc.balance,
        credits: Number(totals[0]?.credits ?? 0),
        debits: Number(totals[0]?.debits ?? 0),
      } as Out<typeof SuitePoints.StatementOut>;
    }),
};

const transaction: ActionHandler<Out<typeof SuitePoints.TxnIn>, Out<typeof SuitePoints.TxnDetailOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const me = yield* selfMember(ctx);
      const txn = yield* store(
        sql<{
          txn_id: string;
          txn_no: string;
          txn_type: TxnType;
          occurred_at: Date;
          recorded_at: Date;
          memo: string;
          actor_id: string;
          on_behalf_of: string | null;
          surface: string;
          idempotency_key: string;
          ref_kind: string | null;
          ref_id: string | null;
          reverses_txn_id: string | null;
          event_seq: string;
        }>`
          SELECT txn_id, txn_no::text AS txn_no, txn_type, occurred_at, recorded_at, memo, actor_id, on_behalf_of, surface,
                 idempotency_key, ref_kind, ref_id, reverses_txn_id, event_seq::text AS event_seq
          FROM ledger_transactions WHERE workspace_id = ${ws} AND txn_id = ${input.txn_id}`,
      );
      const t = txn[0];
      const notFound = refuse(
        "UNKNOWN_REFERENCE",
        "UNKNOWN_TRANSACTION",
        `no transaction '${input.txn_id}'`,
        {},
        "/txn_id",
      );
      if (!t) return yield* Effect.fail(notFound);
      const entries = yield* store(
        sql<{
          code: string;
          kind: string;
          member_id: string | null;
          amount: string;
          balance_after: string;
          account_id: string;
        }>`
          SELECT a.code, a.kind, a.member_id, e.amount::text AS amount, e.balance_after::text AS balance_after, a.account_id
          FROM ledger_entries e JOIN ledger_accounts a ON a.account_id = e.account_id
          WHERE e.txn_id = ${t.txn_id} ORDER BY e.entry_id`,
      );
      // own, or points:ledger, or points:view-all reaching every member leg
      const own = entries.some((e) => e.member_id === me.id);
      if (!own) {
        const led = yield* decide(ctx, "points:ledger", "ledger");
        if (led.kind !== "allow") {
          const va = yield* decide(ctx, "points:view-all", "points");
          if (va.kind !== "allow") return yield* Effect.fail(notFound);
          for (const e of entries) {
            if (!e.member_id) continue;
            const mem = yield* Effect.either(memberByHandle(ws, e.code.replace(/^member:/, "")));
            if (mem._tag === "Left") return yield* Effect.fail(forbiddenRow());
            yield* requireTarget({ allow: va }, factsOf(mem.right));
          }
        }
      }
      const lots = yield* store(
        sql<{
          lot_id: string;
          code: string;
          change: "created" | "consumed" | "restored" | "expired";
          points: string;
          expires_at: Date;
        }>`
          SELECT l.lot_id, a.code, 'created' AS change, l.original::text AS points, l.expires_at
          FROM point_lots l JOIN ledger_accounts a ON a.account_id = l.account_id WHERE l.source_txn_id = ${t.txn_id}
          UNION ALL
          SELECT l.lot_id, a.code, CASE WHEN c.amount > 0 THEN 'consumed' ELSE 'restored' END, abs(c.amount)::text, l.expires_at
          FROM lot_consumptions c JOIN point_lots l ON l.lot_id = c.lot_id
          JOIN ledger_accounts a ON a.account_id = l.account_id WHERE c.txn_id = ${t.txn_id}
          UNION ALL
          SELECT l.lot_id, a.code, 'expired', coalesce((SELECT abs(e.amount) FROM ledger_entries e
                                                          WHERE e.txn_id = ${t.txn_id} AND e.account_id = l.account_id), 0)::text, l.expires_at
          FROM point_lots l JOIN ledger_accounts a ON a.account_id = l.account_id WHERE l.expired_txn_id = ${t.txn_id}`,
      );
      const reversedBy = yield* store(
        sql<{ txn_id: string }>`SELECT txn_id FROM ledger_transactions WHERE reverses_txn_id = ${t.txn_id}`,
      );
      const orderNos = new Map<string, string>();
      const badgeSlugs = new Map<string, string>();
      if (t.ref_kind === "order" && t.ref_id) {
        const o = yield* store(
          sql<{ order_no: string }>`SELECT order_no FROM store_orders WHERE order_id::text = ${t.ref_id}`,
        );
        if (o[0]) orderNos.set(t.ref_id, o[0].order_no);
      }
      if (t.ref_kind === "badge_award" && t.ref_id) {
        const b = yield* store(
          sql<{ badge_slug: string }>`SELECT badge_slug FROM badge_awards WHERE award_id::text = ${t.ref_id}`,
        );
        if (b[0]) badgeSlugs.set(t.ref_id, b[0].badge_slug);
      }
      const refs = yield* personRefs(ws, [
        t.actor_id,
        ...(t.on_behalf_of ? [t.on_behalf_of] : []),
        ...entries.flatMap((e) => (e.member_id ? [e.member_id] : [])),
      ]);
      return {
        txn_id: t.txn_id,
        txn_no: Number(t.txn_no),
        txn_type: t.txn_type,
        occurred_at: iso(t.occurred_at),
        recorded_at: iso(t.recorded_at),
        memo: t.memo,
        actor: needRef(refs, t.actor_id),
        on_behalf_of: t.on_behalf_of ? needRef(refs, t.on_behalf_of) : null,
        surface: t.surface,
        entries: entries.map((e) => ({
          account: e.code,
          member: e.member_id ? needRef(refs, e.member_id) : null,
          amount: Number(e.amount),
          balance_after: Number(e.balance_after),
        })),
        lots: lots.map((l) => ({
          lot_id: l.lot_id,
          account: l.code,
          change: l.change,
          points: Number(l.points),
          expires_at: iso(l.expires_at),
        })),
        ref: refView(t.ref_kind, t.ref_id, orderNos, badgeSlugs),
        reverses: t.reverses_txn_id,
        reversed_by: reversedBy[0]?.txn_id ?? null,
        idempotency_key: t.idempotency_key,
        event_seq: Number(t.event_seq),
      } as Out<typeof SuitePoints.TxnDetailOut>;
    }),
};

const expiry: ActionHandler<Out<typeof SuitePoints.MemberQuery>, Out<typeof SuitePoints.ExpiryOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const m = yield* targetMember(ctx, input.member, "points:view-all", "points");
      const program = yield* loadProgram(ws);
      const acc = yield* account(ws, m.handle);
      const buckets = yield* expiryBuckets(acc.id);
      const today = dateOnly(ctx.now);
      let next: { on: string; points: number } | null = null;
      for (const b of buckets)
        for (const w of program.expiry.warn_days) {
          const on = dateOnly(new Date(Date.parse(`${b.expires_on}T00:00:00Z`) - w * DAY_MS));
          if (on >= today && (next === null || on < next.on)) next = { on, points: b.points };
        }
      return {
        member: needRef(yield* personRefs(ws, [m.id]), m.id),
        buckets,
        next_warning: next,
      } as Out<typeof SuitePoints.ExpiryOut>;
    }),
};

const tiers: ActionHandler<unknown, Out<typeof SuitePoints.TiersOut>> = {
  run: (_input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const program = yield* loadProgram(ws);
      const counts = yield* store(
        sql<{ tier: string; n: number }>`
          SELECT tier, count(*)::int AS n FROM ledger_accounts WHERE workspace_id = ${ws} AND kind = 'member' GROUP BY tier`,
      );
      const by = new Map(counts.map((c) => [c.tier, c.n] as const));
      return {
        tiers: [...program.tiers]
          .sort((a, b) => a.min_lifetime_points - b.min_lifetime_points)
          .map((t) => ({
            tier: t.tier,
            min_lifetime_points: t.min_lifetime_points,
            perks: [...t.perks],
            members: by.get(t.tier) ?? 0,
          })),
      } as Out<typeof SuitePoints.TiersOut>;
    }),
};

// ---- transfers -------------------------------------------------------------------------------------------

/** Validate a transfer against the Program limits and return what the posting needs. */
const checkTransfer = (input: Out<typeof SuitePoints.TransferIn>, ctx: ActionCtx) =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const program = yield* loadProgram(ws);
    const from = yield* selfMember(ctx);
    const t = program.transfer;
    if (!t.enabled)
      return yield* Effect.fail(
        refuse("RULE_REFUSED", "LIMIT_EXCEEDED", "transfers are switched off", {
          limit: "transfer.enabled",
          value: 0,
        }),
      );
    if (input.to === from.handle)
      return yield* Effect.fail(
        refuse("RULE_REFUSED", "SELF_ACTION", "you cannot transfer points to yourself"),
      );
    const to = yield* memberByHandle(ws, input.to);
    if (to.disabled)
      return yield* Effect.fail(
        refuse("RULE_REFUSED", "MEMBER_DISABLED", "the recipient is disabled", {}, "/to"),
      );
    if (input.points < t.min_points)
      return yield* Effect.fail(
        refuse(
          "RULE_REFUSED",
          "LIMIT_EXCEEDED",
          "below the minimum transfer",
          {
            limit: t.min_points,
            value: input.points,
          },
          "/points",
        ),
      );
    if (input.points > t.max_per_transfer)
      return yield* Effect.fail(
        refuse(
          "RULE_REFUSED",
          "LIMIT_EXCEEDED",
          "above the maximum per transfer",
          {
            limit: t.max_per_transfer,
            value: input.points,
          },
          "/points",
        ),
      );
    const acc = yield* account(ws, from.handle);
    const sent = yield* sentToday(acc.id, ctx.now);
    if (sent + input.points > t.max_per_day)
      return yield* Effect.fail(
        refuse(
          "RULE_REFUSED",
          "LIMIT_EXCEEDED",
          "above the daily transfer limit",
          {
            limit: t.max_per_day,
            value: sent + input.points,
          },
          "/points",
        ),
      );
    return { from, to, balance: acc.balance, sent, program };
  });

const transfer: ActionHandler<Out<typeof SuitePoints.TransferIn>, Out<typeof SuitePoints.TxnResult>> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const c = yield* checkTransfer(input, ctx);
      return {
        effect: `Transfer ${input.points} points to ${input.to}`,
        facts: {
          to: input.to,
          points: input.points,
          balance_before: c.balance,
          balance_after: c.balance - input.points,
          sent_today: c.sent,
          sufficient: c.balance >= input.points,
        },
        decision: "approval",
        approverPermission: "points:adjust",
      };
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const c = yield* checkTransfer(input, ctx);
      const res = yield* postTransfer(ctx, {
        from: c.from.handle,
        to: c.to.handle,
        points: input.points,
        memo: input.memo,
        key: `transfer:${c.from.handle}:${input.idempotency_key}`,
        ref: { kind: "transfer", id: input.idempotency_key },
        ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}),
      });
      if (!res.replayed)
        yield* createNotifications(ctx, {
          recipients: [principalRefOf(c.to)],
          type: "points_awarded",
          title: `${c.from.displayName} sent you ${input.points} points`,
          body: clip(input.memo, 500),
          link: "/points",
          actorId: c.from.id,
          subject: { kind: "txn", id: res.txn_id },
          sourceEventSeq: res.event_seq,
          dedupeKey: `${res.event_seq}:points_awarded:${c.to.handle}`,
        });
      return {
        txn_id: res.txn_id,
        txn_no: res.txn_no,
        balance: res.balances[memberCode(c.from.handle)] ?? c.balance - input.points,
        replayed: res.replayed,
      };
    }),
};

// ---- awards ----------------------------------------------------------------------------------------------

const CATEGORY_LABEL: Record<string, string> = {
  recognition: "Recognition",
  performance: "Performance",
  milestone: "Milestone",
  service: "Service",
  other: "Award",
};

const checkAward = (input: Out<typeof SuitePoints.AwardIn>, ctx: ActionCtx) =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const program = yield* loadProgram(ws);
    const me = yield* selfMember(ctx);
    const handles = [...new Set(input.to)];
    if (handles.length > program.awards.max_recipients)
      return yield* Effect.fail(
        refuse(
          "RULE_REFUSED",
          "LIMIT_EXCEEDED",
          "too many recipients",
          {
            limit: program.awards.max_recipients,
            value: handles.length,
          },
          "/to",
        ),
      );
    if (handles.includes(me.handle))
      return yield* Effect.fail(
        refuse("RULE_REFUSED", "SELF_ACTION", "you cannot award points to yourself", {}, "/to"),
      );
    const members = [];
    for (const h of handles) {
      const found = yield* Effect.either(memberByHandle(ws, h));
      if (found._tag === "Left") {
        if (ctx.allow?.rowPredicate) return yield* Effect.fail(forbiddenRow());
        return yield* Effect.fail(found.left);
      }
      yield* requireTarget(ctx, factsOf(found.right));
      if (found.right.disabled)
        return yield* Effect.fail(refuse("RULE_REFUSED", "MEMBER_DISABLED", `${h} is disabled`, {}, "/to"));
      members.push(found.right);
    }
    return { me, members, program, held: input.points > program.awards.manager_max_per_award };
  });

const award: ActionHandler<Out<typeof SuitePoints.AwardIn>, Out<typeof SuitePoints.AwardOut>> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const c = yield* checkAward(input, ctx);
      const facts = yield* memberFactsFor(
        ctx.principal.workspaceId,
        ctx.now,
        c.members.map((m) => m.id),
      );
      let bonus = 0;
      for (const f of facts) {
        const ev = yield* evaluateEarn(
          ctx.principal.workspaceId,
          f,
          ctx.now,
          input.points,
          "recognition",
          "award",
          false,
        );
        bonus += ev.totals.kind === "earn" ? ev.totals.bonus_points : 0;
      }
      return {
        effect: `Award ${input.points} points to ${c.members.length} member${c.members.length === 1 ? "" : "s"}`,
        facts: {
          recipients: c.members.length,
          points_each: input.points,
          total_base: input.points * c.members.length,
          promotion_bonus_total: bonus,
          held_for_approval: c.held,
        },
        decision: c.held ? "approval" : "auto",
        approverPermission: "points:adjust",
      };
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const c = yield* checkAward(input, ctx);
      if (c.held && ctx.approvalId === undefined)
        return fileForApproval(
          "points:adjust",
          `Award ${input.points} points to ${c.members.map((m) => m.handle).join(", ")} (above the manager limit of ${c.program.awards.manager_max_per_award})`,
        );
      const facts = yield* memberFactsFor(
        ws,
        ctx.now,
        c.members.map((m) => m.id),
      );
      const results: Array<Out<typeof SuitePoints.AwardOut>["results"][number]> = [];
      let allReplayed = true;
      for (const m of c.members) {
        const f = facts.find((x) => x.memberId === m.id) ?? (yield* memberWithFacts(ws, m.id, ctx.now));
        const ev = yield* evaluateEarn(ws, f, ctx.now, input.points, "recognition", "award", true);
        const bonus = ev.totals.kind === "earn" ? ev.totals.bonus_points : 0;
        const memo = clip(`${CATEGORY_LABEL[input.category] ?? "Award"}: ${input.reason}`, 280);
        const res = yield* postAward(ctx, {
          handle: m.handle,
          base: input.points,
          bonus,
          memo,
          key: `award:${input.idempotency_key}:${m.handle}`,
          ...(ctx.approvalId
            ? { ref: { kind: "approval" as const, id: ctx.approvalId }, approvalId: ctx.approvalId }
            : {}),
        });
        if (!res.replayed) {
          allReplayed = false;
          if (ev.applied.length > 0)
            yield* chargePromotions(ctx, {
              member: m,
              evaluation: ev,
              context: "earn",
              ref: { kind: "txn", id: res.txn_id },
            });
          yield* createNotifications(ctx, {
            recipients: [principalRefOf(m)],
            type: "points_awarded",
            title: `You received ${input.points + bonus} points`,
            body: clip(`${c.me.displayName}: ${input.reason}`, 500),
            link: "/points",
            actorId: c.me.id,
            subject: { kind: "txn", id: res.txn_id },
            sourceEventSeq: res.event_seq,
            dedupeKey: `${res.event_seq}:points_awarded:${m.handle}`,
          });
        }
        results.push({
          member: m.handle,
          txn_id: res.txn_id,
          base_points: input.points,
          bonus_points: bonus,
          promotions: ev.applied.map((a) => a.slug),
        });
      }
      return {
        status: "committed" as const,
        approval_id: ctx.approvalId ?? null,
        results,
        replayed: allReplayed,
      };
    }),
};

// ---- adjustments -----------------------------------------------------------------------------------------

const adjust: ActionHandler<Out<typeof SuitePoints.AdjustIn>, Out<typeof SuitePoints.TxnResult>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const m = yield* memberByHandle(ws, input.member);
      const res = yield* postAdjustment(ctx, {
        handle: m.handle,
        delta: input.points,
        memo: clip(input.reason, 280),
        key: `adjust:${input.idempotency_key}`,
        ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}),
      });
      return {
        txn_id: res.txn_id,
        txn_no: res.txn_no,
        balance: res.balances[memberCode(m.handle)] ?? (yield* account(ws, m.handle)).balance,
        replayed: res.replayed,
      };
    }),
};

export const pointsHandlers = {
  "points.summary": summary,
  "points.statement": statement,
  "points.transaction": transaction,
  "points.transfer": transfer,
  "points.award": award,
  "points.adjust": adjust,
  "points.expiry": expiry,
  "points.tiers": tiers,
} satisfies HandlerTable;
