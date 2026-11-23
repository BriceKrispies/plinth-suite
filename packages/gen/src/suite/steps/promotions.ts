import { Effect } from "effect";
import { nodeId, nodeUri } from "@plinth/core";
import type { PromotionSpec, PromotionStatus } from "@plinth/spec";
import { emitFrom, inTx, invoke } from "@plinth/engine";
import type { SeedStep } from "../seed";

/**
 * Seed step `promotions` (CONTRACT.md 11.5, 8): the 8 Promotion nodes. They are created as drafts and moved to their
 * seeded status with the managed commit of `promotions.transition` (the system surface, rule R-PROMO-SCHEDULE), each
 * move followed by its `promotion.state_changed` event at the virtual time of the move. The activation of
 * `black-friday-tech` is requested by the agent for Maya through the real action (dry run, then commit with the token),
 * so it stays held in `change_approvals` for Priya's approval. Redemption history is not written here: it is produced by
 * the orders and awards of the activity step evaluating these promotions (and topped up by `activityMarketing`).
 */

type Spec = Omit<PromotionSpec, "status" | "owner"> & { owner?: string };

interface Seeded {
  readonly slug: string;
  readonly title: string;
  readonly spec: Spec;
  /** Moves applied by the managed commit, each at its virtual time. */
  readonly path: ReadonlyArray<{ readonly to: PromotionStatus; readonly at: string }>;
}

const LEAD = "user:marketing-lead";

const PROMOTIONS: ReadonlyArray<Seeded> = [
  {
    slug: "gold-double-points",
    title: "Double points for Gold and Platinum",
    spec: {
      description: "Recognition awards earn double points for Gold and Platinum members during peak season.",
      banner: { headline: "Double points this week", tone: "signal", icon: "bolt" },
      eligibility: { tiers: ["gold", "platinum"], channels: ["recognition"] },
      effects: [{ type: "points_multiplier", factor: 2 }],
      budget: { max_cost_points: 250000, max_per_member: 10 },
      schedule: { starts_at: "2026-11-09T00:00:00Z", ends_at: "2026-12-01T00:00:00Z" },
      priority: 500,
      stacking: "exclusive",
    },
    path: [{ to: "active", at: "2026-11-08T10:00:00Z" }],
  },
  {
    slug: "peak-season-store-15",
    title: "Peak season: 15% off apparel and wellness",
    spec: {
      description: "Fifteen percent off apparel and wellness rewards for the whole peak season.",
      banner: { headline: "15% off apparel and wellness", tone: "success", icon: "percent" },
      eligibility: { channels: ["store"] },
      effects: [
        { type: "store_discount", percent: 15, categories: ["category:apparel", "category:wellness"] },
      ],
      budget: { max_cost_points: 120000 },
      schedule: { starts_at: "2026-11-02T00:00:00Z", ends_at: "2026-12-02T00:00:00Z" },
      priority: 300,
      stacking: "stack",
      stack_group: "seasonal",
    },
    path: [{ to: "active", at: "2026-11-01T09:00:00Z" }],
  },
  {
    slug: "giving-match",
    title: "Giving match",
    spec: {
      description:
        "Every giving order earns a 200 point bonus from the programme, up to three times per member.",
      banner: { headline: "We match your giving", tone: "info", icon: "heart" },
      eligibility: { channels: ["store"], categories: ["category:giving"] },
      effects: [{ type: "bonus_points", points: 200, on: "purchase" }],
      budget: { max_per_member: 3 },
      schedule: { starts_at: "2026-10-25T00:00:00Z", ends_at: "2026-12-31T00:00:00Z" },
      priority: 200,
      stacking: "stack",
    },
    path: [{ to: "active", at: "2026-10-24T09:00:00Z" }],
  },
  {
    slug: "new-joiner-welcome",
    title: "New joiner welcome",
    spec: {
      description: "A 500 point bonus on the first order of members who joined in the last 120 days.",
      banner: { headline: "Welcome bonus on your first order", tone: "info", icon: "gift" },
      eligibility: { channels: ["store"], segments: ["segment:new-joiners"] },
      effects: [{ type: "bonus_points", points: 500, on: "purchase" }],
      budget: { max_per_member: 1 },
      schedule: { starts_at: "2026-11-23T00:00:00Z", ends_at: "2026-12-23T00:00:00Z" },
      priority: 150,
      stacking: "stack",
    },
    path: [{ to: "scheduled", at: "2026-11-18T09:00:00Z" }],
  },
  {
    slug: "emea-weekend-boost",
    title: "EMEA weekend boost",
    spec: {
      description: "Recognition earns 1.5x for EMEA members on Saturdays and Sundays.",
      eligibility: { regions: ["EMEA"], channels: ["recognition"] },
      effects: [{ type: "points_multiplier", factor: 1.5 }],
      budget: {},
      schedule: {
        starts_at: "2026-11-07T00:00:00Z",
        ends_at: "2026-12-07T00:00:00Z",
        days_of_week: [6, 7],
      },
      priority: 400,
      stacking: "stack",
    },
    path: [
      { to: "active", at: "2026-11-06T09:00:00Z" },
      { to: "paused", at: "2026-11-16T12:00:00Z" },
    ],
  },
  {
    slug: "black-friday-tech",
    title: "Black Friday tech",
    spec: {
      description:
        "Twenty percent off every tech reward over Black Friday weekend, at most 3 000 points per order.",
      banner: { headline: "Black Friday: 20% off tech", tone: "danger", icon: "laptop" },
      eligibility: { channels: ["store"] },
      effects: [
        { type: "store_discount", percent: 20, categories: ["category:tech"], max_discount_points: 3000 },
      ],
      budget: {},
      schedule: { starts_at: "2026-11-27T00:00:00Z", ends_at: "2026-12-01T00:00:00Z" },
      priority: 350,
      stacking: "stack",
    },
    path: [],
  },
  {
    slug: "free-tote-over-5k",
    title: "Free tote over 5 000",
    spec: {
      description: "A free canvas tote on every cart of 5 000 points or more.",
      banner: { headline: "Free tote on big carts", tone: "success", icon: "bag" },
      eligibility: { channels: ["store"], min_cart_points: 5000 },
      effects: [{ type: "free_item", product: "product:canvas-tote", min_cart_points: 5000 }],
      budget: {},
      schedule: { starts_at: "2026-10-20T00:00:00Z", ends_at: "2026-11-10T00:00:00Z" },
      priority: 100,
      stacking: "stack",
      owner: "user:ops-lead",
    },
    path: [
      { to: "active", at: "2026-10-19T09:00:00Z" },
      { to: "ended", at: "2026-11-10T00:00:00Z" },
    ],
  },
  {
    slug: "reengage-at-risk",
    title: "Re-engage at-risk members",
    spec: {
      description:
        "A 1 000 point bonus for members who come back to the store, granted by the win-back automation.",
      eligibility: { channels: ["store"], entitlement_only: true },
      effects: [{ type: "bonus_points", points: 1000, on: "purchase" }],
      budget: { max_per_member: 1 },
      schedule: { starts_at: "2026-11-24T00:00:00Z", ends_at: "2026-12-31T00:00:00Z" },
      priority: 250,
      stacking: "stack",
    },
    path: [],
  },
];

