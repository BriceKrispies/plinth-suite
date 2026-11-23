import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { nodeId, nodeUri, principalId, workspaceId } from "@plinth/core";
import { DomainError, actionByName } from "@plinth/spec";
import {
  Authorizer,
  ChangeLog,
  ControlStore,
  HANDLERS,
  Identity,
  StoreLive,
  audienceOf,
  domainEventsSince,
  fileActionApproval,
  inTx,
  invoke,
  listActions,
  memberByHandle,
  notImplemented,
  navCounts,
  postAdjustment,
  postAward,
  postExpiry,
  postPurchase,
  postRefund,
  postReversal,
  postTransfer,
  requireTarget,
  resetAndSeed,
  store,
  trialBalance,
  verifyDomainChain,
  type ActionHandler,
  type EmitCtx,
  type Principal,
} from "@plinth/engine";
import { Xoshiro } from "../src/rng";
import { ALL_STEPS, runSuiteSeed } from "../src/suite";

// Needs Postgres (plinth_test). The shared Suite foundation: seed framework, ledger, dispatcher, domain stream, counts.

const WS = workspaceId("northwind");
const DEMO = new Date("2026-11-20T14:30:00Z");

// The foundation tests run on the people world (service principals, members, program, roles, preferences, groups and
// opening balances): the domain steps are exercised by their own files, and a full seed takes about a minute.
const FOUNDATION_STEPS = ALL_STEPS.slice(0, 7);

const seedWorld = (steps: typeof ALL_STEPS) =>
  Effect.gen(function* () {
    yield* resetAndSeed;
    yield* runSuiteSeed({ steps });
  });

const setup = Effect.gen(function* () {
  yield* seedWorld(FOUNDATION_STEPS);
  const id = yield* Identity;
  const who = (s: string) => id.bySubject(s);
  return {
    maya: yield* who("user:ops-lead"),
    jonas: yield* who("user:emea-lead"),
    priya: yield* who("user:finance-analyst"),
    agent: yield* who("agent:claude-code"),
    ana: yield* who("user:ana-silva"),
    ben: yield* who("user:ben-carter"),
    system: yield* who("service:ingest"),
  };
});

const emit = (p: Principal, at: Date = DEMO): EmitCtx => ({ principal: p, surface: "system", now: at });

const balanceOf = (handle: string) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const r = yield* store(
      sql<{ b: string }>`SELECT balance::text AS b FROM ledger_accounts WHERE code = ${"member:" + handle}`,
    );
    return Number(r[0]?.b ?? 0);
  });

