// Opens every prototype at once, has the agent commit a new panel over MCP, and screenshots each
// page shortly after the change arrives (the "agent just built this" moment).
//   tsx scripts/proto-live.ts [outDir=shots/proto] [slug=orders-by-carrier]
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { join } from "node:path";

const [, , outDir = "shots/proto", slug = "orders-by-carrier"] = process.argv;
const ids = ["meridian", "nocturne", "folio", "lattice", "strata"];
const base = process.env.PLINTH_WEB_URL ?? "http://localhost:5173";
const DASH = "plinth://northwind/Dashboard/5ae7964d-8abf-57eb-b795-a5bf81998c8b";

const browser = await chromium.launch();
const pages = await Promise.all(
  ids.map(async (id) => {
    const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await p.goto(`${base}/proto/${id}/index.html?d=ops-board`);
    return [id, p] as const;
  }),
);
await Promise.all(pages.map(([, p]) => p.waitForLoadState("networkidle").catch(() => {})));
await new Promise((r) => setTimeout(r, 2500));

const mcp = new Client({ name: "proto-live", version: "0.1.0" });
await mcp.connect(
  new StreamableHTTPClientTransport(new URL("http://localhost:8790/mcp"), {
    requestInit: { headers: { authorization: "Bearer dev-agent-claude-code" } },
  }),
);
const call = async (name: string, args: unknown) =>
  JSON.parse(
    ((await mcp.callTool({ name, arguments: args as Record<string, unknown> })).content as Array<{ text: string }>)[0]!
      .text,
  );
const pv = await call("node.preview", {
  kind: "Panel",
  body: {
    apiVersion: "plinth/v1",
    kind: "Panel",
    metadata: { slug, title: "Orders by carrier, last hour" },
    spec: {
      query: {
        from: "source:orders",
        where: [{ field: "placed_at", op: "gte", value: "now() - 1h" }],
        group: ["carrier"],
        aggregate: { orders: "count()" },
        order: [{ field: "orders", dir: "desc" }],
      },
      visual: { type: "bar", channels: { x: "carrier", y: "orders" } },
    },
  },
  place: { dashboard: DASH, at: { x: 0, y: 3, w: 6, h: 2 } },
});
if (!pv.ok) throw new Error(JSON.stringify(pv.error));
const cm = await call("node.commit", { preview_token: pv.data.preview_token, idempotency_key: `proto-live:${slug}` });
console.log("committed", cm.data?.change_seq ?? JSON.stringify(cm.error));
await mcp.close();

await new Promise((r) => setTimeout(r, 1800));
await Promise.all(pages.map(([id, p]) => p.screenshot({ path: join(outDir, `${id}-live.png`) })));
await new Promise((r) => setTimeout(r, 1500));
await Promise.all(pages.map(([id, p]) => p.screenshot({ path: join(outDir, `${id}-live-full.png`), fullPage: true })));
await browser.close();
