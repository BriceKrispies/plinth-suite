import { Effect, Either } from "effect";
import {
  ControlStore,
  addMonths,
  inTx,
  invoke,
  postAward,
  postExpiry,
  store,
  type Principal,
  type SuiteEnv,
} from "@plinth/engine";
import type { SeedCtx, SeedError } from "../seed";
import { SEED_MEMBERS, type SeedMember } from "../people";
import type { Xoshiro } from "../../rng";
import { PRODUCTS, finalStock, slugOf } from "./catalogue";

/**
 * The engagement part of seed step `activity` (CONTRACT.md 11.8): about 600 award transactions, 150 store orders across every
 * status (8 high-value, 2 awaiting approval now), 80 transfers, expiry postings in three monthly waves, 40 reviews and the
 * manual badges. Everything runs THROUGH THE ACTION HANDLERS at each command's own virtual timestamp (`ctx.act`), and the
 * engines drain after each command, so badges, notifications and ledger history are consistent by construction.
 *
 * Commands are intents on a time-ordered queue. An intent decides its details when it runs (from the live balances and
 * stock) and may queue follow-ups (an order's approval, fulfilment, delivery, review), so the status mix emerges from the
 * timeline: an order placed yesterday is still being prepared today.
 */

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const HISTORY_DAYS = 90;
const HIGH_VALUE_MIN = 18_000;

const AWARD_REASONS = [
  "Stayed late to clear the dock before the storm",
  "Zero picking errors this month",
  "Helped a new starter find their feet",
  "Great teamwork on the peak-season rollout",
  "Fixed the conveyor jam in record time",
  "Kept a customer order on track against the odds",
  "Ran the safety walk with real care",
  "Covered a shift at short notice",
  "Sharpest cycle-count accuracy on the site",
  "Brought the night shift together",
  "Suggested a layout change that saved hours",
  "Handled a hard delivery day with a smile",
  "Mentored two apprentices through onboarding",
  "Spotted a safety issue before it became one",
  "Led the toolbox talk on manual handling",
  "Cleared the returns backlog",
  "Went the extra mile for a key account",
  "Trained the team on the new scanners",
  "Made the visitor day run smoothly",
  "Five years of reliable service",
  "Kept the cold chain intact through the outage",
  "Turned a tough audit into a clean one",
];

const TRANSFER_MEMOS = [
  "Thanks for covering my shift",
  "Coffee on me",
  "For the lift to the depot",
  "Birthday gift pot",
  "Thanks for the training tips",
  "Team lunch contribution",
  "Splitting the charity pledge",
  "You saved my Monday",
  "Cheers for the help with the audit",
  "Pooling points for the cabin",
  "A thank-you from the night crew",
  "Welcome to the team",
];

const REVIEW_BY_RATING: Record<number, ReadonlyArray<readonly [string, string]>> = {
  5: [
    ["Better than expected", "Arrived quickly and feels well made. Would happily spend points on it again."],
    ["Love it", "Exactly what I hoped for. The whole crew is jealous."],
    ["Great reward", "Good quality and a nice treat after a long peak season."],
  ],
  4: [
    ["Very good", "Solid quality for the points. Packaging could be lighter."],
    ["Happy with it", "Does the job well. Took a few days longer than I expected."],
  ],
  3: [
    ["It is fine", "Decent, though I expected a little more for the price in points."],
    ["Okay", "Works as described. Nothing special."],
  ],
  2: [["Underwhelming", "The finish was not what the photo suggested."]],
  1: [["Not for me", "Did not fit my needs and I could not return it."]],
};

const COUNTRY: Record<string, string> = { NA: "US", EMEA: "GB", APAC: "SG", LATAM: "BR", ANZ: "AU" };
const CITY: Record<string, string> = {
  NA: "Columbus",
  EMEA: "Rotterdam",
  APAC: "Singapore",
  LATAM: "Sao Paulo",
  ANZ: "Auckland",
};

const TIER_RANK: Record<string, number> = { bronze: 0, silver: 1, gold: 2, platinum: 3 };

const CATALOGUE = PRODUCTS.map((p, i) => ({
  ...p,
  slug: slugOf(p.title),
  fulfilment: p.fulfilment ?? (p.category === "giving" ? "donation" : "ship"),
  index: i,
}));

