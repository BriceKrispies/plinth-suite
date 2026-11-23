import { describe, expect, it } from "vitest";
import { evaluatePromotions, promotionQualifies } from "@plinth/core";
import type { MemberFacts, PromoCandidate, PromoContext, PromotionSpec } from "@plinth/spec";
import { catalogHandlersForTest } from "./suite-2-helpers";
import { cronMatches, firesBetween, nextFires, parseCron } from "../src/suite/marketing/cron";
import { diffBlocks, diffFields, displayStatus } from "../src/suite/marketing/content-core";
import { substitute } from "../src/suite/marketing/automation-core";

// Pure parts of the marketing and content modules: promotion evaluation (CONTRACT 8.3), cron, templates, block diff.

const NOW = "2026-11-21T10:00:00Z"; // a Saturday

const facts = (over: Partial<MemberFacts> = {}): MemberFacts => ({
  handle: "ana-silva",
  region: "EMEA",
  tier: "gold",
  balance: 5000,
  lifetime_points: 30000,
  points_earned_30d: 1000,
  points_redeemed_30d: 0,
  orders_90d: 2,
  badges_count: 1,
  badges: ["first-redemption"],
  groups: ["emea-ops"],
  roles: ["member"],
  department: "fulfilment",
  joined_days: 400,
  last_active_days: 1,
  status: "active",
  ...over,
});

const spec = (over: Partial<PromotionSpec>): PromotionSpec => ({
  status: "active",
  description: "test",
  eligibility: {},
  effects: [{ type: "bonus_points", points: 100, on: "earn" }],
  budget: {},
  schedule: { starts_at: "2026-11-01T00:00:00Z", ends_at: "2026-12-01T00:00:00Z" },
  priority: 100,
  stacking: "stack",
  owner: "user:marketing-lead",
  ...over,
});

const cand = (slug: string, s: PromotionSpec, over: Partial<PromoCandidate> = {}): PromoCandidate => ({
  slug,
  revision: 1,
  spec: s,
  usage: { cost_points: 0, redemptions: 0, member_redemptions: 0 },
  member_in_segments: {},
  member_in_groups: {},
  entitled: false,
  free_items: {},
  ...over,
});

const earn: PromoContext = { kind: "earn", channel: "recognition", base_points: 1000, earn_type: "award" };
const cart: PromoContext = {
  kind: "purchase",
  channel: "store",
  lines: [
    { product: "fleece", category: "apparel", qty: 2, unit_points: 1000 },
    { product: "laptop", category: "tech", qty: 1, unit_points: 3000 },
  ],
};

const run = (
  candidates: PromoCandidate[],
  context: PromoContext,
  mode: "live" | "simulate" = "live",
  m = facts(),
) => evaluatePromotions({ now: NOW, mode, member: m, context, candidates });

