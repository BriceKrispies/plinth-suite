import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { workspaceId } from "@plinth/core";
import { DomainError } from "@plinth/spec";
import {
  ControlStore,
  Identity,
  StoreLive,
  invoke,
  resetAndSeed,
  store,
  trialBalance,
  type InvokeOutcome,
  type Principal,
} from "@plinth/engine";
import { runSuiteSeed } from "../src/suite";
import {
  groups,
  members,
  openingBalances,
  preferences,
  program,
  roles,
  servicePrincipals,
} from "../src/suite/steps/people";
import { catalogueStep } from "../src/suite/steps/catalogue";
import { badgesStep } from "../src/suite/steps/badges";
import { badgesOnEvents } from "../../worker/src/engines/badges";
import { expireDueLots, warnExpiring } from "../../worker/src/engines/expiry";
import { drainConsumer } from "../../worker/src/worker";

// Needs Postgres (plinth_test). The engagement modules: points, ledger, store, badges, and the badge and expiry engines.

const WS = workspaceId("northwind");
const DEMO = new Date("2026-11-20T14:30:00Z");
const at = (minutes: number) => new Date(DEMO.getTime() + minutes * 60_000);

const STEPS = [
  servicePrincipals,
  members,
  program,
  roles,
  preferences,
  groups,
  openingBalances,
  catalogueStep,
  badgesStep,
];

const setup = Effect.gen(function* () {
  yield* resetAndSeed;
  yield* runSuiteSeed({ steps: STEPS });
  const id = yield* Identity;
  const who = (s: string) => id.bySubject(s);
  return {
    maya: yield* who("user:ops-lead"),
    jonas: yield* who("user:emea-lead"),
    priya: yield* who("user:finance-analyst"),
    samir: yield* who("user:it-admin"),
    ana: yield* who("user:ana-silva"),
    ben: yield* who("user:ben-carter"),
    agent: yield* who("agent:claude-code"),
  };
});

const run = (as: Principal, name: string, input: Record<string, unknown> = {}, when = DEMO) =>
  invoke({ actor: { principal: as, surface: "api" }, name, input, at: when });

const data = (o: InvokeOutcome): any => {
  if (o.kind !== "result") throw new Error(`expected a result, got ${o.kind}`);
  return o.data;
};

const ok = (as: Principal, name: string, input: Record<string, unknown> = {}, when = DEMO) =>
  run(as, name, input, when).pipe(Effect.map(data));

const refusal = (eff: Effect.Effect<unknown, unknown, any>) =>
  eff.pipe(
    Effect.either,
    Effect.map((r) => (Either.isLeft(r) ? (r.left as DomainError) : undefined)),
  );

const reasonOf = (e: DomainError | undefined) => (e?.details as { reason?: string } | undefined)?.reason;

const balanceOf = (handle: string) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const r = yield* store(
      sql<{ b: string }>`SELECT balance::text AS b FROM ledger_accounts WHERE code = ${"member:" + handle}`,
    );
    return Number(r[0]?.b ?? 0);
  });

const stockOf = (slug: string) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const r = yield* store(
      sql<{ n: number }>`SELECT on_hand AS n FROM product_inventory WHERE product_slug = ${slug}`,
    );
    return r[0]?.n ?? 0;
  });

const count = (q: string) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const r = yield* store(sql.unsafe<{ n: string }>(`SELECT count(*)::text AS n FROM ${q}`));
    return Number(r[0]?.n ?? 0);
  });

const address = {
  name: "Ben Carter",
  line1: "1 Dock Road",
  city: "Columbus",
  postal_code: "43004",
  country: "US",
};

/** Put items in the cart, quote, and place an order. */
const buy = (
  as: Principal,
  items: ReadonlyArray<[string, number]>,
  delivery: Record<string, unknown>,
  key: string,
  when = DEMO,
) =>
  Effect.gen(function* () {
    yield* ok(as, "cart.clear", {}, when);
    for (const [slug, qty] of items) yield* ok(as, "cart.set_item", { slug, qty }, when);
    const quote = yield* ok(as, "checkout.quote", {}, when);
    return yield* ok(
      as,
      "checkout.place",
      { quote_hash: quote.quote_hash, delivery, idempotency_key: key },
      when,
    );
  });

