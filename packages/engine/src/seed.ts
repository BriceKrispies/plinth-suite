import { Effect } from "effect";
import { nodeId, nodeUri, principalId, workspaceId, GENESIS_HASH } from "@plinth/core";
import {
  AGENT_SUITE_CEILING,
  auditSourceBody,
  type AggObject,
  ordersSourceBody,
  type DashboardBody,
  type GrantSpec,
  type Kind,
  type NodeChange,
  type PanelBody,
} from "@plinth/spec";
import { AppConfig } from "./config";
import { PlinthClock } from "./clock";
import { ChangeLog } from "./change-log";
import { ControlStore, store } from "./control-store";
import type { Principal } from "./identity";
import { migrate } from "./migrator";

/** The seeded principals (README: Identities). Stable subjects; ids are UUIDv5 of the subject. */
export const SEED_PRINCIPALS = [
  { subject: "user:ops-lead", kind: "human", name: "Maya Ortiz" },
  { subject: "user:emea-lead", kind: "human", name: "Jonas Becker" },
  { subject: "user:finance-analyst", kind: "human", name: "Priya Nair" },
  { subject: "agent:claude-code", kind: "agent", name: "Claude Code", delegator: "user:ops-lead" },
  { subject: "service:replay-driver", kind: "service", name: "Replay driver" },
  { subject: "service:ingest", kind: "service", name: "Ingest" },
] as const;

/**
 * The agent ceiling (spec 03 section 5.3). It holds `grant:inspect` and `grant:propose`, never `grant:write` or
 * `approval:decide`. `node:write:<Kind>` entries name the kinds the agent may write.
 */
export const AGENT_CEILING = {
  permissions: [
    ...AGENT_SUITE_CEILING,
    "node:read",
    "node:write:Dashboard",
    "node:write:Panel",
    "node:write:Query",
    "node:write:Rule",
    "node:write:Form",
    "node:write:Parameter",
    "node:delete",
    "query:run",
    "action:notify",
    "workflow:read",
    "grant:propose",
    "grant:inspect",
    "ui:present",
  ],
};

/** The seeded grants (spec 03 section 7.2 and the README identities). Committed on the system surface. */
export const seedGrants = (ws: string): ReadonlyArray<{ slug: string; spec: GrantSpec }> => [
  {
    slug: "ops-lead-all",
    spec: {
      principal: "user:ops-lead",
      effect: "allow",
      actions: [
        "node:read",
        "node:write",
        "node:delete",
        "query:run",
        "grant:inspect",
        "grant:propose",
        "grant:write",
        "workflow:read",
        "workflow:acknowledge",
        "action:notify",
        "ui:present",
      ],
      resource: `plinth://${ws}/`,
      row_predicate: null,
      column_mask: [],
      status: "active",
    },
  },
  {
    slug: "emea-lead-ops-board",
    spec: {
      principal: "user:emea-lead",
      effect: "allow",
      actions: ["node:read"],
      resource: `plinth://${ws}/Dashboard/ops-board`,
      row_predicate: "region = 'EMEA'",
      column_mask: [],
      status: "active",
    },
  },
  {
    slug: "emea-lead-finance-board",
    spec: {
      principal: "user:emea-lead",
      effect: "allow",
      actions: ["node:read"],
      resource: `plinth://${ws}/Dashboard/finance-board`,
      row_predicate: null,
      column_mask: [],
      status: "active",
    },
  },
  {
    slug: "emea-lead-sources",
    spec: {
      principal: "user:emea-lead",
      effect: "allow",
      actions: ["node:read"],
      resource: `plinth://${ws}/Source/`,
      row_predicate: null,
      column_mask: [],
      status: "active",
    },
  },
  {
    slug: "finance-analyst-board",
    spec: {
      principal: "user:finance-analyst",
      effect: "allow",
      actions: [
        "node:read",
        "node:write",
        "node:delete",
        "approval:decide",
        "grant:write",
        "grant:inspect",
        "grant:propose",
      ],
      resource: `plinth://${ws}/Dashboard/finance-board`,
      row_predicate: null,
      column_mask: [],
      status: "active",
    },
  },
  {
    slug: "finance-analyst-sources",
    spec: {
      principal: "user:finance-analyst",
      effect: "allow",
      actions: ["node:read", "query:run"],
      resource: `plinth://${ws}/Source/`,
      row_predicate: null,
      column_mask: [],
      status: "active",
    },
  },
  {
    slug: "finance-analyst-grants",
    spec: {
      principal: "user:finance-analyst",
      effect: "allow",
      actions: ["node:read"],
      resource: `plinth://${ws}/Grant/`,
      row_predicate: null,
      column_mask: [],
      status: "active",
    },
  },
];

const financePanel = (
  slug: string,
  title: string,
  aggregate: Record<string, string | AggObject>,
  y: string,
): PanelBody => ({
  apiVersion: "plinth/v1",
  kind: "Panel",
  metadata: { slug, title },
  spec: {
    query: {
      from: "source:orders",
      where: [{ field: "placed_at", op: "gte", value: { expr: "now() - 24h" } }],
      group: ["region"],
      aggregate,
      order: [{ field: "region", dir: "asc" }],
    },
    visual: { type: "bar", channels: { x: "region", y } },
  },
});