describe("evaluatePromotions (CONTRACT 8.3)", () => {
  it("is deterministic: same input, same output", () => {
    const cs = [cand("a", spec({ effects: [{ type: "points_multiplier", factor: 2 }] }))];
    expect(run(cs, earn)).toEqual(run(cs, earn));
  });

  it("an exclusive first candidate applies alone; the rest are rejected for stacking", () => {
    const ev = run(
      [
        cand(
          "big",
          spec({ stacking: "exclusive", priority: 500, effects: [{ type: "points_multiplier", factor: 2 }] }),
        ),
        cand("small", spec({ priority: 100 })),
      ],
      earn,
    );
    expect(ev.applied.map((a) => a.slug)).toEqual(["big"]);
    expect(ev.rejected).toContainEqual(expect.objectContaining({ slug: "small", reason: "stacking" }));
    expect(ev.totals).toMatchObject({
      kind: "earn",
      base_points: 1000,
      bonus_points: 1000,
      final_points: 2000,
    });
    expect(ev.cost_points).toBe(1000);
    expect(ev.delta_points).toBe(1000);
  });

  it("orders by priority then slug; of a stack group only the first is kept", () => {
    const ev = run(
      [
        cand("b-promo", spec({ stack_group: "seasonal", priority: 10 })),
        cand("a-promo", spec({ stack_group: "seasonal", priority: 10 })),
        cand("c-promo", spec({ priority: 5, effects: [{ type: "bonus_points", points: 7, on: "earn" }] })),
      ],
      earn,
    );
    expect(ev.applied.map((a) => a.slug)).toEqual(["a-promo", "c-promo"]);
    expect(ev.rejected).toContainEqual(expect.objectContaining({ slug: "b-promo", reason: "stacking" }));
    expect(ev.totals).toMatchObject({ bonus_points: 107 });
  });

  it("the largest multiplier applies once, with the factor floored: bonus = floor(base * (factor - 1))", () => {
    const ev = run(
      [
        cand("x15", spec({ effects: [{ type: "points_multiplier", factor: 1.5 }], priority: 2 })),
        cand("x2", spec({ effects: [{ type: "points_multiplier", factor: 2 }], priority: 1 })),
      ],
      { ...earn, base_points: 333 },
    );
    expect(ev.applied.map((a) => a.slug)).toEqual(["x2"]);
    expect(ev.totals).toMatchObject({ bonus_points: 333 });
    const f = run([cand("x15", spec({ effects: [{ type: "points_multiplier", factor: 1.5 }] }))], {
      ...earn,
      base_points: 333,
    });
    expect(f.totals).toMatchObject({ bonus_points: 166, final_points: 499 });
  });

  it("store discounts: per line maximum percent, floored, capped per effect in line order", () => {
    const ev = run(
      [
        cand(
          "apparel-15",
          spec({ effects: [{ type: "store_discount", percent: 15, categories: ["category:apparel"] }] }),
        ),
        cand(
          "tech-20",
          spec({
            effects: [
              {
                type: "store_discount",
                percent: 20,
                categories: ["category:tech"],
                max_discount_points: 500,
              },
            ],
          }),
        ),
      ],
      cart,
    );
    // apparel: floor(2 * 1000 * 15 / 100) = 300; tech: floor(3000 * 20 / 100) = 600 capped at 500
    expect(ev.totals).toMatchObject({
      kind: "purchase",
      subtotal_points: 5000,
      discount_points: 800,
      total_points: 4200,
    });
    expect(ev.cost_points).toBe(800);
    expect(ev.delta_points).toBe(-800);
  });

  it("a free item needs the cart minimum and stock; its cost and benefit are the product's price", () => {
    const free = cand(
      "free-tote",
      spec({ effects: [{ type: "free_item", product: "product:canvas-tote", min_cart_points: 4000 }] }),
      { free_items: { "product:canvas-tote": { unit_points: 800, in_stock: true } } },
    );
    const ok = run([free], cart);
    expect(ok.totals).toMatchObject({ free_items: [{ product: "canvas-tote", unit_points: 800 }] });
    expect(ok.cost_points).toBe(800);
    const none = run(
      [{ ...free, free_items: { "product:canvas-tote": { unit_points: 800, in_stock: false } } }],
      cart,
    );
    expect(none.applied).toEqual([]);
  });

  it("each rejection names the first failing check", () => {
    const cases: Array<[string, PromotionSpec, Partial<PromoCandidate>, string]> = [
      ["paused", spec({ status: "paused" }), {}, "status"],
      [
        "early",
        spec({ schedule: { starts_at: "2026-11-22T00:00:00Z", ends_at: "2026-12-01T00:00:00Z" } }),
        {},
        "window",
      ],
      [
        "weekday",
        spec({
          schedule: {
            starts_at: "2026-11-01T00:00:00Z",
            ends_at: "2026-12-01T00:00:00Z",
            days_of_week: [1, 2],
          },
        }),
        {},
        "window",
      ],
      ["channel", spec({ eligibility: { channels: ["store"] } }), {}, "channel"],
      ["tier", spec({ eligibility: { tiers: ["platinum"] } }), {}, "tier"],
      ["region", spec({ eligibility: { regions: ["NA"] } }), {}, "region"],
      ["segment", spec({ eligibility: { segments: ["segment:new-joiners"] } }), {}, "segment"],
      ["group", spec({ eligibility: { groups: ["group:na-ops"] } }), {}, "group"],
      ["new", spec({ eligibility: { new_members_days: 30 } }), {}, "new_member"],
      ["entitlement", spec({ eligibility: { entitlement_only: true } }), {}, "entitlement"],
      [
        "per-member",
        spec({ budget: { max_per_member: 1 } }),
        { usage: { cost_points: 0, redemptions: 1, member_redemptions: 1 } },
        "per_member",
      ],
      [
        "budget",
        spec({ budget: { max_redemptions: 5 } }),
        { usage: { cost_points: 0, redemptions: 5, member_redemptions: 0 } },
        "budget",
      ],
    ];
    for (const [slug, s, over, reason] of cases) {
      const ev = run([cand(slug, s, over)], earn);
      expect(ev.rejected, slug).toEqual([expect.objectContaining({ slug, reason })]);
    }
    const min = run(
      [
        cand(
          "min",
          spec({
            eligibility: { min_cart_points: 9000 },
            effects: [{ type: "bonus_points", points: 5, on: "purchase" }],
          }),
        ),
      ],
      cart,
    );
    expect(min.rejected).toEqual([expect.objectContaining({ slug: "min", reason: "min_cart" })]);
    const scope = run(
      [
        cand(
          "scope",
          spec({
            eligibility: { categories: ["category:giving"] },
            effects: [{ type: "bonus_points", points: 5, on: "purchase" }],
          }),
        ),
      ],
      cart,
    );
    expect(scope.rejected).toEqual([expect.objectContaining({ slug: "scope", reason: "scope" })]);
    const ctxFail = run([cand("ctx", spec({ effects: [{ type: "store_discount", percent: 10 }] }))], earn);
    expect(ctxFail.rejected).toEqual([expect.objectContaining({ slug: "ctx", reason: "context" })]);
  });

  it("a promotion whose cost would pass the points budget is dropped and the rest are recomputed", () => {
    const ev = run(
      [
        cand(
          "capped",
          spec({
            priority: 9,
            budget: { max_cost_points: 500 },
            effects: [{ type: "points_multiplier", factor: 2 }],
          }),
        ),
        cand("fallback", spec({ priority: 1, effects: [{ type: "bonus_points", points: 50, on: "earn" }] })),
      ],
      earn,
    );
    expect(ev.applied.map((a) => a.slug)).toEqual(["fallback"]);
    expect(ev.rejected).toContainEqual(expect.objectContaining({ slug: "capped", reason: "budget" }));
  });

  it("simulate mode evaluates a draft and reports its status as an advisory; ended is still rejected", () => {
    const draft = run([cand("d", spec({ status: "draft" }))], earn, "simulate");
    expect(draft.applied).toHaveLength(1);
    expect(draft.advisories).toEqual([expect.objectContaining({ slug: "d", reason: "status" })]);
    expect(run([cand("e", spec({ status: "ended" }))], earn, "simulate").rejected).toHaveLength(1);
  });

  it("promotionQualifies ignores the cart and the channel", () => {
    const c = cand(
      "q",
      spec({ eligibility: { tiers: ["gold"], channels: ["store"], min_cart_points: 9999 } }),
    );
    expect(promotionQualifies(c, facts(), new Date(NOW))).toBe(true);
    expect(promotionQualifies(c, facts({ tier: "bronze" }), new Date(NOW))).toBe(false);
  });
});

