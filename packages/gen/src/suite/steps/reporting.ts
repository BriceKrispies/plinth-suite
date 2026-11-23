import { Effect } from "effect";
import { SUITE_SOURCES, type DashboardBody, type PanelBody } from "@plinth/spec";
import { ControlStore, store } from "@plinth/engine";
import type { SeedStep } from "../seed";

/**
 * Seed step `reporting` (CONTRACT.md 13.1, 13.3). Commits the 12 Suite reporting Sources (curated Postgres views exposed
 * as `metadata` Sources, label `plinth.suite: "true"`) and the three Suite boards with their Panels:
 * `programme-overview`, `store-performance` and `engagement`. The kernel `orders` Source belongs to the kernel reset;
 * this step only checks that it is present and refuses to run without it, since the kernel boards depend on it.
 */

interface PanelDef {
  readonly slug: string;
  readonly title: string;
  readonly from: string;
  readonly where?: ReadonlyArray<{ field: string; op: string; value?: unknown }>;
  readonly derive?: Record<string, string>;
  readonly group?: ReadonlyArray<string>;
  readonly aggregate?: Record<string, unknown>;
  readonly order?: ReadonlyArray<{ field: string; dir: "asc" | "desc" }>;
  readonly limit?: number;
  readonly visual: PanelBody["spec"]["visual"];
}

const panel = (d: PanelDef): PanelBody =>
  ({
    apiVersion: "plinth/v1",
    kind: "Panel",
    metadata: { slug: d.slug, title: d.title, labels: { "plinth.suite": "true" } },
    spec: {
      query: {
        from: `source:${d.from}`,
        ...(d.where ? { where: d.where } : {}),
        ...(d.derive ? { derive: d.derive } : {}),
        ...(d.group ? { group: d.group } : {}),
        ...(d.aggregate ? { aggregate: d.aggregate } : {}),
        ...(d.order ? { order: d.order } : {}),
        ...(d.limit ? { limit: d.limit } : {}),
      },
      visual: d.visual,
    },
  }) as unknown as PanelBody;

const DAY = "bucket(%, '1 day')";
const day = (col: string) => DAY.replace("%", col);

const PROGRAMME: ReadonlyArray<PanelDef> = [
  {
    slug: "suite-points-flow",
    title: "Points issued and redeemed per day",
    from: "suite.ledger",
    where: [{ field: "account_kind", op: "eq", value: "member" }],
    derive: { day: day("occurred_at") },
    group: ["day", "txn_type"],
    aggregate: { points: { fn: "sum", of: "amount" } },
    order: [{ field: "day", dir: "asc" }],
    visual: {
      type: "area",
      channels: { x: "day", y: "points", series: "txn_type" },
      options: { stacked: false, unit: "pts" },
    },
  },
  {
    slug: "suite-active-members",
    title: "Active members",
    from: "suite.members",
    where: [{ field: "status", op: "eq", value: "active" }],
    aggregate: { active_members: { fn: "count" } },
    visual: { type: "kpi", channels: { value: "active_members" } },
  },
  {
    slug: "suite-tier-distribution",
    title: "Members by tier",
    from: "suite.members",
    where: [{ field: "status", op: "eq", value: "active" }],
    group: ["tier"],
    aggregate: { members: { fn: "count" } },
    order: [{ field: "members", dir: "desc" }],
    visual: { type: "bar", channels: { x: "tier", y: "members" } },
  },
  {
    slug: "suite-badges-per-week",
    title: "Badges awarded per week",
    from: "suite.badge_awards",
    where: [{ field: "revoked", op: "eq", value: false }],
    derive: { week: "bucket(awarded_at, '7 day')" },
    group: ["week"],
    aggregate: { awards: { fn: "count" } },
    order: [{ field: "week", dir: "asc" }],
    visual: { type: "line", channels: { x: "week", y: "awards" } },
  },
];

const STORE: ReadonlyArray<PanelDef> = [
  {
    slug: "suite-revenue-per-day",
    title: "Revenue in points per day",
    from: "suite.store_orders",
    where: [{ field: "status", op: "not_in", value: ["cancelled", "refunded"] }],
    derive: { day: day("placed_at") },
    group: ["day"],
    aggregate: { revenue: { fn: "sum", of: "total_points" } },
    order: [{ field: "day", dir: "asc" }],
    visual: { type: "line", channels: { x: "day", y: "revenue" }, options: { unit: "pts" } },
  },
  {
    slug: "suite-top-products",
    title: "Top products",
    from: "suite.order_items",
    where: [{ field: "status", op: "not_in", value: ["cancelled", "refunded"] }],
    group: ["product_title"],
    aggregate: { units: { fn: "sum", of: "qty" }, points: { fn: "sum", of: "line_points" } },
    order: [{ field: "points", dir: "desc" }],
    limit: 10,
    visual: { type: "table", columns: ["product_title", "units", "points"], options: { page_size: 10 } },
  },
  {
    slug: "suite-orders-by-status",
    title: "Orders by status",
    from: "suite.store_orders",
    group: ["status"],
    aggregate: { orders: { fn: "count" } },
    order: [{ field: "orders", dir: "desc" }],
    visual: { type: "bar", channels: { x: "status", y: "orders" } },
  },
  {
    slug: "suite-fulfilment-p95",
    title: "Fulfilment time, 95th percentile, by region",
    from: "suite.store_orders",
    where: [{ field: "fulfil_ms", op: "not_null" }],
    group: ["region"],
    aggregate: { p95_ms: { fn: "percentile", of: "fulfil_ms", p: 0.95 } },
    order: [{ field: "region", dir: "asc" }],
    visual: { type: "bar", channels: { x: "region", y: "p95_ms" }, options: { unit: "ms" } },
  },
];

