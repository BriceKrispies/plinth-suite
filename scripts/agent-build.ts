// Replays an agent's board-building session over real MCP calls (preview -> commit per step).
// It is not a UI animation: every step is a real tool call through the same path a live agent uses.
//   tsx scripts/agent-build.ts [delayMs=2500] [fromStep=1]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const delay = Number(process.argv[2] ?? 2500);
const from = Number(process.argv[3] ?? 1);
const url = new URL(process.env.PLINTH_MCP_URL ?? "http://localhost:8790/mcp");
const token = process.env.PLINTH_MCP_TOKEN ?? "dev-agent-claude-code";
const DASH = "plinth://northwind/Dashboard/5ae7964d-8abf-57eb-b795-a5bf81998c8b";

const client = new Client({ name: "plinth-agent-build", version: "0.1.0" });
await client.connect(
  new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${token}` } } }),
);

const call = async (name: string, args: unknown) => {
  const r = await client.callTool({ name, arguments: args as Record<string, unknown> });
  const text = (r.content as Array<{ type: string; text?: string }>)[0]?.text ?? "{}";
  return JSON.parse(text) as { ok: boolean; data?: any; error?: any };
};

const window = [
  { field: "placed_at", op: "gte", value: "2026-11-20T14:00:00Z" },
  { field: "placed_at", op: "lt", value: "2026-11-20T14:20:00Z" },
];
const lastHour = [{ field: "placed_at", op: "gte", value: "now() - 1h" }];

type Step = { slug: string; title: string; query: unknown; visual: unknown; at: unknown };
const steps: Step[] = [
  {
    slug: "kpi-orders",
    title: "Orders, last hour",
    query: { from: "source:orders", where: lastHour, aggregate: { orders: "count()" } },
    visual: { type: "kpi", channels: { value: "orders" } },
    at: { x: 0, y: 0, w: 3, h: 3 },
  },
  {
    slug: "kpi-p95",
    title: "p95 fulfilment latency, last hour",
    query: {
      from: "source:orders",
      where: lastHour,
      derive: { latency_ms: "handed_to_carrier_at - placed_at" },
      aggregate: { p95_latency_ms: "percentile(latency_ms, 0.95)" },
    },
    visual: { type: "kpi", channels: { value: "p95_latency_ms" } },
    at: { x: 3, y: 0, w: 3, h: 3 },
  },
  {
    slug: "p95-by-region",
    title: "p95 fulfilment latency by region, last hour",
    query: {
      from: "source:orders",
      where: lastHour,
      derive: { latency_ms: "handed_to_carrier_at - placed_at" },
      group: ["region"],
      aggregate: { p95_latency_ms: "percentile(latency_ms, 0.95)", orders: "count()" },
      order: [{ field: "p95_latency_ms", dir: "desc" }],
    },
    visual: { type: "bar", channels: { x: "region", y: "p95_latency_ms" } },
    at: { x: 6, y: 0, w: 6, h: 5 },
  },
  {
    slug: "carrier-heatmap",
    title: "p95 handoff by carrier and region, 14:00-14:20",
    query: {
      from: "source:orders",
      where: window,
      derive: { handoff_ms: "handed_to_carrier_at - packed_at" },
      group: ["carrier", "region"],
      aggregate: { p95_handoff_ms: "percentile(handoff_ms, 0.95)" },
    },
    visual: {
      type: "heatmap",
      channels: { x: "region", y: "carrier", value: "p95_handoff_ms" },
      threshold: { value: 600, style: "alert" },
    },
    at: { x: 0, y: 5, w: 8, h: 5 },
  },
  {
    slug: "emea-carriers",
    title: "EMEA by carrier, 14:00-14:20",
    query: {
      from: "source:orders",
      where: [...window, { field: "region", op: "eq", value: "EMEA" }],
      derive: { handoff_ms: "handed_to_carrier_at - packed_at" },
      group: ["carrier"],
      aggregate: { orders: "count()", p95_handoff_ms: "percentile(handoff_ms, 0.95)" },
      order: [{ field: "p95_handoff_ms", dir: "desc" }],
    },
    visual: { type: "table", columns: ["carrier", "orders", "p95_handoff_ms"] },
    at: { x: 8, y: 5, w: 4, h: 5 },
  },
];

for (const [i, s] of steps.entries()) {
  if (i + 1 < from) continue;
  const pv = await call("node.preview", {
    kind: "Panel",
    body: {
      apiVersion: "plinth/v1",
      kind: "Panel",
      metadata: { slug: s.slug, title: s.title },
      spec: { query: s.query, visual: s.visual },
    },
    place: { dashboard: DASH, at: s.at },
  });
  if (!pv.ok) {
    console.log(`step ${i + 1} ${s.slug}: preview refused`, JSON.stringify(pv.error));
    continue;
  }
  const cm = await call("node.commit", {
    preview_token: pv.data.preview_token,
    idempotency_key: `agent-build:${s.slug}`,
  });
  console.log(
    `step ${i + 1} ${s.slug}: ${cm.ok ? `committed seq ${cm.data.change_seq} (${pv.data.rule_id.join(", ")})` : JSON.stringify(cm.error)}`,
  );
  await new Promise((r) => setTimeout(r, delay));
}
await client.close();