const count = (table: "ledger_transactions" | "ledger_entries" | "domain_events" | "action_approvals") =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const r = yield* store(sql.unsafe<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`));
    return Number(r[0]?.n ?? 0);
  });

/** Install a handler for the duration of `eff` (the dispatcher looks handlers up in the registry on every call). */
const withHandlers = <A, E, R>(
  hs: Record<string, ActionHandler<any, any>>,
  eff: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => {
  const table = HANDLERS as unknown as Record<string, ActionHandler<any, any>>;
  const saved = Object.fromEntries(Object.keys(hs).map((k) => [k, table[k]]));
  return Effect.acquireUseRelease(
    Effect.sync(() => Object.assign(table, hs)),
    () => eff,
    () => Effect.sync(() => Object.assign(table, saved)),
  );
};

const refusal = <A, E>(eff: Effect.Effect<A, E, any>) =>
  eff.pipe(
    Effect.either,
    Effect.map((r) => (Either.isLeft(r) ? (r.left as unknown as DomainError) : undefined)),
  );

describe("seed framework", () => {
  it.effect("seeds 40 members with accounts, roles, grants, groups and opening balances", () =>
    Effect.gen(function* () {
      const { jonas, ana } = yield* setup;
      const { sql } = yield* ControlStore;
      const n = (q: Effect.Effect<ReadonlyArray<{ n: string }>, any, any>) =>
        q.pipe(Effect.map((r) => Number(r[0]?.n)));
      expect(yield* n(store(sql<{ n: string }>`SELECT count(*)::text AS n FROM members`))).toBe(40);
      expect(
        yield* n(
          store(sql<{ n: string }>`SELECT count(*)::text AS n FROM ledger_accounts WHERE kind = 'member'`),
        ),
      ).toBe(40);
      expect(
        yield* n(store(sql<{ n: string }>`SELECT count(*)::text AS n FROM nodes WHERE kind = 'Role'`)),
      ).toBe(6);
      expect(
        yield* n(store(sql<{ n: string }>`SELECT count(*)::text AS n FROM nodes WHERE kind = 'Group'`)),
      ).toBe(8);
      expect(
        yield* n(store(sql<{ n: string }>`SELECT count(*)::text AS n FROM nodes WHERE kind = 'Preference'`)),
      ).toBe(40);
      const tiers = yield* store(
        sql<{
          tier: string;
          n: string;
        }>`SELECT tier, count(*)::text AS n FROM ledger_accounts WHERE kind = 'member' GROUP BY tier`,
      );
      expect(Object.fromEntries(tiers.map((t) => [t.tier, Number(t.n)]))).toEqual({
        bronze: 16,
        silver: 12,
        gold: 8,
        platinum: 4,
      });
      const t = yield* trialBalance(WS);
      expect(t.violations).toEqual([]);
      expect(t.ok).toBe(true);
      // role grants: the EMEA manager holds points:award with an EMEA predicate; a plain member holds none (AC-AUTHZ-ROLES)
      const authz = yield* Authorizer;
      const res = "plinth://northwind/suite/points";
      expect(yield* authz.authorize(jonas, "points:award", res)).toMatchObject({
        kind: "allow",
        rowPredicate: "(region = 'EMEA')",
      });
      expect(yield* authz.authorize(ana, "points:award", res)).toMatchObject({ kind: "deny" });
      expect((yield* verifyDomainChain(WS)).ok).toBe(true);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("two resets give identical ids, domain events and ledger (AC-SEED determinism)", () =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const snapshot = Effect.gen(function* () {
        const ev = yield* store(
          sql<{ seq: string; hash: Buffer }>`SELECT seq::text AS seq, hash FROM domain_events ORDER BY seq`,
        );
        const tx = yield* store(
          sql<{
            txn_id: string;
            txn_no: string;
          }>`SELECT txn_id, txn_no::text AS txn_no FROM ledger_transactions ORDER BY txn_no`,
        );
        return {
          ev: ev.map((e) => `${e.seq}:${e.hash.toString("hex")}`),
          tx: tx.map((t) => `${t.txn_no}:${t.txn_id}`),
        };
      });
      // the people world plus catalogue and badges; the whole history is compared in suite-determinism.test.ts
      const steps = ALL_STEPS.slice(0, 9);
      yield* seedWorld(steps);
      const a = yield* snapshot;
      yield* seedWorld(steps);
      const b = yield* snapshot;
      expect(a.ev.length).toBeGreaterThan(40);
      expect(b).toEqual(a);
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("ledger posting (CONTRACT 7)", () => {
  it.effect("awards, transfers, purchases, refunds and adjustments keep every invariant", () =>
    Effect.gen(function* () {
      const { system } = yield* setup;
      const before = yield* balanceOf("ana-silva");
      const ben = yield* balanceOf("ben-carter");
      const a = yield* inTx(
        postAward(emit(system), {
          handle: "ana-silva",
          base: 1000,
          bonus: 100,
          memo: "test award",
          key: "t:award:1",
        }),
      );
      expect(a.replayed).toBe(false);
      expect(a.balances["member:ana-silva"]).toBe(before + 1100);
      yield* inTx(
        postTransfer(emit(system), {
          from: "ana-silva",
          to: "ben-carter",
          points: 400,
          memo: "thanks",
          key: "t:transfer:1",
        }),
      );
      expect(yield* balanceOf("ben-carter")).toBe(ben + 400);
      const buy = yield* inTx(
        postPurchase(emit(system), {
          handle: "ana-silva",
          total: 500,
          memo: "order",
          key: "t:order:1",
          orderId: "o-1",
        }),
      );
      expect(yield* balanceOf("ana-silva")).toBe(before + 1100 - 400 - 500);
      yield* inTx(
        postRefund(emit(system), {
          handle: "ana-silva",
          total: 500,
          memo: "refund",
          key: "t:refund:1",
          orderId: "o-1",
          purchaseTxnId: buy.txn_id,
        }),
      );
      expect(yield* balanceOf("ana-silva")).toBe(before + 1100 - 400);
      yield* inTx(
        postAdjustment(emit(system), {
          handle: "ana-silva",
          delta: -50,
          memo: "correction",
          key: "t:adjust:1",
        }),
      );
      yield* inTx(
        postAdjustment(emit(system), {
          handle: "ana-silva",
          delta: 25,
          memo: "correction",
          key: "t:adjust:2",
        }),
      );
      expect(yield* balanceOf("ana-silva")).toBe(before + 1100 - 400 - 25);
      const t = yield* trialBalance(WS);
      expect(t.violations).toEqual([]);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("a debit past zero is INSUFFICIENT_POINTS and leaves no rows (L2)", () =>
    Effect.gen(function* () {
      const { system } = yield* setup;
      const bal = yield* balanceOf("ana-silva");
      const [tx0, en0, ev0] = [
        yield* count("ledger_transactions"),
        yield* count("ledger_entries"),
        yield* count("domain_events"),
      ];
      const e = yield* refusal(
        inTx(
          postTransfer(emit(system), {
            from: "ana-silva",
            to: "ben-carter",
            points: bal + 1,
            memo: "too much",
            key: "t:over:1",
          }),
        ),
      );
      expect(e?.code).toBe("CONFLICT");
      expect(e?.details).toMatchObject({ reason: "INSUFFICIENT_POINTS", balance: bal, required: bal + 1 });
      expect([
        yield* count("ledger_transactions"),
        yield* count("ledger_entries"),
        yield* count("domain_events"),
      ]).toEqual([tx0, en0, ev0]);
      expect(yield* balanceOf("ana-silva")).toBe(bal);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect(
    "replaying a key returns the same transaction; a different request with the key is refused (L7)",
    () =>
      Effect.gen(function* () {
        const { system } = yield* setup;
        const first = yield* inTx(
          postAward(emit(system), { handle: "ben-carter", base: 100, memo: "once", key: "t:idem:1" }),
        );
        const again = yield* inTx(
          postAward(emit(system), { handle: "ben-carter", base: 100, memo: "once", key: "t:idem:1" }),
        );
        expect(again.txn_id).toBe(first.txn_id);
        expect(again.replayed).toBe(true);
        const bal = yield* balanceOf("ben-carter");
        const e = yield* refusal(
          inTx(postAward(emit(system), { handle: "ben-carter", base: 101, memo: "once", key: "t:idem:1" })),
        );
        expect(e?.code).toBe("IDEMPOTENCY_KEY_REUSED");
        expect(yield* balanceOf("ben-carter")).toBe(bal);
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("an unbalanced transaction fails at commit and leaves nothing (L1)", () =>
    Effect.gen(function* () {
      const { system } = yield* setup;
      const { sql } = yield* ControlStore;
      const acct = yield* store(
        sql<{ account_id: string }>`SELECT account_id FROM ledger_accounts WHERE code = 'member:ana-silva'`,
      );
      const before = yield* count("ledger_transactions");
      const r = yield* Effect.exit(
        store(
          sql.withTransaction(
            Effect.gen(function* () {
              const txn = "11111111-1111-4111-8111-111111111111";
              yield* sql`INSERT INTO ledger_transactions (txn_id, workspace_id, txn_no, txn_type, occurred_at, actor_id, surface, memo,
                                                         idempotency_key, request_hash, event_seq)
                         VALUES (${txn}, ${WS}, 999999, 'award', now(), ${system.id}, 'system', 'unbalanced', 'raw:1', ${Buffer.alloc(32)}, 1)`;
              yield* sql`INSERT INTO ledger_entries (workspace_id, txn_id, account_id, amount, balance_after)
                         VALUES (${WS}, ${txn}, ${acct[0]?.account_id}, 5, 0)`;
            }),
          ),
        ),
      );
      // the deferred L1 trigger fires at COMMIT: the whole transaction fails (as a failure or a defect)
      expect(r._tag).toBe("Failure");
      expect(yield* count("ledger_transactions")).toBe(before);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("a tier crossing emits tier.changed; reversal and expiry keep the lots consistent (L5, L9)", () =>
    Effect.gen(function* () {
      const { system } = yield* setup;
      const { sql } = yield* ControlStore;
      // a bronze member crosses the silver floor
      const bronze = yield* store(
        sql<{
          code: string;
          lifetime_earned: string;
        }>`SELECT code, lifetime_earned::text AS lifetime_earned FROM ledger_accounts WHERE kind = 'member' AND tier = 'bronze' ORDER BY code LIMIT 1`,
      );
      const handle = (bronze[0]?.code ?? "").slice(7);
      const need = 5000 - Number(bronze[0]?.lifetime_earned) + 10;
      const r = yield* inTx(postAward(emit(system), { handle, base: need, memo: "boost", key: "t:tier:1" }));
      expect(r.tier_changes).toEqual([{ member: handle, from: "bronze", to: "silver" }]);
      const ev = yield* store(
        sql<{
          type: string;
        }>`SELECT type FROM domain_events WHERE type = 'tier.changed' ORDER BY seq DESC LIMIT 1`,
      );
      expect(ev[0]?.type).toBe("tier.changed");
      // reversing the award consumes its own lot and drops the tier again
      const rev = yield* inTx(postReversal(emit(system), { txnId: r.txn_id, memo: "undo boost" }));
      expect(rev.tier_changes).toEqual([{ member: handle, from: "silver", to: "bronze" }]);
      expect(
        (yield* refusal(inTx(postReversal(emit(system), { txnId: r.txn_id, memo: "again" }))))?.code,
      ).toBe("CONFLICT");
      // expiring a lot
      const lot = yield* store(
        sql<{ lot_id: string; remaining: string; code: string }>`
          SELECT l.lot_id, l.remaining::text AS remaining, a.code FROM point_lots l JOIN ledger_accounts a ON a.account_id = l.account_id
          WHERE l.remaining > 0 ORDER BY l.lot_id LIMIT 1`,
      );
      const l = lot[0];
      expect(l).toBeDefined();
      yield* inTx(
        postExpiry(emit(system), {
          handle: (l?.code ?? "").slice(7),
          lotId: l?.lot_id ?? "",
          remaining: Number(l?.remaining),
          memo: "expired",
        }),
      );
      const t = yield* trialBalance(WS);
      expect(t.violations).toEqual([]);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("500 random postings leave the trial balance clean (AC-LEDGER-TRIAL)", () =>
    Effect.gen(function* () {
      const { system } = yield* setup;
      const rng = new Xoshiro(2026n);
      const handles = ["ana-silva", "ben-carter", "chloe-nguyen", "david-kim", "emma-brooks"];
      const purchases: Array<{ handle: string; total: number; txn: string; order: string }> = [];
      for (let i = 0; i < 500; i++) {
        const h = rng.pick(handles);
        const other = rng.pick(handles.filter((x) => x !== h));
        const n = 10 + rng.int(300);
        const key = `t:rand:${i}`;
        const op = rng.int(6);
        const attempt =
          op === 0
            ? postAward(emit(system), { handle: h, base: n, bonus: rng.int(2) * 20, memo: "r", key })
            : op === 1
              ? postTransfer(emit(system), { from: h, to: other, points: n, memo: "r", key })
              : op === 2
                ? postPurchase(emit(system), { handle: h, total: n, memo: "r", key, orderId: `o-${i}` }).pipe(
                    Effect.tap((p) =>
                      Effect.sync(() =>
                        purchases.push({ handle: h, total: n, txn: p.txn_id, order: `o-${i}` }),
                      ),
                    ),
                  )
                : op === 3
                  ? postAdjustment(emit(system), {
                      handle: h,
                      delta: rng.int(2) === 0 ? n : -n,
                      memo: "r",
                      key,
                    })
                  : op === 4 && purchases.length > 0
                    ? (() => {
                        const p = purchases.splice(rng.int(purchases.length), 1)[0]!;
                        return postRefund(emit(system), {
                          handle: p.handle,
                          total: p.total,
                          memo: "r",
                          key,
                          orderId: p.order,
                          purchaseTxnId: p.txn,
                        });
                      })()
                    : postAward(emit(system), { handle: h, base: n, memo: "r", key });
        // a debit past zero is a legal refusal; every other outcome must commit
        const r = yield* Effect.either(inTx(attempt));
        if (Either.isLeft(r)) expect((r.left as DomainError).details?.["reason"]).toBe("INSUFFICIENT_POINTS");
      }
      const t = yield* trialBalance(WS);
      expect(t.violations).toEqual([]);
      expect(t.ok).toBe(true);
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("action dispatcher (CONTRACT 5)", () => {
  const AwardIn = (points: number, key: string) => ({
    to: ["ana-silva"],
    points,
    category: "recognition",
    reason: "great work",
    idempotency_key: key,
  });

  /** A real-enough points.award: row predicate, one ledger posting per recipient, derived idempotency keys. */
  const awardHandler: ActionHandler<any, any> = {
    run: (input, ctx) =>
      Effect.gen(function* () {
        const results: Array<unknown> = [];
        for (const handle of input.to as string[]) {
          const m = yield* memberByHandle(ctx.principal.workspaceId, handle);
          yield* requireTarget(ctx, m);
          const r = yield* postAward(ctx, {
            handle,
            base: input.points,
            memo: "award",
            key: `award:${input.idempotency_key}:${handle}`,
          });
          results.push({
            member: handle,
            txn_id: r.txn_id,
            base_points: input.points,
            bonus_points: 0,
            promotions: [],
          });
        }
        return { status: "committed", approval_id: null, results, replayed: false };
      }),
  };
  const transferHandler: ActionHandler<any, any> = {
    preview: (input) =>
      Effect.succeed({
        effect: `Transfer ${input.points} pts to ${input.to}`,
        facts: { points: input.points },
        approverPermission: "points:transfer",
      }),
    run: (input, ctx) =>
      Effect.gen(function* () {
        const r = yield* postTransfer(ctx, {
          from: "ana-silva",
          to: input.to,
          points: input.points,
          memo: input.memo,
          key: `transfer:${input.idempotency_key}`,
          ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}),
        });
        return {
          txn_id: r.txn_id,
          txn_no: r.txn_no,
          balance: r.balances["member:ana-silva"] ?? 0,
          replayed: false,
        };
      }),
  };
  const decideHandler: ActionHandler<any, any> = {
    run: (input, ctx) =>
      Effect.gen(function* () {
        const r = yield* ctx.executeHeld(input.id, ctx.principal);
        const person = {
          subject: ctx.principal.subject,
          handle: null,
          display_name: "x",
          kind: "human",
          avatar: { initials: "X", hue: 1 },
        };
        return {
          type: "action",
          id: input.id,
          title: "t",
          summary: "s",
          status: r.status,
          requested_by: person,
          on_behalf_of: null,
          requested_at: "2026-11-20T14:30:00Z",
          expires_at: null,
          rule_id: [],
          approver_permission: "points:transfer",
          can_decide: false,
          blocked_reason: null,
          decided_by: null,
          decided_at: null,
          decision_reason: null,
          link: "/approvals",
          detail: {},
        };
      }),
  };

  it.effect(
    "decodes with excess properties refused, authorises, and runs the handler in one transaction",
    () =>
      Effect.gen(function* () {
        const { maya, ana } = yield* setup;
        yield* withHandlers(
          { "points.award": awardHandler },
          Effect.gen(function* () {
            const bad = yield* refusal(
              invoke({
                actor: { principal: maya, surface: "ui" },
                name: "points.award",
                input: { ...AwardIn(10, "k-bad-0001"), wrong: 1 },
              }),
            );
            expect(bad?.code).toBe("VALIDATION_FAILED");
            expect(bad?.path).toContain("wrong");
            const denied = yield* refusal(
              invoke({
                actor: { principal: ana, surface: "ui" },
                name: "points.award",
                input: AwardIn(10, "k-deny-0001"),
              }),
            );
            expect(denied).toMatchObject({ code: "FORBIDDEN" });
            expect(denied?.details?.["permission"]).toBe("points:award");
            const unknown = yield* refusal(
              invoke({ actor: { principal: maya, surface: "ui" }, name: "points.awards", input: {} }),
            );
            expect(unknown?.code).toBe("UNKNOWN_REFERENCE");
            expect(unknown?.did_you_mean).toContain("points.award");
            const before = yield* balanceOf("ana-silva");
            const ok = yield* invoke({
              actor: { principal: maya, surface: "ui" },
              name: "points.award",
              input: AwardIn(100, "k-ok-00001"),
            });
            expect(ok).toMatchObject({ kind: "result", replayed: false });
            expect(yield* balanceOf("ana-silva")).toBe(before + 100);
          }),
        );
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("is idempotent per (principal, key): same request replays, a different one is refused", () =>
    Effect.gen(function* () {
      const { maya } = yield* setup;
      yield* withHandlers(
        { "points.award": awardHandler },
        Effect.gen(function* () {
          const run = (points: number) =>
            invoke({
              actor: { principal: maya, surface: "ui" },
              name: "points.award",
              input: AwardIn(points, "k-idem-0001"),
            });
          const first = yield* run(100);
          const bal = yield* balanceOf("ana-silva");
          const second = yield* run(100);
          expect(second).toMatchObject({ kind: "result", replayed: true });
          expect((second as any).data.results[0].txn_id).toBe((first as any).data.results[0].txn_id);
          expect(yield* balanceOf("ana-silva")).toBe(bal);
          expect((yield* refusal(run(150)))?.code).toBe("IDEMPOTENCY_KEY_REUSED");
        }),
      );
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("a failing handler rolls back everything it wrote, including events", () =>
    Effect.gen(function* () {
      const { maya } = yield* setup;
      yield* withHandlers(
        {
          "points.award": {
            run: (_i, ctx) =>
              Effect.gen(function* () {
                yield* postAward(ctx, { handle: "ana-silva", base: 5, memo: "x", key: "t:rollback:1" });
                return yield* Effect.fail(new DomainError({ code: "RULE_REFUSED", path: "", message: "no" }));
              }),
          },
        },
        Effect.gen(function* () {
          const [tx0, ev0] = [yield* count("ledger_transactions"), yield* count("domain_events")];
          const e = yield* refusal(
            invoke({
              actor: { principal: maya, surface: "ui" },
              name: "points.award",
              input: AwardIn(5, "k-roll-0001"),
            }),
          );
          expect(e?.code).toBe("RULE_REFUSED");
          expect([yield* count("ledger_transactions"), yield* count("domain_events")]).toEqual([tx0, ev0]);
        }),
      );
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect(
    "a row-predicate miss is FORBIDDEN row_predicate for the EMEA manager on an NA member (AC-AUTHZ-ROLES)",
    () =>
      Effect.gen(function* () {
        const { jonas } = yield* setup;
        yield* withHandlers(
          { "points.award": awardHandler },
          Effect.gen(function* () {
            const e = yield* refusal(
              invoke({
                actor: { principal: jonas, surface: "ui" },
                name: "points.award",
                input: AwardIn(10, "k-row-00001"),
              }),
            );
            expect(e?.code).toBe("FORBIDDEN");
            expect(e?.details?.["reason"]).toBe("row_predicate");
            const emea = yield* invoke({
              actor: { principal: jonas, surface: "ui" },
              name: "points.award",
              input: { ...AwardIn(10, "k-row-00002"), to: ["jakob-meyer"] },
            });
            expect(emea.kind).toBe("result");
          }),
        );
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("stubs answer NOT_IMPLEMENTED, and agent-denied actions are refused as ceiling_denies", () =>
    Effect.gen(function* () {
      const { maya, agent } = yield* setup;
      // every action has a handler now: the placeholder is exercised through a registry entry of its own
      const stub = yield* withHandlers(
        { "points.tiers": notImplemented("points.tiers") },
        refusal(invoke({ actor: { principal: maya, surface: "ui" }, name: "points.tiers", input: {} })),
      );
      expect(stub?.details?.["reason"]).toBe("NOT_IMPLEMENTED");
      const denied = yield* refusal(
        invoke({
          actor: { principal: agent, surface: "mcp" },
          name: "me.sessions.revoke",
          input: { session_id: "ses_" + "a".repeat(22) },
        }),
      );
      expect(denied).toMatchObject({ code: "FORBIDDEN" });
      expect(denied?.details?.["reason"]).toBe("ceiling_denies");
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect(
    "an agent's approval action: dry run, token, filed for approval; the delegator cannot decide, another human can (AC-MCP-ACTIONS)",
    () =>
      Effect.gen(function* () {
        const { maya, jonas, agent } = yield* setup;
        yield* withHandlers(
          { "points.transfer": transferHandler, "approvals.decide": decideHandler },
          Effect.gen(function* () {
            const input = {
              to: "ben-carter",
              points: 200,
              memo: "thanks",
              idempotency_key: "agent-transfer-1",
            };
            const act = { principal: agent, surface: "mcp" as const };
            // no token: PREVIEW_REQUIRED with the call to make
            const need = yield* refusal(invoke({ actor: act, name: "points.transfer", input }));
            expect(need?.code).toBe("PREVIEW_REQUIRED");
            expect(need?.suggestion).toMatchObject({ kind: "call", tool: "action.invoke" });
            // dry run
            const dry = yield* invoke({ actor: act, name: "points.transfer", input, dryRun: true });
            expect(dry.kind).toBe("preview");
            const token = (dry as any).preview.preview_token as string;
            expect((dry as any).preview.decision).toBe("approval");
            expect((dry as any).preview.effect).toContain("Transfer 200 pts");
            // commit files it
            const before = yield* count("action_approvals");
            const held = yield* invoke({
              actor: act,
              name: "points.transfer",
              previewToken: token,
              idempotencyKey: "agent-commit-1",
            });
            expect(held.kind).toBe("pending_approval");
            expect(yield* count("action_approvals")).toBe(before + 1);
            const approvalId = (held as any).approval_id as string;
            // the token is single use
            expect(
              (yield* refusal(
                invoke({
                  actor: act,
                  name: "points.transfer",
                  previewToken: token,
                  idempotencyKey: "agent-commit-2",
                }),
              ))?.code,
            ).toBe("PREVIEW_REQUIRED");
            // the human the agent acts for cannot decide it
            const self = yield* refusal(
              invoke({
                actor: { principal: maya, surface: "ui" },
                name: "approvals.decide",
                input: { type: "action", id: approvalId, decision: "approve" },
              }),
            );
            expect(self?.code).toBe("FORBIDDEN");
            expect(self?.details?.["policy"]).toBe("sod:on_behalf_of");
            // another approver can; the transfer posts with approved_by set and the agent as actor
            const decided = yield* invoke({
              actor: { principal: jonas, surface: "ui" },
              name: "approvals.decide",
              input: { type: "action", id: approvalId, decision: "approve" },
            });
            expect((decided as any).data.status).toBe("approved");
            const { sql } = yield* ControlStore;
            const ev = yield* store(
              sql<{ actor: string; approver: string | null }>`
              SELECT a.subject AS actor, ap.subject AS approver FROM domain_events e
              JOIN principals a ON a.principal_id = e.actor_id LEFT JOIN principals ap ON ap.principal_id = e.approved_by
              WHERE e.type = 'points.posted' AND e.payload ->> 'txn_type' = 'transfer' ORDER BY e.seq DESC LIMIT 1`,
            );
            expect(ev[0]).toEqual({ actor: "agent:claude-code", approver: "user:emea-lead" });
            const row = yield* store(
              sql<{ status: string }>`SELECT status FROM action_approvals WHERE approval_id = ${approvalId}`,
            );
            expect(row[0]?.status).toBe("approved");
            // already decided
            expect((yield* refusal(ctxDecide(jonas, approvalId)))?.details?.["reason"]).toBe(
              "INVALID_TRANSITION",
            );
          }),
        );
      }).pipe(Effect.provide(StoreLive)),
  );

  const ctxDecide = (p: Principal, id: string) =>
    invoke({
      actor: { principal: p, surface: "ui" },
      name: "approvals.decide",
      input: { type: "action", id, decision: "approve" },
    });

  it.effect("the catalogue lists only what the viewer may call", () =>
    Effect.gen(function* () {
      const { maya, ana, agent } = yield* setup;
      const names = (p: Principal) => listActions(p, {}).pipe(Effect.map((r) => r.items.map((i) => i.name)));
      const mine = yield* names(ana);
      expect(mine).toContain("me.get");
      expect(mine).not.toContain("points.award");
      expect(mine).not.toContain("admin.member_create");
      const mayas = yield* names(maya);
      expect(mayas).toContain("points.award");
      const agents = yield* names(agent);
      expect(agents).not.toContain("me.sessions.revoke");
      const one = yield* listActions(maya, { name: "points.award" });
      expect(one.items[0]?.input_schema).toBeDefined();
      expect(actionByName("points.award")?.agent).toBe("approval");
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("domain events, stream and counts", () => {
  it.effect("the chain verifies, and altering one payload makes it fail at that seq (AC-AUDIT-CHAINS)", () =>
    Effect.gen(function* () {
      yield* setup;
      const { sql } = yield* ControlStore;
      expect((yield* verifyDomainChain(WS)).ok).toBe(true);
      const row = yield* store(
        sql<{ seq: string }>`SELECT seq::text AS seq FROM domain_events ORDER BY seq OFFSET 3 LIMIT 1`,
      );
      const seq = Number(row[0]?.seq);
      yield* store(
        sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`ALTER TABLE domain_events DISABLE TRIGGER domain_events_append_only`;
            yield* sql`UPDATE domain_events SET payload = payload || '{"tampered":true}'::jsonb WHERE workspace_id = ${WS} AND seq = ${seq}`;
            yield* sql`ALTER TABLE domain_events ENABLE TRIGGER domain_events_append_only`;
          }),
        ),
      );
      const v = yield* verifyDomainChain(WS);
      expect(v.ok).toBe(false);
      expect(v.error?.seq).toBe(seq);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect(
    "a member receives their own events and public ones, never another member's (AC-RT-DOMAIN, per-user filtering)",
    () =>
      Effect.gen(function* () {
        const { ana, ben, jonas, agent, system } = yield* setup;
        const { sql } = yield* ControlStore;
        const head = yield* store(sql<{ h: string }>`SELECT head_seq::text AS h FROM domain_chain`);
        const after = Number(head[0]?.h);
        yield* inTx(
          postTransfer(emit(system), {
            from: "ana-silva",
            to: "ben-carter",
            points: 60,
            memo: "hi",
            key: "t:rt:1",
          }),
        );
        const seen = (p: Principal) =>
          Effect.gen(function* () {
            const aud = yield* audienceOf(p);
            const r = yield* domainEventsSince(WS, aud, after);
            return r.items
              .filter((e) => e.type === "points.posted")
              .map((e) => (e.payload as { account: string }).account);
          });
        expect(yield* seen(ana)).toEqual(["member:ana-silva"]);
        expect(yield* seen(ben)).toEqual(["member:ben-carter"]);
        // finance sees every account of a posting; a manager without the finance role sees none of them
        const priya = yield* (yield* Identity).bySubject("user:finance-analyst");
        expect((yield* seen(priya)).sort()).toEqual(["member:ana-silva", "member:ben-carter"]);
        expect(yield* seen(jonas)).toEqual([]);
        // an agent matches its delegator's audience (Maya is not finance either)
        expect(yield* seen(agent)).toEqual([]);
        // the window advances over hidden events, so they are never re-read
        const r = yield* domainEventsSince(WS, yield* audienceOf(jonas), after);
        expect(r.items).toEqual([]);
        expect(r.through).toBeGreaterThan(after);
        // type filter
        const only = yield* domainEventsSince(WS, yield* audienceOf(ana), after, { types: ["tier.changed"] });
        expect(only.items).toEqual([]);
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("counts: notifications, tasks, cart and held approvals are computed per principal", () =>
    Effect.gen(function* () {
      const { maya, jonas, ana, agent } = yield* setup;
      const { sql } = yield* ControlStore;
      expect((yield* navCounts(ana)).notifications_unread).toBe(0);
      const aid = principalId(WS, "user:ana-silva");
      yield* store(
        sql`INSERT INTO notifications (notification_id, workspace_id, recipient_id, type, title, body, in_app, created_at, dedupe_key)
            VALUES (gen_random_uuid(), ${WS}, ${aid}, 'system', 't', 'b', true, now(), 'c:1'),
                   (gen_random_uuid(), ${WS}, ${aid}, 'system', 't', 'b', true, now(), 'c:2'),
                   (gen_random_uuid(), ${WS}, ${aid}, 'system', 't', 'b', false, now(), 'c:3')`,
      );
      yield* store(
        sql`INSERT INTO tasks (task_id, workspace_id, task_no, title, status, priority, assignee_id, created_by, created_at, updated_at, completed_at, source)
            VALUES (gen_random_uuid(), ${WS}, 1, 'a', 'open', 'normal', ${aid}, ${aid}, now(), now(), NULL, 'manual'),
                   (gen_random_uuid(), ${WS}, 2, 'b', 'done', 'normal', ${aid}, ${aid}, now(), now(), now(), 'manual')`,
      );
      const c = yield* navCounts(ana);
      expect(c.notifications_unread).toBe(2);
      expect(c.tasks_open).toBe(1);
      // a held action is pending for approvers other than the requester and the person the agent acts for
      yield* store(
        sql.withTransaction(
          Effect.gen(function* () {
            yield* fileActionApproval(
              { principal: agent, onBehalfOf: maya, surface: "mcp", now: DEMO },
              {
                action: "points.transfer",
                input: {},
                approverPermission: "points:transfer",
                summary: "Transfer 1 pt",
                idempotencyKey: "c-approval-1",
              },
            );
          }),
        ),
      );
      expect((yield* navCounts(jonas)).approvals_pending).toBe(1);
      expect((yield* navCounts(maya)).approvals_pending).toBe(0);
      expect((yield* navCounts(ana)).approvals_pending).toBe(0);
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("Suite node kinds through the kernel path", () => {
  it.effect(
    "a Suite node commits, is read back, and an unknown field is refused with its pointer; managed fields need an action",
    () =>
      Effect.gen(function* () {
        const { system, maya } = yield* setup;
        const log = yield* ChangeLog;
        expect(ALL_STEPS.map((s) => s.name)).toContain("program");
        const prog = yield* log.findBySlug(maya, "Program", "rewards");
        expect(prog?.revision).toBe(1);
        const cat = {
          apiVersion: "plinth/v1",
          kind: "Category",
          metadata: { slug: "apparel", title: "Apparel" },
          spec: {
            description: "Clothing",
            artwork: { icon: "shirt", hue: 212, pattern: "dots" },
            sort: 1,
            status: "active",
          },
        };
        const uri = nodeUri("northwind", "Category", nodeId(WS, "Category", "apparel"));
        const ok = yield* log.commit({
          actor: { principal: system, surface: "system" },
          changes: [
            {
              target: uri,
              base_revision: null,
              ops: [{ op: "create", kind: "Category", slug: "apparel", body: cat }],
            },
          ],
        });
        expect(ok.status).toBe("committed");
        const bad = yield* refusal(
          log.commit({
            actor: { principal: system, surface: "system" },
            changes: [
              {
                target: nodeUri("northwind", "Category", nodeId(WS, "Category", "tech")),
                base_revision: null,
                ops: [
                  {
                    op: "create",
                    kind: "Category",
                    slug: "tech",
                    body: {
                      ...cat,
                      metadata: { slug: "tech", title: "Tech" },
                      spec: { ...cat.spec, colour: "red" },
                    },
                  },
                ],
              },
            ],
          }),
        );
        expect(bad?.code).toBe("VALIDATION_FAILED");
        expect(bad?.path).toContain("colour");
        // a Promotion's status is managed: the node path refuses it, only promotions.transition may change it
        const promo = {
          apiVersion: "plinth/v1",
          kind: "Promotion",
          metadata: { slug: "gold-double", title: "Gold double" },
          spec: {
            status: "draft",
            description: "2x",
            eligibility: { tiers: ["gold"], channels: ["recognition"] },
            effects: [{ type: "points_multiplier", factor: 2 }],
            budget: {},
            schedule: { starts_at: "2026-11-01T00:00:00Z", ends_at: "2026-12-01T00:00:00Z" },
            priority: 500,
            stacking: "exclusive",
            owner: "user:marketing-lead",
          },
        };
        const puri = nodeUri("northwind", "Promotion", nodeId(WS, "Promotion", "gold-double"));
        yield* log.commit({
          actor: { principal: system, surface: "system" },
          changes: [
            {
              target: puri,
              base_revision: null,
              ops: [{ op: "create", kind: "Promotion", slug: "gold-double", body: promo }],
            },
          ],
        });
        const refused = yield* refusal(
          log.commit({
            actor: { principal: maya, surface: "api" },
            changes: [
              { target: puri, base_revision: 1, ops: [{ op: "set", path: "/spec/status", value: "active" }] },
            ],
          }),
        );
        expect(refused?.code).toBe("RULE_REFUSED");
        expect(refused?.details?.["reason"]).toBe("managed_field");
        // with the action's context it is classified: activating a draft is held for approval (R-PROMO-ACTIVATE)
        const held = yield* log.commit({
          actor: { principal: maya, surface: "api" },
          changes: [
            { target: puri, base_revision: 1, ops: [{ op: "set", path: "/spec/status", value: "active" }] },
          ],
          managed: { by: "promotions.transition" },
        });
        expect(held.status).toBe("pending_approval");
        // Priya (promotions:approve) approves; the requester's own role would not do
        const priya = yield* (yield* Identity).bySubject("user:finance-analyst");
        const done = yield* log.decideApproval(priya, held.approval_id ?? "", "approve");
        expect(done.status).toBe("approved");
        const after = yield* log.findBySlug(maya, "Promotion", "gold-double");
        expect((after?.body as any).spec.status).toBe("active");
        // creating a Promotion that is not a draft is refused; an unknown category reference is UNKNOWN_REFERENCE
        const prodBody = {
          apiVersion: "plinth/v1",
          kind: "Product",
          metadata: { slug: "tee", title: "Tee" },
          spec: {
            category: "category:nope",
            summary: "s",
            description: "d",
            price_points: 100,
            artwork: { icon: "shirt", hue: 1, pattern: "dots" },
            tags: [],
            status: "draft",
            featured: false,
            fulfilment: "ship",
            low_stock_threshold: 3,
          },
        };
        const ref = yield* refusal(
          log.commit({
            actor: { principal: system, surface: "system" },
            changes: [
              {
                target: nodeUri("northwind", "Product", nodeId(WS, "Product", "tee")),
                base_revision: null,
                ops: [{ op: "create", kind: "Product", slug: "tee", body: prodBody }],
              },
            ],
          }),
        );
        expect(ref?.code).toBe("UNKNOWN_REFERENCE");
        // a valid Product creates its inventory row in the same transaction
        yield* log.commit({
          actor: { principal: system, surface: "system" },
          changes: [
            {
              target: nodeUri("northwind", "Product", nodeId(WS, "Product", "tee")),
              base_revision: null,
              ops: [
                {
                  op: "create",
                  kind: "Product",
                  slug: "tee",
                  body: { ...prodBody, spec: { ...prodBody.spec, category: "category:apparel" } },
                },
              ],
            },
          ],
        });
        const { sql } = yield* ControlStore;
        const inv = yield* store(
          sql<{ on_hand: number }>`SELECT on_hand FROM product_inventory WHERE product_slug = 'tee'`,
        );
        expect(inv[0]?.on_hand).toBe(0);
      }).pipe(Effect.provide(StoreLive)),
  );
});