const ENGAGEMENT: ReadonlyArray<PanelDef> = [
  {
    slug: "suite-promotion-redemptions",
    title: "Redemptions per promotion",
    from: "suite.promotion_redemptions",
    where: [{ field: "reversed", op: "eq", value: false }],
    group: ["promotion"],
    aggregate: { redemptions: { fn: "count" } },
    order: [{ field: "redemptions", dir: "desc" }],
    visual: { type: "bar", channels: { x: "promotion", y: "redemptions" } },
  },
  {
    slug: "suite-promotion-cost",
    title: "Cost per promotion",
    from: "suite.promotion_redemptions",
    where: [{ field: "reversed", op: "eq", value: false }],
    group: ["promotion"],
    aggregate: { cost: { fn: "sum", of: "cost_points" } },
    order: [{ field: "cost", dir: "desc" }],
    visual: { type: "bar", channels: { x: "promotion", y: "cost" }, options: { unit: "pts" } },
  },
  {
    slug: "suite-automation-heatmap",
    title: "Automation runs by day",
    from: "suite.automation_runs",
    derive: { day: day("created_at") },
    group: ["automation", "day"],
    aggregate: { runs: { fn: "count" } },
    visual: { type: "heatmap", channels: { x: "day", y: "automation", value: "runs" } },
  },
  {
    slug: "suite-message-volume",
    title: "Messages per day by thread kind",
    from: "suite.messages",
    derive: { day: day("sent_at") },
    group: ["day", "thread_kind"],
    aggregate: { messages: { fn: "count" } },
    order: [{ field: "day", dir: "asc" }],
    visual: {
      type: "area",
      channels: { x: "day", y: "messages", series: "thread_kind" },
      options: { stacked: true },
    },
  },
  {
    slug: "suite-content-views",
    title: "Content views by item",
    from: "suite.content_engagement",
    group: ["title"],
    aggregate: { views: { fn: "sum", of: "views" } },
    order: [{ field: "views", dir: "desc" }],
    limit: 10,
    visual: { type: "table", columns: ["title", "views"], options: { page_size: 10 } },
  },
];

const dashboard = (
  slug: string,
  title: string,
  items: ReadonlyArray<readonly [string, number, number, number, number]>,
): DashboardBody =>
  ({
    apiVersion: "plinth/v1",
    kind: "Dashboard",
    metadata: { slug, title, labels: { "plinth.suite": "true" } },
    spec: {
      layout: {
        columns: 12,
        items: items.map(([p, x, y, w, h]) => ({ panel: `panel:${p}`, at: { x, y, w, h } })),
      },
    },
  }) as unknown as DashboardBody;

export const reportingStep: SeedStep = {
  name: "reporting",
  spec: "13.1, 13.3",
  run: (ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const orders = yield* store(
        sql<{
          n: number;
        }>`SELECT 1 AS n FROM nodes WHERE workspace_id = ${ctx.workspaceId} AND kind = 'Source' AND slug = 'orders'`,
      );
      if (orders.length === 0)
        return yield* Effect.die(
          new Error("the kernel orders Source is missing: run the kernel reset first"),
        );
      yield* ctx.commitNodes(
        SUITE_SOURCES.map((s) => ctx.create("Source", s.body.metadata.slug, s.body)),
        "seed: suite reporting sources",
      );
      yield* ctx.commitNodes(
        [...PROGRAMME, ...STORE, ...ENGAGEMENT].map((d) => ctx.create("Panel", d.slug, panel(d))),
        "seed: suite reporting panels",
      );
      yield* ctx.commitNodes(
        [
          ctx.create(
            "Dashboard",
            "programme-overview",
            dashboard("programme-overview", "Programme overview", [
              ["suite-points-flow", 0, 0, 8, 6],
              ["suite-active-members", 8, 0, 4, 3],
              ["suite-tier-distribution", 8, 3, 4, 3],
              ["suite-badges-per-week", 0, 6, 12, 5],
            ]),
          ),
          ctx.create(
            "Dashboard",
            "store-performance",
            dashboard("store-performance", "Store performance", [
              ["suite-revenue-per-day", 0, 0, 8, 6],
              ["suite-orders-by-status", 8, 0, 4, 6],
              ["suite-top-products", 0, 6, 7, 6],
              ["suite-fulfilment-p95", 7, 6, 5, 6],
            ]),
          ),
          ctx.create(
            "Dashboard",
            "engagement",
            dashboard("engagement", "Engagement", [
              ["suite-promotion-redemptions", 0, 0, 6, 5],
              ["suite-promotion-cost", 6, 0, 6, 5],
              ["suite-automation-heatmap", 0, 5, 12, 6],
              ["suite-message-volume", 0, 11, 7, 6],
              ["suite-content-views", 7, 11, 5, 6],
            ]),
          ),
        ],
        "seed: suite reporting boards",
      );
    }),
};