describe("cron over virtual UTC", () => {
  it("parses five fields with lists, ranges and steps, and rejects the rest", () => {
    expect(parseCron("*/15 9-17 * * 1-5")).toBeDefined();
    expect(parseCron("0 9 * *")).toBeUndefined();
    expect(parseCron("61 9 * * *")).toBeUndefined();
    expect(parseCron("a b c d e")).toBeUndefined();
  });

  it("day of week is ISO: Monday is 1, Sunday is 7 (and 0)", () => {
    const monday = parseCron("0 9 * * 1")!;
    expect(cronMatches(monday, new Date("2026-11-16T09:00:00Z"))).toBe(true);
    expect(cronMatches(monday, new Date("2026-11-15T09:00:00Z"))).toBe(false);
    const sunday0 = parseCron("0 9 * * 0")!;
    expect(cronMatches(sunday0, new Date("2026-11-15T09:00:00Z"))).toBe(true);
  });

  it("lists the next fire times in order", () => {
    const c = parseCron("0 9 * * 1")!;
    expect(nextFires(c, new Date("2026-11-20T14:30:00Z"), 3).map((d) => d.toISOString())).toEqual([
      "2026-11-23T09:00:00.000Z",
      "2026-11-30T09:00:00.000Z",
      "2026-12-07T09:00:00.000Z",
    ]);
    expect(
      firesBetween(c, new Date("2026-11-01T00:00:00Z"), new Date("2026-11-30T09:00:00Z")).map((d) =>
        d.toISOString(),
      ),
    ).toEqual([
      "2026-11-02T09:00:00.000Z",
      "2026-11-09T09:00:00.000Z",
      "2026-11-16T09:00:00.000Z",
      "2026-11-23T09:00:00.000Z",
      "2026-11-30T09:00:00.000Z",
    ]);
  });
});

