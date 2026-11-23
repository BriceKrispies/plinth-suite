import { Effect, type Schema as S } from "effect";
import { SuitePoints, type TxnType } from "@plinth/spec";
import { ControlStore, store } from "../../control-store";
import { postReversal, trialBalance } from "../ledger";
import type { ActionHandler } from "../types";
import {
  clip,
  decodeCursor,
  encodeCursor,
  iso,
  needRef,
  pageLimit,
  personRefs,
  refuse,
} from "./engagement-shared";
import type { HandlerTable } from "./stub";

/** Module `ledger` (CONTRACT.md 7, finance): accounts, the trial balance and reversals. */

type Out<T extends S.Schema.Any> = S.Schema.Type<T>;

const accounts: ActionHandler<Out<typeof SuitePoints.AccountsIn>, Out<typeof SuitePoints.AccountsOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const limit = pageLimit(input.limit);
      const cur = decodeCursor<{ c: string }>(input.cursor);
      const params: unknown[] = [ws];
      let where = "a.workspace_id = $1";
      if (input.kind) {
        params.push(input.kind);
        where += ` AND a.kind = $${params.length}`;
      }
      if (input.q && input.q.trim() !== "") {
        params.push(
          `%${input.q
            .trim()
            .toLowerCase()
            .replace(/[%_\\]/g, (c) => `\\${c}`)}%`,
        );
        where += ` AND (lower(a.code) LIKE $${params.length} OR EXISTS (SELECT 1 FROM principals p WHERE p.principal_id = a.member_id
                         AND lower(p.display_name) LIKE $${params.length}))`;
      }
      if (cur) {
        params.push(cur.c);
        where += ` AND a.code > $${params.length}`;
      }
      const rows = yield* store(
        sql.unsafe<{
          code: string;
          kind: "member" | "system";
          member_id: string | null;
          balance: string;
          lifetime_earned: string;
          entries: number;
          last_at: Date | null;
        }>(
          `SELECT a.code, a.kind, a.member_id, a.balance::text AS balance, a.lifetime_earned::text AS lifetime_earned,
                  (SELECT count(*)::int FROM ledger_entries e WHERE e.account_id = a.account_id) AS entries,
                  (SELECT max(t.occurred_at) FROM ledger_entries e JOIN ledger_transactions t ON t.txn_id = e.txn_id
                    WHERE e.account_id = a.account_id) AS last_at
           FROM ledger_accounts a WHERE ${where} ORDER BY a.code LIMIT ${limit + 1}`,
          params,
        ),
      );
      const page = rows.slice(0, limit);
      const refs = yield* personRefs(
        ws,
        page.flatMap((r) => (r.member_id ? [r.member_id] : [])),
      );
      return {
        items: page.map((r) => ({
          account: r.code,
          kind: r.kind,
          member: r.member_id ? needRef(refs, r.member_id) : null,
          balance: Number(r.balance),
          lifetime_earned: Number(r.lifetime_earned),
          entries: r.entries,
          last_entry_at: r.last_at ? iso(r.last_at) : null,
        })),
        next_cursor:
          rows.length > limit && page.length > 0 ? encodeCursor({ c: page[page.length - 1]?.code }) : null,
      } as Out<typeof SuitePoints.AccountsOut>;
    }),
};

const trial: ActionHandler<unknown, Out<typeof SuitePoints.TrialBalanceOut>> = {
  run: (_input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const tb = yield* trialBalance(ws);
      const accs = yield* store(
        sql<{ code: string; kind: string; balance: string }>`
          SELECT code, kind, balance::text AS balance FROM ledger_accounts WHERE workspace_id = ${ws} ORDER BY code`,
      );
      const lots = yield* store(
        sql<{ s: string }>`
          SELECT coalesce(sum(l.remaining), 0)::text AS s FROM point_lots l
          JOIN ledger_accounts a ON a.account_id = l.account_id WHERE a.workspace_id = ${ws} AND a.kind = 'member'`,
      );
      const drift = yield* store(
        sql<{ code: string; cached: string; computed: string }>`
          SELECT a.code, a.balance::text AS cached, coalesce(sum(e.amount), 0)::text AS computed
          FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.account_id
          WHERE a.workspace_id = ${ws} GROUP BY a.account_id HAVING a.balance <> coalesce(sum(e.amount), 0)`,
      );
      return {
        ok: tb.ok,
        checked_at: ctx.now.toISOString(),
        system: accs
          .filter((a) => a.kind === "system")
          .map((a) => ({ account: a.code, balance: Number(a.balance) })),
        member_total: accs.filter((a) => a.kind === "member").reduce((s, a) => s + Number(a.balance), 0),
        grand_total: accs.reduce((s, a) => s + Number(a.balance), 0),
        lots_total: Number(lots[0]?.s ?? 0),
        drift: drift.map((d) => ({
          account: d.code,
          cached: Number(d.cached),
          computed: Number(d.computed),
        })),
        unbalanced_txns: tb.violations.filter((v) => v.invariant === "L1").map((v) => v.subject),
        txn_count: tb.transactions,
      } as Out<typeof SuitePoints.TrialBalanceOut>;
    }),
};

const REVERSIBLE: ReadonlyArray<TxnType> = ["award", "adjustment", "promotion_bonus", "badge_reward"];

const reverse: ActionHandler<Out<typeof SuitePoints.ReverseIn>, Out<typeof SuitePoints.TxnResult>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const t = yield* store(
        sql<{ txn_type: TxnType; reversed: boolean }>`
          SELECT t.txn_type, EXISTS (SELECT 1 FROM ledger_transactions r WHERE r.reverses_txn_id = t.txn_id) AS reversed
          FROM ledger_transactions t WHERE t.workspace_id = ${ws} AND t.txn_id = ${input.txn_id}`,
      );
      if (!t[0])
        return yield* Effect.fail(
          refuse(
            "UNKNOWN_REFERENCE",
            "UNKNOWN_TRANSACTION",
            `no transaction '${input.txn_id}'`,
            {},
            "/txn_id",
          ),
        );
      if (t[0].reversed)
        return yield* Effect.fail(
          refuse("CONFLICT", "INVALID_TRANSITION", "this transaction was already reversed", {
            from: "reversed",
            to: "reversal",
            allowed: [],
          }),
        );
      if (!REVERSIBLE.includes(t[0].txn_type))
        return yield* Effect.fail(
          refuse(
            "CONFLICT",
            "INVALID_TRANSITION",
            "only awards, adjustments and bonuses are reversed here; purchases are reversed by order cancel or refund",
            { from: t[0].txn_type, to: "reversal", allowed: [] },
          ),
        );
      const res = yield* postReversal(ctx, {
        txnId: input.txn_id,
        memo: clip(`Reversal: ${input.reason}`, 280),
        ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}),
      });
      const member = Object.entries(res.balances).find(([code]) => code.startsWith("member:"));
      return {
        txn_id: res.txn_id,
        txn_no: res.txn_no,
        balance: member ? member[1] : 0,
        replayed: res.replayed,
      };
    }),
};

export const ledgerHandlers = {
  "ledger.accounts": accounts,
  "ledger.trial_balance": trial,
  "ledger.reverse": reverse,
} satisfies HandlerTable;