/**
 * Reset the control store to the demo seed: migrate, truncate every table, create workspace `northwind`, the
 * principals, the `orders` and `audit.changes` Sources, the seeded grants, an empty `ops-board` Dashboard and the
 * `finance-board` Dashboard with two panels over `orders`. Everything goes through the real commit path, on the
 * system surface. Returns the new run prefix; the caller re-lands history under it.
 */
export const resetAndSeed = Effect.gen(function* () {
  const cfg = yield* AppConfig;
  const { sql } = yield* ControlStore;
  const clock = yield* PlinthClock;
  const log = yield* ChangeLog;
  yield* migrate;
  const wsId = workspaceId(cfg.workspaceSlug);
  const now = yield* clock.now;
  const runPrefix = `${cfg.runPrefixRoot}/r` + now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  if (process.env["VITEST"] !== undefined && cfg.db.name === "plinth")
    return yield* Effect.die(
      new Error("tests must not reset the demo database; use PLINTH_DB_NAME=plinth_test"),
    );

  yield* store(
    sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`TRUNCATE action_idempotency, promotion_usage, automation_metric_state, outbox, idempotency_records, preview_tokens, change_approvals, changes, nodes, workspace_chain,
                            source_partitions, source_shards, virtual_clock, principals, workspaces CASCADE`;
        yield* sql`INSERT INTO workspaces (workspace_id, slug, manifest_id, run_prefix) VALUES (${wsId}, ${cfg.workspaceSlug}, 'l2', ${runPrefix})`;
        yield* sql`INSERT INTO workspace_chain (workspace_id, head_seq, head_hash) VALUES (${wsId}, 0, ${GENESIS_HASH})`;
        for (const p of SEED_PRINCIPALS) {
          const delegator = "delegator" in p ? principalId(wsId, p.delegator) : null;
          const scope = p.kind === "agent" ? JSON.stringify(AGENT_CEILING) : null;
          yield* sql`INSERT INTO principals (principal_id, workspace_id, kind, subject, display_name, delegator_id, max_scope)
                     VALUES (${principalId(wsId, p.subject)}, ${wsId}, ${p.kind}, ${p.subject}, ${p.name}, ${delegator}, ${scope}::jsonb)`;
        }
        yield* sql`INSERT INTO source_shards (source_id, shard_count) VALUES ('orders', 1)`;
      }),
    ),
  );

  const system: Principal = {
    id: principalId(wsId, "service:ingest"),
    subject: "service:ingest",
    kind: "service",
    displayName: "Ingest",
    workspaceId: wsId,
    workspaceSlug: cfg.workspaceSlug,
    delegatorId: null,
    delegatorSubject: null,
  };
  const create = (kind: Kind, slug: string, body: unknown): NodeChange => ({
    target: nodeUri(cfg.workspaceSlug, kind, nodeId(wsId, kind, slug)),
    base_revision: null,
    ops: [{ op: "create", kind, slug, body }],
  });
  const commit = (changes: ReadonlyArray<NodeChange>, reason: string) =>
    log.commit({ actor: { principal: system, surface: "system" }, changes, reason });

  const dashboard = (
    slug: string,
    title: string,
    items: DashboardBody["spec"]["layout"]["items"],
  ): DashboardBody => ({
    apiVersion: "plinth/v1",
    kind: "Dashboard",
    metadata: { slug, title },
    spec: { layout: { columns: 12, items } },
  });

  yield* commit(
    [create("Source", "orders", ordersSourceBody()), create("Source", "audit.changes", auditSourceBody())],
    "seed: sources",
  );
  yield* commit(
    seedGrants(cfg.workspaceSlug).map((g) =>
      create("Grant", g.slug, {
        apiVersion: "plinth/v1",
        kind: "Grant",
        metadata: { slug: g.slug, title: g.slug },
        spec: g.spec,
      }),
    ),
    "seed: grants",
  );
  yield* commit(
    [create("Dashboard", "ops-board", dashboard("ops-board", "Ops board", []))],
    "seed: ops board",
  );
  yield* commit(
    [
      create(
        "Panel",
        "finance-revenue-by-region",
        financePanel(
          "finance-revenue-by-region",
          "Revenue by region",
          { revenue: { fn: "sum" as const, of: "order_value_cents" } },
          "revenue",
        ),
      ),
      create(
        "Panel",
        "finance-orders-by-region",
        financePanel(
          "finance-orders-by-region",
          "Orders by region",
          { orders: { fn: "count" as const } },
          "orders",
        ),
      ),
      create(
        "Dashboard",
        "finance-board",
        dashboard("finance-board", "Finance board", [
          { panel: "panel:finance-revenue-by-region", at: { x: 0, y: 0, w: 6, h: 6 } },
          { panel: "panel:finance-orders-by-region", at: { x: 6, y: 0, w: 6, h: 6 } },
        ]),
      ),
    ],
    "seed: finance board",
  );
  return { workspaceId: wsId, runPrefix };
});

export type { PanelBody };