describe("templates", () => {
  it("substitute {{path}} as plain text over the run context; unknown paths are empty", () => {
    const ctx = {
      event: { order_no: "R-000007", n: 3, tags: ["a", "b"] },
      member: { handle: "ana-silva" },
      now: "t",
    };
    expect(
      substitute("Order {{event.order_no}} for {{ member.handle }} ({{event.n}}; {{event.tags}})", ctx),
    ).toBe("Order R-000007 for ana-silva (3; a, b)");
    expect(substitute("{{event.missing}}|{{nope.x}}", ctx)).toBe("|");
    // never evaluated: markup in data stays text
    expect(substitute("{{event.x}}", { event: { x: "<b>{{member.handle}}</b>" } })).toBe(
      "<b>{{member.handle}}</b>",
    );
  });
});

describe("content diff and display status", () => {
  const p = (text: string) => ({ type: "paragraph" as const, text });
  it("matches identical blocks, pairs edits by type, detects moves, additions and removals", () => {
    const a = [p("one"), p("two"), p("three")];
    const b = [p("three"), p("one"), p("TWO edited"), { type: "divider" as const }];
    const d = diffBlocks(a, b);
    const by = (i: number) => d.find((x) => x.index === i)!;
    expect(by(0)).toMatchObject({ change: "unchanged", from_index: 2 });
    expect(by(1)).toMatchObject({ change: "moved", from_index: 0 });
    expect(by(2).change).toBe("modified");
    expect(by(3).change).toBe("added");
    expect(diffBlocks([p("x")], [])).toEqual([
      { index: 0, change: "removed", before: p("x"), after: null, from_index: 0 },
    ]);
  });

  it("derives scheduled and revising from the status and dates", () => {
    const base = {
      type: "page",
      status: "approved",
      summary: "s",
      hero: { icon: "megaphone", hue: 1, pattern: "dots" },
      blocks: [p("x")],
      tags: [],
      audience: { everyone: true },
      author: "user:content-editor",
      reviewers: [],
      schedule: { publish_at: "2026-11-21T09:00:00Z" },
      pinned: false,
      allow_reactions: true,
      published_revision: null,
      review_log: [],
    } as never;
    expect(displayStatus(base, new Date("2026-11-20T14:30:00Z"))).toBe("scheduled");
    expect(displayStatus({ ...(base as object), schedule: {} } as never, new Date())).toBe("approved");
    expect(
      displayStatus({ ...(base as object), status: "draft", published_revision: 3 } as never, new Date()),
    ).toBe("revising");
    expect(diffFields(base, { ...(base as object), pinned: true } as never)).toEqual([
      { path: "/spec/pinned", before: false, after: true },
    ]);
  });

  it("the builder catalogue lists every triggerable event with its payload fields", () => {
    const c = catalogHandlersForTest();
    expect(c.events.map((e) => e.type)).toContain("order.placed");
    const placed = c.events.find((e) => e.type === "order.placed")!;
    expect(placed.fields.map((f) => f.path)).toContain("event.categories");
    expect(c.step_types.map((s) => s.type).sort()).toEqual(
      ["apply_promotion", "award_points", "create_task", "notify", "send_message", "webhook"].sort(),
    );
    expect(c.member_facts.length).toBe(14);
  });
});