export const promotionsStep: SeedStep = {
  name: "promotions",
  spec: "11.5, 8",
  run: (ctx) =>
    Effect.gen(function* () {
      const body = (p: Seeded) => ({
        apiVersion: "plinth/v1",
        kind: "Promotion",
        metadata: { slug: p.slug, title: p.title },
        spec: { status: "draft", owner: LEAD, ...p.spec },
      });
      yield* ctx.commitNodes(
        PROMOTIONS.map((p) => ctx.create("Promotion", p.slug, body(p))),
        "seed: promotions (drafts)",
      );
      const uri = (slug: string) =>
        nodeUri(ctx.workspaceSlug, "Promotion", nodeId(ctx.workspaceId, "Promotion", slug));

      // the seeded moves: managed commits on the system surface, each announced at its own virtual time
      for (const p of PROMOTIONS) {
        let rev = 1;
        let from: PromotionStatus = "draft";
        for (const m of p.path) {
          const res = yield* ctx.commitNodes(
            [
              {
                target: uri(p.slug),
                base_revision: rev,
                ops: [{ op: "set", path: "/spec/status", value: m.to }],
              },
            ],
            `seed: ${p.slug} ${from} to ${m.to}`,
            { by: "promotions.transition" },
          );
          rev = res.nodes?.[0]?.result_revision ?? rev + 1;
          yield* inTx(
            emitFrom(ctx.emitCtx(new Date(m.at)), "promotion.state_changed", {
              audience: ["*"],
              subject: { kind: "promotion", id: p.slug },
              payload: { promotion: p.slug, title: p.title, from, to: m.to, revision: rev },
            }),
          );
          from = m.to;
        }
      }

      // the held activation: the agent asks for Maya, through the real action (dry run, then commit with the token)
      // The agent acts with its ceiling intersected with its delegator's grants, and Maya (admin, manager) holds no
      // promotions:manage through her roles (CONTRACT 3.6), so the request for her needs one seeded grant of her own.
      yield* ctx.commitNodes(
        [
          ctx.create("Grant", "ops-lead-promotions", {
            apiVersion: "plinth/v1",
            kind: "Grant",
            metadata: { slug: "ops-lead-promotions", title: "ops-lead-promotions" },
            spec: {
              principal: "user:ops-lead",
              effect: "allow",
              actions: ["promotions:manage"],
              resource: `plinth://${ctx.workspaceSlug}/suite/`,
              status: "active",
            },
          }),
        ],
        "seed: promotions:manage for the delegator of the held activation",
      );
      const agent = yield* ctx.principal("agent:claude-code");
      const at = new Date("2026-11-19T16:10:00Z");
      const input = {
        slug: "black-friday-tech",
        to: "scheduled",
        reason: "Prepare the Black Friday tech offer for Maya",
        base_revision: 1,
      };
      const dry = yield* invoke({
        actor: { principal: agent, surface: "mcp" },
        name: "promotions.transition",
        input,
        dryRun: true,
        at,
      });
      if (dry.kind !== "preview")
        return yield* Effect.die(new Error(`seed: the dry run of the black-friday-tech activation gave ${dry.kind}`));
      const filed = yield* invoke({
        actor: { principal: agent, surface: "mcp" },
        name: "promotions.transition",
        input,
        previewToken: dry.preview.preview_token,
        idempotencyKey: "seed-black-friday-tech-activation",
        at,
      });
      // the change log holds the activation (R-PROMO-ACTIVATE); the commit answers with the filed approval
      if (filed.kind !== "result" || (filed.data as { status?: string }).status !== "pending_approval")
        return yield* Effect.die(
          new Error(`seed: the black-friday-tech activation was not held: ${JSON.stringify(filed).slice(0, 400)}`),
        );
    }),
};
