import type { Kind } from "./common";
import { SUITE_KIND_PURPOSE } from "./suite/examples";

/**
 * Minimal valid documents per node kind, served by `schema.describe`. Tests decode every one against its schema
 * (and the Panel examples against the `orders` source), so an example cannot drift from the schema.
 */
const SLOWEST_P95 = {
  from: "source:orders",
  where: [
    { field: "placed_at", op: "gte", value: { expr: "now() - 1h" } },
    { field: "fulfilled_at", op: "not_null" },
  ],
  derive: {
    latency_ms: "ms(fulfilled_at - placed_at)",
    minute: "bucket(placed_at, '1 minute')",
  },
  group: ["minute", "region"],
  aggregate: { p95: { fn: "percentile", of: "latency_ms", p: 0.95 } },
  order: [{ field: "minute", dir: "asc" }],
};

export const PANEL_EXAMPLES = {
  line: {
    apiVersion: "plinth/v1",
    kind: "Panel",
    metadata: { slug: "p95-by-region", title: "Fulfilment p95 by region (ms)" },
    spec: {
      query: SLOWEST_P95,
      visual: {
        type: "line",
        channels: { x: "minute", y: "p95", series: "region" },
        options: { unit: "ms" },
      },
    },
  },
  heatmap: {
    apiVersion: "plinth/v1",
    kind: "Panel",
    metadata: { slug: "carrier-heatmap", title: "Handoff p95 by region and carrier (ms)" },
    spec: {
      query: {
        from: "source:orders",
        where: [
          { field: "placed_at", op: "gte", value: { expr: "now() - 1h" } },
          { field: "handed_to_carrier_at", op: "not_null" },
        ],
        derive: { handoff_ms: "ms(handed_to_carrier_at - packed_at)" },
        group: ["region", "carrier"],
        aggregate: { p95: { fn: "percentile", of: "handoff_ms", p: 0.95 } },
      },
      visual: {
        type: "heatmap",
        channels: { x: "carrier", y: "region", value: "p95" },
        options: { unit: "ms" },
      },
    },
  },
  bar: {
    apiVersion: "plinth/v1",
    kind: "Panel",
    metadata: { slug: "orders-by-region", title: "Orders by region" },
    spec: {
      query: {
        from: "source:orders",
        where: [{ field: "placed_at", op: "gte", value: { expr: "now() - 24h" } }],
        group: ["region"],
        aggregate: { orders: { fn: "count" } },
      },
      visual: { type: "bar", channels: { x: "region", y: "orders" } },
    },
  },
  kpi: {
    apiVersion: "plinth/v1",
    kind: "Panel",
    metadata: { slug: "orders-last-hour", title: "Orders in the last hour" },
    spec: {
      query: {
        from: "source:orders",
        where: [{ field: "placed_at", op: "gte", value: { expr: "now() - 1h" } }],
        aggregate: { orders: { fn: "count" } },
      },
      visual: { type: "kpi", channels: { value: "orders" } },
    },
  },
  table: {
    apiVersion: "plinth/v1",
    kind: "Panel",
    metadata: { slug: "recent-orders", title: "Recent orders" },
    spec: {
      query: {
        from: "source:orders",
        where: [{ field: "placed_at", op: "gte", value: { expr: "now() - 15m" } }],
        select: ["order_id", "region", "carrier", "status", "placed_at"],
        order: [{ field: "placed_at", dir: "desc" }],
        limit: 50,
      },
      visual: { type: "table", columns: ["order_id", "region", "carrier", "status", "placed_at"] },
    },
  },
} as const;

export const KIND_EXAMPLES: Partial<Record<Kind, unknown>> = {
  Dashboard: {
    apiVersion: "plinth/v1",
    kind: "Dashboard",
    metadata: { slug: "regional-ops", title: "Regional ops" },
    spec: {
      parameters: { window: { type: "duration", default: "1h" } },
      layout: { columns: 12, items: [] },
    },
  },
  Panel: PANEL_EXAMPLES.line,
  Grant: {
    apiVersion: "plinth/v1",
    kind: "Grant",
    metadata: { slug: "emea-finance-rows", title: "EMEA rows on the finance board" },
    spec: {
      principal: "user:emea-lead",
      effect: "allow",
      actions: ["node:read"],
      resource: "dashboard:finance-board",
      row_predicate: "region = 'EMEA'",
      column_mask: [],
    },
  },
};

export const KIND_PURPOSE: Record<Kind, string> = {
  Dashboard: "A grid of panels with parameters. Create it, then place panels on it.",
  Panel: "One visual (line, bar, heatmap, kpi, table, area, scatter) over a query. Place it on a Dashboard.",
  Query: "A named, reusable query AST. Not available yet.",
  Source: "A data source and its fields. Read-only for agents; see source.list.",
  Parameter: "A named dashboard parameter. Not available yet.",
  Rule: "An alert over a query. Not available yet.",
  Action: "A server-side action in the registry. Not available yet.",
  Form: "A form bound to an action. Not available yet.",
  Workflow: "A state machine for incidents. Not available yet.",
  Grant:
    "Who may read what, optionally narrowed by a row predicate. An agent's grant is held for human approval.",
  Metric: "A named metric expression. Not available yet.",
  Template: "A reusable node template. Not available yet.",
  Export: "A scheduled export. Not available yet.",
  Annotation: "A note pinned to a node. Not available yet.",
  Comment: "A comment on a node. Not available yet.",
  ...SUITE_KIND_PURPOSE,
};