interface Intent {
  readonly at: number;
  readonly seq: number;
  readonly run: () => Effect.Effect<void, SeedError, SuiteEnv>;
}

export const activityEngagement = (ctx: SeedCtx): Effect.Effect<void, SeedError, SuiteEnv> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rng: Xoshiro = ctx.rng("activity-engagement");
    const S = ctx.demoNow.getTime() - HISTORY_DAYS * DAY;
    const E = ctx.demoNow.getTime() - 20 * MIN;

    // ---- principals ----
    const principals = new Map<string, Principal>();
    for (const m of SEED_MEMBERS) principals.set(m.handle, yield* ctx.principal(m.subject));
    const maya = principals.get("maya-ortiz") as Principal;
    const jonas = principals.get("jonas-becker") as Principal;
    const priya = principals.get("priya-nair") as Principal;
    const samir = principals.get("samir-haddad") as Principal;

    // ---- the queue ----
    const queue: Intent[] = [];
    let seq = 0;
    const push = (at: number, run: Intent["run"]) => {
      if (at >= E) return;
      const it: Intent = { at, seq: seq++, run };
      let lo = 0;
      let hi = queue.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const q = queue[mid] as Intent;
        if (q.at < it.at || (q.at === it.at && q.seq < it.seq)) lo = mid + 1;
        else hi = mid;
      }
      queue.splice(lo, 0, it);
    };

    /** Run an action at `at`, drain the engines, and swallow a refusal (a command that the live state does not allow). */
    const attempt = (as: Principal, action: string, input: Record<string, unknown>, at: number) =>
      Effect.gen(function* () {
        const r = yield* Effect.either(ctx.act(as, action, input, { at: new Date(at) }));
        if (Either.isLeft(r)) return undefined;
        yield* ctx.drain(new Date(at));
        return r.right;
      });

    const businessTime = (): number => {
      const day = rng.int(HISTORY_DAYS);
      const hour = rng.weighted<number>([
        [7, 2],
        [8, 4],
        [9, 6],
        [10, 7],
        [11, 7],
        [12, 4],
        [13, 6],
        [14, 7],
        [15, 7],
        [16, 6],
        [17, 4],
        [18, 2],
        [20, 1],
        [22, 1],
      ]);
      return S + day * DAY + hour * HOUR + rng.int(60) * MIN + rng.int(60) * 1000;
    };

    const accounts = () =>
      Effect.gen(function* () {
        const rows = yield* store(
          sql<{ code: string; balance: string; tier: string }>`
            SELECT code, balance::text AS balance, tier FROM ledger_accounts
            WHERE workspace_id = ${ctx.workspaceId} AND kind = 'member'`,
        );
        return new Map(
          rows.map(
            (r) => [r.code.replace(/^member:/, ""), { balance: Number(r.balance), tier: r.tier }] as const,
          ),
        );
      });
    const stockMap = () =>
      Effect.gen(function* () {
        const rows = yield* store(
          sql<{ product_slug: string; on_hand: number }>`
            SELECT product_slug, on_hand FROM product_inventory WHERE workspace_id = ${ctx.workspaceId}`,
        );
        return new Map(rows.map((r) => [r.product_slug, r.on_hand] as const));
      });

    // ---- 1. expiry history: three waves of older awards that fall due inside the window ----
    const waves = [80, 50, 20];
    for (const [w, daysAgo] of waves.entries()) {
      const due = ctx.demoNow.getTime() - daysAgo * DAY;
      const earned = addMonths(new Date(due), -12);
      const pool = [...SEED_MEMBERS];
      const n = 10 + rng.int(5);
      for (let i = 0; i < n && pool.length > 0; i++) {
        const m = pool.splice(rng.int(pool.length), 1)[0] as SeedMember;
        const base = 40 + rng.int(8) * 30;
        yield* inTx(
          postAward(ctx.emitCtx(earned), {
            handle: m.handle,
            base,
            memo: "Long-service recognition",
            key: `seed:legacy:${w}:${m.handle}`,
            ref: { kind: "seed", id: `legacy-${w}` },
          }),
        );
      }
      push(due + HOUR, () =>
        Effect.gen(function* () {
          const at = new Date(due + HOUR);
          const lots = yield* store(
            sql<{ lot_id: string; code: string; remaining: string }>`
              SELECT l.lot_id, a.code, l.remaining::text AS remaining FROM point_lots l
              JOIN ledger_accounts a ON a.account_id = l.account_id
              WHERE l.workspace_id = ${ctx.workspaceId} AND l.remaining > 0 AND a.kind = 'member'
                AND l.expires_at <= ${at.toISOString()}::timestamptz ORDER BY l.expires_at, l.lot_id`,
          );
          for (const l of lots)
            yield* inTx(
              postExpiry(ctx.emitCtx(at), {
                handle: l.code.replace(/^member:/, ""),
                lotId: l.lot_id,
                remaining: Number(l.remaining),
                memo: "Points expired",
              }),
            );
          yield* ctx.drain(at);
        }),
      );
    }

    // ---- 2. manager awards (about 600 transactions) ----
    const awardCategories = [
      ["recognition", 50],
      ["performance", 20],
      ["service", 12],
      ["milestone", 10],
      ["other", 8],
    ] as const;
    for (let i = 0; i < 280; i++) {
      const at = businessTime();
      const emea = rng.float() < 0.22;
      const awarder = emea ? jonas : maya;
      const pool = SEED_MEMBERS.filter(
        (m) => m.handle !== (emea ? "jonas-becker" : "maya-ortiz") && (!emea || m.region === "EMEA"),
      );
      const count = rng.weighted<number>([
        [1, 40],
        [2, 35],
        [3, 25],
      ]);
      const to: string[] = [];
      const left = [...pool];
      while (to.length < Math.min(count, left.length))
        to.push((left.splice(rng.int(left.length), 1)[0] as SeedMember).handle);
      const points = rng.weighted<number>([
        [25, 6],
        [50, 14],
        [75, 8],
        [100, 18],
        [150, 12],
        [200, 12],
        [250, 8],
        [300, 6],
        [500, 8],
        [750, 3],
        [1000, 3],
        [2000, 2],
      ]);
      const category = rng.weighted<string>(awardCategories.map(([c, w]) => [c, w] as const));
      const reason = rng.pick(AWARD_REASONS);
      push(at, () =>
        attempt(
          awarder,
          "points.award",
          { to, points, category, reason, idempotency_key: `seed-award-${i}` },
          at,
        ).pipe(Effect.asVoid),
      );
    }

    // ---- 3. transfers (80) ----
    const generous = SEED_MEMBERS.filter((m) => !m.named).slice(0, 7);
    for (let i = 0; i < 80; i++) {
      const at = businessTime();
      const from = rng.float() < 0.55 ? rng.pick(generous) : rng.pick(SEED_MEMBERS);
      const to = rng.pick(SEED_MEMBERS.filter((m) => m.handle !== from.handle));
      const points = rng.weighted<number>([
        [50, 20],
        [75, 10],
        [100, 25],
        [150, 10],
        [200, 15],
        [300, 8],
        [500, 8],
        [750, 2],
      ]);
      const memo = rng.pick(TRANSFER_MEMOS);
      push(at, () =>
        Effect.gen(function* () {
          const acc = yield* accounts();
          if ((acc.get(from.handle)?.balance ?? 0) < points) return;
          yield* attempt(
            principals.get(from.handle) as Principal,
            "points.transfer",
            { to: to.handle, points, memo, idempotency_key: `seed-transfer-${i}` },
            at,
          );
        }),
      );
    }

    // ---- 4. orders (175 intents, about 150 land), reviews and the lifecycle ----
    let reviews = 0;
    const scheduleReview = (member: SeedMember, slugs: ReadonlyArray<string>, after: number, n: number) => {
      if (reviews >= 40 || slugs.length === 0 || rng.float() > 0.34) return;
      reviews += 1;
      const at = after + (1 + rng.int(4)) * DAY + rng.int(12) * HOUR;
      const rating = rng.weighted<number>([
        [5, 45],
        [4, 35],
        [3, 12],
        [2, 5],
        [1, 3],
      ]);
      const [title, body] = rng.pick(REVIEW_BY_RATING[rating] ?? REVIEW_BY_RATING[5] ?? []);
      const slug = rng.pick(slugs);
      push(at, () =>
        attempt(
          principals.get(member.handle) as Principal,
          "store.review_create",
          { slug, rating, title: title ?? "Good", body: body ?? "", idempotency_key: `seed-review-${n}` },
          at,
        ).pipe(Effect.asVoid),
      );
    };

    const placeOrder = (at: number, n: number, mode: "normal" | "highvalue" | "pending") =>
      Effect.gen(function* () {
        const acc = yield* accounts();
        const stock = yield* stockMap();
        const hv = mode !== "normal";
        const candidates = SEED_MEMBERS.map((m) => ({
          m,
          bal: acc.get(m.handle)?.balance ?? 0,
          tier: acc.get(m.handle)?.tier ?? "bronze",
        })).filter((c) => c.bal >= (hv ? HIGH_VALUE_MIN + 500 : 700));
        if (candidates.length === 0) return;
        const who = rng.weighted(candidates.map((c) => [c, hv ? c.bal : Math.sqrt(c.bal)] as const));
        const avail = CATALOGUE.filter(
          (p) =>
            (stock.get(p.slug) ?? 0) > 0 &&
            TIER_RANK[p.minTier ?? "bronze"]! <= (TIER_RANK[who.tier] ?? 0) &&
            p.price <= who.bal * 0.85,
        );
        const lines: Array<{ slug: string; qty: number; price: number; fulfilment: string }> = [];
        if (hv) {
          const big = avail.filter((p) => p.price >= HIGH_VALUE_MIN);
          if (big.length === 0) return;
          const p = rng.pick(big);
          lines.push({ slug: p.slug, qty: 1, price: p.price, fulfilment: p.fulfilment });
        } else {
          const want = rng.weighted<number>([
            [1, 55],
            [2, 30],
            [3, 15],
          ]);
          let total = 0;
          const cheap = avail.filter((p) => p.price < 9000);
          for (let tries = 0; tries < 12 && lines.length < want && cheap.length > 0; tries++) {
            const p = rng.weighted(cheap.map((x) => [x, 1 / Math.sqrt(x.price)] as const));
            if (lines.some((l) => l.slug === p.slug)) continue;
            const qty = Math.min(
              rng.weighted<number>([
                [1, 85],
                [2, 12],
                [3, 3],
              ]),
              stock.get(p.slug) ?? 1,
            );
            if (total + p.price * qty >= 14_000 || total + p.price * qty > who.bal * 0.85) continue;
            total += p.price * qty;
            lines.push({ slug: p.slug, qty, price: p.price, fulfilment: p.fulfilment });
          }
        }
        if (lines.length === 0) return;
        const member = who.m;
        const as = principals.get(member.handle) as Principal;
        yield* attempt(as, "cart.clear", {}, at);
        for (const l of lines)
          if (!(yield* attempt(as, "cart.set_item", { slug: l.slug, qty: l.qty }, at))) {
            yield* attempt(as, "cart.clear", {}, at);
            return;
          }
        const quote = (yield* attempt(as, "checkout.quote", {}, at)) as { quote_hash: string } | undefined;
        if (!quote) return;
        const method = lines.some((l) => l.fulfilment === "ship") ? "ship" : (lines[0]?.fulfilment ?? "ship");
        const delivery =
          method === "ship"
            ? {
                method,
                address: {
                  name: member.displayName,
                  line1: `${10 + rng.int(90)} Harbour Road`,
                  city: CITY[member.region] ?? "Columbus",
                  postal_code: `${1000 + rng.int(8999)}`,
                  country: COUNTRY[member.region] ?? "US",
                },
              }
            : method === "pickup"
              ? { method, pickup_site: `${CITY[member.region] ?? "Columbus"} depot` }
              : { method };
        const placed = (yield* attempt(
          as,
          "checkout.place",
          { quote_hash: quote.quote_hash, delivery, idempotency_key: `seed-order-${n}` },
          at,
        )) as { order_id: string; requires_approval: boolean } | undefined;
        if (!placed) {
          yield* attempt(as, "cart.clear", {}, at);
          return;
        }
        if (mode === "pending") return;

        // the lifecycle: queue the follow-ups that fall before now
        const orderId = placed.order_id;
        const slugs = lines.map((l) => l.slug);
        const staff = member.region === "EMEA" && rng.float() < 0.5 ? jonas : maya;
        const approver = member.handle === "priya-nair" ? maya : priya;
        const step = (t: number, who2: Principal, transition: string, note?: string) =>
          push(t, () =>
            attempt(
              who2,
              "orders.transition",
              {
                order_id: orderId,
                transition,
                ...(note ? { note } : {}),
                idempotency_key: `seed-order-${n}-${transition}`,
              },
              t,
            ).pipe(Effect.asVoid),
          );
        const cancel = !placed.requires_approval && rng.float() < 0.08;
        if (cancel) {
          step(at + (5 + rng.int(40)) * MIN, as, "cancel", "Ordered by mistake");
          return;
        }
        let t = at;
        if (placed.requires_approval) {
          t += (1 + rng.int(20)) * HOUR;
          step(t, approver, "approve");
        }
        const outcome = rng.weighted<string>([
          ["delivered", 70],
          ["shipped", 12],
          ["fulfilled", 6],
          ["approved", 7],
          ["refunded", 5],
        ]);
        if (outcome === "approved" && !placed.requires_approval) return;
        if (outcome === "approved") return;
        t += (2 + rng.int(28)) * HOUR;
        step(t, staff, "fulfil");
        if (outcome === "fulfilled") return;
        if (method === "ship") {
          t += (3 + rng.int(28)) * HOUR;
          step(t, staff, "ship");
          if (outcome === "shipped") return;
        }
        t += (1 + rng.int(5)) * DAY;
        step(t, staff, "deliver");
        if (outcome === "refunded") {
          t += (1 + rng.int(7)) * DAY;
          step(t, priya, "refund", "Item damaged in transit");
        } else scheduleReview(member, slugs, t, n);
      });

    for (let n = 0; n < 175; n++) {
      const at = businessTime();
      const mode = n < 6 ? "highvalue" : "normal";
      push(at, () => placeOrder(at, n, mode));
    }
    // two high-value orders that are still waiting for approval now
    push(ctx.demoNow.getTime() - 5 * HOUR, () =>
      placeOrder(ctx.demoNow.getTime() - 5 * HOUR, 900, "pending"),
    );
    push(ctx.demoNow.getTime() - 27 * HOUR, () =>
      placeOrder(ctx.demoNow.getTime() - 27 * HOUR, 901, "pending"),
    );

    // ---- 5. manual badges ----
    const manual: Array<[string, number]> = [
      ["peak-hero", 3],
      ["mentor", 4],
    ];
    for (const [slug, count] of manual) {
      const pool = SEED_MEMBERS.filter((m) => m.handle !== "maya-ortiz");
      for (let i = 0; i < count; i++) {
        const m = pool.splice(rng.int(pool.length), 1)[0] as SeedMember;
        const at = businessTime();
        push(at, () =>
          attempt(
            maya,
            "badges.award",
            {
              slug,
              member: m.handle,
              reason:
                slug === "peak-hero"
                  ? "Carried the dock through the peak-season surge"
                  : "Coached three new starters",
              idempotency_key: `seed-badge-${slug}-${i}`,
            },
            at,
          ).pipe(Effect.asVoid),
        );
      }
    }

    // ---- run the timeline ----
    yield* ctx.drain(new Date(S));
    while (queue.length > 0) {
      const it = queue.shift() as Intent;
      yield* it.run();
    }

    // ---- the stock count: every product lands on the contract's stock rule ----
    const countAt = ctx.demoNow.getTime() - 15 * MIN;
    const stock = yield* stockMap();
    for (const p of CATALOGUE) {
      const delta = finalStock(p, p.index) - (stock.get(p.slug) ?? 0);
      if (delta === 0) continue;
      yield* attempt(
        samir,
        "inventory.adjust",
        {
          slug: p.slug,
          delta,
          reason: "count_correction",
          note: "Quarterly stock count",
          idempotency_key: `seed-count-${p.slug}`,
        },
        countAt,
      );
    }

    // ---- one large award waiting for finance (above the manager limit) ----
    const heldAt = new Date(ctx.demoNow.getTime() - 3 * HOUR);
    const target = SEED_MEMBERS.find((m) => m.handle === "ana-silva") as SeedMember;
    yield* invoke({
      actor: { principal: maya, surface: "system" },
      name: "points.award",
      input: {
        to: [target.handle],
        points: 5000,
        category: "milestone",
        reason: "Ten years of service at the Columbus site",
        idempotency_key: "seed-award-held",
      },
      at: heldAt,
    }).pipe(Effect.either);
  });