describe("points (CONTRACT 7)", () => {
  it.effect("transfers move points within Program limits and replay by idempotency key", () =>
    Effect.gen(function* () {
      const { maya, ben } = yield* setup;
      const m0 = yield* balanceOf("maya-ortiz");
      const b0 = yield* balanceOf("ben-carter");
      const input = {
        to: "ben-carter",
        points: 120,
        memo: "Thanks for the help",
        idempotency_key: "tr-test-0001",
      };
      const first = yield* ok(maya, "points.transfer", input);
      expect(first.balance).toBe(m0 - 120);
      expect(yield* balanceOf("ben-carter")).toBe(b0 + 120);
      const again = yield* run(maya, "points.transfer", input);
      expect(again.kind === "result" && again.replayed).toBe(true);
      expect(yield* balanceOf("ben-carter")).toBe(b0 + 120);
      // the recipient is told
      const notes = yield* count(
        `notifications WHERE type = 'points_awarded' AND title LIKE '%sent you 120 points'`,
      );
      expect(notes).toBe(1);
      // limits and refusals
      expect(
        reasonOf(
          yield* refusal(
            run(maya, "points.transfer", { ...input, to: "maya-ortiz", idempotency_key: "tr-test-0002" }),
          ),
        ),
      ).toBe("SELF_ACTION");
      expect(
        reasonOf(
          yield* refusal(
            run(maya, "points.transfer", { ...input, points: 20, idempotency_key: "tr-test-0003" }),
          ),
        ),
      ).toBe("LIMIT_EXCEEDED");
      expect(
        reasonOf(
          yield* refusal(
            run(maya, "points.transfer", { ...input, points: 9000, idempotency_key: "tr-test-0004" }),
          ),
        ),
      ).toBe("LIMIT_EXCEEDED");
      const poor = yield* refusal(
        run(ben, "points.transfer", {
          to: "maya-ortiz",
          points: 4900,
          memo: "x",
          idempotency_key: "tr-test-0005",
        }),
      );
      expect(poor?.code).toBe("CONFLICT");
      expect((yield* trialBalance(WS)).ok).toBe(true);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("awards need points:award, respect the row predicate and are held above the manager limit", () =>
    Effect.gen(function* () {
      const { maya, jonas, ben, ana } = yield* setup;
      const b0 = yield* balanceOf("ben-carter");
      const res = yield* ok(maya, "points.award", {
        to: ["ben-carter"],
        points: 200,
        category: "recognition",
        reason: "Great teamwork",
        idempotency_key: "aw-test-0001",
      });
      expect(res.status).toBe("committed");
      expect(res.results[0]).toMatchObject({ member: "ben-carter", base_points: 200, bonus_points: 0 });
      expect(yield* balanceOf("ben-carter")).toBe(b0 + 200);
      expect(
        yield* count(`notifications WHERE type = 'points_awarded' AND title = 'You received 200 points'`),
      ).toBe(1);
      // a plain member cannot award; the awarder cannot be a recipient; a regional manager stays in region
      expect(
        (yield* refusal(
          run(ben, "points.award", {
            to: ["ana-silva"],
            points: 10,
            category: "other",
            reason: "x",
            idempotency_key: "aw-test-0002",
          }),
        ))?.code,
      ).toBe("FORBIDDEN");
      expect(
        reasonOf(
          yield* refusal(
            run(maya, "points.award", {
              to: ["maya-ortiz"],
              points: 10,
              category: "other",
              reason: "x",
              idempotency_key: "aw-test-0003",
            }),
          ),
        ),
      ).toBe("SELF_ACTION");
      const out = yield* refusal(
        run(jonas, "points.award", {
          to: ["ana-silva"],
          points: 10,
          category: "other",
          reason: "x",
          idempotency_key: "aw-test-0004",
        }),
      );
      expect(out?.code).toBe("FORBIDDEN");
      expect((out?.details as { reason?: string }).reason).toBe("row_predicate");
      void ana;
      // above manager_max_per_award the whole award is filed for points:adjust
      const held = yield* run(maya, "points.award", {
        to: ["ben-carter"],
        points: 5000,
        category: "milestone",
        reason: "Ten years",
        idempotency_key: "aw-test-0005",
      });
      expect(held.kind).toBe("pending_approval");
      expect(yield* balanceOf("ben-carter")).toBe(b0 + 200);
      expect(
        yield* count(
          `action_approvals WHERE status = 'pending_approval' AND approver_permission = 'points:adjust'`,
        ),
      ).toBe(1);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("adjustments, reversals, the statement and the trial balance agree", () =>
    Effect.gen(function* () {
      const { priya, ben, maya } = yield* setup;
      const b0 = yield* balanceOf("ben-carter");
      const adj = yield* ok(priya, "points.adjust", {
        member: "ben-carter",
        points: 300,
        reason: "Correction",
        idempotency_key: "adj-test-001",
      });
      expect(adj.balance).toBe(b0 + 300);
      expect(
        reasonOf(
          yield* refusal(
            run(priya, "points.adjust", {
              member: "ben-carter",
              points: -99999999,
              reason: "x",
              idempotency_key: "adj-test-002",
            }),
          ),
        ),
      ).toBe("INSUFFICIENT_POINTS");
      const rev = yield* ok(priya, "ledger.reverse", {
        txn_id: adj.txn_id,
        reason: "Entered twice",
        idempotency_key: "rev-test-001",
      });
      expect(rev.balance).toBe(b0);
      expect(
        reasonOf(
          yield* refusal(
            run(priya, "ledger.reverse", {
              txn_id: adj.txn_id,
              reason: "again",
              idempotency_key: "rev-test-002",
            }),
          ),
        ),
      ).toBe("INVALID_TRANSITION");
      // a member sees own statement lines with running balances; another member's needs points:view-all
      const st = yield* ok(ben, "points.statement", {});
      expect(st.items.length).toBeGreaterThan(2);
      expect(st.items[0].txn_type).toBe("reversal");
      expect(st.closing_balance).toBe(b0);
      expect((yield* refusal(run(ben, "points.statement", { member: "maya-ortiz" })))?.code).toBe(
        "FORBIDDEN",
      );
      const sm = yield* ok(maya, "points.summary", {});
      expect(sm.account).toBe("member:maya-ortiz");
      expect(sm.tier.tier).toBe("platinum");
      const detail = yield* ok(ben, "points.transaction", { txn_id: adj.txn_id });
      expect(detail.reversed_by).toBe(rev.txn_id);
      expect(detail.entries.length).toBe(2);
      const tb = yield* ok(priya, "ledger.trial_balance", {});
      expect(tb.ok).toBe(true);
      expect(tb.grand_total).toBe(0);
      expect(tb.member_total).toBe(tb.lots_total);
      const tiers = yield* ok(ben, "points.tiers", {});
      expect(tiers.tiers.map((t: { tier: string }) => t.tier)).toEqual([
        "bronze",
        "silver",
        "gold",
        "platinum",
      ]);
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("store (CONTRACT 7.4 to 7.6)", () => {
  it.effect("checkout debits points and stock atomically; a stale quote is PRICE_CHANGED", () =>
    Effect.gen(function* () {
      const { maya } = yield* setup;
      const b0 = yield* balanceOf("maya-ortiz");
      const s0 = yield* stockOf("logo-cap");
      yield* ok(maya, "cart.clear");
      yield* ok(maya, "cart.set_item", { slug: "logo-cap", qty: 2 });
      const quote = yield* ok(maya, "checkout.quote");
      expect(quote.total_points).toBe(1800);
      expect(quote.requires_approval).toBe(false);
      // the cart changes between quote and checkout
      yield* ok(maya, "cart.set_item", { slug: "logo-cap", qty: 3 });
      const stale = yield* refusal(
        run(maya, "checkout.place", {
          quote_hash: quote.quote_hash,
          delivery: { method: "ship", address },
          idempotency_key: "co-test-0001",
        }),
      );
      expect(reasonOf(stale)).toBe("PRICE_CHANGED");
      expect((stale?.details as { quote?: { total_points?: number } }).quote?.total_points).toBe(2700);
      expect(yield* balanceOf("maya-ortiz")).toBe(b0);
      const fresh = yield* ok(maya, "checkout.quote");
      const order = yield* ok(maya, "checkout.place", {
        quote_hash: fresh.quote_hash,
        delivery: { method: "ship", address },
        idempotency_key: "co-test-0002",
      });
      expect(order.status).toBe("approved");
      expect(order.total_points).toBe(2700);
      expect(order.events.map((e: { to: string }) => e.to)).toEqual(["placed", "approved"]);
      expect(yield* balanceOf("maya-ortiz")).toBe(b0 - 2700);
      expect(yield* stockOf("logo-cap")).toBe(s0 - 3);
      expect((yield* ok(maya, "cart.get")).item_count).toBe(0);
      expect(reasonOf(yield* refusal(run(maya, "checkout.quote")))).toBe("CART_EMPTY");
      expect((yield* trialBalance(WS)).ok).toBe(true);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect(
    "the order lifecycle: cancel refunds and restocks, deliver and refund follow the state machine",
    () =>
      Effect.gen(function* () {
        const { maya, priya } = yield* setup;
        const b0 = yield* balanceOf("maya-ortiz");
        const s0 = yield* stockOf("canvas-tote");
        const o1 = yield* buy(maya, [["canvas-tote", 2]], { method: "ship", address }, "lc-test-0001");
        expect(yield* stockOf("canvas-tote")).toBe(s0 - 2);
        expect(o1.allowed_transitions).toContain("cancel");
        const c = yield* ok(maya, "orders.transition", {
          order_id: o1.order_id,
          transition: "cancel",
          idempotency_key: "lc-test-0002",
        });
        expect(c.status).toBe("cancelled");
        expect(c.refund_txn_id).not.toBeNull();
        expect(yield* balanceOf("maya-ortiz")).toBe(b0);
        expect(yield* stockOf("canvas-tote")).toBe(s0);

        const o2 = yield* buy(maya, [["canvas-tote", 1]], { method: "ship", address }, "lc-test-0003");
        const bad = yield* refusal(
          run(maya, "orders.transition", {
            order_id: o2.order_id,
            transition: "deliver",
            idempotency_key: "lc-test-0004",
          }),
        );
        expect(reasonOf(bad)).toBe("INVALID_TRANSITION");
        expect((bad?.details as { allowed?: string[] }).allowed).toEqual(["fulfil", "cancel"]);
        yield* ok(
          maya,
          "orders.transition",
          { order_id: o2.order_id, transition: "fulfil", idempotency_key: "lc-test-0005" },
          at(5),
        );
        yield* ok(
          maya,
          "orders.transition",
          { order_id: o2.order_id, transition: "ship", idempotency_key: "lc-test-0006" },
          at(10),
        );
        const delivered = yield* ok(
          maya,
          "orders.transition",
          { order_id: o2.order_id, transition: "deliver", idempotency_key: "lc-test-0007" },
          at(15),
        );
        expect(delivered.status).toBe("delivered");
        // refunds need store:refund
        expect(
          (yield* refusal(
            run(
              maya,
              "orders.transition",
              { order_id: o2.order_id, transition: "refund", idempotency_key: "lc-test-0008" },
              at(20),
            ),
          ))?.code,
        ).toBe("FORBIDDEN");
        const refunded = yield* ok(
          priya,
          "orders.transition",
          { order_id: o2.order_id, transition: "refund", restock: true, idempotency_key: "lc-test-0009" },
          at(20),
        );
        expect(refunded.status).toBe("refunded");
        expect(yield* balanceOf("maya-ortiz")).toBe(b0);
        // the member's list and the timeline
        const list = yield* ok(maya, "orders.list", {});
        expect(list.status_counts.refunded).toBe(1);
        expect(list.status_counts.cancelled).toBe(1);
        expect(
          (yield* ok(maya, "orders.get", { order_id: o2.order_id })).events.map((e: { to: string }) => e.to),
        ).toEqual(["placed", "approved", "fulfilled", "shipped", "delivered", "refunded"]);
        expect((yield* trialBalance(WS)).ok).toBe(true);
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("a refund requested by the agent is held for approval, never run", () =>
    Effect.gen(function* () {
      const { maya, agent } = yield* setup;
      const o = yield* buy(maya, [["logo-cap", 1]], { method: "ship", address }, "ag-test-0001");
      yield* ok(
        maya,
        "orders.transition",
        { order_id: o.order_id, transition: "fulfil", idempotency_key: "ag-test-0002" },
        at(5),
      );
      yield* ok(
        maya,
        "orders.transition",
        { order_id: o.order_id, transition: "ship", idempotency_key: "ag-test-0003" },
        at(10),
      );
      const input = { order_id: o.order_id, transition: "refund", idempotency_key: "ag-test-0004" };
      const preview = yield* invoke({
        actor: { principal: agent, surface: "mcp" },
        name: "orders.transition",
        input,
        dryRun: true,
        at: at(15),
      });
      expect(preview.kind === "preview" && preview.preview.decision).toBe("approval");
      const token = preview.kind === "preview" ? preview.preview.preview_token : "";
      const filed = yield* invoke({
        actor: { principal: agent, surface: "mcp" },
        name: "orders.transition",
        input,
        previewToken: token,
        idempotencyKey: "ag-test-0004",
        at: at(15),
      });
      expect(filed.kind).toBe("pending_approval");
      expect((yield* ok(maya, "orders.get", { order_id: o.order_id })).status).toBe("shipped");
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("cart rules, wishlist, inventory and reviews", () =>
    Effect.gen(function* () {
      const { maya, ben, samir } = yield* setup;
      // tier gate and stock rules
      expect(
        (yield* refusal(run(ben, "cart.set_item", { slug: "noise-cancelling-headphones", qty: 1 })))?.code,
      ).toBe("RULE_REFUSED");
      expect(reasonOf(yield* refusal(run(maya, "cart.set_item", { slug: "logo-cap", qty: 10 })))).toBe(
        "LIMIT_EXCEEDED",
      );
      expect((yield* ok(maya, "wishlist.add", { slug: "yoga-mat" })).in_wishlist).toBe(true);
      expect(
        (yield* ok(maya, "wishlist.list")).items.map((i: { product: { slug: string } }) => i.product.slug),
      ).toEqual(["yoga-mat"]);
      expect((yield* ok(maya, "wishlist.remove", { slug: "yoga-mat" })).in_wishlist).toBe(false);
      // catalogue
      const cat = yield* ok(maya, "store.catalog", { category: "giving", sort: "price_asc" });
      expect(cat.items[0].slug).toBe("plant-10-trees");
      expect(cat.total).toBe(10);
      // the catalogue step stocks every product with a buffer; the stock count of the history lands this one on zero
      yield* ok(samir, "inventory.adjust", {
        slug: "fitness-band",
        delta: -(yield* stockOf("fitness-band")),
        reason: "count_correction",
        idempotency_key: "inv-test-zero",
      });
      const out = yield* ok(maya, "store.catalog", { in_stock: true });
      expect(out.items.every((i: { slug: string }) => i.slug !== "fitness-band")).toBe(true);
      const cats = yield* ok(ben, "store.categories");
      expect(cats.items.length).toBe(6);
      // inventory
      const before = yield* stockOf("yoga-mat");
      const adj = yield* ok(samir, "inventory.adjust", {
        slug: "yoga-mat",
        delta: 12,
        reason: "restock",
        idempotency_key: "inv-test-001",
      });
      expect(adj.on_hand).toBe(before + 12);
      expect(
        reasonOf(
          yield* refusal(
            run(samir, "inventory.adjust", {
              slug: "yoga-mat",
              delta: -100000,
              reason: "damage",
              idempotency_key: "inv-test-002",
            }),
          ),
        ),
      ).toBe("OUT_OF_STOCK");
      expect(
        (yield* refusal(
          run(ben, "inventory.adjust", {
            slug: "yoga-mat",
            delta: 1,
            reason: "restock",
            idempotency_key: "inv-test-003",
          }),
        ))?.code,
      ).toBe("FORBIDDEN");
      // reviews need a delivered order, once per product
      expect(
        reasonOf(
          yield* refusal(
            run(maya, "store.review_create", {
              slug: "water-bottle",
              rating: 5,
              title: "Great",
              body: "",
              idempotency_key: "rv-test-001",
            }),
          ),
        ),
      ).toBe("NOT_ELIGIBLE");
      const o = yield* buy(maya, [["water-bottle", 1]], { method: "ship", address }, "rv-test-002");
      for (const [i, t] of ["fulfil", "ship", "deliver"].entries())
        yield* ok(
          maya,
          "orders.transition",
          { order_id: o.order_id, transition: t, idempotency_key: `rv-test-1${i}` },
          at(5 * (i + 1)),
        );
      const rv = yield* ok(
        maya,
        "store.review_create",
        {
          slug: "water-bottle",
          rating: 4,
          title: "Solid",
          body: "Keeps coffee hot.",
          idempotency_key: "rv-test-003",
        },
        at(30),
      );
      expect(rv.status).toBe("published");
      expect(
        reasonOf(
          yield* refusal(
            run(
              maya,
              "store.review_create",
              { slug: "water-bottle", rating: 5, title: "Again", body: "", idempotency_key: "rv-test-004" },
              at(31),
            ),
          ),
        ),
      ).toBe("ALREADY_EXISTS");
      const detail = yield* ok(maya, "store.product", { slug: "water-bottle" }, at(32));
      expect(detail.rating_histogram).toEqual([0, 0, 0, 1, 0]);
      expect(detail.card.rating).toEqual({ average: 4, count: 1 });
      // a moderator hides it
      const hidden = yield* ok(
        samir,
        "store.review_moderate",
        { review_id: rv.review_id, status: "hidden", reason: "Off topic" },
        at(33),
      );
      expect(hidden.status).toBe("hidden");
      expect((yield* ok(ben, "store.reviews", { slug: "water-bottle" }, at(34))).items.length).toBe(0);
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("badges (CONTRACT 12.4)", () => {
  it.effect("manual awards post the reward once; revoking reverses it while the points are held", () =>
    Effect.gen(function* () {
      const { maya, ben } = yield* setup;
      const b0 = yield* balanceOf("ben-carter");
      const a = yield* ok(maya, "badges.award", {
        slug: "mentor",
        member: "ben-carter",
        reason: "Coached three starters",
        idempotency_key: "bg-test-0001",
      });
      expect(a.badge).toBe("mentor");
      expect(a.points_txn_id).not.toBeNull();
      expect(yield* balanceOf("ben-carter")).toBe(b0 + 500);
      expect(
        reasonOf(
          yield* refusal(
            run(maya, "badges.award", {
              slug: "mentor",
              member: "ben-carter",
              reason: "again",
              idempotency_key: "bg-test-0002",
            }),
          ),
        ),
      ).toBe("ALREADY_EXISTS");
      expect(
        reasonOf(
          yield* refusal(
            run(maya, "badges.award", {
              slug: "mentor",
              member: "maya-ortiz",
              reason: "me",
              idempotency_key: "bg-test-0003",
            }),
          ),
        ),
      ).toBe("SELF_ACTION");
      expect(
        (yield* refusal(
          run(ben, "badges.award", {
            slug: "mentor",
            member: "maya-ortiz",
            reason: "x",
            idempotency_key: "bg-test-0004",
          }),
        ))?.code,
      ).toBe("FORBIDDEN");
      expect(yield* count(`notifications WHERE type = 'badge_earned'`)).toBe(1);
      const cat = yield* ok(ben, "badges.catalog", {});
      expect(cat.earned).toBe(1);
      expect(cat.items.find((i: { slug: string }) => i.slug === "automation-pioneer").title).toBe(
        "Secret badge",
      );
      const revoked = yield* ok(maya, "badges.revoke", { award_id: a.award_id, reason: "Awarded in error" });
      expect(revoked.revoked_at).not.toBeNull();
      expect(yield* balanceOf("ben-carter")).toBe(b0);
      expect(
        reasonOf(yield* refusal(run(maya, "badges.revoke", { award_id: a.award_id, reason: "twice" }))),
      ).toBe("INVALID_TRANSITION");
      // a revoked badge can be awarded again
      yield* ok(maya, "badges.award", {
        slug: "mentor",
        member: "ben-carter",
        reason: "Second chance",
        idempotency_key: "bg-test-0005",
      });
      expect((yield* ok(ben, "badges.member", { handle: "ben-carter" })).awards.length).toBe(1);
      expect((yield* trialBalance(WS)).ok).toBe(true);
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("engines", () => {
  const wctx = (when: Date) => ({ workspaceId: WS, workspaceSlug: "northwind", now: when });

  it.effect("the badge engine awards threshold and event badges once, as service:badges", () =>
    Effect.gen(function* () {
      const { maya } = yield* setup;
      yield* drainConsumer("badges", badgesOnEvents, wctx(at(-60)));
      const silver = yield* count(`badge_awards WHERE badge_slug = 'silver-standard' AND revoked_at IS NULL`);
      expect(silver).toBeGreaterThan(10);
      expect(
        yield* count(
          `badge_awards a JOIN principals p ON p.principal_id = a.awarded_by WHERE p.subject <> 'service:badges'`,
        ),
      ).toBe(0);
      yield* buy(maya, [["logo-cap", 1]], { method: "ship", address }, "en-test-0001", at(0));
      yield* drainConsumer("badges", badgesOnEvents, wctx(at(1)));
      expect(yield* count(`badge_awards WHERE badge_slug = 'first-redemption'`)).toBe(1);
      // running again changes nothing
      const total = yield* count(`badge_awards`);
      yield* drainConsumer("badges", badgesOnEvents, wctx(at(2)));
      expect(yield* count(`badge_awards`)).toBe(total);
      expect(yield* count(`ledger_transactions WHERE txn_type = 'badge_reward'`)).toBe(total);
      expect((yield* trialBalance(WS)).ok).toBe(true);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("the expiry engine expires due lots once and warns before they expire", () =>
    Effect.gen(function* () {
      yield* setup;
      // the opening lots (90 days before the demo) expire 12 months after they were earned
      const due = new Date(DEMO.getTime() - 90 * 86_400_000);
      due.setUTCFullYear(due.getUTCFullYear() + 1);
      const warnDay = new Date(Math.floor((due.getTime() - 7 * 86_400_000) / 86_400_000) * 86_400_000);
      yield* warnExpiring(wctx(warnDay), warnDay);
      const warned = yield* count(`domain_events WHERE type = 'points.expiring'`);
      expect(warned).toBeGreaterThan(30);
      yield* warnExpiring(wctx(warnDay), warnDay);
      expect(yield* count(`domain_events WHERE type = 'points.expiring'`)).toBe(warned);
      expect(yield* count(`notifications WHERE type = 'points_expiring'`)).toBeGreaterThan(30);

      const expired = yield* expireDueLots(wctx(new Date(due.getTime() + 3_600_000)));
      expect(expired).toBeGreaterThan(30);
      expect(yield* count(`ledger_accounts WHERE kind = 'member' AND balance > 0`)).toBe(0);
      expect(yield* expireDueLots(wctx(new Date(due.getTime() + 7_200_000)))).toBe(0);
      expect((yield* trialBalance(WS)).ok).toBe(true);
    }).pipe(Effect.provide(StoreLive)),
  );
});
